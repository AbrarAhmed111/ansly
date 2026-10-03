import { completenessSignals, type CompletenessSignals } from '@ansly/types'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadFullProfile } from '@/lib/profile'
import { TOKEN_WINDOW_DAYS, type TokenEvent } from '@/lib/usage'

export interface DashboardData {
  signals: CompletenessSignals
  /** Rows per profile section, keyed by section slug. */
  counts: Record<string, number>
  savedCount: number
  usage: { generated: number; filled: number; reused: number; tailored: number }
  /** Token use, pre-bucketed by the database; summed by the viewer's local day on the client. */
  tokens: TokenEvent[]
  hasMaster: boolean
  readyCount: number
}

/** The `dashboard_summary()` RPC result (see supabase/migrations/20261009000000_dashboard_summary.sql). */
interface SummaryRow {
  profile: CompletenessSignals['profile']
  experiences: number
  experiences_described: boolean
  projects: number
  projects_described: boolean
  skills: number
  known_skills: number
  education: number
  achievements: number
  profile_facts: number
  saved_answers: number
  usage_7d: Record<string, number>
  token_buckets: [string, number][]
  master_resume: boolean
  ready_tailorings: number
}

function weekly(byKind: Record<string, number>): DashboardData['usage'] {
  const count = (kinds: string[]) => kinds.reduce((sum, kind) => sum + (byKind[kind] ?? 0), 0)
  return {
    generated: count(['generate', 'regenerate']),
    filled: count(['fill']),
    reused: count(['use_saved_answer']),
    tailored: count(['tailoring_completed']),
  }
}

function fromSummary(s: SummaryRow): DashboardData {
  return {
    signals: {
      profile: s.profile,
      experiences: s.experiences,
      experiencesDescribed: s.experiences_described,
      projectsDescribed: s.projects_described,
      knownSkills: s.known_skills,
      education: s.education,
      achievements: s.achievements,
      facts: s.profile_facts,
    },
    counts: {
      experience: s.experiences,
      projects: s.projects,
      skills: s.skills,
      education: s.education,
      achievements: s.achievements,
    },
    savedCount: s.saved_answers,
    usage: weekly(s.usage_7d),
    tokens: s.token_buckets.map(([created_at, tokens]) => ({ created_at, tokens: Number(tokens) })),
    hasMaster: s.master_resume,
    readyCount: s.ready_tailorings,
  }
}

/** Before the dashboard_summary migration is applied: the per-table reads, all in parallel. */
async function loadLegacy(supabase: SupabaseClient): Promise<DashboardData> {
  const week = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
  const tokenSince = new Date(Date.now() - (TOKEN_WINDOW_DAYS + 1) * 24 * 3600 * 1000).toISOString()
  const [profile, saved, events, tokens, master, ready] = await Promise.all([
    loadFullProfile(supabase),
    supabase.from('saved_answers').select('id', { count: 'exact', head: true }),
    supabase.from('usage_events').select('kind').gte('created_at', week),
    supabase.from('usage_events').select('created_at, tokens').gt('tokens', 0).gte('created_at', tokenSince).limit(5000),
    // Before the v1.2 migration these tables don't exist: counts stay null and the cards still render.
    supabase.from('resumes').select('id', { count: 'exact', head: true }).eq('is_master', true),
    supabase.from('resume_tailorings').select('id', { count: 'exact', head: true }).eq('status', 'ready'),
  ])
  const byKind: Record<string, number> = {}
  for (const { kind } of events.data ?? []) byKind[kind] = (byKind[kind] ?? 0) + 1
  return {
    signals: completenessSignals(profile),
    counts: {
      experience: profile.experiences.length,
      projects: profile.projects.length,
      skills: profile.skills.length,
      education: profile.education.length,
      achievements: profile.achievements.length,
    },
    savedCount: saved.count ?? 0,
    usage: weekly(byKind),
    tokens: (tokens.data ?? []) as TokenEvent[],
    hasMaster: (master.count ?? 0) > 0,
    readyCount: ready.count ?? 0,
  }
}

/** Everything the dashboard shows: one RPC (instead of ~12 queries), with the old reads as a fallback. */
export async function loadDashboard(supabase: SupabaseClient): Promise<DashboardData> {
  const { data, error } = await supabase.rpc('dashboard_summary', { token_window_days: TOKEN_WINDOW_DAYS + 1 })
  if (!error && data) return fromSummary(data as SummaryRow)
  return loadLegacy(supabase)
}
