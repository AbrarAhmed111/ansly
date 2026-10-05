/** A readable message from anything thrown. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** "1 item", "3 items". */
export function plural(count: number, word: string, pluralWord = `${word}s`): string {
  return `${count} ${count === 1 ? word : pluralWord}`
}

/** "favorite_project" -> "favorite project". */
export function humanize(value: string): string {
  return value.replace(/_/g, ' ')
}

/** "just now", "12 days ago", "8 months ago": how long ago an ISO timestamp was. */
export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const days = Math.floor((now - then) / 86_400_000)
  if (days < 1) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  const months = Math.floor(days / 30)
  if (months < 12) return months === 1 ? 'a month ago' : `${months} months ago`
  const years = Math.floor(days / 365)
  return years <= 1 ? 'a year ago' : `${years} years ago`
}
