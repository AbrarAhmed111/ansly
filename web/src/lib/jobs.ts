import type { EmploymentType, Job, JobMatch, MatchTier, SalaryPeriod, Workplace } from '@ansly/types'
import type { Tone } from '@/components/ui'

export const TIERS: Record<MatchTier, { label: string; tone: Tone; description: string }> = {
  strong: { label: 'Strong alignment', tone: 'success', description: 'Your skills, experience and preferences fit well.' },
  good: { label: 'Good alignment', tone: 'accent', description: 'A solid fit with a few gaps.' },
  potential: { label: 'Potential', tone: 'warning', description: 'Worth a look; check the gaps first.' },
  low: { label: 'Low alignment', tone: 'neutral', description: 'Different role or many gaps.' },
}

export const TIER_ORDER: MatchTier[] = ['strong', 'good', 'potential', 'low']

export const WORKPLACE_LABELS: Record<Workplace, string> = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'On-site' }

export const EMPLOYMENT_LABELS: Record<EmploymentType, string> = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  contract: 'Contract',
  internship: 'Internship',
  temporary: 'Temporary',
}

const PERIOD_SUFFIX: Record<SalaryPeriod, string> = { year: '/yr', month: '/mo', hour: '/hr' }

function compact(amount: number): string {
  if (amount >= 1000) {
    const k = amount / 1000
    return `${Number.isInteger(k) ? k : k.toFixed(1)}k`
  }
  return String(amount)
}

/** "$100k–140k/yr", "€60k/yr", or null when the posting has no salary. */
export function formatSalary(job: Pick<Job, 'salary_min' | 'salary_max' | 'salary_currency' | 'salary_period'>): string | null {
  const { salary_min: min, salary_max: max, salary_currency: currency, salary_period: period } = job
  if (min == null && max == null) return null
  const symbol = { USD: '$', EUR: '€', GBP: '£' }[currency ?? ''] ?? (currency ? `${currency} ` : '')
  const range = min != null && max != null && min !== max ? `${compact(min)}–${compact(max)}` : compact((min ?? max)!)
  return `${symbol}${range}${period ? PERIOD_SUFFIX[period] : ''}`
}

/** "3 days ago", "today". */
export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return ''
  const days = Math.floor((now - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  const months = Math.floor(days / 30)
  return months === 1 ? '1 month ago' : `${months} months ago`
}

/** Short facts for a job card: location, workplace, type, salary. */
export function jobFacts(job: Job): string[] {
  return [
    job.location,
    job.workplace ? WORKPLACE_LABELS[job.workplace] : null,
    job.employment_type && job.employment_type !== 'full_time' ? EMPLOYMENT_LABELS[job.employment_type] : null,
    formatSalary(job),
  ].filter((v): v is string => Boolean(v))
}

/** Experience line for a match, e.g. "Asks for 5+ years · you have 3.5". */
export function experienceLine(match: JobMatch): string | null {
  const { required, profile, fit } = match.experience ?? {}
  if (fit === 'unknown' || required == null) return null
  return `Asks for ${required}+ years${profile != null ? ` · you have ${profile}` : ''}`
}

// How often the feed asks the API to rescore jobs, per browser.
const REFRESH_KEY = 'ansly-matches-refreshed-at'
const REFRESH_EVERY_MS = 60 * 60 * 1000

export function matchesAreStale(now = Date.now()): boolean {
  try {
    const last = Number(localStorage.getItem(REFRESH_KEY) ?? 0)
    return now - last > REFRESH_EVERY_MS
  } catch {
    return true
  }
}

export function markMatchesRefreshed(now = Date.now()) {
  try {
    localStorage.setItem(REFRESH_KEY, String(now))
  } catch {
    // Storage unavailable: the feed will just refresh again next visit.
  }
}
