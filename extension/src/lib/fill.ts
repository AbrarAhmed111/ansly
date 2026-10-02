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

// --- choices and undo ---------------------------------------------------------------

const optionKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** The item whose option text matches `wanted` best (exact, then case/punctuation-insensitive, then prefix). */
function pick<T>(items: T[], label: (item: T) => string, wanted: string): T | undefined {
  const key = optionKey(wanted)
  return (
    items.find((i) => label(i) === wanted) ??
    items.find((i) => optionKey(label(i)) === key) ??
    items.find((i) => optionKey(label(i)) !== '' && (optionKey(label(i)).startsWith(key) || key.startsWith(optionKey(label(i)))))
  )
}

const isChecked = (el: HTMLElement) =>
  el instanceof HTMLInputElement ? el.checked : el.getAttribute('aria-checked') === 'true'

function setChecked(el: HTMLElement, checked: boolean) {
  if (isChecked(el) === checked) return
  // .click() runs the page's own handlers (React listens for click on checkboxes and radios).
  el.click()
  if (el instanceof HTMLInputElement && el.checked !== checked) {
    el.checked = checked
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
}

function selectNative(el: HTMLSelectElement, values: string[]): boolean {
  const options = [...el.options]
  const chosen = values
    .map((v) => pick(options, (o) => o.textContent?.trim() ?? '', v))
    .filter((o): o is HTMLOptionElement => Boolean(o))
  if (!chosen.length) return false
  el.focus()
  if (el.multiple) {
    options.forEach((o) => (o.selected = chosen.includes(o)))
  } else {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
    if (setter) setter.call(el, chosen[0]!.value)
    else el.value = chosen[0]!.value
  }
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return chosen.every((o) => o.selected)
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * react-select / ARIA comboboxes: open, type the option text, pick the matching
 * option (or press Enter). Best-effort: the caller verifies and reports failure.
 */
async function selectCombobox(el: HTMLElement, value: string): Promise<boolean> {
  const input = el instanceof HTMLInputElement ? el : (el.querySelector('input') ?? el)
  input.focus()
  input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  if (input instanceof HTMLInputElement) {
    nativeValueSetter(input)?.call(input, value)
    input.dispatchEvent(inputEvent(input, value))
  }
  await wait(250)
  const root = el.getRootNode() as Document | ShadowRoot
  const listId = input.getAttribute('aria-controls') ?? el.getAttribute('aria-controls')
  const list = (listId ? root.getElementById?.(listId) : null) ?? root.querySelector?.('[role=listbox]')
  const options = list ? ([...list.querySelectorAll('[role=option]')] as HTMLElement[]) : []
  const option = pick(options, (o) => o.textContent?.trim() ?? '', value)
  if (option) {
    option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    option.click()
  } else {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }))
  }
  await wait(100)
  const shown = normalize(el.closest('[class*="container" i]')?.textContent ?? el.textContent ?? '').toLowerCase()
  return shown.includes(normalize(value).toLowerCase())
}

/**
 * Chooses option(s) in a choice field. `answer` is one option, or several joined
 * with " | " for multi-choice; `labels[i]` is `controls[i]`'s option text for groups.
 * Returns whether the field now shows that choice.
 */
export async function fillChoice(controls: HTMLElement[], answer: string, labels: string[] = []): Promise<boolean> {
  const values = answer.split(/\s*\|\s*/).filter(Boolean)
  const first = controls[0]
  if (!first || !values.length) return false

  if (first instanceof HTMLSelectElement) return selectNative(first, values)
  const role = first.getAttribute('role')
  if (role === 'listbox') {
    const option = pick([...first.querySelectorAll('[role=option]')] as HTMLElement[], (o) => o.textContent?.trim() ?? '', values[0]!)
    option?.click()
    return Boolean(option)
  }
  if (role === 'combobox') return selectCombobox(first, values[0]!)

  // A lone checkbox answered Yes / No.
  const checkbox = first instanceof HTMLInputElement ? first.type === 'checkbox' : role === 'checkbox'
  if (controls.length === 1 && checkbox) {
    const yes = /^y(es)?\b/i.test(values[0]!)
    setChecked(first, yes)
    return isChecked(first) === yes
  }

  // Radio / checkbox groups.
  const labelOf = (el: HTMLElement) => labels[controls.indexOf(el)] ?? ''
  const wanted = values.map((v) => pick(controls, labelOf, v)).filter((c): c is HTMLElement => Boolean(c))
  if (!wanted.length) return false
  if (checkbox) controls.forEach((c) => setChecked(c, wanted.includes(c)))
  else setChecked(wanted[0]!, true)
  return wanted.every(isChecked)
}

export type Snapshot =
  | { type: 'text'; el: HTMLElement; value: string }
  | { type: 'checked'; states: [HTMLElement, boolean][] }
  | { type: 'select'; el: HTMLSelectElement; selected: boolean[] }
  | { type: 'none' }

const isToggle = (el: HTMLElement) =>
  (el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox')) ||
  ['radio', 'checkbox'].includes(el.getAttribute('role') ?? '')

/** Records a field's current value so Undo can restore it exactly. */
export function snapshotValue(controls: HTMLElement[]): Snapshot {
  const first = controls[0]
  if (!first) return { type: 'none' }
  if (first instanceof HTMLSelectElement) return { type: 'select', el: first, selected: [...first.options].map((o) => o.selected) }
  if (isToggle(first)) return { type: 'checked', states: controls.map((c) => [c, isChecked(c)]) }
  if (['combobox', 'listbox'].includes(first.getAttribute('role') ?? '')) return { type: 'none' }
  return { type: 'text', el: first, value: readFieldValue(first) }
}

/** Puts a snapshot back. Returns false where it can't (custom dropdowns): the user resets those by hand. */
export function restoreValue(snapshot: Snapshot): boolean {
  switch (snapshot.type) {
    case 'text': {
      const { el, value } = snapshot
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        el.focus()
        const setter = nativeValueSetter(el)
        if (setter) setter.call(el, value)
        else el.value = value
        el.dispatchEvent(inputEvent(el, value))
        el.dispatchEvent(new Event('change', { bubbles: true }))
        return el.value === value
      }
      if (!value.trim()) {
        el.focus()
        el.textContent = ''
        el.dispatchEvent(inputEvent(el, ''))
        return true
      }
      return fillContentEditable(el, value).ok
    }
    case 'checked':
      // Uncheck first so a radio group ends with exactly the old selection.
      snapshot.states.forEach(([el, was]) => !was && setChecked(el, false))
      snapshot.states.forEach(([el, was]) => was && setChecked(el, true))
      return snapshot.states.every(([el, was]) => isChecked(el) === was)
    case 'select':
      ;[...snapshot.el.options].forEach((o, i) => (o.selected = snapshot.selected[i] ?? false))
      snapshot.el.dispatchEvent(new Event('input', { bubbles: true }))
      snapshot.el.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    case 'none':
      return false
  }
}

/** Whether the field already has a value (Fill all skips these unless told to overwrite). */
export function hasValue(controls: HTMLElement[]): boolean {
  const first = controls[0]
  if (!first) return false
  if (first instanceof HTMLSelectElement) {
    const o = first.selectedOptions[0]
    return Boolean(o && o.value !== '' && !(o.index === 0 && /^(select|choose|please|--)/i.test(o.textContent?.trim() ?? '')))
  }
  const snap = snapshotValue(controls)
  // A lone checkbox's unchecked state is an answer too ("No"), so only groups count as filled.
  if (snap.type === 'checked') return controls.length > 1 && snap.states.some(([, c]) => c)
  if (snap.type === 'text') return normalize(snap.value).length > 0
  return false
}
