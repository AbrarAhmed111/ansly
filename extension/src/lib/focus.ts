/**
 * Keyboard focus for Ansly's dialogs (popover, panel). They live in a shadow root on someone else's page, so Tab
 * would otherwise walk out into the page's own fields: at the ends it wraps around inside the dialog instead.
 */

const FOCUSABLE = [
  'button:not([disabled])', 'a[href]', 'input:not([disabled]):not([type=hidden])', 'select:not([disabled])',
  'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(', ')

export function focusables(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest('[hidden]'))
}

/** The focused element, looking inside the shadow root the container lives in. */
function activeIn(container: HTMLElement): Element | null {
  const root = container.getRootNode() as Document | ShadowRoot
  return root.activeElement ?? null
}

/** Call from the dialog's keydown handler: keeps Tab / Shift+Tab inside `container`. */
export function trapTab(e: { key: string; shiftKey: boolean; preventDefault: () => void }, container: HTMLElement | null): void {
  if (e.key !== 'Tab' || !container) return
  const items = focusables(container)
  if (!items.length) return
  const first = items[0]!
  const last = items[items.length - 1]!
  const active = activeIn(container)
  if (e.shiftKey && (active === first || !container.contains(active))) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && (active === last || !container.contains(active))) {
    e.preventDefault()
    first.focus()
  }
}
