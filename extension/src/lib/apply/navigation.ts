import { isHidden } from '../detection/classify'
import { allRoots } from '../detection/scan'

const NON_SUBMIT_ACTIONS = new Set([
  'apply',
  'apply for this job',
  'apply now',
  'continue',
  'continue application',
  'continue to application',
  'next',
  'next step',
  'save and continue',
])
const APPLY_ACTIONS = new Set(['apply', 'apply for this job', 'apply now'])

const FINAL_ACTION = /\b(submit|send|complete|finish)\b/i

function labels(element: HTMLElement): string[] {
  const inputValue = element instanceof HTMLInputElement ? element.value : ''
  return [
    element.getAttribute('aria-label') ?? '',
    inputValue,
    element.innerText ?? element.textContent ?? '',
  ]
    .map((label) => label.replace(/\s*&\s*/g, ' and ').replace(/\s+/g, ' ').trim().toLowerCase())
    .filter(Boolean)
}

function enabled(element: HTMLElement): boolean {
  return (
    element.isConnected &&
    !isHidden(element) &&
    !(element instanceof HTMLButtonElement && element.disabled) &&
    !(element instanceof HTMLInputElement && element.disabled) &&
    element.getAttribute('aria-disabled') !== 'true'
  )
}

/** Returns an unambiguous, clearly labeled Indeed step action, never a final-submit control. */
export function findIndeedNextAction(doc: Document, allowApply = true): HTMLElement | null {
  const candidates = allRoots(doc)
    .flatMap((root) => [...root.querySelectorAll<HTMLElement>('button, [role="button"], input[type="button"], input[type="submit"]')])
    .filter((element) => {
      if (!enabled(element)) return false
      const text = labels(element)
      if (text.some((label) => FINAL_ACTION.test(label))) return false
      if (!text.some((label) => NON_SUBMIT_ACTIONS.has(label) && (allowApply || !APPLY_ACTIONS.has(label)))) {
        return false
      }
      if (
        element.closest('form, dialog[open], [role="dialog"]') &&
        text.some((label) => label === 'apply' || label === 'apply now' || label === 'apply for this job')
      ) {
        return false
      }
      return true
    })

  const indeedApply = candidates.filter((element) =>
    element.matches('#indeedApplyButton, [data-testid="indeedApplyButton"]'),
  )
  if (indeedApply.length === 1) return indeedApply[0]!
  if (indeedApply.length > 1) return null

  const applicationDialog = candidates.filter((element) => element.closest('dialog[open], [role="dialog"]'))
  if (applicationDialog.length === 1) return applicationDialog[0]!
  if (applicationDialog.length > 1) return null

  return candidates.length === 1 ? candidates[0]! : null
}

function stepSignature(doc: Document): string {
  const roots = allRoots(doc)
  const fields = roots.flatMap((root) =>
    [...root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      'input:not([type="file"]), textarea, select',
    )],
  )
    .map((field) => `${field.name}|${field.id}|${field.value}`)
    .join('\n')
  const text = roots
    .map((root) => ('body' in root ? `${root.body?.innerText ?? ''}\n${root.body?.textContent ?? ''}` : root.textContent) ?? '')
    .join('\n')
  return `${doc.defaultView?.location.href ?? ''}\n${text}\n${fields}`.slice(0, 12000)
}

/** Clicks the chosen step control and waits for visible page/form state to change. */
export function clickAndWaitForIndeedStep(element: HTMLElement, doc: Document, timeoutMs = 3000): Promise<boolean> {
  const before = stepSignature(doc)
  const view = doc.defaultView
  if (!view || !doc.documentElement) return Promise.resolve(false)
  const win = view

  return new Promise((resolve) => {
    let finished = false
    const observer = new win.MutationObserver(() => {
      if (stepSignature(doc) !== before) finish(true)
    })
    const timer = win.setTimeout(() => finish(stepSignature(doc) !== before), timeoutMs)

    function finish(changed: boolean) {
      if (finished) return
      finished = true
      observer.disconnect()
      win.clearTimeout(timer)
      resolve(changed)
    }

    observer.observe(doc.documentElement, { childList: true, characterData: true, subtree: true })
    element.click()
    if (stepSignature(doc) !== before) finish(true)
  })
}
