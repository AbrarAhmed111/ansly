// End-to-end check against the real Supabase project and a running llm API.
//
// Signs in as a test account, builds a small profile, and drives the whole
// answer loop through the API the same way the extension does. Everything it
// creates is tagged "[e2e]" and deleted at the end.
//
// Needs a confirmed test account (use a dedicated one, not your real profile):
//   .env.e2e (gitignored):  E2E_EMAIL=...  E2E_PASSWORD=...
// and the API running:      pnpm --filter @ansly/llm dev
//
// Run: node scripts/e2e.mjs [--api http://localhost:8000]

import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const readEnv = (file) => {
  try {
    return Object.fromEntries(
      readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => /^\s*[A-Z_0-9]+\s*=/.test(l))
        .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')] }),
    )
  } catch { return {} }
}

const env = { ...readEnv('web/.env'), ...readEnv('.env.e2e'), ...process.env }
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '')
const KEY = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const API = (process.argv.includes('--api') ? process.argv[process.argv.indexOf('--api') + 1] : env.E2E_API_URL || 'http://localhost:8000').replace(/\/+$/, '')
const TAG = '[e2e]'

if (!SUPABASE_URL || !KEY) throw new Error('Supabase URL/key missing from web/.env')
if (!env.E2E_EMAIL || !env.E2E_PASSWORD) {
  console.error('Set E2E_EMAIL and E2E_PASSWORD in .env.e2e (a confirmed test account).')
  process.exit(2)
}

let passed = 0
async function step(name, fn) {
  const start = Date.now()
  try {
    await fn()
    passed++
    console.log(`  ✔ ${name} (${Date.now() - start}ms)`)
  } catch (e) {
    console.log(`  ✖ ${name}\n    ${e.message}`)
    throw e
  }
}

const auth = async (path, body) => {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await r.json()
  if (!r.ok) throw new Error(`auth ${path}: ${r.status} ${data.msg ?? data.error_description ?? JSON.stringify(data)}`)
  return data
}
const rest = (token) => async (method, path, body, prefer = 'return=representation') => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: prefer },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${text}`)
  return text ? JSON.parse(text) : null
}
const api = (token) => async (path, body) => {
  const r = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  const text = await r.text()
  return { status: r.status, body: text ? JSON.parse(text) : null }
}

console.log(`Supabase: ${new URL(SUPABASE_URL).host}\nAPI:      ${API}\n`)

let session, db, call, userId
const created = { experiences: [], projects: [], skills: [], saved_answers: [] }
let originalProfile = null

try {
  await step('API is healthy and connected to Supabase', async () => {
    const h = await (await fetch(`${API}/health`)).json()
    assert.equal(h.status, 'healthy')
    assert.equal(h.supabase.status, 'ok', `API → Supabase: ${JSON.stringify(h.supabase)}`)
    assert.ok(h.gateway.available_deployments > 0, 'no LLM deployments available')
  })

  await step('anonymous visitors cannot read profile data', async () => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id`, { headers: { apikey: KEY } })
    assert.ok(r.status === 401 || r.status === 403, `expected 401/403, got ${r.status}`)
  })

  await step('sign in with the test account (a separate session, like the extension)', async () => {
    session = await auth('token?grant_type=password', { email: env.E2E_EMAIL, password: env.E2E_PASSWORD })
    userId = session.user.id
    db = rest(session.access_token)
    call = api(session.access_token)
  })

  await step('the signup trigger created a profile row', async () => {
    const rows = await db('GET', 'profiles?select=*')
    assert.equal(rows.length, 1, 'profile row missing — is the on_auth_user_created trigger in place?')
    assert.equal(rows[0].id, userId)
    originalProfile = rows[0]
  })

  await step('build a test profile (only own rows are writable)', async () => {
    await db('PATCH', `profiles?id=eq.${userId}`, {
      headline: `${TAG} Full-stack engineer`,
      summary: `${TAG} Full-stack engineer with four years of experience building web products with React, Next.js, TypeScript and Python.`,
      notice_period: 'Two weeks',
    })
    created.experiences = await db('POST', 'experiences', [{
      company: `${TAG} Acme Labs`, title: 'Software Engineer', is_current: true, start_date: '2023-01-01',
      description: 'Built the customer dashboard in Next.js and a FastAPI service for document search.',
      highlights: ['Cut dashboard load time by 40%'], technologies: ['Next.js', 'TypeScript', 'FastAPI'],
    }])
    created.projects = await db('POST', 'projects', [{
      name: `${TAG} TaskFlow`, role: 'Creator', description: 'Open-source task management app with real-time collaboration.',
      highlights: ['300 GitHub stars'], technologies: ['React', 'Supabase'],
    }])
    created.skills = await db('POST', 'skills', [{ name: `${TAG} React`, level: 'expert' }, { name: `${TAG} Python`, level: null }])
    const other = await fetch(`${SUPABASE_URL}/rest/v1/experiences`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ company: 'x', title: 'y', user_id: '00000000-0000-0000-0000-000000000000' }),
    })
    assert.equal(other.status, 403, `writing a row for another user should be refused, got ${other.status}`)
  })

  let answer
  await step('generate: grounded answer with sources', async () => {
    const r = await call('/api/v1/answers/generate', {
      question: "Tell us about a project you're proud of.",
      job_context: { company: 'Example AI', role: 'Product Engineer' },
      field: { maxLength: 1500, kind: 'textarea' },
    })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(r.body.status, 'answered', JSON.stringify(r.body))
    assert.match(r.body.answer, /TaskFlow/)
    assert.ok(r.body.answer.length <= 1500)
    assert.ok(r.body.usedSources.some((s) => s.type === 'project'), 'expected a project source')
    answer = r.body
    console.log(`    via ${answer.provider}: "${answer.answer.slice(0, 140)}…"`)
  })

  await step('Kubernetes (not in profile) → insufficient_information', async () => {
    const r = await call('/api/v1/answers/generate', { question: 'Do you have experience with Kubernetes?' })
    assert.equal(r.status, 200)
    assert.equal(r.body.status, 'insufficient_information')
    assert.equal(r.body.answer, '')
    assert.match(r.body.missingInformation, /Kubernetes/)
  })

  await step('logistics: answered only from filled preferences', async () => {
    const salary = await call('/api/v1/answers/generate', { question: 'What are your salary expectations?' })
    assert.equal(salary.body.status, 'insufficient_information')
    const notice = await call('/api/v1/answers/generate', { question: 'What is your notice period?' })
    assert.equal(notice.body.status, 'answered', JSON.stringify(notice.body))
    assert.match(notice.body.answer.toLowerCase(), /two weeks|2 weeks/)
  })

  await step('regenerate returns a different version', async () => {
    const r = await call('/api/v1/answers/regenerate', {
      question: "Tell us about a project you're proud of.", previous_answer: answer.answer, instruction: 'shorter',
    })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(r.body.status, 'answered')
    assert.notEqual(r.body.answer, answer.answer)
  })

  let saved
  await step('save as preferred answer, then match a similar question', async () => {
    const r = await call('/api/v1/saved-answers', { question: `${TAG} Tell us about a project you're proud of.`, answer: `${TAG} My edited answer about TaskFlow.` })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    saved = r.body
    created.saved_answers.push(saved)
    const m = await call('/api/v1/saved-answers/match', { question: "What's the project you've enjoyed building most?" })
    assert.equal(m.body.match?.id, saved.id, `no match (score ${m.body.score})`)
    const none = await call('/api/v1/saved-answers/match', { question: 'Do you require visa sponsorship?' })
    assert.notEqual(none.body.match?.id, saved.id)
  })

  await step('use saved answer increments its count', async () => {
    const r = await call(`/api/v1/saved-answers/${saved.id}/use`)
    assert.equal(r.status, 200)
    assert.equal(r.body.use_count, 1)
  })

  await step('fill event is recorded (no text)', async () => {
    const r = await call('/api/v1/events', { kind: 'fill', category: 'project' })
    assert.equal(r.status, 204)
    const events = await db('GET', `usage_events?select=kind,category&order=created_at.desc&limit=10`)
    const kinds = events.map((e) => e.kind)
    for (const k of ['fill', 'use_saved_answer', 'save_answer', 'regenerate', 'generate']) assert.ok(kinds.includes(k), `missing ${k} event`)
    assert.ok(events.every((e) => Object.keys(e).length === 2), 'events must not carry text')
  })

  await step('token refresh works (as the extension does it)', async () => {
    const fresh = await auth('token?grant_type=refresh_token', { refresh_token: session.refresh_token })
    assert.ok(fresh.access_token && fresh.refresh_token !== session.refresh_token)
    const r = await api(fresh.access_token)('/api/v1/saved-answers/match', { question: 'Why us?' })
    assert.equal(r.status, 200)
  })

  console.log(`\n${passed} checks passed`)
} finally {
  // Clean up everything this run created and restore the profile fields it changed.
  if (db) {
    for (const [table, rows] of Object.entries(created)) {
      for (const row of rows) await db('DELETE', `${table}?id=eq.${row.id}`, undefined, 'return=minimal').catch(() => {})
    }
    if (originalProfile) {
      await db('PATCH', `profiles?id=eq.${userId}`, {
        headline: originalProfile.headline, summary: originalProfile.summary, notice_period: originalProfile.notice_period,
      }).catch(() => {})
    }
    console.log('Cleaned up test rows (usage events are append-only and stay).')
  }
}
