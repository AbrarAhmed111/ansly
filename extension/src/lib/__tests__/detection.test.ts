import { beforeEach, describe, expect, it, vi } from 'vitest'
import { classifyField } from '../detection/classify'
import { cleanText, extractQuestion, humanizeName } from '../detection/question'
import { scanAll, scanFields, watchFields } from '../detection/scan'
import {
  ASHBY,
  GREENHOUSE,
  GREENHOUSE_NEW,
  INDEED,
  LEVER,
  LINKEDIN,
  LINKEDIN_STEP,
  NOISE,
  RICH_EDITOR,
  WORKDAY,
  WORKDAY_WIDGETS,
} from './fixtures'

function load(html: string) {
  document.head.innerHTML = ''
  document.body.innerHTML = html
  // happy-dom puts <title> from body markup into the body; mirror it to document.title.
  const title = document.querySelector('title')
  if (title) document.title = title.textContent ?? ''
}

const eligibleQuestions = () => scanFields(document).map((f) => f.question.text)

/** "kind: question (profile key | skip reason | options)" for every field, in page order. */
const kinds = () =>
  scanAll(document).map((f) => {
    const extra = f.profileKey ?? f.skipReason ?? (f.options ? f.options.join('/') : '')
    return extra ? `${f.kind}: ${f.question.text} (${extra})` : `${f.kind}: ${f.question.text}`
  })

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

  it('uses aria-describedby as the question when there is no label, unless it only describes format', () => {
    load(`<textarea id="x" aria-describedby="h"></textarea><p id="h">What would you change about our product?</p>
          <div><textarea id="y" aria-describedby="h2"></textarea><p id="h2">Max 500 characters</p></div>`)
    expect(extractQuestion(document.getElementById('x')!)).toMatchObject({ text: 'What would you change about our product?', source: 'aria-describedby' })
    expect(extractQuestion(document.getElementById('y')!).source).not.toBe('aria-describedby')
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

  it('Greenhouse: profile fields, open questions, short questions and choices', () => {
    load(GREENHOUSE)
    expect(kinds()).toEqual([
      'profile: First Name (first_name)',
      'profile: Last Name (last_name)',
      'profile: Email (email)',
      'profile: Phone (phone)',
      'profile: LinkedIn Profile (linkedin)',
      'profile: Website (website)',
      'open_text: Why do you want to work at Acme?',
      'short_text: How did you hear about this job?',
      'choice_single: Are you legally authorized to work in the United States? (Yes/No)',
      'open_text: Tell us about a technically challenging project you worked on.',
      'open_text: Cover Letter',
    ])
    expect(eligibleQuestions()).toEqual([
      'Why do you want to work at Acme?',
      'How did you hear about this job?',
      'Tell us about a technically challenging project you worked on.',
      'Cover Letter',
    ])
  })

  it('Greenhouse job boards: react-select, number, checkbox group; EEO, consent and file ignored', () => {
    load(GREENHOUSE_NEW)
    expect(kinds()).toEqual([
      'profile: First Name (first_name)',
      'choice_single: Will you now or in the future require sponsorship?',
      'number: Years of experience with TypeScript',
      'short_text: What is your notice period?',
      'choice_multi: Which of these have you used in production? (React/Vue/Python)',
      'ignored: Gender (eeo)',
      'ignored: Veteran Status (eeo)',
      'ignored: I agree to the privacy policy (consent)',
      'ignored: Resume/CV (file)',
    ])
    expect(scanAll(document)[0]!.required).toBe(true)
  })

  it('Lever: profile fields by label, custom question and cover letter', () => {
    load(LEVER)
    expect(kinds()).toEqual([
      'profile: Full name (full_name)',
      'profile: Email (email)',
      'profile: Current company (current_company)',
      'profile: LinkedIn URL (linkedin)',
      'open_text: What excites you about Acme?',
      'open_text: Add a cover letter or anything else you want to share.',
    ])
  })

  it('LinkedIn Easy Apply: numbers, radios from a fieldset legend', () => {
    load(LINKEDIN)
    expect(kinds()).toEqual([
      'number: How many years of work experience do you have with React.js?',
      'profile: Mobile phone number (phone)',
      'open_text: Why are you interested in this role?',
      'short_text: Briefly describe your experience leading a team',
      "choice_single: Are you comfortable commuting to this job's location? (Yes/No)",
    ])
  })

  it('LinkedIn Easy Apply step: logistics selects without the placeholder option', () => {
    load(LINKEDIN_STEP)
    expect(kinds()).toEqual([
      'choice_single: Will you now, or in the future, require sponsorship for employment visa status? (Yes/No)',
      'choice_single: Are you comfortable working in a hybrid setting? (Yes/No)',
      'number: How many years of experience do you have with Python?',
    ])
  })

  it('Indeed: label and aria-labelledby questions', () => {
    load(INDEED)
    expect(kinds()).toEqual([
      'short_text: What is your desired salary?',
      'open_text: Describe your experience with Python.',
      'profile: City, State (city)',
      'short_text: Do you have experience with Kubernetes?',
    ])
  })

  it('Ashby: ARIA radios, a yes/no checkbox and an essay', () => {
    load(ASHBY)
    expect(kinds()).toEqual([
      'profile: Name (full_name)',
      'choice_single: Are you willing to relocate to San Francisco? (Yes/No)',
      'open_text: What would you build in your first 90 days?',
      "choice_single: I'm comfortable working in a hybrid setup (Yes/No)",
    ])
  })

  it('Workday: data-automation-id labels, radio group, listbox', () => {
    load(WORKDAY)
    expect(kinds()).toEqual([
      'open_text: Please describe why you are interested in this position',
      'ignored: Address Line 1 (personal)',
      'ignored: Date of Birth (input-type)',
    ])
    load(WORKDAY_WIDGETS)
    expect(kinds()).toEqual([
      'choice_single: Are you legally authorized to work in this country? (Yes/No)',
      'choice_single: How did you hear about us? (LinkedIn/Referral)',
      'open_text: Tell us about yourself',
    ])
  })

  it('open shadow roots', () => {
    load('<div id="host"></div>')
    const shadow = document.getElementById('host')!.attachShadow({ mode: 'open' })
    shadow.innerHTML = '<label for="q">Why do you want this job?</label><textarea id="q"></textarea><label for="e">Email</label><input id="e" type="email">'
    expect(kinds()).toEqual(['open_text: Why do you want this job?', 'profile: Email (email)'])
  })

  it('rich text editors: only the outer contenteditable', () => {
    load(RICH_EDITOR)
    const fields = scanFields(document)
    expect(fields).toHaveLength(1)
    expect(fields[0]).toMatchObject({ kind: 'open_text', control: 'contenteditable', question: { text: 'Tell us about yourself' } })
  })

  it('ignores search boxes, hidden, disabled, read-only, password and captcha fields', () => {
    load(NOISE + '<label for="c">Verify</label><textarea id="c" name="g-recaptcha-response"></textarea>')
    expect(kinds()).toEqual([
      'ignored: Search jobs (search)',
      'ignored: Search (search)',
      'ignored: Why us? (hidden)',
      'ignored: Why us? (disabled)',
      'ignored: Why us? (disabled)',
      'ignored: Password (password)',
      'number: Years',
      'ignored:  (hidden)',
      'ignored: Verify (captcha)',
    ])
  })

  it('flags long-answer questions', () => {
    load(`<label for="a">Why Acme?</label><input id="a" type="text"><label for="b">Do you have a driver's license?</label><input id="b" type="text">`)
    expect(classifyField(document.getElementById('a')!).longAnswer).toBe(true)
    expect(classifyField(document.getElementById('b')!)).toMatchObject({ eligible: true, longAnswer: false, kind: 'short_text' })
  })

  it('can skip our own UI', () => {
    load(`<ansly-root><label for="x">Why?</label><textarea id="x"></textarea></ansly-root>`)
    expect(scanFields(document, (el) => Boolean(el.closest('ansly-root')))).toEqual([])
  })

  it('gives fields stable ids across scans', () => {
    load(GREENHOUSE)
    expect(scanAll(document).map((f) => f.id)).toEqual(scanAll(document).map((f) => f.id))
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

  it('rescans when a multi-step form swaps its content', async () => {
    load('<div id="step"><label for="a">Why us?</label><textarea id="a"></textarea></div>')
    const seen: string[][] = []
    const stop = watchFields(document, (fields) => seen.push(fields.map((f) => f.question.text)), { debounceMs: 10 })
    document.getElementById('step')!.innerHTML = '<label for="b">What is your notice period?</label><input id="b" type="text">'
    await new Promise((r) => setTimeout(r, 50))
    stop()
    expect(seen.at(-1)).toEqual(['What is your notice period?'])
  })

  it('ignores mutations that cannot change fields', async () => {
    load('<div id="clock">10:00</div><label for="a">Why us?</label><textarea id="a"></textarea><div id="carousel" class="a"></div>')
    let scans = 0
    const stop = watchFields(document, () => scans++, { debounceMs: 10 })
    document.getElementById('clock')!.textContent = '10:01'
    document.getElementById('carousel')!.className = 'b'
    document.getElementById('carousel')!.appendChild(document.createElement('span'))
    await new Promise((r) => setTimeout(r, 50))
    stop()
    expect(scans).toBe(1) // only the initial scan
  })

  it('rescans when a label is relabelled', async () => {
    load('<label for="a" id="l">Loading…</label><textarea id="a"></textarea>')
    const seen: string[][] = []
    const stop = watchFields(document, (fields) => seen.push(fields.map((f) => f.question.text)), { debounceMs: 10 })
    document.getElementById('l')!.textContent = 'Why do you want this job?'
    await new Promise((r) => setTimeout(r, 50))
    stop()
    expect(seen.at(-1)).toEqual(['Why do you want this job?'])
  })

  it('waits while the tab is hidden and catches up when it is shown', async () => {
    load('<form id="f"></form>')
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    let scans = 0
    const stop = watchFields(document, () => scans++, { debounceMs: 10 })
    document.getElementById('f')!.innerHTML = '<label for="n">Why us?</label><textarea id="n"></textarea>'
    await new Promise((r) => setTimeout(r, 50))
    expect(scans).toBe(0)
    hidden.mockReturnValue(false)
    document.dispatchEvent(new Event('visibilitychange'))
    await new Promise((r) => setTimeout(r, 50))
    stop()
    hidden.mockRestore()
    expect(scans).toBe(1)
  })

  it('finds fields in shadow roots added later', async () => {
    load('<div id="mount"></div>')
    const seen: string[][] = []
    const stop = watchFields(document, (fields) => seen.push(fields.map((f) => f.question.text)), { debounceMs: 10 })
    const host = document.createElement('div')
    host.attachShadow({ mode: 'open' }).innerHTML = '<label for="q">Why do you want this job?</label><textarea id="q"></textarea>'
    document.getElementById('mount')!.appendChild(host)
    await new Promise((r) => setTimeout(r, 50))
    stop()
    expect(seen.at(-1)).toEqual(['Why do you want this job?'])
  })

  it('rescans when a <dialog> opens (LinkedIn Easy Apply)', async () => {
    load('<dialog id="d"><label for="w">Why do you want this job?</label><textarea id="w"></textarea></dialog>')
    const seen: string[][] = []
    const stop = watchFields(document, (fields) => seen.push(fields.filter((f) => f.eligible).map((f) => f.question.text)), { debounceMs: 10 })
    document.getElementById('d')!.setAttribute('open', '')
    await new Promise((r) => setTimeout(r, 50))
    stop()
    expect(seen.at(-1)).toEqual(['Why do you want this job?'])
  })

  it('finds fields in a shadow root that appeared without a DOM change once the user interacts', async () => {
    load('<div id="host"></div>')
    const seen: string[][] = []
    const stop = watchFields(document, (fields) => seen.push(fields.map((f) => f.question.text)), { debounceMs: 10 })
    const shadow = document.getElementById('host')!.attachShadow({ mode: 'open' })
    shadow.innerHTML = '<label for="q">Why do you want this job?</label><textarea id="q"></textarea>'
    shadow.getElementById('q')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true }))
    await new Promise((r) => setTimeout(r, 50))
    stop()
    expect(seen.at(-1)).toEqual(['Why do you want this job?'])
  })
})

describe('LinkedIn Easy Apply dialog', () => {
  it('detects fields in an open dialog even when the app around it is aria-hidden', () => {
    load(`<div id="app" aria-hidden="true">
      <dialog open aria-labelledby="h"><h2 id="h">Apply to Burq</h2>
        <label for="why">Why do you want to work at Burq?</label><textarea id="why"></textarea>
        <div aria-hidden="true"><input id="decoy" type="text" aria-label="Hidden helper"></div>
      </dialog>
    </div>`)
    const fields = scanFields(document)
    expect(fields.map((f) => f.question.text)).toEqual(['Why do you want to work at Burq?'])
  })

  it('skips the resume file picker', () => {
    load(`<dialog open><p>Resume*</p><fieldset role="radiogroup">
      <input id="r1" type="radio" name="g" aria-label="Abrar Ahmed Resume.pdf" checked><label for="r1"></label>
      <input id="r2" type="radio" name="g" aria-label="Resume (Backend).docx"><label for="r2"></label>
    </fieldset></dialog>`)
    expect(scanAll(document).map((f) => [f.kind, f.skipReason])).toEqual([['ignored', 'file']])
  })
})
