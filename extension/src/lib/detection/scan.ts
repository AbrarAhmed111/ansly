/**
 * Scanning: finds every candidate field in a document (including open shadow
 * roots), groups radios / checkboxes into one field each, classifies them, and
 * keeps the list in sync as the page changes (MutationObserver, debounced).
 *
 * Job sites are large, busy pages, so watching is selective: only mutations that
 * can add, remove, show/hide or relabel a field trigger a rescan, nothing runs in
 * a hidden tab, and shadow roots are found incrementally instead of by walking
 * the whole document on every scan.
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

type Scope = Document | ShadowRoot | Element

/** Adds every open shadow root under `node` (including node's own) to `into`. */
function collectShadowRoots(node: Scope, into: ShadowRoot[]) {
  const visit = (el: Element) => {
    if (el.shadowRoot && el.tagName !== 'ANSLY-ROOT') {
      into.push(el.shadowRoot)
      collectShadowRoots(el.shadowRoot, into)
    }
  }
  if (node instanceof Element) visit(node)
  node.querySelectorAll('*').forEach(visit)
}

/** The document plus every open shadow root under it. */
export function allRoots(root: Scope): Scope[] {
  const roots: ShadowRoot[] = []
  collectShadowRoots(root, roots)
  return [root, ...roots]
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

/** `roots`: `root` and its shadow roots, when the caller already knows them (see allRoots). */
export function scanAll(root: Scope, ignore?: (el: Element) => boolean, roots: Scope[] = allRoots(root)): TrackedField[] {
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

  for (const scope of roots) {
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

// `open`: a <dialog> or <details> showing its content (LinkedIn Easy Apply opens in a <dialog>).
const OBSERVED_ATTRIBUTES = ['hidden', 'style', 'class', 'disabled', 'readonly', 'aria-hidden', 'inert', 'open', 'contenteditable', 'type', 'role', 'aria-expanded']
// Elements whose appearance can add, remove or relabel a field.
const RELEVANT_SELECTOR = `${FIELD_SELECTOR}, label, legend, fieldset, form`
// Shadow roots attached without a DOM mutation (late custom-element upgrades) are found by a full walk this often.
const FULL_WALK_MS = 5000
// However busy the page, a pending rescan runs within this long.
const MAX_WAIT_MS = 1000
// More added nodes than this in one batch: rediscover shadow roots with a full walk instead.
const MAX_TRACKED_ADDITIONS = 500

/** Whether an added or removed node can change the field list. Text-only changes can't (labels are checked by target). */
function touchesFields(node: Node): boolean {
  if (node.nodeType !== Node.ELEMENT_NODE) return false
  const el = node as Element
  return Boolean(el.shadowRoot) || el.matches(RELEVANT_SELECTOR) || el.querySelector(RELEVANT_SELECTOR) !== null
}

function isRelevant(m: MutationRecord): boolean {
  const target = m.target as Element
  if (m.type === 'attributes') return target.matches?.(FIELD_SELECTOR) || target.querySelector?.(FIELD_SELECTOR) != null
  // A label's own text changing relabels its field.
  if (target.closest?.('label, legend')) return true
  return [...m.addedNodes].some(touchesFields) || [...m.removedNodes].some(touchesFields)
}

export interface ScanStats {
  durationMs: number
  roots: number
  fields: number
}

/**
 * Calls `onChange` with every classified field (including ignored ones) now and
 * whenever the DOM changes in a way that can affect fields (debounced, at most
 * MAX_WAIT_MS late, paused while the tab is hidden). Watches open shadow roots
 * too. Returns a function that stops observing.
 */
export function watchFields(
  doc: Document,
  onChange: (fields: TrackedField[]) => void,
  options: { debounceMs?: number; ignore?: (el: Element) => boolean; onScan?: (stats: ScanStats) => void } = {},
): () => void {
  const { debounceMs = 300, ignore, onScan } = options
  let timer: ReturnType<typeof setTimeout> | undefined
  let firstPending = 0
  let dirtyWhileHidden = false
  const observed = new WeakSet<Node>()
  let shadowRoots: ShadowRoot[] = []
  let lastFullWalk = -Infinity
  let added: Element[] = []
  let fullWalkNeeded = false

  const observer = new MutationObserver((mutations) => {
    let relevant = timer !== undefined
    for (const m of mutations) {
      if (ignore?.(m.target as Element)) continue
      for (const node of m.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue
        if (added.length < MAX_TRACKED_ADDITIONS) added.push(node as Element)
        else fullWalkNeeded = true
      }
      relevant ||= isRelevant(m)
    }
    if (relevant) schedule()
  })
  const observe = (node: Node) => {
    if (observed.has(node)) return
    observed.add(node)
    // childList + subtree catches multi-step forms (LinkedIn Easy Apply) swapping their content.
    observer.observe(node, { childList: true, subtree: true, attributes: true, attributeFilter: OBSERVED_ATTRIBUTES })
  }
  const updateShadowRoots = () => {
    const now = performance.now()
    if (fullWalkNeeded || now - lastFullWalk > FULL_WALK_MS) {
      shadowRoots = []
      collectShadowRoots(doc, shadowRoots)
      lastFullWalk = now
    } else {
      shadowRoots = shadowRoots.filter((r) => r.host.isConnected)
      for (const el of added) if (el.isConnected) collectShadowRoots(el, shadowRoots)
      shadowRoots = [...new Set(shadowRoots)]
    }
    added = []
    fullWalkNeeded = false
    shadowRoots.forEach(observe)
  }
  const run = () => {
    timer = undefined
    firstPending = 0
    if (doc.hidden) {
      dirtyWhileHidden = true
      return
    }
    const started = performance.now()
    updateShadowRoots()
    const fields = scanAll(doc, ignore, [doc, ...shadowRoots])
    onScan?.({ durationMs: performance.now() - started, roots: shadowRoots.length + 1, fields: fields.length })
    onChange(fields)
  }
  const schedule = () => {
    const now = performance.now()
    firstPending ||= now
    clearTimeout(timer)
    timer = setTimeout(run, Math.max(0, Math.min(debounceMs, firstPending + MAX_WAIT_MS - now)))
  }
  const onVisibility = () => {
    if (!doc.hidden && dirtyWhileHidden) {
      dirtyWhileHidden = false
      schedule()
    }
  }
  // A shadow root attached without a DOM mutation (and so unobserved) shows up when the user interacts with it:
  // focusing a field or clicking inside it. Rediscover roots right away then.
  const onInteraction = (e: Event) => {
    const root = (e.composedPath()[0] as Node | undefined)?.getRootNode?.()
    if (root instanceof ShadowRoot && !shadowRoots.includes(root) && !ignore?.(root.host)) {
      fullWalkNeeded = true
      schedule()
    }
  }

  observe(doc.documentElement)
  doc.addEventListener('visibilitychange', onVisibility)
  doc.addEventListener('focusin', onInteraction, true)
  doc.addEventListener('click', onInteraction, true)
  run()
  return () => {
    clearTimeout(timer)
    observer.disconnect()
    doc.removeEventListener('visibilitychange', onVisibility)
    doc.removeEventListener('focusin', onInteraction, true)
    doc.removeEventListener('click', onInteraction, true)
  }
}
