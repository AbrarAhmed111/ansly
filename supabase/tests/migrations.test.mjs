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

test('permalinkless LinkedIn leads use distinct stable post identities', async () => {
  const insertLead = (tx, sourcePostId) =>
    tx.query(
      `insert into public.leads (
        source_platform, source_name, author_name, author_profile_url, company_name,
        title, opportunity_type, status, contactability, description, source_post_id
      ) values (
        'linkedin', 'LinkedIn', 'Alice', 'https://www.linkedin.com/in/alice/',
        'Unverified employer', 'Hiring React engineer', 'job', 'new',
        'email_available', 'Hiring React engineer', $1
      )`,
      [sourcePostId],
    )

  await asUser(ALICE, async (tx) => {
    await insertLead(tx, 'ansly:sha256:post-1')
    await insertLead(tx, 'ansly:sha256:post-2')
  })
  await assert.rejects(asUser(ALICE, (tx) => insertLead(tx, 'ansly:sha256:post-1')))
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
  // PDF is accepted again since the role resume library; the insert trigger keeps masters Word-only.
  assert.deepEqual(rows, [
    {
      allowed_mime_types: [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ],
    },
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

test('profiles persist Apply Agent behavior mode', async () => {
  await asUser(ALICE, async (tx) => {
    const { rows } = await tx.query(
      `update public.profiles set application_agent_mode = 'aggressive' where id = $1
       returning application_agent_mode`,
      [ALICE],
    )
    assert.deepEqual(rows, [{ application_agent_mode: 'aggressive' }])
  })
  await assert.rejects(
    asUser(ALICE, (tx) =>
      tx.query(`update public.profiles set application_agent_mode = 'unknown' where id = $1`, [ALICE]),
    ),
    /check constraint/,
  )
})

test('application runs, events and checkpoints are owner-isolated and append-only', async () => {
  let runId
  await asUser(ALICE, async (tx) => {
    const inserted = await tx.query(
      `insert into public.application_runs (
        job_key, title, company, job_url, platform, route, behavior_mode, status, authorization_data
      ) values (
        'linkedin:senior-engineer:company-x', 'Senior Engineer', 'Company X',
        'https://www.linkedin.com/jobs/view/123', 'linkedin', 'website',
        'normal', 'awaiting_authorization', '{"route":"website"}'::jsonb
      ) returning id`,
    )
    runId = inserted.rows[0].id
    await tx.query(
      `insert into public.application_run_events (run_id, type, activity, status)
       values ($1, 'activity', 'Analyzing job description', 'completed')`,
      [runId],
    )
    await tx.query(
      `insert into public.application_run_checkpoints (run_id, name, status, page_fingerprint)
       values ($1, 'job_detected', 'completed', 'page-123')`,
      [runId],
    )
  })

  await asUser(BOB, async (tx) => {
    assert.equal((await tx.query('select * from public.application_runs')).rows.length, 0)
    assert.equal((await tx.query('select * from public.application_run_events')).rows.length, 0)
    assert.equal((await tx.query('select * from public.application_run_checkpoints')).rows.length, 0)
  })

  await asUser(ALICE, async (tx) => {
    await tx.query(
      `update public.application_runs set status = 'authorized' where id = $1`,
      [runId],
    )
    await tx.query(
      `update public.application_run_checkpoints set status = 'completed' where run_id = $1`,
      [runId],
    )
  })

  await assert.rejects(
    asUser(ALICE, (tx) =>
      tx.query(
        `insert into public.application_runs (
          job_key, title, platform, route, behavior_mode, status
        ) values (
          'linkedin:senior-engineer:company-x', 'Second run', 'linkedin',
          'website', 'normal', 'detected'
        )`,
      ),
    ),
    /duplicate key/,
  )

  await asUser(ALICE, async (tx) => {
    await tx.query(`update public.application_runs set status = 'submitted' where id = $1`, [runId])
  })
  await asUser(ALICE, async (tx) => {
    await tx.query(
      `insert into public.application_runs (
        job_key, title, platform, route, behavior_mode, status
      ) values (
        'linkedin:senior-engineer:company-x', 'Retest after completed run',
        'linkedin', 'website', 'normal', 'detected'
      )`,
    )
  })
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
  // Each bucket names the usage kind its tokens came from, for the per-feature dashboard cards.
  assert.deepEqual(
    s.token_buckets.map(([, tokens, kind]) => [kind, Number(tokens)]),
    [['generate', 150]],
  )
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

test('library resumes may be PDF; masters must stay Word', async () => {
  await asUser(ALICE, async (tx) => {
    await tx.query(
      `insert into public.resumes (name, file_path, file_type, version, role_label)
       values ('Backend', $1, 'pdf', 900, 'Backend Engineer')`,
      [`${ALICE}/library/a/backend.pdf`],
    )
  })
  await assert.rejects(
    asUser(ALICE, (tx) =>
      tx.query(
        `insert into public.resumes (name, file_path, file_type, version) values ('Master', $1, 'pdf', 901)`,
        [`${ALICE}/masters/master.pdf`],
      ),
    ),
    /Word/,
  )
})

test('drafts attach only the owner\'s resumes and lose the attachment when it is deleted', async () => {
  const lead = (tx, id) =>
    tx.query(
      `insert into public.leads (source_platform, source_name, author_name, company_name, title,
         opportunity_type, status, contactability, description, original_post_url)
       values ('linkedin', 'LinkedIn', 'A', 'X', 'Hiring', 'job', 'new', 'email_available', 'Hiring', $1)
       returning id`,
      [`https://www.linkedin.com/feed/update/urn:li:activity:${id}/`],
    )
  const { leadId, resumeId } = await asUser(ALICE, async (tx) => {
    const leadId = (await lead(tx, 7001)).rows[0].id
    const resumeId = (
      await tx.query(
        `insert into public.resumes (name, file_path, file_type, version, role_label)
         values ('FE', $1, 'docx', 902, 'Frontend Developer') returning id`,
        [`${ALICE}/library/b/fe.docx`],
      )
    ).rows[0].id
    await tx.query(
      `insert into public.lead_drafts (lead_id, recipient_email, subject, body, resume_id, resume_selection)
       values ($1, 'jobs@example.com', 'Hi', 'Body', $2, 'auto')`,
      [leadId, resumeId],
    )
    return { leadId, resumeId }
  })

  // Bob can't attach Alice's resume to his own draft.
  await assert.rejects(
    asUser(BOB, async (tx) => {
      const bobLead = (await lead(tx, 7002)).rows[0].id
      await tx.query(
        `insert into public.lead_drafts (lead_id, subject, body, resume_id, resume_selection)
         values ($1, 'Hi', 'Body', $2, 'user')`,
        [bobLead, resumeId],
      )
    }),
  )

  await asUser(ALICE, async (tx) => {
    await tx.query('delete from public.resumes where id = $1', [resumeId])
    const { rows } = await tx.query('select resume_id, resume_selection from public.lead_drafts where lead_id = $1', [leadId])
    assert.deepEqual(rows, [{ resume_id: null, resume_selection: 'needs_selection' }])

    await tx.query(`update public.lead_drafts set delivery_status = 'sending' where lead_id = $1`, [leadId])
  })
  await assert.rejects(asUser(ALICE, (tx) => tx.query('delete from public.leads where id = $1', [leadId])), /being sent/)
})

test('email connections and send history are private', async () => {
  await asUser(ALICE, (tx) =>
    tx.query(
      `insert into public.email_connections (provider, email_address, refresh_token_ciphertext, token_key_id)
       values ('gmail', 'alice@gmail.com', 'ciphertext', 'k1')`,
    ),
  )
  await asUser(BOB, async (tx) => {
    const { rows } = await tx.query('select id from public.email_connections')
    assert.equal(rows.length, 0)
  })
  await assert.rejects(
    asUser(ALICE, (tx) =>
      tx.query(
        `insert into public.email_connections (provider, email_address, refresh_token_ciphertext, token_key_id)
         values ('gmail', 'other@gmail.com', 'c', 'k1')`,
      ),
    ),
  )
})

test('profile pictures live in a private, image-only bucket under the owner’s prefix', async () => {
  const { rows: buckets } = await db.query(
    `select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'avatars'`,
  )
  assert.deepEqual(buckets, [
    { public: false, file_size_limit: 2097152, allowed_mime_types: ['image/png', 'image/jpeg', 'image/webp'] },
  ])

  await asUser(ALICE, async (tx) => {
    await tx.query(`insert into storage.objects (bucket_id, name) values ('avatars', $1)`, [`${ALICE}/avatar-1.png`])
    // The profile can point at the owner's own file, never at another user's prefix.
    await tx.query(`update public.profiles set avatar_path = $1 where id = $2`, [`${ALICE}/avatar-1.png`, ALICE])
  })
  await assert.rejects(
    asUser(ALICE, (tx) =>
      tx.query(`insert into storage.objects (bucket_id, name) values ('avatars', $1)`, [`${BOB}/avatar-1.png`]),
    ),
  )
  await assert.rejects(
    asUser(ALICE, (tx) => tx.query(`update public.profiles set avatar_path = $1 where id = $2`, [`${BOB}/x.png`, ALICE])),
  )
  await asUser(BOB, async (tx) => {
    const { rows } = await tx.query(`select name from storage.objects where bucket_id = 'avatars'`)
    assert.deepEqual(rows, [])
    assert.equal((await tx.query(`delete from storage.objects where bucket_id = 'avatars'`)).affectedRows, 0)
    const { rows: profiles } = await tx.query(`select avatar_path from public.profiles where id = $1`, [ALICE])
    assert.deepEqual(profiles, [])
  })
  await asUser(ALICE, async (tx) => {
    assert.equal((await tx.query(`delete from storage.objects where bucket_id = 'avatars'`)).affectedRows, 1)
    await tx.query(`update public.profiles set avatar_path = null where id = $1`, [ALICE])
  })
})

test('a sent email marks its lead contacted, and sent leads that drifted are repaired', async () => {
  const lead = (tx, id) =>
    tx.query(
      `insert into public.leads (source_platform, source_name, author_name, company_name, title,
         opportunity_type, status, contactability, description, original_post_url)
       values ('linkedin', 'LinkedIn', 'A', 'X', 'Hiring', 'job', 'new', 'email_available', 'Hiring', $1)
       returning id`,
      [`https://www.linkedin.com/feed/update/urn:li:activity:${id}/`],
    )
  const draft = (tx, leadId) =>
    tx.query(
      `insert into public.lead_drafts (lead_id, recipient_email, subject, body, resume_selection)
       values ($1, 'jobs@example.com', 'Hi', 'Body', 'none_by_user') returning id`,
      [leadId],
    )
  const status = (tx, id) => tx.query('select status from public.leads where id = $1', [id]).then((r) => r.rows[0].status)

  // New sends: the draft turning 'sent' marks the lead contacted, with a status event.
  await asUser(ALICE, async (tx) => {
    const leadId = (await lead(tx, 8001)).rows[0].id
    await draft(tx, leadId)
    await tx.query(`update public.lead_drafts set delivery_status = 'failed' where lead_id = $1`, [leadId])
    assert.equal(await status(tx, leadId), 'new')
    await tx.query(`update public.lead_drafts set delivery_status = 'sent', sent_at = now() where lead_id = $1`, [leadId])
    assert.equal(await status(tx, leadId), 'contacted')
    const { rows } = await tx.query('select new_status, reason from public.lead_status_events where lead_id = $1', [leadId])
    assert.deepEqual(rows, [{ new_status: 'contacted', reason: 'email_sent' }])
  })

  // Old rows: Gmail accepted the email but the draft and lead were never updated.
  const drifted = await asUser(ALICE, async (tx) => {
    const leadId = (await lead(tx, 8002)).rows[0].id
    const draftId = (await draft(tx, leadId)).rows[0].id
    await tx.query(
      `insert into public.email_send_attempts (draft_id, lead_id, provider, from_address, recipient_email, subject, body,
         status, provider_message_id)
       values ($1, $2, 'gmail', 'a@gmail.com', 'jobs@example.com', 'Hi', 'Body', 'sending', 'msg-1')`,
      [draftId, leadId],
    )
    const untouched = (await lead(tx, 8003)).rows[0].id
    await draft(tx, untouched)
    return { leadId, untouched }
  })
  await db.exec(await readFile(join(migrationsDir, '20261116000000_lead_sent_contacted.sql'), 'utf8'))

  await asUser(ALICE, async (tx) => {
    const { rows } = await tx.query('select delivery_status from public.lead_drafts where lead_id = $1', [drifted.leadId])
    assert.deepEqual(rows, [{ delivery_status: 'sent' }])
    assert.equal(await status(tx, drifted.leadId), 'contacted')
    assert.equal(await status(tx, drifted.untouched), 'new')
  })
})

test('a lead removed by Ansly Cleanup stays stored and still blocks re-collecting its post', async () => {
  const insert = (tx) =>
    tx.query(
      `insert into public.leads (source_platform, source_name, author_name, company_name, title,
         opportunity_type, status, contactability, description, source_post_id)
       values ('linkedin', 'LinkedIn', 'A', 'X', 'Laravel dev', 'job', 'new', 'email_available', 'Laravel', $1)
       returning id`,
      ['urn:li:activity:9001'],
    )
  await asUser(ALICE, async (tx) => {
    const id = (await insert(tx)).rows[0].id
    await tx.query(
      `update public.leads set removed_at = now(), removed_by = 'cleanup', removed_category = 'stack_mismatch',
         removed_reason = 'Only Laravel.' where id = $1`,
      [id],
    )
  })
  await assert.rejects(asUser(ALICE, (tx) => insert(tx)), /duplicate key/)
  await assert.rejects(
    asUser(ALICE, (tx) => tx.query(`update public.leads set removed_by = 'robot' where source_post_id = 'urn:li:activity:9001'`)),
  )
})

test('Job Outreach drafts, resume attachments, and send attempts stay owner-scoped', async () => {
  const created = await asUser(ALICE, async (tx) => {
    const resume = await tx.query(
      `insert into public.resumes (name, file_path, file_type, version, role_label, parse_status)
       values ('Backend.pdf', $1, 'pdf', 1, 'Backend Engineer', 'parsed') returning id`,
      [`${ALICE}/library/backend.pdf`],
    )
    const draft = await tx.query(
      `insert into public.job_outreach_drafts (job_text, job_info, resume_id, resume_selection, match_confidence,
         status, recipient_email, subject, body)
       values ('A complete pasted job advertisement', '{"application_method":"email"}', $1, 'auto', 'high',
         'draft', 'jobs@example.com', 'Backend Engineer', 'Hello Hiring Team.') returning id`,
      [resume.rows[0].id],
    )
    await tx.query(
      `insert into public.email_send_attempts (job_outreach_id, provider, from_address, recipient_email, subject, body)
       values ($1, 'gmail', 'alice@example.com', 'jobs@example.com', 'Backend Engineer', 'Hello')`,
      [draft.rows[0].id],
    )
    return { resumeId: resume.rows[0].id, draftId: draft.rows[0].id }
  })

  await asUser(BOB, async (tx) => {
    assert.equal((await tx.query('select * from public.job_outreach_drafts')).rows.length, 0)
    assert.equal((await tx.query('update public.job_outreach_drafts set status = \'sent\'')).affectedRows, 0)
    assert.equal((await tx.query('delete from public.job_outreach_drafts')).affectedRows, 0)
    await assert.rejects(
      tx.query(
        `insert into public.job_outreach_drafts (job_text, resume_id)
         values ('Another pasted ad', $1)`,
        [created.resumeId],
      ),
      /foreign key/,
    )
  })

  await asUser(ALICE, async (tx) => {
    const { rows } = await tx.query(
      'select status, resume_id, resume_selection from public.job_outreach_drafts where id = $1',
      [created.draftId],
    )
    assert.deepEqual(rows, [{ status: 'draft', resume_id: created.resumeId, resume_selection: 'auto' }])
    await tx.query('delete from public.resumes where id = $1', [created.resumeId])
    const detached = await tx.query(
      'select resume_id, resume_selection from public.job_outreach_drafts where id = $1',
      [created.draftId],
    )
    assert.deepEqual(detached.rows, [{ resume_id: null, resume_selection: 'needs_selection' }])
  })

  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.exec('set local role anon')
      await tx.query('select * from public.job_outreach_drafts')
    }),
    /permission denied/,
  )
})
