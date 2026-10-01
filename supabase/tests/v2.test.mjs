// V2 schema: shared jobs, per-user matches/searches/alerts, the application workspace and resumes.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { ALICE, BOB, asAnon, asService, asUser, createDb } from './db.mjs'

let db
let jobId
let sourceId

before(async () => {
  db = await createDb()
  await asService(db, async (tx) => {
    const { rows } = await tx.query(`select id from public.job_sources where kind = 'greenhouse' and identifier = 'vercel'`)
    sourceId = rows[0].id
    const job = await tx.query(
      `insert into public.jobs (source_id, external_id, dedupe_key, url, title, company, skills)
       values ($1, '1', 'vercel|engineer|remote', 'https://example.com/1', 'Engineer', 'Vercel', '{nextjs,typescript}')
       returning id`,
      [sourceId],
    )
    jobId = job.rows[0].id
  })
})

test('initial job sources are seeded with their terms', async () => {
  const { rows } = await db.query(`select kind, terms_url from public.job_sources`)
  assert.ok(rows.length >= 10)
  assert.ok(rows.every((r) => r.terms_url), 'every source records where its terms are')
  assert.ok(!rows.some((r) => /linkedin|indeed/i.test(r.kind)))
})

test('signed-in users read jobs but cannot write them', async () => {
  await asUser(db, ALICE, async (tx) => {
    const { rows } = await tx.query('select title from public.jobs')
    assert.deepEqual(rows, [{ title: 'Engineer' }])
  })
  await assert.rejects(
    asUser(db, ALICE, (tx) =>
      tx.query(`insert into public.jobs (source_id, external_id, dedupe_key, url, title, company)
                values ($1, '2', 'x', 'https://x', 'X', 'X')`, [sourceId]),
    ),
    /permission denied/,
  )
  await assert.rejects(
    asUser(db, ALICE, (tx) => tx.query(`update public.job_sources set enabled = false`)),
    /permission denied/,
  )
})

test('anonymous visitors cannot read jobs', async () => {
  await assert.rejects(asAnon(db, (tx) => tx.query('select * from public.jobs')), /permission denied/)
})

test('the same job cannot be stored twice under one dedupe key', async () => {
  await assert.rejects(
    asService(db, (tx) =>
      tx.query(`insert into public.jobs (source_id, external_id, dedupe_key, url, title, company)
                values ($1, '99', 'vercel|engineer|remote', 'https://example.com/99', 'Engineer', 'Vercel')`, [sourceId]),
    ),
    /duplicate key/,
  )
})

test('job matches are private to each user', async () => {
  await asUser(db, ALICE, (tx) =>
    tx.query(`insert into public.job_matches (job_id, tier, score, matched_skills) values ($1, 'strong', 0.9, '{nextjs}')`, [jobId]),
  )
  await asUser(db, BOB, async (tx) => {
    const { rows } = await tx.query('select * from public.job_matches')
    assert.equal(rows.length, 0)
  })
  await assert.rejects(
    asUser(db, ALICE, (tx) =>
      tx.query(`insert into public.job_matches (job_id, tier, score) values ($1, 'excellent', 0.9)`, [jobId]),
    ),
    /check constraint|duplicate key/,
  )
})

test('saved searches and alerts belong to their owner', async () => {
  const searchId = await asUser(db, ALICE, async (tx) => {
    const { rows } = await tx.query(
      `insert into public.saved_searches (name, query, filters) values ('Remote', 'remote next.js', '{"workplace": ["remote"]}') returning id`,
    )
    await tx.query(`insert into public.job_alerts (saved_search_id, job_id, tier) values ($1, $2, 'good')`, [rows[0].id, jobId])
    return rows[0].id
  })
  await asUser(db, BOB, async (tx) => {
    assert.equal((await tx.query('select * from public.saved_searches')).rows.length, 0)
    assert.equal((await tx.query('select * from public.job_alerts')).rows.length, 0)
  })
  // Deleting a search removes its alerts.
  await asUser(db, ALICE, async (tx) => {
    await tx.query('delete from public.saved_searches where id = $1', [searchId])
    assert.equal((await tx.query('select * from public.job_alerts')).rows.length, 0)
  })
})

test('applications log creation and status changes, and stamp applied_at', async () => {
  const app = await asUser(db, ALICE, async (tx) => {
    const { rows } = await tx.query(
      `insert into public.applications (job_id, company, role) values ($1, 'Vercel', 'Engineer') returning id, status, applied_at`,
      [jobId],
    )
    return rows[0]
  })
  assert.equal(app.status, 'interested')
  assert.equal(app.applied_at, null)

  await asUser(db, ALICE, async (tx) => {
    const { rows } = await tx.query(`update public.applications set status = 'applied' where id = $1 returning applied_at`, [app.id])
    assert.ok(rows[0].applied_at, 'applied_at is set when the status becomes applied')
    const events = await tx.query(
      `select kind, from_status, to_status from public.application_events where application_id = $1 order by created_at, kind`,
      [app.id],
    )
    assert.deepEqual(
      events.rows.map((e) => e.kind).sort(),
      ['created', 'status_change'],
    )
    assert.ok(events.rows.some((e) => e.from_status === 'interested' && e.to_status === 'applied'))
  })

  await asUser(db, BOB, async (tx) => {
    assert.equal((await tx.query('select * from public.applications')).rows.length, 0)
    assert.equal((await tx.query('select * from public.application_events')).rows.length, 0)
  })

  // One application per job per user.
  await assert.rejects(
    asUser(db, ALICE, (tx) =>
      tx.query(`insert into public.applications (job_id, company, role) values ($1, 'Vercel', 'Engineer')`, [jobId]),
    ),
    /duplicate key/,
  )
})

test('application answers are unique per question, ignoring case and spacing', async () => {
  await asUser(db, ALICE, async (tx) => {
    const { rows } = await tx.query(`insert into public.applications (company, role) values ('Acme', 'Dev') returning id`)
    const appId = rows[0].id
    await tx.query(
      `insert into public.application_answers (application_id, question, answer) values ($1, 'Why us?', 'Because.')`,
      [appId],
    )
    await assert.rejects(
      tx.query(`insert into public.application_answers (application_id, question, answer) values ($1, '  why US? ', 'Again')`, [appId]),
      /duplicate key/,
    )
  })
})

test('only one default resume per user', async () => {
  await asUser(db, ALICE, (tx) =>
    tx.query(`insert into public.resumes (name, file_path, file_name, is_default) values ('Main', '${ALICE}/a.pdf', 'a.pdf', true)`),
  )
  await assert.rejects(
    asUser(db, ALICE, (tx) =>
      tx.query(`insert into public.resumes (name, file_path, file_name, is_default) values ('Other', '${ALICE}/b.pdf', 'b.pdf', true)`),
    ),
    /duplicate key/,
  )
})

test('resume files are only accessible in the owner\'s folder', async () => {
  await asUser(db, ALICE, (tx) =>
    tx.query(`insert into storage.objects (bucket_id, name) values ('resumes', '${ALICE}/cv.pdf')`),
  )
  await assert.rejects(
    asUser(db, ALICE, (tx) => tx.query(`insert into storage.objects (bucket_id, name) values ('resumes', '${BOB}/cv.pdf')`)),
    /row-level security/,
  )
  await asUser(db, BOB, async (tx) => {
    assert.equal((await tx.query(`select * from storage.objects`)).rows.length, 0)
  })
})

test('new usage event kinds are accepted', async () => {
  await asUser(db, ALICE, (tx) => tx.query(`insert into public.usage_events (kind) values ('prepare'), ('autofill')`))
})
