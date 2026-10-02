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
}
const SAVED: SavedAnswer = {
  id: 'sa1', user_id: 'u', question: "Tell us about a project you're proud of", answer: 'My saved answer.',
  category: 'project', company: null, role: null, use_count: 2, last_used_at: null, created_at: '', updated_at: '',
}
const ok = (data: unknown): Result<unknown> => ({ ok: true, data })

let root: Root
let container: HTMLElement
let field: HTMLTextAreaElement
let onClose: ReturnType<typeof vi.fn>
let onFilled: ReturnType<typeof vi.fn>

async function open(
  maxLength: number | null = null,
  extra: Partial<Parameters<typeof Popover>[0]> = {},
  question = 'What project are you most proud of?',
) {
  const target: PopoverTarget = { el: field, question, field: { label: null, maxLength, kind: 'textarea' } }
  await act(async () => {
    root.render(
      <Popover target={target} getJobContext={() => ({ company: 'Acme', role: 'Engineer' })} onClose={onClose} onFilled={onFilled} {...extra} />,
    )
  })
  // Let the request chain settle.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

const text = () => container.textContent ?? ''
const button = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined
async function click(label: string) {
  const b = button(label)
  if (!b) throw new Error(`No "${label}" button. Text: ${text()}`)
  await act(async () => {
    b.click()
    await new Promise((r) => setTimeout(r, 0))
  })
}

beforeEach(() => {
  for (const key of Object.keys(responses)) delete responses[key as RequestType]
  calls.length = 0
  document.body.innerHTML = '<textarea id="field"></textarea><div id="ui"></div>'
  field = document.getElementById('field') as HTMLTextAreaElement
  container = document.getElementById('ui')!
  root = createRoot(container)
  onClose = vi.fn()
  onFilled = vi.fn()
})

afterEach(() => act(() => root.unmount()))

describe('Popover', () => {
  it('generates, lets the user edit, and fills the field', async () => {
    responses.matchSaved = [ok({ match: null, score: 0 })]
    responses.generate = [ok(ANSWERED)]
    await open()

    expect(calls.map((c) => c.type)).toEqual(['matchSaved', 'generate'])
    expect(calls[1]!.payload).toMatchObject({
      question: 'What project are you most proud of?',
      job_context: { company: 'Acme', role: 'Engineer' },
      field: { kind: 'textarea' },
    })
    expect(text()).toContain('Based on: TaskFlow')
    expect(text()).toContain('high confidence')

    const textarea = container.querySelector('textarea.answer') as HTMLTextAreaElement
    expect(textarea.value).toBe(ANSWERED.answer)
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(textarea, 'My edited answer.')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })

    await click('Fill')
    expect(field.value).toBe('My edited answer.')
    expect(calls.at(-1)).toEqual({ type: 'track', payload: { kind: 'fill', category: 'project' } })
    expect(onFilled).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('regenerates with the previous answer', async () => {
    responses.matchSaved = [ok({ match: null, score: 0 })]
    responses.generate = [ok(ANSWERED)]
    responses.regenerate = [ok({ ...ANSWERED, answer: 'A different take.' })]
    await open()
    await click('Regenerate')
    expect(calls.at(-1)).toMatchObject({ type: 'regenerate', payload: { previous_answer: ANSWERED.answer } })
    expect((container.querySelector('textarea.answer') as HTMLTextAreaElement).value).toBe('A different take.')
  })

  it('saves as a preferred answer with job context', async () => {
    responses.matchSaved = [ok({ match: null, score: 0 })]
    responses.generate = [ok(ANSWERED)]
    responses.saveAnswer = [ok({ ...SAVED, id: 'new-id' })]
    await open()
    await click('Save as preferred')
    expect(calls.at(-1)).toEqual({
      type: 'saveAnswer',
      payload: { question: 'What project are you most proud of?', answer: ANSWERED.answer, category: 'project', company: 'Acme', role: 'Engineer' },
    })
    expect(button('Saved')?.disabled).toBe(true)
  })

  it('offers a similar saved answer before generating', async () => {
    responses.matchSaved = [ok({ match: SAVED, score: 0.9 })]
    await open()
    expect(text()).toContain('A similar saved answer was found')
    expect(calls.map((c) => c.type)).toEqual(['matchSaved'])

    await click('Use saved answer')
    expect((container.querySelector('textarea.answer') as HTMLTextAreaElement).value).toBe('My saved answer.')
    expect(calls.at(-1)).toEqual({ type: 'useSaved', payload: { id: 'sa1' } })
  })

  it('can generate a new answer instead of the saved one', async () => {
    responses.matchSaved = [ok({ match: SAVED, score: 0.9 })]
    responses.generate = [ok(ANSWERED)]
    await open()
    await click('Generate new answer')
    expect((container.querySelector('textarea.answer') as HTMLTextAreaElement).value).toBe(ANSWERED.answer)
  })

  it('shows insufficient information with a link to the profile', async () => {
    responses.matchSaved = [ok({ match: null, score: 0 })]
    responses.generate = [ok({ ...ANSWERED, status: 'insufficient_information', answer: '', usedSources: [],
      missingInformation: "Your profile doesn't mention Kubernetes." })]
    await open()
    expect(text()).toContain("Your profile doesn't mention Kubernetes.")
    await click('Add information')
    expect(calls.at(-1)).toEqual({ type: 'openWebApp', payload: { path: '/profile' } })
  })

  it('asks to connect when not signed in', async () => {
    responses.matchSaved = [{ ok: false, error: { code: 'not_connected', message: 'Connect Ansly to your account.' } }]
    await open()
    expect(text()).toContain('Ansly isn’t connected')
    await click('Connect Ansly')
    expect(calls.at(-1)).toEqual({ type: 'openWebApp', payload: { path: '/extension' } })
  })

  it('shows errors with retry, and a failed saved-answer lookup still generates', async () => {
    responses.matchSaved = [{ ok: false, error: { code: 'server', message: 'boom' } }]
    responses.generate = [
      { ok: false, error: { code: 'unavailable', message: 'The AI providers are busy.' } },
      ok(ANSWERED),
    ]
    await open()
    expect(text()).toContain('The AI providers are busy.')
    await click('Retry')
    expect((container.querySelector('textarea.answer') as HTMLTextAreaElement).value).toBe(ANSWERED.answer)
  })

  it('blocks filling an answer over the character limit', async () => {
    responses.matchSaved = [ok({ match: null, score: 0 })]
    responses.generate = [ok(ANSWERED)]
    await open(10)
    expect(button('Fill')?.disabled).toBe(true)
    expect(text()).toContain(`/ 10 characters`)
  })

  it('sends the default style and only regenerates on Apply', async () => {
    responses.matchSaved = [ok({ match: null, score: 0 })]
    responses.generate = [ok(ANSWERED)]
    responses.regenerate = [ok({ ...ANSWERED, answer: 'Shorter.' })]
    await open(null, { defaultStyle: { length: 'auto', tone: 'friendly' } })
    expect(calls[1]!.payload).toMatchObject({ style: { length: 'auto', tone: 'friendly' } })
    expect(text()).toContain('Standard · auto')
    expect(button('Apply')).toBeUndefined()

    await click('Concise')
    expect(calls.at(-1)!.type).toBe('generate') // no request yet
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
    expect(button('Apply')).toBeUndefined()
    expect(container.querySelector('[aria-checked="true"]')?.textContent).toBe('Concise')

    // Plain Regenerate keeps the applied settings.
    responses.regenerate = [ok(ANSWERED)]
    await click('Regenerate')
    expect(calls.at(-1)).toMatchObject({ type: 'regenerate', payload: { style: { length: 'concise', tone: 'technical' } } })
  })

  it('defaults cover letters to Detailed and suggests the job description', async () => {
    responses.matchSaved = [ok({ match: null, score: 0 })]
    responses.generate = [ok({ ...ANSWERED, category: 'cover_letter', intent: 'cover_letter' })]
    await open(null, { useJobDescription: false }, 'Cover letter')
    expect(text()).toContain('Detailed · auto for cover letters')
    expect(container.querySelector('[aria-checked="true"]')?.textContent).toBe('Detailed')
    expect(text()).toContain('Cover letters are better with the job description')
  })

  it('asks for missing information inline, saves it and regenerates', async () => {
    responses.matchSaved = [ok({ match: null, score: 0 })]
    responses.generate = [
      ok({ ...ANSWERED, status: 'insufficient_information', answer: '', missingInformation: "Your profile doesn't mention Kubernetes.",
        missing: [{ key: 'skill:kubernetes', prompt: 'Have you used Kubernetes?', input: 'skill', target: { type: 'skill', name: 'Kubernetes' } }] }),
      ok({ ...ANSWERED, answer: "No, I haven't worked with Kubernetes." }),
    ]
    responses.saveMissing = [ok({ saved: [] })]
    await open()
    expect(text()).toContain("Ansly doesn't have this yet")
    expect(text()).toContain('Have you used Kubernetes?')
    await click("I don't have this")
    await click('Save & answer')
    expect(calls.find((c) => c.type === 'saveMissing')!.payload).toEqual({ items: [{
      key: 'skill:kubernetes', target: { type: 'skill', name: 'Kubernetes' }, value: { have: false, years: null, level: null }, prompt: 'Have you used Kubernetes?',
    }] })
    expect(calls.at(-1)).toMatchObject({ type: 'generate', payload: { additional_facts: null } })
    expect((container.querySelector('textarea.answer') as HTMLTextAreaElement).value).toBe("No, I haven't worked with Kubernetes.")
  })

  it('answers once without saving, using what the user said', async () => {
    responses.matchSaved = [ok({ match: null, score: 0 })]
    responses.generate = [
      ok({ ...ANSWERED, status: 'insufficient_information', answer: '', missingInformation: 'x',
        missing: [{ key: 'fact:leadership', prompt: 'Describe a time you led a team.', input: 'textarea', target: { type: 'fact', category: 'leadership' } }] }),
      ok(ANSWERED),
    ]
    responses.saveAnswer = [ok({ id: 'sa' })]
    await open()
    const box = container.querySelector('.missing textarea') as HTMLTextAreaElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, 'I led the checkout rewrite.')
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const checks = [...container.querySelectorAll('.missing input[type=checkbox]')] as HTMLInputElement[]
    await act(async () => checks[0]!.click()) // un-tick "Save to my profile"
    await act(async () => checks[1]!.click()) // tick "Also reuse this exact answer"
    await click('Answer')
    expect(calls.some((c) => c.type === 'saveMissing')).toBe(false)
    expect(calls.find((c) => c.type === 'saveAnswer')!.payload).toEqual({ question: 'What project are you most proud of?', answer: 'I led the checkout rewrite.' })
    expect(calls.at(-1)).toMatchObject({ type: 'generate', payload: { additional_facts: ['Describe a time you led a team. I led the checkout rewrite.'] } })
  })
})
