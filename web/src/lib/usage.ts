/** Token use from usage_events, bucketed by the viewer's local day. */

export interface TokenEvent {
  created_at: string
  tokens: number | null
}

export interface TokenUsage {
  today: number
  /** Average per day, from the first day with usage in the window through today (so a new account isn't diluted). */
  perDay: number
  /** Days the average covers. */
  days: number
}

export const TOKEN_WINDOW_DAYS = 30
const DAY_MS = 24 * 3600 * 1000

function dayStart(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

export function tokenUsage(events: TokenEvent[], now = new Date()): TokenUsage {
  const today = dayStart(now)
  const windowStart = today - (TOKEN_WINDOW_DAYS - 1) * DAY_MS
  let todayTotal = 0
  let total = 0
  let first = today
  for (const e of events) {
    const tokens = e.tokens ?? 0
    const day = dayStart(new Date(e.created_at))
    if (!tokens || day < windowStart || day > today) continue
    total += tokens
    if (day === today) todayTotal += tokens
    first = Math.min(first, day)
  }
  const days = Math.round((today - first) / DAY_MS) + 1
  return { today: todayTotal, perDay: Math.round(total / days), days }
}

/** 950 -> "950", 12_400 -> "12.4k", 2_300_000 -> "2.3M". */
export function compactNumber(value: number): string {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}
