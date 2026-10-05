/**
 * Character and word limits: from `maxlength`, and from what the page says near
 * the field ("Maximum 500 characters", "Max 250 words", "0/500", "Minimum 100
 * characters") in its label, helper text (aria-describedby), placeholder or the
 * small text right after it. Read locally; nothing is sent but the numbers.
 */

export interface Limits {
  maxLength: number | null
  maxWords: number | null
  minLength: number | null
}

const NUM = String.raw`(\d{1,3}(?:,\d{3})+|\d+)`
const UNIT = String.raw`(characters?|chars?|words?)`
const MAX_BEFORE = new RegExp(String.raw`\b(?:max(?:imum)?\.?|up to|no more than|limit(?:ed)? to|not (?:to )?exceed|at most|under|less than)\s*(?:of\s*)?${NUM}\s*${UNIT}\b`, 'gi')
const MAX_AFTER = new RegExp(String.raw`\b${NUM}\s*${UNIT}\s*(?:max(?:imum)?|or (?:less|fewer)|limit|maximum)\b`, 'gi')
const MIN = new RegExp(String.raw`\b(?:min(?:imum)?\.?|at least|no (?:less|fewer) than)\s*(?:of\s*)?${NUM}\s*${UNIT}\b`, 'gi')
// A live counter: "0/500", "0 / 500 characters", "0 of 500".
const COUNTER = new RegExp(String.raw`^\s*\d+\s*(?:\/|of)\s*${NUM}\s*(?:characters?|chars?)?\s*(?:remaining|left)?\s*$`, 'i')

const toInt = (s: string) => Number(s.replace(/,/g, ''))
const isWords = (unit: string) => unit.toLowerCase().startsWith('w')

/** Limits stated in text. When several are stated, the tightest wins. */
export function parseLimits(texts: (string | null | undefined)[]): Limits {
  const out: Limits = { maxLength: null, maxWords: null, minLength: null }
  const tighter = (a: number | null, b: number) => (a == null ? b : Math.min(a, b))
  for (const raw of texts) {
    const text = (raw ?? '').replace(/\s+/g, ' ').trim()
    if (!text || text.length > 400) continue
    for (const re of [MAX_BEFORE, MAX_AFTER]) {
      for (const m of text.matchAll(re)) {
        const n = toInt(m[1]!)
        if (n <= 0) continue
        if (isWords(m[2]!)) out.maxWords = tighter(out.maxWords, n)
        else out.maxLength = tighter(out.maxLength, n)
      }
    }
    for (const m of text.matchAll(MIN)) {
      const n = toInt(m[1]!)
      // A word minimum is kept as characters (about 5 per word): it only steers length.
      if (n > 0) out.minLength = Math.max(out.minLength ?? 0, isWords(m[2]!) ? n * 5 : n)
    }
    const counter = COUNTER.exec(text)
    if (counter) out.maxLength = tighter(out.maxLength, toInt(counter[1]!))
  }
  return out
}

const NEXT_FIELD = 'label, input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role=textbox], fieldset'

/** Short text right after the field (and after its wrapper): where forms put helper text and counters. */
export function nearbyText(el: HTMLElement): string[] {
  const out: string[] = []
  let node: HTMLElement | null = el
  for (let depth = 0; node && depth < 2; depth++, node = node.parentElement) {
    let sibling = node.nextElementSibling
    for (let i = 0; sibling && i < 3; i++, sibling = sibling.nextElementSibling) {
      // The next field (or its label) starts: its helper text is not this field's.
      if (sibling.matches(NEXT_FIELD) || sibling.querySelector(NEXT_FIELD)) return out
      // textContent, not innerText: no layout during a scan.
      const text = sibling.textContent ?? ''
      if (text.trim() && text.length <= 200) out.push(text)
    }
  }
  return out
}

/** Every limit Ansly can find for a field. `maxlength` and stated limits combine; the tightest wins. */
export function detectLimits(el: HTMLElement, texts: (string | null | undefined)[] = []): Limits {
  const attr = (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) && el.maxLength > 0 ? el.maxLength : null
  const stated = parseLimits([...texts, el.getAttribute('placeholder'), el.getAttribute('aria-description'), ...nearbyText(el)])
  const maxLength = attr != null && stated.maxLength != null ? Math.min(attr, stated.maxLength) : (attr ?? stated.maxLength)
  return { maxLength, maxWords: stated.maxWords, minLength: stated.minLength }
}

export const countWords = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0)

export type CountState = 'ok' | 'near' | 'over' | 'under'

export interface Count {
  /** "423 / 500 characters", "178 / 250 words", "531 / 500 — 31 over". */
  label: string
  state: CountState
  /** How far over the hard limit (characters or words), 0 when within. */
  over: number
  unit: 'characters' | 'words'
}

/** The live count for an answer: words when the field limits words, else characters. Near = within 10%. */
export function countFor(text: string, limits: Partial<Limits>): Count {
  const trimmed = text.trim()
  const words = limits.maxWords != null && limits.maxLength == null
  const value = words ? countWords(trimmed) : trimmed.length
  const max = words ? limits.maxWords! : (limits.maxLength ?? null)
  const unit = words ? 'words' : 'characters'
  // A field with both limits: characters are counted, and going over the word limit counts as over too.
  const wordsOver = !words && limits.maxWords != null ? Math.max(0, countWords(trimmed) - limits.maxWords) : 0
  if (max == null) {
    const under = limits.minLength != null && value > 0 && value < limits.minLength
    return { label: `${value} ${unit}${under ? ` — at least ${limits.minLength}` : ''}`, state: under ? 'under' : 'ok', over: wordsOver, unit }
  }
  const over = Math.max(0, value - max)
  if (over > 0) return { label: `${value} / ${max} — ${over} over`, state: 'over', over, unit }
  if (wordsOver > 0) return { label: `${countWords(trimmed)} / ${limits.maxWords} words — ${wordsOver} over`, state: 'over', over: wordsOver, unit: 'words' }
  if (value >= max * 0.9) return { label: `${value} / ${max} ${unit} — near limit`, state: 'near', over: 0, unit }
  if (limits.minLength != null && value > 0 && value < limits.minLength) {
    return { label: `${value} / ${max} ${unit} — at least ${limits.minLength}`, state: 'under', over: 0, unit }
  }
  return { label: `${value} / ${max} ${unit}`, state: 'ok', over: 0, unit }
}
