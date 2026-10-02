/**
 * Question extraction: finds the human-readable question for a form field,
 * using only generic signals (no per-site rules).
 *
 * Order: aria-labelledby → <label> → aria-label → aria-describedby →
 * field-container label conventions (Workday data-automation-id, data-testid) →
 * surrounding text (preceding siblings / headings up the tree) → fieldset legend →
 * placeholder → name/id.
 *
 * Works inside open shadow roots: ids and labels are looked up in the field's own root.
 */

export type QuestionSource =
  | 'aria-labelledby'
  | 'label'
  | 'aria-label'
  | 'aria-describedby'
  | 'container'
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
    // Dropdown options inside a label aren't part of the question.
    if (element !== el && ['option', 'listbox'].includes(element.getAttribute('role') ?? '')) return
    element.childNodes.forEach(walk)
    if (/^(P|DIV|LI|BR|H[1-6]|LABEL|LEGEND|SPAN)$/.test(tag)) parts.push(' ')
  }
  walk(el)
  return parts.join('').replace(/\s+/g, ' ').trim()
}

/** The document or shadow root that holds `el`; ids and label[for] resolve there. */
function rootOf(el: Element): Document | ShadowRoot {
  const root = el.getRootNode()
  return root instanceof ShadowRoot || root instanceof Document ? root : el.ownerDocument
}

function byIds(el: Element, attr: string): string {
  const ids = el.getAttribute(attr)?.split(/\s+/).filter(Boolean) ?? []
  const root = rootOf(el)
  return ids
    .map((id) => root.getElementById(id) ?? el.ownerDocument.getElementById(id))
    .filter((n): n is HTMLElement => Boolean(n))
    .map((n) => visibleText(n))
    .join(' ')
}

function escapeId(id: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id.replace(/["\\]/g, '\\$&')
}

function labelText(el: HTMLElement): string {
  const texts: string[] = []
  if (el.id) rootOf(el).querySelectorAll(`label[for="${escapeId(el.id)}"]`).forEach((l) => texts.push(visibleText(l)))
  const wrapping = el.closest('label')
  if (wrapping) texts.push(visibleText(wrapping))
  return texts.find((t) => cleanText(t)) ?? ''
}

function legendText(el: Element): string {
  const fieldset = el.closest('fieldset')
  const legend = fieldset ? [...fieldset.children].find((c) => c.tagName === 'LEGEND') : null
  return legend ? visibleText(legend) : ''
}

/**
 * Label conventions of field containers that don't use <label for>: Workday wraps each
 * field in [data-automation-id^="formField"] with a [data-automation-id="formLabel"];
 * many React forms use data-testid="...label".
 */
function containerLabel(el: Element, own: Element[] = [el]): string {
  const workday = el.closest('[data-automation-id^="formField"]')
  const wdLabel = workday?.querySelector('[data-automation-id="formLabel"], [data-automation-id="richTextLabel"], label')
  if (wdLabel && !wdLabel.contains(el)) return visibleText(wdLabel)
  for (let node = el.parentElement, depth = 0; node && depth < 4; node = node.parentElement, depth++) {
    // A container with other fields holds their labels too.
    if ([...node.querySelectorAll(FIELD_QUERY)].some((f) => !own.some((o) => o === f || o.contains(f) || f.contains(o)))) break
    const label = node.querySelector(':scope > [data-testid$="label" i], :scope > [data-testid*="-label" i], :scope > [class*="label" i]:not(input):not(textarea)')
    if (label && !own.some((o) => label.contains(o)) && !label.querySelector('input, textarea, select')) {
      const text = visibleText(label)
      if (text) return text
    }
  }
  return ''
}

const FIELD_QUERY = 'input:not([type=hidden]), textarea, select, [contenteditable]:not([contenteditable=false]), [role=combobox], [role=radiogroup], [role=textbox]'

const isField = (el: Element) => el.matches(FIELD_QUERY)

/**
 * Text that appears before the field inside its nearby containers: the closest
 * preceding sibling with text, checked at each ancestor level. Stops at
 * containers that hold other fields' questions.
 */
function surroundingText(el: HTMLElement, own: HTMLElement[] = [el]): string {
  let node: Element | null = el
  const isOwn = (n: Element) => own.some((o) => n === o || n.contains(o))
  for (let depth = 0; node && depth < MAX_ANCESTOR_DEPTH; depth++) {
    let sibling = node.previousElementSibling
    while (sibling) {
      // A sibling that contains another field belongs to a different question.
      if (!isOwn(sibling) && (isField(sibling) || sibling.querySelector('input:not([type=hidden]), textarea, select'))) break
      const text = cleanText(visibleText(sibling))
      if (text) return text
      sibling = sibling.previousElementSibling
    }
    if (sibling) break
    const parent: HTMLElement | null = node.parentElement
    if (!parent || parent === el.ownerDocument.body) break
    // Don't climb into a container that holds other fields: its text isn't ours.
    const others = [...parent.querySelectorAll(FIELD_QUERY)].filter((f) => !own.some((o) => o === f || o.contains(f) || f.contains(o)))
    if (others.length > 0) break
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

/** A label that only describes format is helper text, not the question. */
const FORMAT_HINT = /^(max(imum)?|min(imum)?|up to|at least|limit)\b.*\b(characters?|words?)\b/i

function firstText(candidates: [QuestionSource, () => string][], hint: string | null): ExtractedQuestion {
  for (const [source, get] of candidates) {
    const text = cleanText(get())
    if (text && !(source === 'aria-describedby' && FORMAT_HINT.test(text))) return { text, source, hint }
  }
  return { text: '', source: 'none', hint }
}

export function extractQuestion(el: HTMLElement): ExtractedQuestion {
  const hint = cleanText(byIds(el, 'aria-describedby')) || null
  return firstText(
    [
      ['aria-labelledby', () => byIds(el, 'aria-labelledby')],
      ['label', () => labelText(el)],
      ['aria-label', () => el.getAttribute('aria-label') ?? ''],
      ['aria-describedby', () => hint ?? ''],
      ['container', () => containerLabel(el)],
      ['surrounding', () => surroundingText(el)],
      ['legend', () => legendText(el)],
      ['placeholder', () => el.getAttribute('placeholder') ?? el.getAttribute('data-placeholder') ?? ''],
      ['name', () => humanizeName(el.getAttribute('name')) || humanizeName(el.id)],
    ],
    hint,
  )
}

/** The question for a radio / checkbox group: legend, radiogroup label, or the text before the group. */
export function extractGroupQuestion(anchor: HTMLElement, controls: HTMLElement[]): ExtractedQuestion {
  const first = controls[0] ?? anchor
  const hint = cleanText(byIds(anchor, 'aria-describedby')) || null
  const group = first.closest('[role=radiogroup], [role=group]') as HTMLElement | null
  return firstText(
    [
      ['aria-labelledby', () => (group ? byIds(group, 'aria-labelledby') : '') || byIds(anchor, 'aria-labelledby')],
      ['aria-label', () => group?.getAttribute('aria-label') ?? anchor.getAttribute('aria-label') ?? ''],
      ['legend', () => legendText(first)],
      ['container', () => containerLabel(first, controls)],
      ['surrounding', () => surroundingText(anchor, controls)],
      ['name', () => humanizeName(first.getAttribute('name'))],
    ],
    hint,
  )
}

/** The visible label of one option (radio / checkbox / role=option). */
export function optionLabel(el: HTMLElement): string {
  const fromLabel = cleanText(el.getAttribute('aria-label')) || cleanText(byIds(el, 'aria-labelledby')) || cleanText(labelText(el))
  if (fromLabel) return fromLabel
  if (el.getAttribute('role')) return cleanText(visibleText(el))
  // <input type=radio> Yes  (text right after the input)
  const next = el.nextSibling
  const after = next?.nodeType === Node.TEXT_NODE ? next.textContent : next instanceof Element ? visibleText(next) : ''
  return cleanText(after) || cleanText((el as HTMLInputElement).value)
}
