/**
 * Question extraction: finds the human-readable question for a form field,
 * using only generic signals (no per-site rules).
 *
 * Order: aria-labelledby → <label> → aria-label → fieldset legend →
 * surrounding text (preceding siblings / headings up the tree) → placeholder → name/id.
 */

export type QuestionSource =
  | 'aria-labelledby'
  | 'label'
  | 'aria-label'
  | 'legend'
  | 'surrounding'
  | 'placeholder'
  | 'name'
  | 'none'

export interface ExtractedQuestion {
  text: string
  source: QuestionSource
  /** Helper text (aria-describedby), e.g. "Max 500 characters". */
  hint: string | null
}

const MAX_LENGTH = 500
const MAX_ANCESTOR_DEPTH = 6

/** Collapses whitespace and strips required-markers like "*", "✱", "(required)". */
export function cleanText(text: string | null | undefined): string {
  if (!text) return ''
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s*[*✱]+\s*$/u, '')
    .replace(/\s*\((?:required|optional)\)\s*$/i, '')
    .replace(/\s+required\s*$/i, '')
    .trim()
    .replace(/\s*[*✱]+\s*$/u, '')
    .slice(0, MAX_LENGTH)
}

/** Visible text of an element, ignoring form controls, scripts and our own UI. */
export function visibleText(el: Element): string {
  const parts: string[] = []
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent ?? '')
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const element = node as Element
    const tag = element.tagName
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SELECT', 'TEXTAREA', 'INPUT', 'BUTTON', 'OPTION', 'SVG'].includes(tag)) return
    if (tag === 'ANSLY-ROOT' || element.getAttribute('aria-hidden') === 'true' || element.hasAttribute('hidden')) return
    if (element.getAttribute('contenteditable') && element.getAttribute('contenteditable') !== 'false') return
    element.childNodes.forEach(walk)
    if (/^(P|DIV|LI|BR|H[1-6]|LABEL|LEGEND|SPAN)$/.test(tag)) parts.push(' ')
  }
  walk(el)
  return parts.join('').replace(/\s+/g, ' ').trim()
}

function byIds(el: Element, attr: string): string {
  const ids = el.getAttribute(attr)?.split(/\s+/).filter(Boolean) ?? []
  const doc = el.ownerDocument
  return ids
    .map((id) => doc.getElementById(id))
    .filter((n): n is HTMLElement => Boolean(n))
    .map((n) => visibleText(n))
    .join(' ')
}

function labelText(el: HTMLElement): string {
  const doc = el.ownerDocument
  const texts: string[] = []
  if (el.id) {
    const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(el.id) : el.id.replace(/["\\]/g, '\\$&')
    doc.querySelectorAll(`label[for="${escaped}"]`).forEach((l) => texts.push(visibleText(l)))
  }
  const wrapping = el.closest('label')
  if (wrapping) texts.push(visibleText(wrapping))
  return texts.find((t) => cleanText(t)) ?? ''
}

function legendText(el: HTMLElement): string {
  const legend = el.closest('fieldset')?.querySelector(':scope > legend')
  return legend ? visibleText(legend) : ''
}

const isField = (el: Element) =>
  el.matches('input:not([type=hidden]), textarea, select, [contenteditable]:not([contenteditable=false])')

/**
 * Text that appears before the field inside its nearby containers: the closest
 * preceding sibling with text, checked at each ancestor level. Stops at
 * containers that hold other fields' questions.
 */
function surroundingText(el: HTMLElement): string {
  let node: Element | null = el
  for (let depth = 0; node && depth < MAX_ANCESTOR_DEPTH; depth++) {
    let sibling = node.previousElementSibling
    while (sibling) {
      // A sibling that contains another field belongs to a different question.
      if (isField(sibling) || sibling.querySelector('input:not([type=hidden]), textarea, select')) break
      const text = cleanText(visibleText(sibling))
      if (text) return text
      sibling = sibling.previousElementSibling
    }
    if (sibling) break
    const parent: HTMLElement | null = node.parentElement
    if (!parent || parent === el.ownerDocument.body) break
    // Don't climb into a container that holds several fields: its text isn't ours.
    if (parent.querySelectorAll('input:not([type=hidden]), textarea, select, [contenteditable=true]').length > 1) {
      break
    }
    node = parent
  }
  return ''
}

/** "why_do_you_want" / "whyDoYouWant" → "why do you want"; ignores opaque ids. */
export function humanizeName(name: string | null): string {
  if (!name) return ''
  const last = name.split(/[[\].]/).filter(Boolean).pop() ?? name
  const words = last
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-]+/g, ' ')
    .replace(/\d+/g, ' ')
    .trim()
    .toLowerCase()
  // Opaque or generated names ("field0", "q", "input", "text value") aren't questions.
  if (words.replace(/\s/g, '').length < 4 || /^(field|input|text|value|answer|question|textarea)( \w+)?$/.test(words)) return ''
  return words
}

export function extractQuestion(el: HTMLElement): ExtractedQuestion {
  const hint = cleanText(byIds(el, 'aria-describedby')) || null
  const candidates: [QuestionSource, () => string][] = [
    ['aria-labelledby', () => byIds(el, 'aria-labelledby')],
    ['label', () => labelText(el)],
    ['aria-label', () => el.getAttribute('aria-label') ?? ''],
    ['surrounding', () => surroundingText(el)],
    ['legend', () => legendText(el)],
    ['placeholder', () => el.getAttribute('placeholder') ?? el.getAttribute('data-placeholder') ?? ''],
    ['name', () => humanizeName(el.getAttribute('name')) || humanizeName(el.id)],
  ]
  for (const [source, get] of candidates) {
    const text = cleanText(get())
    if (text) return { text, source, hint }
  }
  return { text: '', source: 'none', hint }
}
