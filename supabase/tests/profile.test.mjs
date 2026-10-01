// V1 schema: profile, sections, saved answers and usage events.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { ALICE, BOB, asUser as runAs, createDb } from './db.mjs'

let db
const asUser = (userId, fn) => runAs(db, userId, fn)

before(async () => {
  db = await createDb()
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

test('anonymous visitors cannot read profile data', async () => {
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.exec('set local role anon')
      await tx.query('select * from public.profiles')
    }),
    /permission denied/,
  )
})
