/**
 * Field filling that frameworks notice.
 *
 * React (and others) track an input's value internally, so setting `.value`
 * directly is ignored. Using the prototype's native setter and then
 * dispatching `input`/`change` makes the framework see a real edit.
 */

export type FillMethod = 'native-setter' | 'exec-command' | 'text-content'

export interface FillResult {
  ok: boolean
  method: FillMethod
  /** What the field contains afterwards. */
  value: string
}

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim()

function nativeValueSetter(el: HTMLInputElement | HTMLTextAreaElement) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  return Object.getOwnPropertyDescriptor(proto, 'value')?.set
}

function inputEvent(el: HTMLElement, text: string) {
  const view = el.ownerDocument.defaultView ?? window
  const Ctor = view.InputEvent ?? view.Event
  return new Ctor('input', { bubbles: true, cancelable: false, inputType: 'insertReplacementText', data: text } as InputEventInit)
}

export function readFieldValue(el: HTMLElement): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value
  return el.innerText ?? el.textContent ?? ''
}

export function verifyFilled(el: HTMLElement, text: string): boolean {
  const value = normalize(readFieldValue(el))
  const expected = normalize(text)
  return expected.length > 0 && (value === expected || value.includes(expected))
}

function fillTextControl(el: HTMLInputElement | HTMLTextAreaElement, text: string): FillResult {
  const value = el.maxLength > 0 ? text.slice(0, el.maxLength) : text
  el.focus()
  const setter = nativeValueSetter(el)
  if (setter) setter.call(el, value)
  else el.value = value
  el.dispatchEvent(inputEvent(el, value))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return { ok: verifyFilled(el, value), method: 'native-setter', value: el.value }
}

function fillContentEditable(el: HTMLElement, text: string): FillResult {
  const doc = el.ownerDocument
  el.focus()
  // Select the existing content so the insert replaces it.
  const selection = doc.getSelection()
  if (selection) {
    const range = doc.createRange()
    range.selectNodeContents(el)
    selection.removeAllRanges()
    selection.addRange(range)
  }
  // execCommand goes through the editor's own input handling (ProseMirror,
  // Draft.js, Quill...), which keeps their internal state in sync.
  let inserted = false
  try {
    inserted = typeof doc.execCommand === 'function' && doc.execCommand('insertText', false, text)
  } catch {
    inserted = false
  }
  if (inserted && verifyFilled(el, text)) {
    return { ok: true, method: 'exec-command', value: readFieldValue(el) }
  }

  // Fallback: replace the text and tell listeners.
  el.textContent = text
  el.dispatchEvent(inputEvent(el, text))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return { ok: verifyFilled(el, text), method: 'text-content', value: readFieldValue(el) }
}

/** Puts `text` into the field and checks that it stuck. */
export function fillField(el: HTMLElement, text: string): FillResult {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return fillTextControl(el, text)
  return fillContentEditable(el, text)
}
