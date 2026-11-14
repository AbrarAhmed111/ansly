import type { Lead, TargetingProfile } from '@ansly/types'
import { createClient } from '@/lib/supabase/client'

/** Profile fields a user edits. System fields (id, owner, timestamps, active flag) are never sent. */
export type TargetingProfileValues = Pick<
  TargetingProfile,
  | 'name'
  | 'description'
  | 'target_roles'
  | 'keywords'
  | 'excluded_keywords'
  | 'locations'
  | 'remote_preferences'
  | 'opportunity_types'
>

export const EMPTY_PROFILE: TargetingProfileValues = {
  name: '',
  description: '',
  target_roles: [],
  keywords: [],
  excluded_keywords: [],
  locations: [],
  remote_preferences: 'any',
  opportunity_types: [],
}

export function profileValues(profile: TargetingProfile): TargetingProfileValues {
  return {
    name: profile.name,
    description: profile.description ?? '',
    target_roles: profile.target_roles,
    keywords: profile.keywords,
    excluded_keywords: profile.excluded_keywords,
    locations: profile.locations,
    remote_preferences: profile.remote_preferences,
    opportunity_types: profile.opportunity_types,
  }
}

export async function listTargetingProfiles(): Promise<TargetingProfile[]> {
  const { data, error } = await createClient()
    .from('targeting_profiles')
    .select('*')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as TargetingProfile[]
}

export async function createTargetingProfile(values: TargetingProfileValues): Promise<TargetingProfile> {
  const { data, error } = await createClient().from('targeting_profiles').insert(clean(values)).select('*').single()
  if (error) throw friendly(error)
  return data as TargetingProfile
}

export async function updateTargetingProfile(
  id: string,
  values: Partial<TargetingProfileValues>,
): Promise<TargetingProfile> {
  const { data, error } = await createClient()
    .from('targeting_profiles')
    .update(clean(values))
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw friendly(error)
  return data as TargetingProfile
}

export async function deleteTargetingProfile(id: string): Promise<void> {
  const { error } = await createClient().from('targeting_profiles').delete().eq('id', id)
  if (error) throw friendly(error)
}

/** The extension collects against the active profile, so exactly one is marked active in the database. */
export async function activateTargetingProfile(id: string): Promise<void> {
  const client = createClient()
  const cleared = await client.from('targeting_profiles').update({ is_active: false }).eq('is_active', true).neq('id', id)
  if (cleared.error) throw friendly(cleared.error)
  const activated = await client.from('targeting_profiles').update({ is_active: true }).eq('id', id)
  if (activated.error) throw friendly(activated.error)
}

export async function setLeadStatus(ids: string[], status: Lead['status']): Promise<void> {
  if (!ids.length) return
  const { error } = await createClient().from('leads').update({ status }).in('id', ids)
  if (error) throw friendly(error)
}

export async function deleteLeads(ids: string[]): Promise<void> {
  if (!ids.length) return
  const { error } = await createClient().from('leads').delete().in('id', ids)
  if (error) throw friendly(error)
}

function clean<T extends Partial<TargetingProfileValues>>(values: T): T {
  const next = { ...values }
  if (typeof next.name === 'string') next.name = next.name.trim()
  if (typeof next.description === 'string') next.description = next.description.trim() || null
  return next
}

function friendly(error: { message: string; code?: string }): Error {
  if (error.code === '23505') return new Error('A targeting profile with this name already exists.')
  return new Error(error.message)
}

/** Best = the post gives an email; good = it gives an apply link. */
export type LeadTier = 'email' | 'link' | 'other'

export function leadTier(lead: Lead): LeadTier {
  if (lead.contact_info?.email) return 'email'
  if (lead.contact_info?.application_url) return 'link'
  return 'other'
}

export function relativeDate(value?: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: days > 300 ? 'numeric' : undefined })
}
