/**
 * Scanning: finds every candidate field in a document (including open shadow
 * roots), groups radios / checkboxes into one field each, classifies them, and
 * keeps the list in sync as the page changes (MutationObserver, debounced).
 */

import { classifyField, classifyGroup, type FieldClassification } from './classify'

export const FIELD_SELECTOR = [
  'input', 'textarea', 'select', '[contenteditable]:not([contenteditable="false"])',
  '[role=textbox]', '[role=combobox]', '[role=radiogroup]', '[role=listbox]', '[role=radio]', '[role=checkbox]',
].join(', ')

export interface TrackedField extends FieldClassification {
  /** Stable for the page session. */
  id: string
  /** The element to position UI against: the field, or the group's container. */
  el: HTMLElement
  /** The controls to fill: the field itself, or each radio / checkbox of a group. */
  controls: HTMLElement[]
}

const ids = new WeakMap<HTMLElement, string>()
let nextId = 0
function idFor(el: HTMLElement): string {
  let id = ids.get(el)
  if (!id) {
    id = `f${++nextId}`
    ids.set(el, id)
  }
  return id
}

/** The document plus every open shadow root under it. */
export function allRoots(root: Document | ShadowRoot | Element): (Document | ShadowRoot | Element)[] {
  const roots: (Document | ShadowRoot | Element)[] = [root]
  const walk = (node: Document | ShadowRoot | Element) => {
    node.querySelectorAll('*').forEach((el) => {
      if (el.shadowRoot && el.tagName !== 'ANSLY-ROOT') {
        roots.push(el.shadowRoot)
        walk(el.shadowRoot)
      }
    })
  }
  walk(root)
  return roots
}

/** Topmost contenteditable only: rich editors nest editable children. */
function isNestedEditable(el: Element): boolean {
  return Boolean(el.parentElement?.closest('[contenteditable]:not([contenteditable="false"]), [role=textbox]'))
}

/** Lowest element containing all of `els`. */
function commonAncestor(els: HTMLElement[]): HTMLElement {
  let node: HTMLElement | null = els[0]!.parentElement
  while (node && !els.every((e) => node!.contains(e))) node = node.parentElement
  return node ?? els[0]!
}

function groupAnchor(controls: HTMLElement[]): HTMLElement {
  const first = controls[0]!
  const container = first.closest('fieldset, [role=radiogroup], [role=group]') as HTMLElement | null
  if (container && controls.every((c) => container.contains(c))) return container
  return controls.length > 1 ? commonAncestor(controls) : (first.closest('label') ?? first)
}

export function scanAll(root: Document | ShadowRoot | Element, ignore?: (el: Element) => boolean): TrackedField[] {
  const fields: TrackedField[] = []
  const radioGroups = new Map<string, HTMLElement[]>()
  const checkboxGroups = new Map<string, HTMLElement[]>()
  const keyOf = (el: HTMLElement, kind: string) => {
    const container = el.closest('[role=radiogroup], [role=group], fieldset')
    const name = el.getAttribute('name')
    const form = (el as HTMLInputElement).form
    // Same name in the same form (or root) = one question; otherwise group by container.
    if (name) return `${kind}:${name}:${form ? idFor(form) : 'root'}`
    return container ? `${kind}:c:${idFor(container as HTMLElement)}` : `${kind}:e:${idFor(el)}`
  }

  for (const scope of allRoots(root)) {
    scope.querySelectorAll(FIELD_SELECTOR).forEach((node) => {
      const el = node as HTMLElement
      if (ignore?.(el)) return
      const role = el.getAttribute('role')
      const type = el instanceof HTMLInputElement ? el.type : ''

      if (type === 'radio' || role === 'radio') {
        const key = keyOf(el, 'radio')
        radioGroups.set(key, [...(radioGroups.get(key) ?? []), el])
        return
      }
      if (type === 'checkbox' || role === 'checkbox') {
        const key = keyOf(el, 'checkbox')
        checkboxGroups.set(key, [...(checkboxGroups.get(key) ?? []), el])
        return
      }
      // Containers whose parts are scanned on their own.
      if (role === 'radiogroup') return
      // react-select (older versions): the role=combobox wrapper is the field, not its input.
      if (el instanceof HTMLInputElement && el.parentElement?.closest('[role=combobox]')) return
      // A listbox that belongs to a combobox is that combobox's options.
      if (role === 'listbox' && el.id && (el.getRootNode() as Document).querySelector?.(`[aria-controls="${el.id}"], [aria-owns="${el.id}"]`)) return
      if ((el.hasAttribute('contenteditable') || role === 'textbox') && isNestedEditable(el)) return

      fields.push({ ...classifyField(el), id: idFor(el), el, controls: [el] })
    })
  }

  for (const controls of radioGroups.values()) {
    const anchor = groupAnchor(controls)
    fields.push({ ...classifyGroup(anchor, controls, false), id: idFor(anchor), el: anchor, controls })
  }
  for (const controls of checkboxGroups.values()) {
    if (controls.length === 1) {
      const el = controls[0]!
      // A lone native checkbox ("I'm willing to relocate", "I agree to the terms").
      if (el instanceof HTMLInputElement) {
        fields.push({ ...classifyField(el), id: idFor(el), el: el.closest('label') ?? el, controls })
        continue
      }
    }
    const anchor = groupAnchor(controls)
    fields.push({ ...classifyGroup(anchor, controls, true), id: idFor(anchor), el: anchor, controls })
  }

  // Document order, so panels and tests read top to bottom.
  return fields.sort((a, b) => (a.el === b.el ? 0 : a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
}

/** Fields that get the ✨ button (free-text questions). */
export function scanFields(root: Document | ShadowRoot | Element, ignore?: (el: Element) => boolean): TrackedField[] {
  return scanAll(root, ignore).filter((f) => f.eligible)
}

/** Fields Ansly can fill (everything but ignored). */
export const detected = (fields: TrackedField[]) => fields.filter((f) => f.kind !== 'ignored')

const OBSERVED_ATTRIBUTES = ['hidden', 'style', 'class', 'disabled', 'readonly', 'aria-hidden', 'contenteditable', 'type', 'role', 'aria-expanded']

/**
 * Calls `onChange` with every classified field (including ignored ones) now and
 * whenever the DOM changes (debounced). Watches open shadow roots too. Returns a
 * function that stops observing.
 */
export function watchFields(
  doc: Document,
  onChange: (fields: TrackedField[]) => void,
  options: { debounceMs?: number; ignore?: (el: Element) => boolean } = {},
): () => void {
  const { debounceMs = 300, ignore } = options
  let timer: ReturnType<typeof setTimeout> | undefined
  const observed = new WeakSet<Node>()

  const observer = new MutationObserver((mutations) => {
    // Ignore mutations inside our own UI.
    if (mutations.every((m) => ignore?.(m.target as Element))) return
    schedule()
  })
  const observe = (node: Node) => {
    if (observed.has(node)) return
    observed.add(node)
    // childList + subtree catches multi-step forms (LinkedIn Easy Apply) swapping their content.
    observer.observe(node, { childList: true, subtree: true, attributes: true, attributeFilter: OBSERVED_ATTRIBUTES })
  }
  const run = () => {
    const roots = allRoots(doc)
    roots.forEach((r) => r instanceof ShadowRoot && observe(r))
    onChange(scanAll(doc, ignore))
  }
  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(run, debounceMs)
  }

  observe(doc.documentElement)
  run()
  return () => {
    clearTimeout(timer)
    observer.disconnect()
  }
}
