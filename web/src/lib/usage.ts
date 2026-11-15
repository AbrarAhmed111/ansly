/** Token use from usage_events, bucketed by the viewer's local day. */

export interface TokenEvent {
  created_at: string
  tokens: number | null
  /** usage_events.kind the tokens came from; missing on older data (before the per-feature dashboard migration). */
  kind?: string | null
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

/** AI features the dashboard breaks token use down by. */
export type TokenFeature = 'answers' | 'tailoring' | 'emails' | 'other'

/** Which feature each token-carrying usage_events kind belongs to; anything unlisted counts as 'other'. */
const FEATURE_KINDS: Record<Exclude<TokenFeature, 'other'>, readonly string[]> = {
  // Answers on application forms: generating, filling, rewriting and adapting saved answers.
  answers: ['generate', 'regenerate', 'fill', 'fill_all', 'fill_all_completed', 'rewrite', 'fit_to_limit', 'adapt_saved_answer'],
  // Resume tailoring runs, plus the job analysis they start from.
  tailoring: ['tailoring_started', 'tailoring_completed', 'tailoring_failed', 'job_analyzed'],
  // Leads: role detection, resume matching and email writing.
  emails: ['lead_email'],
}
const KIND_FEATURE = new Map<string, TokenFeature>(
  Object.entries(FEATURE_KINDS).flatMap(([feature, kinds]) => kinds.map((kind) => [kind, feature as TokenFeature])),
)

export function tokenFeature(kind: string | null | undefined): TokenFeature {
  return (kind && KIND_FEATURE.get(kind)) || 'other'
}

export interface FeatureTokens {
  today: number
  /** Over the whole window (TOKEN_WINDOW_DAYS, local days). */
  total: number
}

/** Tokens per feature, today and over the window. Null when the events don't say which feature they came from. */
export function tokensByFeature(events: TokenEvent[], now = new Date()): Record<TokenFeature, FeatureTokens> | null {
  if (events.some((e) => (e.tokens ?? 0) > 0 && !e.kind)) return null
  const today = dayStart(now)
  const windowStart = today - (TOKEN_WINDOW_DAYS - 1) * DAY_MS
  const out: Record<TokenFeature, FeatureTokens> = {
    answers: { today: 0, total: 0 },
    tailoring: { today: 0, total: 0 },
    emails: { today: 0, total: 0 },
    other: { today: 0, total: 0 },
  }
  for (const e of events) {
    const tokens = e.tokens ?? 0
    const day = dayStart(new Date(e.created_at))
    if (!tokens || day < windowStart || day > today) continue
    const bucket = out[tokenFeature(e.kind)]
    bucket.total += tokens
    if (day === today) bucket.today += tokens
  }
  return out
}
