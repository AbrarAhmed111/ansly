import type { FullProfile } from '@ansly/types'
import type { SupabaseClient } from '@supabase/supabase-js'

const SECTION_TABLES = ['experiences', 'projects', 'skills', 'education', 'achievements'] as const

/** Loads the signed-in user's whole profile (RLS limits every query to their rows). */
export async function loadFullProfile(supabase: SupabaseClient): Promise<FullProfile> {
  const [profile, ...sections] = await Promise.all([
    supabase.from('profiles').select('*').maybeSingle(),
    ...SECTION_TABLES.map((t) => supabase.from(t).select('*').order('sort_order')),
  ])
  const failed = [profile, ...sections].find((r) => r.error)
  if (failed?.error) throw new Error(failed.error.message)

  const [experiences, projects, skills, education, achievements] = sections.map((s) => s.data ?? [])
  return {
    profile: profile.data,
    experiences,
    projects,
    skills,
    education,
    achievements,
  } as FullProfile
}
