/**
 * Local drafts: an answer the user edited survives closing and reopening the
 * popover (or an accidental click outside it). Kept in this tab's
 * sessionStorage only, keyed by the page, the field and the question, and
 * dropped after a few hours, once filled, or when the user discards it.
 */

const PREFIX = 'ansly:draft:'
const TTL_MS = 4 * 60 * 60 * 1000

function hash(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/** The page (no query or fragment), the field and the question. */
export function draftKey(fieldId: string, question: string, url: string = location.href): string {
  let page = url
  try {
    const u = new URL(url)
    page = `${u.origin}${u.pathname}`
  } catch {
    // Not a URL: use as is.
  }
  return PREFIX + hash(`${page}|${fieldId}|${question.trim().toLowerCase()}`)
}

function storage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export function loadDraft(key: string): string | null {
  try {
    const raw = storage()?.getItem(key)
    if (!raw) return null
    const { text, at } = JSON.parse(raw) as { text: string; at: number }
    if (typeof text !== 'string' || Date.now() - at > TTL_MS) {
      storage()?.removeItem(key)
      return null
    }
    return text
  } catch {
    return null
  }
}

export function saveDraft(key: string, text: string): void {
  try {
    storage()?.setItem(key, JSON.stringify({ text, at: Date.now() }))
  } catch {
    // Storage full or blocked: drafts are a convenience.
  }
}

export function clearDraft(key: string): void {
  try {
    storage()?.removeItem(key)
  } catch {
    // Ignore.
  }
}
