// Applies every migration to an in-process Postgres (PGlite) with a minimal
// stand-in for Supabase's auth schema, then checks row-level security.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'

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
  db = new PGlite()
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
