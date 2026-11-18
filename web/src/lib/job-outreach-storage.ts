import type { JobOutreachResponse } from '@ansly/types'

export const JOB_OUTREACH_STORAGE_KEY = 'ansly:job-outreach:draft:v1'

export interface JobOutreachDraftSnapshot {
  jobText: string
  result: JobOutreachResponse
  recipient: string
  subject: string
  body: string
  resumeId: string
}

export function loadJobOutreachDraft(): JobOutreachDraftSnapshot | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(JOB_OUTREACH_STORAGE_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<JobOutreachDraftSnapshot>
    if (typeof value.jobText !== 'string' || !value.result || typeof value.result !== 'object') return null
    return {
      jobText: value.jobText,
      result: value.result as JobOutreachResponse,
      recipient: typeof value.recipient === 'string' ? value.recipient : value.result.recipient_email ?? '',
      subject: typeof value.subject === 'string' ? value.subject : value.result.subject ?? '',
      body: typeof value.body === 'string' ? value.body : value.result.body ?? '',
      resumeId: typeof value.resumeId === 'string' ? value.resumeId : value.result.resume_id ?? '',
    }
  } catch {
    return null
  }
}

export function saveJobOutreachDraft(snapshot: JobOutreachDraftSnapshot): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(JOB_OUTREACH_STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    // Storage is optional: private browsing or quota limits must not block the email workflow.
  }
}

export function clearJobOutreachDraft(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(JOB_OUTREACH_STORAGE_KEY)
  } catch {
    // Storage is optional.
  }
}
