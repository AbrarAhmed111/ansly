import type { Experience, Profile, ProfileValues } from '@ansly/types'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config'

/** City from a location like "Berlin, Germany" or "Austin, TX". "Remote" isn't a city. */
function cityOf(location: string | null): string | undefined {
  const first = location?.split(',')[0]?.trim()
  return first && !/^remote\b/i.test(first) ? first : undefined
}

/** What Ansly fills into `profile` fields, straight from the profile (no LLM). */
export function profileValues(profile: Profile | null, experiences: Experience[] = []): ProfileValues {
  if (!profile) return {}
  const name = profile.full_name?.trim() || undefined
  const parts = name?.split(/\s+/) ?? []
  const current = experiences.find((e) => e.is_current) ?? null
  const values: ProfileValues = {
    full_name: name,
    first_name: parts.length > 1 ? parts.slice(0, -1).join(' ') : name,
    last_name: parts.length > 1 ? parts.at(-1) : undefined,
    email: profile.email ?? undefined,
    phone: profile.phone ?? undefined,
    location: profile.location ?? undefined,
    city: cityOf(profile.location),
    headline: profile.headline ?? undefined,
    linkedin: profile.links?.linkedin,
    github: profile.links?.github,
    website: profile.links?.website ?? profile.links?.portfolio,
    portfolio: profile.links?.portfolio ?? profile.links?.website,
    current_company: current?.company,
    current_title: current?.title ?? profile.headline ?? undefined,
  }
  return Object.fromEntries(Object.entries(values).filter(([, v]) => typeof v === 'string' && v.trim())) as ProfileValues
}

/** Reads the user's own profile row and current role (row-level security scopes it to them). */
export async function fetchProfileValues(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<ProfileValues> {
  const get = async (path: string) => {
    const response = await fetchImpl(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${accessToken}` },
    })
    if (!response.ok) throw new Error(`Could not load your profile (${response.status})`)
    return response.json()
  }
  const [profiles, experiences] = await Promise.all([
    get('profiles?select=*&limit=1'),
    get('experiences?select=company,title,is_current&is_current=eq.true&limit=1'),
  ])
  return profileValues(profiles[0] ?? null, experiences)
}
