import { profileCompleteness, type FullProfile } from '@ansly/types'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config'

export interface ProfileSummary {
  name: string | null
  completeness: number
  /** Labels of profile items still missing. */
  missing: string[]
}

const TABLES = ['experiences', 'projects', 'skills', 'education', 'achievements'] as const

/** Reads the user's own profile from Supabase (row-level security scopes it to them). */
export async function fetchProfileSummary(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<ProfileSummary> {
  const get = async (table: string) => {
    const response = await fetchImpl(`${SUPABASE_URL}/rest/v1/${table}?select=*`, {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${accessToken}` },
    })
    if (!response.ok) throw new Error(`Could not load ${table} (${response.status})`)
    return response.json()
  }
  const [profiles, ...sections] = await Promise.all([get('profiles'), ...TABLES.map(get)])
  const [experiences, projects, skills, education, achievements] = sections
  const full = { profile: profiles[0] ?? null, experiences, projects, skills, education, achievements } as FullProfile
  const { percent, items } = profileCompleteness(full)
  return {
    name: full.profile?.full_name ?? null,
    completeness: percent,
    missing: items.filter((i) => !i.done).map((i) => i.label),
  }
}
