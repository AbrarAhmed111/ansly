import type { AnswerResponse, SavedAnswer } from '@ansly/types'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RequestType, Result } from '@/lib/messages'
import { Popover, type PopoverTarget } from '../Popover'

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

const ANSWERED: AnswerResponse = {
  status: 'answered',
  answer: 'I built TaskFlow, an open-source task app.',
  confidence: 'high',
  usedSources: [{ type: 'project', id: 'p1', label: 'TaskFlow' }],
  missingInformation: null,
  missing: [],
  category: 'project',
  intent: 'favorite_project',
  provider: 'Gemini #1',
  model: 'gemini',
  origin: 'generated',
}
const SAVED: SavedAnswer = {
  id: 'sa1', user_id: 'u', question: "Tell us about a project you're proud of", answer: 'My saved answer.',
  category: 'project', company: null, role: null, use_count: 2, last_used_at: null, created_at: '', updated_at: '',
}
const ok = (data: unknown): Result<unknown> => ({ ok: true, data })
const resolved = (answer: unknown): Result<unknown> => ok({ savedMatch: null, score: 0, answer })
const needs = (missing: AnswerResponse['missing']) =>
  resolved({ ...ANSWERED, status: 'insufficient_information', answer: '', usedSources: [], missingInformation: 'x', missing })

let root: Root
let container: HTMLElement
let field: HTMLTextAreaElement
let onClose: ReturnType<typeof vi.fn>
let onFilled: ReturnType<typeof vi.fn>

async function settle() {
  await act(async () => {
    for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0))
  })
}

async function open(
  maxLength: number | null = null,
  extra: Partial<Parameters<typeof Popover>[0]> = {},
  question = 'What project are you most proud of?',
  fieldExtra: Partial<PopoverTarget['field']> = {},
) {
  const target: PopoverTarget = { el: field, question, fieldId: 'f1', field: { label: null, maxLength, kind: 'textarea', ...fieldExtra } }
  await act(async () => {
    root.render(
      <Popover target={target} getJobContext={() => ({ company: 'Acme', role: 'Engineer' })} onClose={onClose} onFilled={onFilled} {...extra} />,
    )
  })
  await settle()
}

const text = () => container.textContent ?? ''
const answerBox = () => container.querySelector('textarea.answer') as HTMLTextAreaElement
const button = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined
async function click(label: string) {
  const b = button(label)
  if (!b) throw new Error(`No "${label}" button. Text: ${text()}`)
  await act(async () => {
    b.click()
  })
  await settle()
}
async function type(el: HTMLTextAreaElement | HTMLInputElement, value: string) {
  await act(async () => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  for (const key of Object.keys(responses)) delete responses[key as RequestType]
  calls.length = 0
  sessionStorage.clear()
  document.body.innerHTML = '<textarea id="field"></textarea><div id="ui"></div>'
  field = document.getElementById('field') as HTMLTextAreaElement
  container = document.getElementById('ui')!
  root = createRoot(container)
  onClose = vi.fn()
  onFilled = vi.fn()
})

afterEach(() => act(() => root.unmount()))

describe('Popover', () => {
  it('generates, shows where the answer came from, lets the user edit, and fills the field', async () => {
    responses.resolve = [resolved(ANSWERED)]
    await open()

    expect(calls.map((c) => c.type)).toEqual(['resolve'])
    expect(calls[0]!.payload).toMatchObject({
      question: 'What project are you most proud of?',
      job_context: { company: 'Acme', role: 'Engineer' },
      field: { kind: 'textarea' },
    })
    expect(text()).toContain('AI generated · Grounded in 1 profile record')
    expect(text()).toContain('TaskFlow')
    // No model-style details in the normal view.
    expect(text()).not.toContain('confidence')
    expect(text()).not.toContain('Gemini')
    expect(text()).toContain('Never submits automatically')

    expect(answerBox().value).toBe(ANSWERED.answer)
    await type(answerBox(), 'My edited answer.')
    await click('Fill answer')
    expect(field.value).toBe('My edited answer.')
    // The user's wait and whether they edited the answer go with "fill" (no text).
    expect(calls.at(-1)).toEqual({ type: 'track', payload: {
      kind: 'fill', category: 'project', duration_ms: expect.any(Number), edited: true,
    } })
    expect(onFilled).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('says plainly when an answer needs review', async () => {
    responses.resolve = [resolved({ ...ANSWERED, confidence: 'low' })]
    await open()
    expect(text()).toContain('Review recommended')
    expect(text()).toContain('Ansly found limited supporting information.')
  })

  it('labels instant answers from the profile', async () => {
    responses.resolve = [resolved({ ...ANSWERED, answer: 'No', origin: 'profile', usedSources: [{ type: 'profile', id: 'u', label: 'Profile' }] })]
    await open()
    expect(text()).toContain('Instant · From your profile')
  })

  it('offers to answer the other open long questions together', async () => {
    responses.resolve = [resolved(ANSWERED)]
    const onAnswerRest = vi.fn()
    await open(null, { restCount: 4, onAnswerRest })
    expect(text()).toContain('4 more long questions on this page are empty')
    await click('Answer the rest together')
    expect(onAnswerRest).toHaveBeenCalledTimes(1)
    expect(text()).not.toContain('more long questions')
  })

  it('makes no offer when nothing else is open', async () => {
    responses.resolve = [resolved(ANSWERED)]
    await open(null, { restCount: 0, onAnswerRest: vi.fn() })
    expect(button('Answer the rest together')).toBeUndefined()
  })

  it('regenerates with the previous answer', async () => {
    responses.resolve = [resolved(ANSWERED)]
    responses.regenerate = [ok({ ...ANSWERED, answer: 'A different take.' })]
    await open()
    await click('Regenerate')
    expect(calls.at(-1)).toMatchObject({ type: 'regenerate', payload: { previous_answer: ANSWERED.answer } })
    expect(answerBox().value).toBe('A different take.')
  })

  it('saves as a preferred answer with job context', async () => {
    responses.resolve = [resolved(ANSWERED)]
    responses.saveAnswer = [ok({ ...SAVED, id: 'new-id' })]
    await open()
    await click('Save')
    expect(calls.at(-1)).toEqual({
      type: 'saveAnswer',
      payload: { question: 'What project are you most proud of?', answer: ANSWERED.answer, category: 'project', company: 'Acme', role: 'Engineer' },
    })
    expect(button('Saved')?.disabled).toBe(true)
  })

  it('offers a similar saved answer before generating', async () => {
    responses.resolve = [ok({ savedMatch: SAVED, score: 0.9, answer: null })]
    await open()
    expect(text()).toContain('A similar saved answer was found')
    expect(calls.map((c) => c.type)).toEqual(['resolve'])

    await click('Use saved answer')
    expect(answerBox().value).toBe('My saved answer.')
    expect(text()).toContain('Saved answer')
    expect(calls.at(-1)).toEqual({ type: 'useSaved', payload: { id: 'sa1' } })
  })

  it('can generate a new answer instead of the saved one', async () => {
    responses.resolve = [ok({ savedMatch: SAVED, score: 0.9, answer: null })]
    responses.generate = [ok(ANSWERED)]
    await open()
    await click('Generate new answer')
    expect(answerBox().value).toBe(ANSWERED.answer)
  })

  it('shows insufficient information with a link to the profile', async () => {
    responses.resolve = [resolved({ ...ANSWERED, status: 'insufficient_information', answer: '', usedSources: [],
      missingInformation: "Your profile doesn't mention Kubernetes." })]
    await open()
    expect(text()).toContain('Ansly needs more information from you.')
    expect(text()).toContain("Your profile doesn't mention Kubernetes.")
    await click('Add information')
    expect(calls.at(-1)).toEqual({ type: 'openWebApp', payload: { path: '/profile' } })
  })

  it('asks to connect when not signed in', async () => {
    responses.resolve = [{ ok: false, error: { code: 'not_connected', message: 'Connect Ansly to your account.' } }]
    await open()
    expect(text()).toContain('Ansly isn’t connected')
    await click('Connect Ansly')
    expect(calls.at(-1)).toEqual({ type: 'openWebApp', payload: { path: '/extension' } })
  })

  it('shows friendly errors with retry, never codes', async () => {
    responses.resolve = [
      { ok: false, error: { code: 'unavailable', message: 'HTTP 503 gateway_unavailable' } },
      resolved(ANSWERED),
    ]
    await open()
    expect(text()).toContain('AI service is temporarily busy')
    expect(text()).not.toContain('503')
    await click('Try again')
    expect(calls.map((c) => c.type)).toEqual(['resolve', 'resolve'])
    expect(answerBox().value).toBe(ANSWERED.answer)
  })

  it('counts characters with clear states and fits an over-long answer to the limit', async () => {
    responses.resolve = [resolved(ANSWERED)]
    await open(30)
    expect(text()).toContain('42 / 30 — 12 over')
    expect(button('Fill answer')?.disabled).toBe(true)

    responses.rewrite = [ok({ answer: 'I built TaskFlow, a task app.', changed: true, reason: null })]
    await click('Fit to limit')
    expect(calls.at(-1)).toMatchObject({ type: 'rewrite', payload: {
      text: ANSWERED.answer, action: 'fit', field: { maxLength: 30 }, job_context: { company: 'Acme', role: 'Engineer' },
    } })
    expect(answerBox().value).toBe('I built TaskFlow, a task app.')
    expect(text()).toContain('29 / 30 characters — near limit')
    expect(button('Fill answer')?.disabled).toBe(false)
    // One step back.
    await click('Undo')
    expect(answerBox().value).toBe(ANSWERED.answer)
  })

  it('counts words when the field limits words', async () => {
    responses.resolve = [resolved(ANSWERED)]
    await open(null, {}, 'What project are you most proud of?', { maxWords: 100 })
    expect(text()).toContain('7 / 100 words')
  })

  it('rewrites the latest edit, not the first answer, and keeps it when a rewrite would change facts', async () => {
    responses.resolve = [resolved(ANSWERED)]
    await open()
    await type(answerBox(), 'My own longer edited version of the answer.')
    responses.rewrite = [ok({ answer: 'My own version, shorter.', changed: true, reason: null })]
    await click('Shorter')
    expect(calls.at(-1)).toMatchObject({ type: 'rewrite', payload: { text: 'My own longer edited version of the answer.', action: 'shorter' } })
    expect(answerBox().value).toBe('My own version, shorter.')

    responses.rewrite = [ok({ answer: 'My own version, shorter.', changed: false, reason: 'Ansly couldn’t rewrite this without changing its facts, so your answer was kept.' })]
    await click('Professional')
    expect(answerBox().value).toBe('My own version, shorter.')
    expect(text()).toContain('your answer was kept')
  })

  it('offers more rewrites and a custom one', async () => {
    responses.resolve = [resolved(ANSWERED)]
    await open()
    await click('More ▾')
    expect(button('More technical')).toBeDefined()
    await click('Rewrite…')
    const input = container.querySelector('input[aria-label="How should Ansly rewrite it?"]') as HTMLInputElement
    await type(input, 'More direct, emphasize backend')
    responses.rewrite = [ok({ answer: 'I built TaskFlow.', changed: true, reason: null })]
    await click('Rewrite')
    expect(calls.at(-1)).toMatchObject({ type: 'rewrite', payload: { action: 'custom', instruction: 'More direct, emphasize backend' } })
    expect(answerBox().value).toBe('I built TaskFlow.')
  })

  it('keeps an edited draft when the popover closes and restores it on reopen', async () => {
    responses.resolve = [resolved(ANSWERED)]
    await open()
    await type(answerBox(), 'Half-written edit')
    await act(() => root.unmount())
    root = createRoot(container)
    calls.length = 0
    await open()
    expect(answerBox().value).toBe('Half-written edit')
    expect(text()).toContain('Restored your unsaved edit.')
    expect(calls.map((c) => c.type)).not.toContain('resolve')
    // Discarding it fetches a fresh answer.
    responses.resolve = [resolved(ANSWERED)]
    await click('Discard')
    expect(answerBox().value).toBe(ANSWERED.answer)
  })

  it('shows and edits the memory an answer used, without leaving the page', async () => {
    responses.resolve = [
      resolved({ ...ANSWERED, answer: 'Yes', origin: 'memory', usedSources: [{ type: 'fact', id: 'm1', label: 'Relocation' }] }),
      resolved({ ...ANSWERED, answer: 'No', origin: 'memory', usedSources: [{ type: 'fact', id: 'm1', label: 'Relocation' }] }),
    ]
    await open(null, {}, 'Are you willing to relocate?')
    expect(text()).toContain('Instant · From your Application Memory')
    expect(text()).toContain('Used memory: Relocation → Yes')
    await click('Edit')
    expect(button('Depends on the role')).toBeDefined()
    await click('No')
    responses.updateMemory = [ok({ id: 'm1', value: 'No' })]
    await click('Update')
    expect(calls.find((c) => c.type === 'updateMemory')!.payload).toEqual({ id: 'm1', changes: { value: 'No', scope: 'global' } })
    expect(calls.at(-1)!.type).toBe('resolve')
    expect(answerBox().value).toBe('No')
    expect(text()).toContain('Application Memory updated: Relocation → No')
  })

  it('sends the default style and only regenerates on Apply (under Details)', async () => {
    responses.resolve = [resolved(ANSWERED)]
    responses.regenerate = [ok({ ...ANSWERED, answer: 'Shorter.' })]
    await open(null, { defaultStyle: { length: 'auto', tone: 'friendly' } })
    expect(calls[0]!.payload).toMatchObject({ style: { length: 'auto', tone: 'friendly' } })
    await click('Details')
    expect(text()).toContain('Standard · auto')
    expect(button('Apply')).toBeUndefined()

    await click('Concise')
    expect(calls.at(-1)!.type).toBe('resolve') // no request yet
    const tone = container.querySelector('select[aria-label="Tone"]') as HTMLSelectElement
    await act(async () => {
      tone.value = 'technical'
      tone.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await click('Apply')
    expect(calls.at(-1)).toMatchObject({
      type: 'regenerate',
      payload: { previous_answer: ANSWERED.answer, style: { length: 'concise', tone: 'technical' } },
    })
    // Plain Regenerate keeps the applied settings.
    responses.regenerate = [ok(ANSWERED)]
    await click('Regenerate')
    expect(calls.at(-1)).toMatchObject({ type: 'regenerate', payload: { style: { length: 'concise', tone: 'technical' } } })
  })

  it('defaults cover letters to Detailed and suggests the job description', async () => {
    responses.resolve = [resolved({ ...ANSWERED, category: 'cover_letter', intent: 'cover_letter' })]
    await open(null, { useJobDescription: false }, 'Cover letter')
    await click('Details')
    expect(text()).toContain('Detailed · auto for cover letters')
    expect(container.querySelector('[aria-checked="true"]')?.textContent).toBe('Detailed')
    expect(text()).toContain('Cover letters are better with the job description')
  })

  it('Ctrl+Enter fills and Escape closes', async () => {
    responses.resolve = [resolved(ANSWERED)]
    await open()
    await act(async () => {
      answerBox().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))
    })
    expect(field.value).toBe(ANSWERED.answer)

    responses.resolve = [resolved(ANSWERED)]
    await act(() => root.unmount())
    root = createRoot(container)
    await open()
    await act(async () => {
      answerBox().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onClose).toHaveBeenLastCalledWith({ refocus: true })
  })
})

describe('Ask-and-Learn in the popover', () => {
  it('asks inline, remembers the answer and retries automatically', async () => {
    responses.resolve = [
      needs([{ key: 'skill:kubernetes', prompt: 'Have you used Kubernetes?', input: 'skill', target: { type: 'skill', name: 'Kubernetes' }, group: 'Skills' }]),
      resolved({ ...ANSWERED, answer: "No, I haven't worked with Kubernetes." }),
    ]
    responses.saveMissing = [ok({ saved: [] })]
    await open()
    expect(text()).toContain('Ansly needs one detail')
    expect(text()).toContain('This application asks: “What project are you most proud of?”')
    expect(calls.find((c) => c.type === 'track')!.payload).toEqual({ kind: 'ask_and_learn_shown', category: 'project' })
    await click('No')
    await click('Save & continue')
    expect(calls.find((c) => c.type === 'saveMissing')!.payload).toEqual({
      items: [{ key: 'skill:kubernetes', target: { type: 'skill', name: 'Kubernetes' }, value: { have: false, years: null, level: null }, prompt: 'Have you used Kubernetes?' }],
      job_context: { company: 'Acme', role: 'Engineer', url: null },
    })
    // The original question is retried at once.
    expect(calls.at(-1)!.type).toBe('resolve')
    expect(answerBox().value).toBe("No, I haven't worked with Kubernetes.")
    expect(text()).toContain('Saved to your Application Memory')
  })

  it('uses typed inputs: a three-way choice with a scope', async () => {
    responses.resolve = [needs([{ key: 'willing_to_relocate', prompt: 'Are you willing to relocate?', input: 'choice', options: ['Yes', 'No', 'Depends on the role'],
      target: { type: 'profile_field', field: 'willing_to_relocate' }, group: 'Relocation', scope: 'category', label: 'Relocation' }]),
      resolved({ ...ANSWERED, answer: 'It depends on the role.' })]
    responses.saveMissing = [ok({ saved: [] })]
    await open(null, {}, 'Are you willing to relocate to Austin?')
    expect(button('Save & continue')?.disabled).toBe(true)
    await click('Depends on the role')
    const scope = container.querySelector('.missing .scope select') as HTMLSelectElement
    expect(scope.value).toBe('category')
    await act(async () => {
      scope.value = 'job'
      scope.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await click('Save & continue')
    expect((calls.find((c) => c.type === 'saveMissing')!.payload as { items: unknown[] }).items).toEqual([{
      key: 'willing_to_relocate', target: { type: 'profile_field', field: 'willing_to_relocate' }, value: 'Depends on the role',
      prompt: 'Are you willing to relocate?', scope: 'job',
    }])
  })

  it('answers once without saving anything when Remember is off', async () => {
    responses.resolve = [needs([{ key: 'fact:leadership', prompt: 'Describe a time you led a team.', input: 'textarea', target: { type: 'fact', category: 'leadership' } }])]
    responses.generate = [ok(ANSWERED)]
    responses.saveAnswer = [ok({ id: 'sa' })]
    await open()
    await type(container.querySelector('.missing textarea') as HTMLTextAreaElement, 'I led the checkout rewrite.')
    const checks = [...container.querySelectorAll('.missing input[type=checkbox]')] as HTMLInputElement[]
    await act(async () => checks[0]!.click()) // un-tick "Remember this"
    expect(text()).toContain('Nothing is saved.')
    await act(async () => (container.querySelectorAll('.missing input[type=checkbox]')[1] as HTMLInputElement).click()) // reuse
    await click('Continue')
    expect(calls.some((c) => c.type === 'saveMissing')).toBe(false)
    expect(calls.find((c) => c.type === 'saveAnswer')!.payload).toEqual({ question: 'What project are you most proud of?', answer: 'I led the checkout rewrite.' })
    expect(calls.at(-1)).toMatchObject({ type: 'generate', payload: { additional_facts: ['Describe a time you led a team. I led the checkout rewrite.'] } })
  })

  it('a preference given once is the answer itself', async () => {
    responses.resolve = [needs([{ key: 'notice_period', prompt: 'What is your notice period?', input: 'text', target: { type: 'profile_field', field: 'notice_period' } }])]
    await open(null, {}, 'Notice period')
    await type(container.querySelector('.missing input[type=text]') as HTMLInputElement, '2 weeks')
    await act(async () => (container.querySelector('.missing input[type=checkbox]') as HTMLInputElement).click())
    await click('Continue')
    expect(answerBox().value).toBe('2 weeks')
    expect(calls.map((c) => c.type)).not.toContain('generate')
  })

  it('can be skipped', async () => {
    responses.resolve = [needs([{ key: 'notice_period', prompt: 'What is your notice period?', input: 'text', target: { type: 'profile_field', field: 'notice_period' } }])]
    await open()
    await click('Skip for now')
    expect(calls.at(-1)).toEqual({ type: 'track', payload: { kind: 'ask_and_learn_skipped', category: 'project' } })
    expect(onClose).toHaveBeenCalled()
  })

  it('keeps the answers and explains when saving fails', async () => {
    responses.resolve = [needs([{ key: 'notice_period', prompt: 'What is your notice period?', input: 'text', target: { type: 'profile_field', field: 'notice_period' } }])]
    responses.saveMissing = [{ ok: false, error: { code: 'server', message: 'Supabase error 500' } }]
    await open()
    const input = container.querySelector('.missing input[type=text]') as HTMLInputElement
    await type(input, '2 weeks')
    await click('Save & continue')
    expect(text()).toContain('Ansly couldn’t save that')
    expect(text()).not.toContain('Supabase')
    expect((container.querySelector('.missing input[type=text]') as HTMLInputElement).value).toBe('2 weeks')
  })
})

describe('Popover keyboard focus', () => {
  it('keeps Tab inside the dialog', async () => {
    responses.resolve = [resolved(ANSWERED)]
    await open()
    const dialog = container.querySelector('.popover') as HTMLElement
    const buttons = [...dialog.querySelectorAll('button:not([disabled])')] as HTMLElement[]
    buttons.at(-1)!.focus()
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    await act(async () => void buttons.at(-1)!.dispatchEvent(tab))
    expect(tab.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(buttons[0])
  })
})
