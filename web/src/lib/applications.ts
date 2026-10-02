import { APPLICATION_STATUSES, type Application, type ApplicationStatus, type Job } from '@ansly/types'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Tone } from '@/components/ui'

export const STATUS_META: Record<ApplicationStatus, { label: string; tone: Tone; hint: string }> = {
  interested: { label: 'Interested', tone: 'neutral', hint: 'Saved to apply later' },
  preparing: { label: 'Preparing', tone: 'accent', hint: 'Getting materials ready' },
  applied: { label: 'Applied', tone: 'accent', hint: 'Waiting to hear back' },
  interview: { label: 'Interview', tone: 'warning', hint: 'In the interview process' },
  offer: { label: 'Offer', tone: 'success', hint: 'You have an offer' },
  rejected: { label: 'Rejected', tone: 'danger', hint: 'Closed' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral', hint: 'You stepped back' },
}

export const STATUS_OPTIONS = APPLICATION_STATUSES.map((value) => ({ value, label: STATUS_META[value].label }))

/** Board columns, left to right. Rejected and withdrawn share the last one. */
export const PIPELINE: { key: string; label: string; statuses: ApplicationStatus[] }[] = [
  { key: 'interested', label: 'Interested', statuses: ['interested'] },
  { key: 'preparing', label: 'Preparing', statuses: ['preparing'] },
  { key: 'applied', label: 'Applied', statuses: ['applied'] },
  { key: 'interview', label: 'Interview', statuses: ['interview'] },
  { key: 'offer', label: 'Offer', statuses: ['offer'] },
  { key: 'closed', label: 'Closed', statuses: ['rejected', 'withdrawn'] },
]

export function countByStatus(apps: Pick<Application, 'status'>[]): Record<ApplicationStatus, number> {
  const counts = Object.fromEntries(APPLICATION_STATUSES.map((s) => [s, 0])) as Record<ApplicationStatus, number>
  for (const a of apps) counts[a.status] += 1
  return counts
}

/** The user's application for a job, creating it ("Interested") if there isn't one. Returns its id. */
export async function trackJob(
  supabase: SupabaseClient,
  job: Pick<Job, 'id' | 'company' | 'title' | 'url' | 'location'>,
): Promise<string> {
  const { data: existing, error: findError } = await supabase.from('applications').select('id').eq('job_id', job.id).maybeSingle()
  if (findError) throw new Error(findError.message)
  if (existing) return existing.id as string
  const { data, error } = await supabase
    .from('applications')
    .insert({ job_id: job.id, company: job.company, role: job.title, job_url: job.url, location: job.location })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return data.id as string
}
