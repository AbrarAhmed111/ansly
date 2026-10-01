import { beforeEach, describe, expect, it } from 'vitest'
import { classifyField } from '../detection/classify'
import { cleanText, extractQuestion, humanizeName } from '../detection/question'
import { scanFields, watchFields } from '../detection/scan'
import { GREENHOUSE, INDEED, LEVER, LINKEDIN, NOISE, RICH_EDITOR, WORKDAY } from './fixtures'

function load(html: string) {
  document.head.innerHTML = ''
  document.body.innerHTML = html
  // happy-dom puts <title> from body markup into the body; mirror it to document.title.
  const title = document.querySelector('title')
  if (title) document.title = title.textContent ?? ''
}

const eligibleQuestions = () => scanFields(document).map((f) => f.question.text)

describe('question extraction', () => {
  it('cleans required markers and whitespace', () => {
    expect(cleanText('  Why us?\n *')).toBe('Why us?')
    expect(cleanText('Cover letter ✱')).toBe('Cover letter')
    expect(cleanText('Portfolio (optional)')).toBe('Portfolio')
  })

  it('humanizes meaningful names and ignores opaque ones', () => {
    expect(humanizeName('why_do_you_want_this_job')).toBe('why do you want this job')
    expect(humanizeName('cards[abc][field0]')).toBe('')
    expect(humanizeName('job_application[answers_attributes][0][text_value]')).toBe('')
  })

  it('prefers aria-labelledby, then label, then aria-label', () => {
    load(`<span id="a">From labelledby</span><label for="x">From label</label><textarea id="x" aria-labelledby="a" aria-label="From aria-label"></textarea>`)
    expect(extractQuestion(document.getElementById('x')!)).toMatchObject({ text: 'From labelledby', source: 'aria-labelledby' })
  })

  it('reads helper text from aria-describedby', () => {
    load(`<label for="x">Why us?</label><textarea id="x" aria-describedby="h"></textarea><p id="h">Max 500 characters</p>`)
    expect(extractQuestion(document.getElementById('x')!).hint).toBe('Max 500 characters')
  })

  it('falls back to surrounding text when there is no label', () => {
    load(LEVER)
    const textarea = document.querySelector('textarea[name="cards[abc][field0]"]') as HTMLElement
    expect(extractQuestion(textarea)).toMatchObject({ text: 'What excites you about Acme?', source: 'surrounding' })
  })

  it('does not borrow the previous question for an unlabeled field', () => {
    load(`<div><label for="a">Why us?</label><textarea id="a"></textarea></div><div><textarea id="b" placeholder="Anything else?"></textarea></div>`)
    expect(extractQuestion(document.getElementById('b')!)).toMatchObject({ text: 'Anything else?', source: 'placeholder' })
  })
})

describe('field detection across sites', () => {
  beforeEach(() => load(''))

  it('Greenhouse: open questions only', () => {
    load(GREENHOUSE)
    expect(eligibleQuestions()).toEqual([
      'Why do you want to work at Acme?',
      'Tell us about a technically challenging project you worked on.',
      'Cover Letter',
    ])
  })

  it('Lever: custom question and cover letter, not name/email/company/links', () => {
    load(LEVER)
    expect(eligibleQuestions()).toEqual([
      'What excites you about Acme?',
      'Add a cover letter or anything else you want to share.',
    ])
  })

  it('LinkedIn Easy Apply: skips numeric and personal inputs', () => {
    load(LINKEDIN)
    expect(eligibleQuestions()).toEqual([
      'Why are you interested in this role?',
      'Briefly describe your experience leading a team',
    ])
  })

  it('Indeed: questions via label and aria-labelledby; one-line salary box skipped', () => {
    load(INDEED)
    expect(eligibleQuestions()).toEqual([
      'Describe your experience with Python.',
      'Do you have experience with Kubernetes?',
    ])
  })

  it('Workday: textarea question, not address or date', () => {
    load(WORKDAY)
    expect(eligibleQuestions()).toEqual(['Please describe why you are interested in this position'])
  })

  it('rich text editors: only the outer contenteditable', () => {
    load(RICH_EDITOR)
    const fields = scanFields(document)
    expect(fields).toHaveLength(1)
    expect(fields[0]).toMatchObject({ kind: 'contenteditable', question: { text: 'Tell us about yourself' } })
  })

  it('ignores search boxes, hidden, disabled, read-only and non-text inputs', () => {
    load(NOISE)
    expect(scanFields(document)).toEqual([])
  })

  it('reports why a field was skipped', () => {
    load(GREENHOUSE)
    const reason = (id: string) => classifyField(document.getElementById(id)!).reason
    expect(reason('first_name')).toBe('autocomplete')
    expect(reason('email')).toBe('personal')
    expect(reason('phone')).toBe('input-type')
    expect(reason('question_4')).toBe('short-input')
    expect(reason('question_5')).toBe('choice')
  })

  it('flags long-answer questions', () => {
    load(`<label for="a">Why Acme?</label><input id="a" type="text"><label for="b">Do you have a driver's license?</label><input id="b" type="text">`)
    expect(classifyField(document.getElementById('a')!).longAnswer).toBe(true)
    expect(classifyField(document.getElementById('b')!)).toMatchObject({ eligible: true, longAnswer: false })
  })

  it('can skip our own UI', () => {
    load(`<ansly-root><label for="x">Why?</label><textarea id="x"></textarea></ansly-root>`)
    expect(scanFields(document, (el) => Boolean(el.closest('ansly-root')))).toEqual([])
  })
})

describe('watching for dynamically loaded fields', () => {
  it('rescans when fields are added', async () => {
    load('<form id="f"></form>')
    const seen: string[][] = []
    const stop = watchFields(document, (fields) => seen.push(fields.map((f) => f.question.text)), { debounceMs: 10 })
    document.getElementById('f')!.innerHTML = '<label for="n">Why do you want this job?</label><textarea id="n"></textarea>'
    await new Promise((r) => setTimeout(r, 50))
    stop()
    expect(seen[0]).toEqual([])
    expect(seen.at(-1)).toEqual(['Why do you want this job?'])
  })
})
