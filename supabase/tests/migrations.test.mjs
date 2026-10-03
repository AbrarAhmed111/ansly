// Applies every migration to an in-process Postgres (PGlite) with a minimal
// stand-in for Supabase's auth schema, then checks row-level security.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const ALICE = '00000000-0000-0000-0000-00000000000a'
const BOB = '00000000-0000-0000-0000-00000000000b'

// The parts of Supabase the migrations rely on.
const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (
    id uuid primary key,
    email text,
    raw_user_meta_data jsonb default '{}'::jsonb
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema public, auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;

  create schema storage;
  create table storage.buckets (
    id text primary key,
    name text not null,
    public boolean default false,
    file_size_limit bigint,
    allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets (id),
    name text not null,
    owner uuid default auth.uid()
  );
  create function storage.foldername(name text) returns text[] language sql immutable as $$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
  $$;
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated;
  grant select, insert, update, delete on storage.objects to anon, authenticated;
  grant select on storage.buckets to anon, authenticated;
  grant execute on function storage.foldername(text) to anon, authenticated;
`

let db

/** Runs `fn` as a signed-in user, the way PostgREST does. */
async function asUser(userId, fn) {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId])
    await tx.exec('set local role authenticated')
    return fn(tx)
  })
}

before(async () => {
  db = new PGlite({ extensions: { vector } })
  await db.exec(SUPABASE_STUB)
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort()
  assert.ok(files.length > 0, 'no migrations found')
  for (const file of files) {
    await db.exec(await readFile(join(migrationsDir, file), 'utf8'))
  }
  await db.query(
    `insert into auth.users (id, email, raw_user_meta_data) values
       ($1, 'alice@example.com', '{"full_name": "Alice"}'),
       ($2, 'bob@example.com', '{}')`,
    [ALICE, BOB],
  )
})

test('signup creates a profile row from auth metadata', async () => {
  const { rows } = await db.query('select id, email, full_name from public.profiles order by email')
  assert.deepEqual(rows, [
    { id: ALICE, email: 'alice@example.com', full_name: 'Alice' },
    { id: BOB, email: 'bob@example.com', full_name: null },
  ])
})

test('users only see and change their own profile', async () => {
  await asUser(ALICE, async (tx) => {
    const { rows } = await tx.query('select id from public.profiles')
    assert.deepEqual(rows, [{ id: ALICE }])
    const updated = await tx.query(`update public.profiles set headline = 'x' where id = $1`, [BOB])
    assert.equal(updated.affectedRows, 0)
  })
})

test('section rows default to the current user and are isolated', async () => {
  await asUser(ALICE, (tx) =>
    tx.query(`insert into public.experiences (company, title) values ('WebWhiz', 'Engineer')`),
  )
  await asUser(BOB, async (tx) => {
    const { rows } = await tx.query('select * from public.experiences')
    assert.equal(rows.length, 0)
    const deleted = await tx.query('delete from public.experiences')
    assert.equal(deleted.affectedRows, 0)
  })
  await asUser(ALICE, async (tx) => {
    const { rows } = await tx.query('select company, user_id from public.experiences')
    assert.deepEqual(rows, [{ company: 'WebWhiz', user_id: ALICE }])
  })
})

test('users cannot insert rows for someone else', async () => {
  await assert.rejects(
    asUser(BOB, (tx) =>
      tx.query(`insert into public.skills (user_id, name) values ($1, 'React')`, [ALICE]),
    ),
    /row-level security/,
  )
})

test('skill names are unique per user, case-insensitively', async () => {
  await asUser(ALICE, (tx) => tx.query(`insert into public.skills (name) values ('React')`))
  await assert.rejects(
    asUser(ALICE, (tx) => tx.query(`insert into public.skills (name) values ('react')`)),
    /duplicate key/,
  )
  // Another user can have the same skill.
  await asUser(BOB, (tx) => tx.query(`insert into public.skills (name) values ('React')`))
})

test('updated_at is bumped on update', async () => {
  const before = await asUser(ALICE, (tx) =>
    tx.query(`select updated_at from public.experiences`),
  )
  await new Promise((r) => setTimeout(r, 20))
  const after = await asUser(ALICE, (tx) =>
    tx.query(`update public.experiences set title = 'Senior Engineer' returning updated_at`),
  )
  assert.ok(after.rows[0].updated_at > before.rows[0].updated_at)
})

test('usage events are append-only', async () => {
  await asUser(ALICE, (tx) =>
    tx.query(`insert into public.usage_events (kind, category) values ('generate', 'project')`),
  )
  await assert.rejects(
    asUser(ALICE, (tx) => tx.query('delete from public.usage_events')),
    /permission denied/,
  )
  await assert.rejects(
    asUser(ALICE, (tx) => tx.query(`insert into public.usage_events (kind) values ('bogus')`)),
    /check constraint/,
  )
})

test('rate limit counts hits per user within the window', async () => {
  const check = (userId) =>
    asUser(userId, async (tx) => (await tx.query('select public.check_rate_limit(2, 60) as wait')).rows[0].wait)
  assert.equal(await check(ALICE), 0)
  assert.equal(await check(ALICE), 0)
  const wait = await check(ALICE)
  assert.ok(wait >= 1 && wait <= 60, `expected a retry delay, got ${wait}`)
  assert.equal(await check(BOB), 0)

  await assert.rejects(
    asUser(ALICE, (tx) => tx.query('select * from public.rate_limit_hits')),
    /permission denied/,
  )
  await assert.rejects(
    asUser(ALICE, (tx) => tx.query('select public.check_rate_limit(1, 999999)')),
    /invalid rate limit/,
  )
})

test('anonymous visitors cannot read profile data', async () => {
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.exec('set local role anon')
      await tx.query('select * from public.profiles')
    }),
    /permission denied/,
  )
})

test('profile facts are private to their owner and anon gets nothing', async () => {
  await asUser(ALICE, (tx) =>
    tx.query(`insert into public.profile_facts (category, prompt, answer, source)
              values ('leadership', 'Describe a time you led a team', 'I led the checkout rewrite.', 'extension')`),
  )
  await asUser(BOB, async (tx) => {
    assert.equal((await tx.query('select * from public.profile_facts')).rows.length, 0)
  })
  await asUser(ALICE, async (tx) => {
    const { rows } = await tx.query('select category, user_id, source from public.profile_facts')
    assert.deepEqual(rows, [{ category: 'leadership', user_id: ALICE, source: 'extension' }])
  })
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.exec('set local role anon')
      await tx.query('select * from public.profile_facts')
    }),
    /permission denied/,
  )
})

test("skills accept level 'none' and usage events accept 'fill_all'", async () => {
  await asUser(ALICE, async (tx) => {
    await tx.query(`insert into public.skills (name, level) values ('Kubernetes', 'none')`)
    await tx.query(`insert into public.usage_events (kind) values ('fill_all')`)
  })
  await assert.rejects(
    asUser(ALICE, (tx) => tx.query(`insert into public.skills (name, level) values ('Rust', 'guru')`)),
    /check constraint/,
  )
})

// ---------------------------------------------------------------------------
// v1.2 resume tailoring
// ---------------------------------------------------------------------------

/** Inserts a master resume, job context and tailoring for `userId`; returns their ids. */
async function seedTailoring(userId, version = 1) {
  return asUser(userId, async (tx) => {
    const resume = await tx.query(
      `insert into public.resumes (name, file_path, file_type, version, is_master, parse_status)
       values ('Resume.docx', $1, 'docx', $2, true, 'parsed') returning id`,
      [`${userId}/masters/v${version}.docx`, version],
    )
    const job = await tx.query(
      `insert into public.job_contexts (title, company, description, source)
       values ('Senior Full Stack Engineer', 'Company X', 'Build things with React.', 'manual') returning id`,
    )
    const tailoring = await tx.query(
      `insert into public.resume_tailorings (resume_id, resume_version, job_context_id, pipeline_version, output_file_path)
       values ($1, $2, $3, '1.2.0', $4) returning id`,
      [resume.rows[0].id, version, job.rows[0].id, `${userId}/tailored/t1.docx`],
    )
    return { resumeId: resume.rows[0].id, jobId: job.rows[0].id, tailoringId: tailoring.rows[0].id }
  })
}

test('resumes, job contexts and tailorings are private to their owner', async () => {
  const alice = await seedTailoring(ALICE)
  await asUser(BOB, async (tx) => {
    for (const table of ['resumes', 'job_contexts', 'resume_tailorings']) {
      assert.equal((await tx.query(`select * from public.${table}`)).rows.length, 0, table)
      assert.equal((await tx.query(`update public.${table} set user_id = user_id`)).affectedRows, 0, table)
      assert.equal((await tx.query(`delete from public.${table}`)).affectedRows, 0, table)
    }
  })
  await asUser(ALICE, async (tx) => {
    const { rows } = await tx.query('select id, status from public.resume_tailorings')
    assert.deepEqual(rows, [{ id: alice.tailoringId, status: 'queued' }])
  })
  for (const table of ['resumes', 'job_contexts', 'resume_tailorings']) {
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.exec('set local role anon')
        await tx.query(`select * from public.${table}`)
      }),
      /permission denied/,
      table,
    )
  }
})

test('a tailoring cannot reference another user’s resume or job', async () => {
  const alice = await asUser(ALICE, async (tx) => ({
    resumeId: (await tx.query('select id from public.resumes limit 1')).rows[0].id,
    jobId: (await tx.query('select id from public.job_contexts limit 1')).rows[0].id,
  }))
  await assert.rejects(
    asUser(BOB, (tx) =>
      tx.query(
        `insert into public.resume_tailorings (resume_id, resume_version, job_context_id, pipeline_version)
         values ($1, 1, $2, '1.2.0')`,
        [alice.resumeId, alice.jobId],
      ),
    ),
    /foreign key/,
  )
})

test('one master per user; replacing it keeps old versions', async () => {
  await assert.rejects(
    asUser(ALICE, (tx) =>
      tx.query(
        `insert into public.resumes (name, file_path, file_type, version, is_master)
         values ('Second.docx', $1, 'docx', 2, true)`,
        [`${ALICE}/masters/v2.docx`],
      ),
    ),
    /duplicate key/,
  )
  await asUser(ALICE, async (tx) => {
    await tx.query('update public.resumes set is_master = false where is_master')
    await tx.query(
      `insert into public.resumes (name, file_path, file_type, version, is_master)
       values ('Second.docx', $1, 'docx', 2, true)`,
      [`${ALICE}/masters/v2.docx`],
    )
    const { rows } = await tx.query('select version, is_master from public.resumes order by version')
    assert.deepEqual(rows, [
      { version: 1, is_master: false },
      { version: 2, is_master: true },
    ])
  })
  // Each user has their own master.
  await asUser(BOB, (tx) =>
    tx.query(
      `insert into public.resumes (name, file_path, file_type, is_master) values ('Bob.docx', $1, 'docx', true)`,
      [`${BOB}/masters/v1.docx`],
    ),
  )
})

test('file paths must sit under the owner’s prefix', async () => {
  await assert.rejects(
    asUser(BOB, (tx) =>
      tx.query(
        `insert into public.resumes (name, file_path, file_type, version) values ('x.docx', $1, 'docx', 9)`,
        [`${ALICE}/masters/x.docx`],
      ),
    ),
    /check constraint/,
  )
})

test('new resumes must be Word documents; older PDF versions keep working', async () => {
  for (const [type, path] of [['pdf', 'cv.pdf'], ['docx', 'cv.pdf'], ['pdf', 'cv.docx']]) {
    await assert.rejects(
      asUser(BOB, (tx) =>
        tx.query(`insert into public.resumes (name, file_path, file_type, version) values ('cv', $1, $2, 5)`, [
          `${BOB}/masters/${path}`,
          type,
        ]),
      ),
      /Word \(\.docx\)/,
      `${type} ${path}`,
    )
  }
  // A PDF version from before the change (inserted around the trigger) can still be updated and deleted.
  await db.exec('alter table public.resumes disable trigger resumes_require_docx')
  await db.query(
    `insert into public.resumes (user_id, name, file_path, file_type, version) values ($1, 'Old.pdf', $2, 'pdf', 7)`,
    [BOB, `${BOB}/masters/old.pdf`],
  )
  await db.exec('alter table public.resumes enable trigger resumes_require_docx')
  await asUser(BOB, async (tx) => {
    await tx.query(`update public.resumes set name = 'Old resume.pdf', is_master = false where version = 7`)
    assert.equal((await tx.query('delete from public.resumes where version = 7')).affectedRows, 1)
  })
  const { rows } = await db.query(`select allowed_mime_types from storage.buckets where id = 'resumes'`)
  assert.deepEqual(rows, [
    { allowed_mime_types: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'] },
  ])
})

test('deleting an old resume version keeps its tailorings', async () => {
  await asUser(ALICE, async (tx) => {
    await tx.query('delete from public.resumes where version = 1')
    const { rows } = await tx.query('select resume_id, resume_version from public.resume_tailorings')
    assert.deepEqual(rows, [{ resume_id: null, resume_version: 1 }])
  })
})

test('tailoring status is constrained and updated_at is bumped', async () => {
  await assert.rejects(
    asUser(ALICE, (tx) => tx.query(`update public.resume_tailorings set status = 'done'`)),
    /check constraint/,
  )
  const before = await asUser(ALICE, (tx) => tx.query('select updated_at from public.resume_tailorings'))
  await new Promise((r) => setTimeout(r, 20))
  const after = await asUser(ALICE, (tx) =>
    tx.query(`update public.resume_tailorings set status = 'analyzing' returning updated_at`),
  )
  assert.ok(after.rows[0].updated_at > before.rows[0].updated_at)
})

test('resume files are private to their owner’s storage prefix', async () => {
  const { rows: buckets } = await db.query(`select public from storage.buckets where id = 'resumes'`)
  assert.deepEqual(buckets, [{ public: false }])

  await asUser(ALICE, (tx) =>
    tx.query(`insert into storage.objects (bucket_id, name) values ('resumes', $1)`, [
      `${ALICE}/masters/resume.pdf`,
    ]),
  )
  await assert.rejects(
    asUser(BOB, (tx) =>
      tx.query(`insert into storage.objects (bucket_id, name) values ('resumes', $1)`, [`${ALICE}/masters/evil.pdf`]),
    ),
    /row-level security/,
  )
  await asUser(BOB, async (tx) => {
    assert.equal((await tx.query('select * from storage.objects')).rows.length, 0)
    assert.equal((await tx.query('delete from storage.objects')).affectedRows, 0)
  })
  await asUser(ALICE, async (tx) => {
    const { rows } = await tx.query('select name from storage.objects')
    assert.deepEqual(rows, [{ name: `${ALICE}/masters/resume.pdf` }])
  })
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.exec('set local role anon')
      await tx.query(`insert into storage.objects (bucket_id, name) values ('resumes', 'anon/x.pdf')`)
    }),
    /row-level security/,
  )
})

test('usage events accept the tailoring kinds', async () => {
  await asUser(ALICE, async (tx) => {
    for (const kind of [
      'resume_uploaded', 'resume_parse_failed', 'job_detected', 'tailoring_started', 'tailoring_completed',
      'tailoring_failed', 'resume_previewed', 'resume_downloaded', 'tailoring_deleted',
    ]) {
      await tx.query('insert into public.usage_events (kind) values ($1)', [kind])
    }
  })
})

test('the tailoring metrics queries run against the schema', async () => {
  await asUser(ALICE, (tx) =>
    tx.query(`insert into public.usage_events (kind, duration_ms, tokens, provider) values ('tailoring_completed', 42000, 9000, 'Gemini')`),
  )
  const sql = await readFile(join(migrationsDir, '..', 'analytics', 'tailoring_metrics.sql'), 'utf8')
  const statements = sql
    .split(/;\s*\n/)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean)
  assert.equal(statements.length, 5)
  for (const statement of statements) await db.query(statement)
  const { rows } = await db.query(statements[1])
  assert.equal(Number(rows[0].avg_seconds), 42)
})

test('profiles keep free-form additional context, up to 6000 characters', async () => {
  await asUser(ALICE, async (tx) => {
    const { rows } = await tx.query(
      `update public.profiles set additional_context = $1 where id = $2 returning additional_context`,
      ['Moving into platform engineering.', ALICE],
    )
    assert.deepEqual(rows, [{ additional_context: 'Moving into platform engineering.' }])
  })
  await assert.rejects(
    asUser(ALICE, (tx) =>
      tx.query(`update public.profiles set additional_context = $1 where id = $2`, ['x'.repeat(6001), ALICE]),
    ),
    /check constraint/,
  )
})

test('dashboard_summary aggregates the caller’s own data only', async () => {
  const CAROL = '00000000-0000-0000-0000-00000000000c'
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'carol@example.com', '{"full_name": "Carol"}')`, [CAROL])
  await asUser(CAROL, async (tx) => {
    await tx.query(`insert into public.experiences (company, title, description) values ('A', 'Eng', 'Built things')`)
    await tx.query(`insert into public.experiences (company, title, highlights) values ('B', 'Eng', '{"Shipped"}')`)
    await tx.query(`insert into public.projects (name, description) values ('P', 'An app')`)
    await tx.query(`insert into public.skills (name) values ('Go'), ('Rust')`)
    await tx.query(`insert into public.skills (name, level) values ('COBOL', 'none')`)
    await tx.query(`insert into public.usage_events (kind, tokens) values ('generate', 100), ('generate', 50), ('fill', null)`)
  })
  // Another user's activity must not leak in.
  await asUser(BOB, (tx) => tx.query(`insert into public.usage_events (kind, tokens) values ('generate', 999)`))

  const { rows } = await asUser(CAROL, (tx) => tx.query('select public.dashboard_summary() as s'))
  const s = rows[0].s
  assert.equal(s.profile.full_name, 'Carol')
  assert.equal(s.experiences, 2)
  assert.equal(s.experiences_described, true)
  assert.equal(s.projects_described, true)
  assert.equal(s.skills, 3)
  assert.equal(s.known_skills, 2)
  assert.equal(s.education, 0)
  assert.deepEqual(s.usage_7d, { generate: 2, fill: 1 })
  assert.equal(s.token_buckets.reduce((sum, [, tokens]) => sum + Number(tokens), 0), 150)
  assert.equal(s.master_resume, false)
  assert.equal(s.ready_tailorings, 0)

  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.exec('set local role anon')
      await tx.query('select public.dashboard_summary()')
    }),
    /permission denied/,
  )
})

test('job contexts can be found again by content hash, per user', async () => {
  await asUser(ALICE, (tx) =>
    tx.query(`insert into public.job_contexts (title, description, source, content_hash) values ('Eng', 'Build things', 'manual', 'h1')`),
  )
  const mine = await asUser(ALICE, (tx) => tx.query(`select id from public.job_contexts where content_hash = 'h1'`))
  assert.equal(mine.rows.length, 1)
  const theirs = await asUser(BOB, (tx) => tx.query(`select id from public.job_contexts where content_hash = 'h1'`))
  assert.equal(theirs.rows.length, 0)
})

const vec = (first) => `[${[first, ...new Array(767).fill(0)].join(',')}]`

test('candidate evidence embeddings are private and matched per user', async () => {
  const source = '00000000-0000-0000-0000-0000000000e1'
  await asUser(ALICE, (tx) =>
    tx.query(
      `insert into public.candidate_evidence (source_type, source_id, content_hash, embedding, embedding_model)
       values ('experience', $1, 'h', $2, 'm1')`,
      [source, vec(1)],
    ),
  )
  const mine = await asUser(ALICE, (tx) =>
    tx.query(`select source_id, similarity from public.match_candidate_evidence($1, 'm1', 5)`, [vec(1)]),
  )
  assert.equal(mine.rows.length, 1)
  assert.equal(mine.rows[0].source_id, source)
  assert.ok(Math.abs(mine.rows[0].similarity - 1) < 1e-6)
  const other = await asUser(ALICE, (tx) =>
    tx.query(`select * from public.match_candidate_evidence($1, 'another-model', 5)`, [vec(1)]),
  )
  assert.equal(other.rows.length, 0)
  await asUser(BOB, async (tx) => {
    assert.equal((await tx.query('select * from public.candidate_evidence')).rows.length, 0)
    assert.equal((await tx.query(`select * from public.match_candidate_evidence($1, 'm1', 5)`, [vec(1)])).rows.length, 0)
    assert.equal((await tx.query('delete from public.candidate_evidence')).affectedRows, 0)
  })
  await assert.rejects(
    asUser(BOB, (tx) =>
      tx.query(
        `insert into public.candidate_evidence (user_id, source_type, source_id, content_hash, embedding, embedding_model)
         values ($1, 'experience', $2, 'h', $3, 'm1')`,
        [ALICE, source, vec(1)],
      ),
    ),
    /row-level security/,
  )
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.exec('set local role anon')
      await tx.query('select * from public.candidate_evidence')
    }),
    /permission denied/,
  )
})

test('job_token_usage totals tokens per job, per user', async () => {
  const jobId = await asUser(ALICE, async (tx) =>
    (await tx.query(`insert into public.job_contexts (title, description, source) values ('Eng', 'Build', 'manual') returning id`)).rows[0].id,
  )
  await asUser(ALICE, (tx) =>
    tx.query(
      `insert into public.usage_events (kind, tokens, llm_calls, job_key, job_context_id) values
         ('job_analyzed', 1200, 1, 'k1', $1),
         ('tailoring_completed', 5000, 3, 'k1', $1),
         ('generate', 900, 1, 'k1', null),
         ('adapt_saved_answer', 400, 1, 'k1', null),
         ('generate', 700, 1, 'k2', null)`,
      [jobId],
    ),
  )
  const { rows } = await asUser(ALICE, (tx) =>
    tx.query(`select job_key, job_context_id, tailoring_tokens, answer_tokens, total_tokens, llm_calls
              from public.job_token_usage order by job_key`),
  )
  assert.deepEqual(rows.map((r) => [r.job_key, r.job_context_id, Number(r.tailoring_tokens), Number(r.answer_tokens),
    Number(r.total_tokens), Number(r.llm_calls)]), [
    ['k1', jobId, 6200, 1300, 7500, 6],
    ['k2', null, 0, 700, 700, 1],
  ])
  const theirs = await asUser(BOB, (tx) => tx.query('select * from public.job_token_usage'))
  assert.equal(theirs.rows.length, 0)
  await assert.rejects(
    asUser(BOB, (tx) =>
      tx.query(`insert into public.usage_events (kind, tokens, job_context_id) values ('generate', 1, $1)`, [jobId])),
    /foreign key/,
  )
  // Deleting the job keeps its usage, unlinked.
  await asUser(ALICE, (tx) => tx.query('delete from public.job_contexts where id = $1', [jobId]))
  const kept = await asUser(ALICE, (tx) => tx.query(`select total_tokens, job_context_id from public.job_token_usage where job_key = 'k1'`))
  assert.equal(Number(kept.rows[0].total_tokens), 7500)
  assert.equal(kept.rows[0].job_context_id, null)
})

test('llm_calls roll up into application_usage per job, by stage, with cost and usage pattern', async () => {
  await asUser(ALICE, (tx) =>
    tx.query(
      `insert into public.llm_calls
         (job_key, stage, provider, model, input_tokens, output_tokens, cache_read_tokens, thinking_tokens, ok, cost_usd, duration_ms)
       values
         ('app1', 'job_analysis', 'anthropic', 'claude-haiku-4-5', 700, 300, 0, null, true, 0.0022, 900),
         ('app1', 'matching', 'anthropic', 'claude-opus-5-5', 1700, 250, 0, null, true, 0.0118, 2000),
         ('app1', 'tailoring_plan', 'anthropic', 'claude-opus-5-5', 1800, 340, 600, null, true, 0.0141, 4000),
         ('app1', 'answer_batch', 'gemini', 'gemini-x', 2400, 800, 0, 50, true, null, 3000),
         ('app1', 'answer_batch', 'gemini', 'gemini-x', 300, 20, 0, null, false, null, 500),
         ('app1', 'answer_regeneration', 'gemini', 'gemini-x', 1200, 200, 0, null, true, null, 1500),
         ('app1', 'embedding_query', 'openai', 'text-embedding-3-small', 20, 0, 0, null, true, 0.0000004, 100),
         ('app2', 'answer', 'gemini', 'gemini-x', 1100, 200, 0, null, true, null, 1200),
         ('app2', 'answer', 'gemini', 'gemini-x', 1000, 180, 0, null, true, null, 1100),
         (null, 'answer', 'gemini', 'gemini-x', 1000, 180, 0, null, true, null, 1100)`,
    ),
  )
  const { rows } = await asUser(ALICE, (tx) => tx.query('select * from public.application_usage order by job_key'))
  assert.equal(rows.length, 2) // calls without a job aren't an application
  const [app1, app2] = rows
  assert.equal(Number(app1.job_analysis_tokens), 1000)
  assert.equal(Number(app1.tailoring_tokens), 2740)
  assert.equal(Number(app1.answer_tokens), 3520) // both batch calls: the unusable one was billed too
  assert.equal(Number(app1.regeneration_tokens), 1400)
  assert.equal(Number(app1.total_tokens), 1000 + 1950 + 2740 + 3520 + 1400) // embeddings apart
  assert.equal(Number(app1.cached_input_tokens), 600)
  assert.equal(Number(app1.thinking_tokens), 50)
  assert.equal(Number(app1.llm_calls), 6)
  assert.equal(Number(app1.failed_calls), 1)
  assert.equal(Number(app1.regenerations), 1)
  assert.equal(Number(app1.query_embedding_tokens), 20)
  assert.equal(Number(app1.unpriced_calls), 3)
  assert.equal(Number(app1.generation_cost_usd).toFixed(4), '0.0281')
  assert.equal(Number(app1.total_cost_usd).toFixed(7), '0.0281004')
  assert.equal(app1.usage_pattern, 'tailoring_fill_all')
  assert.equal(app2.usage_pattern, 'single_answer_heavy')

  const theirs = await asUser(BOB, (tx) => tx.query('select * from public.llm_calls'))
  assert.equal(theirs.rows.length, 0)
  await assert.rejects(
    asUser(BOB, (tx) => tx.query(`insert into public.llm_calls (user_id, stage, provider, model) values ($1, 'answer', 'p', 'm')`, [ALICE])),
    /row-level security/,
  )
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.exec('set local role anon')
      await tx.query('select * from public.application_usage')
    }),
    /permission denied/,
  )
})

test('the owner usage report runs', async () => {
  await asUser(ALICE, (tx) =>
    tx.query(`insert into public.usage_events (kind, category, duration_ms, edited) values
                ('generate', 'motivation', null, null), ('regenerate', 'motivation', null, null),
                ('fill', 'motivation', 4200, true)`),
  )
  const sql = await readFile(join(migrationsDir, '..', 'analytics', 'application_usage.sql'), 'utf8')
  const statements = sql.split(/;\s*\n/).map((s) => s.trim()).filter((s) => s.replace(/--.*$/gm, '').trim())
  assert.equal(statements.length, 8)
  for (const statement of statements) await db.query(statement)
  const quality = await db.query(statements[6])
  const { generated, regenerated } = quality.rows[0]
  assert.equal(Number(quality.rows[0].regenerations_per_generated), Number((Number(regenerated) / Number(generated)).toFixed(3)))
  assert.equal(Number(quality.rows[0].edited_before_fill_rate), 1)
  assert.equal(Number(quality.rows[0].median_wait_ms), 4200)
})
