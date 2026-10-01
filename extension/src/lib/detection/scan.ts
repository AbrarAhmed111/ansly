/**
 * Scanning: finds every candidate field in a document and keeps the eligible
 * ones in sync as the page changes (MutationObserver, debounced).
 */

import { classifyField, type FieldClassification } from './classify'

export const FIELD_SELECTOR = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'

export interface TrackedField extends FieldClassification {
  el: HTMLElement
}

/** Topmost contenteditable only: rich editors nest editable children. */
function isNestedEditable(el: Element): boolean {
  const parent = el.parentElement?.closest('[contenteditable]:not([contenteditable="false"])')
  return Boolean(parent)
}

export function scanFields(root: ParentNode, ignore?: (el: Element) => boolean): TrackedField[] {
  const fields: TrackedField[] = []
  root.querySelectorAll(FIELD_SELECTOR).forEach((el) => {
    if (ignore?.(el)) return
    if (el.hasAttribute('contenteditable') && isNestedEditable(el)) return
    const classification = classifyField(el)
    if (classification.eligible) fields.push({ ...classification, el: el as HTMLElement })
  })
  return fields
}

/**
 * Calls `onChange` with the current eligible fields now and whenever the DOM
 * changes (debounced). Returns a function that stops observing.
 */
export function watchFields(
  doc: Document,
  onChange: (fields: TrackedField[]) => void,
  options: { debounceMs?: number; ignore?: (el: Element) => boolean } = {},
): () => void {
  const { debounceMs = 300, ignore } = options
  let timer: ReturnType<typeof setTimeout> | undefined
  const run = () => onChange(scanFields(doc, ignore))
  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(run, debounceMs)
  }

  const observer = new MutationObserver((mutations) => {
    // Ignore mutations inside our own UI.
    if (mutations.every((m) => ignore?.(m.target as Element))) return
    schedule()
  })
  observer.observe(doc.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden', 'style', 'class', 'disabled', 'readonly', 'aria-hidden', 'contenteditable', 'type'],
  })
  run()
  return () => {
    clearTimeout(timer)
    observer.disconnect()
  }
}
