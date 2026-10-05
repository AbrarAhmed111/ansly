import type { BatchAnswerResult } from '@ansly/types'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scanAll } from '@/lib/detection/scan'
import type { RequestType, Result } from '@/lib/messages'
import { Panel } from '../Panel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const responses: Partial<Record<RequestType, Result<unknown>[]>> = {}
const calls: { type: RequestType; payload: unknown }[] = []

vi.mock('@/lib/messages', () => ({
  send: vi.fn(async (type: RequestType, payload: unknown) => {
    calls.push({ type, payload })
    const queue = responses[type]
    return queue?.length ? queue.shift() : { ok: true, data: null }
  }),
}))

const ok = (data: unknown): Result<unknown> => ({ ok: true, data })

const FORM = `
<form id="form">
  <label for="name">Full name</label><input id="name" type="text">
  <label for="email">Email</label><input id="email" type="email">
  <label for="why">Why do you want to work here?</label><textarea id="why"></textarea>
  <label for="proj">Describe a project you are proud of</label><textarea id="proj">My own draft</textarea>
  <label for="sp">Will you require visa sponsorship?</label><select id="sp"><option value="">Select…</option><option>Yes</option><option>No</option></select>
  <label for="np">What is your notice period?</label><input id="np" type="text">
  <label for="g">Gender</label><select id="g"><option>Female</option></select>
  <button type="submit" id="submit">Submit application</button>
</form>`

const result = (id: string, over: Partial<BatchAnswerResult> = {}): BatchAnswerResult => ({
  id, status: 'answered', answer: `Answer for ${id}`, confidence: 'high', usedSources: [], missingInformation: null,
  missing: [], category: 'general', intent: 'general', provider: 'Mock', model: 'm', ...over,
})

let root: Root
let container: HTMLElement
let submitted: number

function fieldId(elementId: string) {
  return scanAll(document).find((f) => f.controls[0]!.id === elementId)!.id
}

async function render(defaults: Partial<{ reviewBeforeFill: boolean; overwriteFilled: boolean }> = {},
  run: { ids: string[]; nonce: number } | null = null) {
  const all = scanAll(document, (el) => container.contains(el))
  const fields = all.filter((f) => f.kind !== 'ignored')
  await act(async () => {
    root.render(
      <Panel
        fields={fields}
        ignoredCount={all.length - fields.length}
        defaults={{ length: 'auto', tone: 'professional', reviewBeforeFill: false, overwriteFilled: false, ...defaults }}
        useJobDescription
        getJobContext={() => ({ company: 'Acme', role: 'Engineer' })}
        onClose={() => {}}
        onRowsChange={() => {}}
        onOpenField={() => {}}
        run={run}
      />,
    )
  })
}

const text = () => container.textContent ?? ''
const button = (label: string) => [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)
async function click(label: string) {
  const b = button(label)
  if (!b) throw new Error(`No "${label}" button. Text: ${text()}`)
  await act(async () => {
    b.click()
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
  })
}
const value = (id: string) => (document.getElementById(id) as HTMLInputElement).value

beforeEach(() => {
  for (const key of Object.keys(responses)) delete responses[key as RequestType]
  calls.length = 0
  document.body.innerHTML = FORM + '<div id="ui"></div>'
  container = document.getElementById('ui')!
  root = createRoot(container)
  submitted = 0
  document.getElementById('form')!.addEventListener('submit', (e) => {
    e.preventDefault()
    submitted++
  })
})

afterEach(() => act(() => root.unmount()))

describe('Fill all panel', () => {
  function happyPath() {
    responses.getProfileValues = [ok({ full_name: 'Sam Rivera', email: 'sam@example.com' })]
    responses.generateBatch = [ok({ results: [
      result(fieldId('why')),
      result(fieldId('sp'), { answer: 'No', provider: null, origin: 'profile' }),
      result(fieldId('np'), { status: 'insufficient_information', answer: '', missingInformation: 'Add your notice period.',
        missing: [{ key: 'notice_period', prompt: 'What is your notice period?', input: 'text', target: { type: 'profile_field', field: 'notice_period' }, group: 'Availability' }] }),
    ] })]
  }

  it('summarizes the page before doing anything', async () => {
    await render()
    expect(text()).toContain('Application Assistant · 6 fields')
    expect(text()).toContain('1 skipped')
    expect(text()).toContain('2 from your profile, instantly')
    expect(text()).toContain('4 questions, answered together')
    expect(text()).toContain('Never submits automatically')
    expect(calls).toEqual([])
  })

  it('fills profile fields, generates the rest in one batch, never submits', async () => {
    happyPath()
    await render()
    await click('Fill all')

    // Saved answers are resolved inside the batch request: no separate matching round trip.
    expect(calls.map((c) => c.type).slice(0, 3)).toEqual(['generateBatch', 'getProfileValues', 'track'])
    const batch = calls.find((c) => c.type === 'generateBatch')!.payload as { check_saved: boolean; items: { id: string; field: { kind: string; options: string[] | null } }[] }
    expect(batch.check_saved).toBe(true)
    // The textarea that already has text is skipped by default.
    expect(batch.items.map((i) => i.field.kind)).toEqual(['open_text', 'choice_single', 'short_text'])
    expect(batch.items[1]!.field.options).toEqual(['Yes', 'No'])

    expect(value('name')).toBe('Sam Rivera')
    expect(value('email')).toBe('sam@example.com')
    expect(value('why')).toBe(`Answer for ${fieldId('why')}`)
    expect((document.getElementById('sp') as HTMLSelectElement).value).toBe('No')
    expect(value('proj')).toBe('My own draft')
    expect(value('np')).toBe('')
    expect(text()).toContain('4 fields filled')
    expect(text()).toContain('Already has an answer')
    expect(text()).toContain('Instant · From your profile')
    expect(submitted).toBe(0)
    const tracked = calls.filter((c) => c.type === 'track').map((c) => (c.payload as { kind: string }).kind)
    expect(tracked).toEqual(expect.arrayContaining(['fill_all', 'fill_all_completed', 'ask_and_learn_shown']))
  })

  it('Undo all restores every field exactly', async () => {
    happyPath()
    await render()
    await click('Fill all')
    await click('Undo all')
    expect([value('name'), value('email'), value('why'), value('proj')]).toEqual(['', '', '', 'My own draft'])
    expect((document.getElementById('sp') as HTMLSelectElement).selectedIndex).toBe(0)
    expect(calls.at(-1)).toEqual({ type: 'track', payload: { kind: 'undo', category: 'all' } })
  })

  it('asks for every missing detail in one form, saves it and answers the blocked questions', async () => {
    happyPath()
    responses.saveMissing = [ok({ saved: [] })]
    await render()
    await click('Fill all')
    expect(text()).toContain('Ansly needs one detail')
    responses.generateBatch = [ok({ results: [result(fieldId('np'), { answer: 'One month' })] })]
    const input = container.querySelector('.missing input[type=text]') as HTMLInputElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '1 month')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click('Save & continue')
    expect(calls.find((c) => c.type === 'saveMissing')!.payload).toEqual({
      items: [{ key: 'notice_period', target: { type: 'profile_field', field: 'notice_period' }, value: '1 month', prompt: 'What is your notice period?', scope: 'global' }],
      job_context: { company: 'Acme', role: 'Engineer', url: null },
    })
    const retry = calls.filter((c) => c.type === 'generateBatch').at(-1)!.payload as { check_saved: boolean; items: { id: string }[] }
    expect(retry.items.map((i) => i.id)).toEqual([fieldId('np')])
    expect(value('np')).toBe('One month')
    expect(text()).toContain('Saved to your Application Memory')
  })

  it('combines the gaps of several questions, each asked once', async () => {
    const relocate = { key: 'willing_to_relocate', prompt: 'Are you willing to relocate?', input: 'choice' as const, options: ['Yes', 'No', 'Depends on the role'],
      target: { type: 'profile_field' as const, field: 'willing_to_relocate' as const }, group: 'Relocation' }
    responses.getProfileValues = [ok({})]
    responses.generateBatch = [ok({ results: [
      result(fieldId('why'), { status: 'insufficient_information', answer: '', missing: [relocate] }),
      result(fieldId('sp'), { status: 'insufficient_information', answer: '', missing: [{ key: 'requires_sponsorship', prompt: 'Will you need visa sponsorship?', input: 'boolean',
        target: { type: 'profile_field', field: 'requires_sponsorship' }, group: 'Work authorization' }] }),
      result(fieldId('np'), { status: 'insufficient_information', answer: '', missing: [relocate] }),
    ] })]
    await render()
    await click('Fill all')
    expect(text()).toContain('Ansly needs 2 details')
    expect(text()).toContain('Relocation')
    expect(text()).toContain('Work authorization')
    expect(button('Save 2 details & continue')?.disabled).toBe(true)
  })

  it('leaves low-confidence answers for review and fills them once ticked', async () => {
    responses.getProfileValues = [ok({})]
    responses.generateBatch = [ok({ results: [
      result(fieldId('why')), result(fieldId('proj'), { confidence: 'low', answer: 'Low one' }),
      result(fieldId('sp'), { answer: 'Yes' }), result(fieldId('np'), { answer: 'Two weeks' }),
    ] })]
    await render({ overwriteFilled: true })
    await click('Fill all')
    expect(value('proj')).toBe('My own draft')
    expect(text()).toContain('Review recommended')
    expect(text()).toContain('Add your name to your profile')

    await click('Review only warnings')
    expect(text()).not.toContain('Why do you want to work here?')
    const tick = container.querySelector('input[aria-label="Fill “Describe a project you are proud of”"]') as HTMLInputElement
    await act(async () => tick.click())
    await click('Fill 1 answer')
    expect(value('proj')).toBe('Low one')
  })

  it('shows the daily-limit message when the batch is refused', async () => {
    responses.getProfileValues = [ok({})]
    responses.generateBatch = [{ ok: false, error: { code: 'rate_limited', message: 'These 3 answers would go over your daily limit: 1 left today.' } }]
    await render()
    await click('Fill all')
    expect(text()).toContain('1 left today')
    expect(value('why')).toBe('')
  })

  it('review mode prepares everything first and fills the ready ones on one confirm', async () => {
    happyPath()
    await render({ reviewBeforeFill: true })
    await click('Prepare answers')
    expect(value('why')).toBe('')
    expect(value('name')).toBe('')
    expect(text()).toContain(`Answer for ${fieldId('why')}`)
    expect(text()).toMatch(/4\s*Ready/)
    expect(text()).toMatch(/1\s*Needs info/)
    await click('Fill 4 ready answers')
    expect(value('why')).toBe(`Answer for ${fieldId('why')}`)
    expect(value('name')).toBe('Sam Rivera')
    expect((document.getElementById('sp') as HTMLSelectElement).value).toBe('No')
  })

  it('fills saved answers the server matched, adapted ones included, and counts their use', async () => {
    responses.getProfileValues = [ok({})]
    responses.generateBatch = [ok({ results: [
      result(fieldId('why'), { answer: 'My saved why, for Acme.', provider: 'Mock', savedAnswerId: 'sa1', adaptedFrom: 'sa1', origin: 'adapted' }),
      result(fieldId('sp'), { answer: 'No' }), result(fieldId('np'), { answer: 'Two weeks', savedAnswerId: 'sa2', origin: 'saved' }),
    ] })]
    await render()
    await click('Fill all')
    expect(value('why')).toBe('My saved why, for Acme.')
    expect(value('np')).toBe('Two weeks')
    expect(text()).toContain('Saved answer · Adapted for this job')
    expect(calls.filter((c) => c.type === 'useSaved').map((c) => c.payload)).toEqual([{ id: 'sa1' }, { id: 'sa2' }])
  })

  it('answers only the fields a popover hands over, in one request', async () => {
    responses.generateBatch = [ok({ results: [result(fieldId('why'))] })]
    await render({}, { ids: [fieldId('why')], nonce: 1 })
    await act(async () => {
      for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
    })
    const batches = calls.filter((c) => c.type === 'generateBatch')
    expect(batches).toHaveLength(1)
    expect((batches[0]!.payload as { items: { id: string }[] }).items.map((i) => i.id)).toEqual([fieldId('why')])
    expect(value('why')).toBe(`Answer for ${fieldId('why')}`)
    expect(value('name')).toBe('')
    expect(calls.some((c) => c.type === 'getProfileValues')).toBe(false)
  })

  it('sends a large form as one request (the server splits it into as few model calls as it can)', async () => {
    document.body.innerHTML =
      '<form id="form">' +
      Array.from({ length: 12 }, (_, i) => `<label for="q${i}">Question number ${i}?</label><textarea id="q${i}"></textarea>`).join('') +
      '</form><div id="ui"></div>'
    container = document.getElementById('ui')!
    root = createRoot(container)
    const ids = Array.from({ length: 12 }, (_, i) => fieldId(`q${i}`))
    responses.generateBatch = [ok({ results: ids.map((id) => result(id)) })]
    await render()
    await click('Fill all')
    const batches = calls.filter((c) => c.type === 'generateBatch').map((c) => (c.payload as { items: unknown[] }).items.length)
    expect(batches).toEqual([12])
    expect(value('q0')).toBe(`Answer for ${ids[0]}`)
    expect(value('q11')).toBe(`Answer for ${ids[11]}`)
  })

  it('passes stated limits with each question', async () => {
    document.body.innerHTML =
      '<form id="form"><label for="w">Why us? (max 150 words)</label><textarea id="w"></textarea><small>Minimum 100 characters</small>' +
      '<label for="c">Summary</label><textarea id="c" maxlength="800"></textarea><span>0/500</span></form><div id="ui"></div>'
    container = document.getElementById('ui')!
    root = createRoot(container)
    responses.generateBatch = [ok({ results: [result(fieldId('w')), result(fieldId('c'))] })]
    await render()
    await click('Fill all')
    const items = (calls.find((c) => c.type === 'generateBatch')!.payload as { items: { field: Record<string, unknown> }[] }).items
    expect(items[0]!.field).toMatchObject({ maxWords: 150, minLength: 100 })
    expect(items[1]!.field).toMatchObject({ maxLength: 500 })
  })
})
