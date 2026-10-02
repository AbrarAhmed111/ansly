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

async function render(defaults: Partial<{ reviewBeforeFill: boolean; overwriteFilled: boolean }> = {}) {
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
    responses.matchSavedBatch = [ok({ results: [] })]
    responses.generateBatch = [ok({ results: [
      result(fieldId('why')),
      result(fieldId('sp'), { answer: 'No', provider: null }),
      result(fieldId('np'), { status: 'insufficient_information', answer: '', missingInformation: 'Add your notice period.',
        missing: [{ key: 'notice_period', prompt: 'What is your notice period?', input: 'text', target: { type: 'profile_field', field: 'notice_period' } }] }),
    ] })]
  }

  it('groups fields and counts ignored ones', async () => {
    await render()
    expect(text()).toContain('Found 6 fields on this page')
    expect(text()).toContain('1 skipped')
    expect(text()).toContain('Profile (2)')
    expect(text()).toContain('Questions (4)')
  })

  it('fills profile fields, generates the rest in one batch, never submits', async () => {
    happyPath()
    await render()
    await click('Fill all')

    expect(calls.map((c) => c.type)).toEqual(['getProfileValues', 'matchSavedBatch', 'generateBatch', 'track'])
    const batch = calls.find((c) => c.type === 'generateBatch')!.payload as { items: { id: string; field: { kind: string; options: string[] | null } }[] }
    // The textarea that already has text is skipped by default.
    expect(batch.items.map((i) => i.field.kind)).toEqual(['open_text', 'choice_single', 'short_text'])
    expect(batch.items[1]!.field.options).toEqual(['Yes', 'No'])

    expect(value('name')).toBe('Sam Rivera')
    expect(value('email')).toBe('sam@example.com')
    expect(value('why')).toBe(`Answer for ${fieldId('why')}`)
    expect((document.getElementById('sp') as HTMLSelectElement).value).toBe('No')
    expect(value('proj')).toBe('My own draft')
    expect(value('np')).toBe('')
    expect(text()).toContain('Needs you (1)')
    expect(text()).toContain('Already has an answer')
    expect(submitted).toBe(0)
    expect(calls.at(-1)).toEqual({ type: 'track', payload: { kind: 'fill_all', category: null } })
  })

  it('Undo all restores every field exactly', async () => {
    happyPath()
    await render()
    await click('Fill all')
    await click('Undo all')
    expect([value('name'), value('email'), value('why'), value('proj')]).toEqual(['', '', '', 'My own draft'])
    expect((document.getElementById('sp') as HTMLSelectElement).selectedIndex).toBe(0)
  })

  it('asks inline for missing information, saves it and fills', async () => {
    happyPath()
    responses.saveMissing = [ok({ saved: [] })]
    await render()
    await click('Fill all')
    responses.generateBatch = [ok({ results: [result(fieldId('np'), { answer: 'One month' })] })]
    await click('Answer')
    const input = container.querySelector('.missing input[type=text]') as HTMLInputElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '1 month')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click('Save & answer')
    expect(calls.find((c) => c.type === 'saveMissing')!.payload).toEqual({ items: [{
      key: 'notice_period', target: { type: 'profile_field', field: 'notice_period' }, value: '1 month', prompt: 'What is your notice period?',
    }] })
    expect(value('np')).toBe('One month')
  })

  it('flags low-confidence answers and overwrites when asked', async () => {
    responses.getProfileValues = [ok({})]
    responses.matchSavedBatch = [ok({ results: [] })]
    responses.generateBatch = [ok({ results: [
      result(fieldId('why')), result(fieldId('proj'), { confidence: 'low', answer: 'Low one' }),
      result(fieldId('sp'), { answer: 'Yes' }), result(fieldId('np'), { answer: 'Two weeks' }),
    ] })]
    await render({ overwriteFilled: true })
    await click('Fill all')
    expect(value('proj')).toBe('Low one')
    expect(text()).toContain('Low confidence: read this one first')
    expect(text()).toContain('Add your name to your profile')
  })

  it('shows the daily-limit message when the batch is refused', async () => {
    responses.getProfileValues = [ok({})]
    responses.matchSavedBatch = [ok({ results: [] })]
    responses.generateBatch = [{ ok: false, error: { code: 'rate_limited', message: 'These 3 answers would go over your daily limit: 1 left today.' } }]
    await render()
    await click('Fill all')
    expect(text()).toContain('1 left today')
    expect(value('why')).toBe('')
  })

  it('review mode shows answers first and fills on one confirm', async () => {
    happyPath()
    await render({ reviewBeforeFill: true })
    await click('Fill all')
    expect(value('why')).toBe('')
    expect(text()).toContain(`Answer for ${fieldId('why')}`)
    await click('Fill 2 answers')
    expect(value('why')).toBe(`Answer for ${fieldId('why')}`)
    expect((document.getElementById('sp') as HTMLSelectElement).value).toBe('No')
  })

  it('uses saved answers before generating', async () => {
    responses.getProfileValues = [ok({})]
    responses.matchSavedBatch = [ok({ results: [{ id: fieldId('why'), score: 0.9, match: { id: 'sa1', answer: 'My saved why.' } }] })]
    responses.generateBatch = [ok({ results: [result(fieldId('sp'), { answer: 'No' }), result(fieldId('np'))] })]
    await render()
    await click('Fill all')
    expect(value('why')).toBe('My saved why.')
    const batch = calls.find((c) => c.type === 'generateBatch')!.payload as { items: { id: string }[] }
    expect(batch.items.map((i) => i.id)).not.toContain(fieldId('why'))
  })
})
