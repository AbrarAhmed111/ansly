import type { EmailDraft } from '@ansly/types'
import type { Tone } from '@/components/ui'
import { generateEmailDrafts, previewEmailGeneration, sendEmailDrafts, writeAndSendEmails } from '@/lib/api'

/** What blocks sending, in the user's words. */
export const ISSUE_LABEL: Record<string, string> = {
  missing_recipient: 'No recipient',
  invalid_recipient: 'Recipient isn’t a valid email',
  missing_subject: 'No subject',
  missing_body: 'Empty email',
  resume_not_chosen: 'Choose a resume (or send without one)',
  not_approved: 'Not approved yet',
  already_sent: 'Already sent',
  sending: 'Sending now',
  failed_needs_retry: 'Failed earlier: use Retry',
}

export const ERROR_LABEL: Record<string, string> = {
  rejected: 'Gmail rejected it (check the address)',
  rate_limited: 'Gmail’s sending limit was reached',
  reauth_required: 'Reconnect Gmail',
  not_connected: 'Gmail isn’t connected',
  outcome_unknown: 'May have been sent: check Gmail’s Sent folder',
  attachment_unavailable: 'The attached resume is missing',
  attachment_too_large: 'The attached resume is over 10 MB',
  invalid_message: 'The email couldn’t be built',
  provider_error: 'Gmail had a problem',
  storage_error: 'Couldn’t read the attachment',
  changed_since_confirmed: 'Changed after you confirmed',
}

export type DraftState = 'needs_resume' | 'draft' | 'approved' | 'sending' | 'sent' | 'failed'

export function draftState(draft: EmailDraft): DraftState {
  if (draft.delivery_status === 'sent') return 'sent'
  if (draft.delivery_status === 'sending') return 'sending'
  if (draft.delivery_status === 'failed') return 'failed'
  if (draft.resume_selection === 'needs_selection') return 'needs_resume'
  return draft.approved ? 'approved' : 'draft'
}

export const STATE_BADGE: Record<DraftState, { label: string; tone: Tone }> = {
  needs_resume: { label: 'Needs resume', tone: 'warning' },
  draft: { label: 'Draft', tone: 'neutral' },
  approved: { label: 'Approved', tone: 'accent' },
  sending: { label: 'Sending…', tone: 'accent' },
  sent: { label: 'Sent', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
}

const chunks = <T,>(items: T[], size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size))

export interface GenerationSummary {
  created: number
  existing: number
  insufficient: number
  failed: { leadId: string; message: string }[]
  draftLeadIds: string[]
}

/** Writes one draft per eligible lead, 10 per request, reporting progress. */
export async function generateDrafts(
  previewToken: string,
  leadIds: string[],
  onProgress: (done: number, total: number) => void,
): Promise<GenerationSummary> {
  const summary: GenerationSummary = { created: 0, existing: 0, insufficient: 0, failed: [], draftLeadIds: [] }
  let done = 0
  onProgress(0, leadIds.length)
  for (const chunk of chunks(leadIds, 10)) {
    try {
      const { results } = await generateEmailDrafts(previewToken, chunk)
      for (const r of results) {
        if (r.outcome === 'created') summary.created++
        else if (r.outcome === 'existing') summary.existing++
        else if (r.outcome === 'insufficient_evidence') summary.insufficient++
        else summary.failed.push({ leadId: r.lead_id, message: r.message ?? 'Failed' })
        if (r.draft) summary.draftLeadIds.push(r.lead_id)
      }
    } catch (e) {
      for (const leadId of chunk) summary.failed.push({ leadId, message: e instanceof Error ? e.message : 'Failed' })
    }
    done += chunk.length
    onProgress(done, leadIds.length)
  }
  return summary
}

export interface SendSummary {
  sent: number
  failed: { draftId: string; code: string | null; message: string | null }[]
  skipped: number
  notAttempted: number
  stopped: string | null
}

/** Sends confirmed drafts 10 per request; stops when Gmail says to (limit reached, access lapsed). */
export async function sendConfirmed(
  confirmToken: string,
  draftIds: string[],
  confirmMayDuplicate: boolean,
  onProgress: (done: number, total: number) => void,
): Promise<SendSummary> {
  const summary: SendSummary = { sent: 0, failed: [], skipped: 0, notAttempted: 0, stopped: null }
  let done = 0
  onProgress(0, draftIds.length)
  for (const chunk of chunks(draftIds, 10)) {
    if (summary.stopped) {
      summary.notAttempted += chunk.length
      continue
    }
    const { results, stopped } = await sendEmailDrafts(confirmToken, chunk, confirmMayDuplicate)
    for (const r of results) {
      if (r.outcome === 'sent') summary.sent++
      else if (r.outcome === 'failed') summary.failed.push({ draftId: r.draft_id, code: r.code, message: r.message })
      else if (r.outcome === 'skipped') summary.skipped++
      else summary.notAttempted++
    }
    summary.stopped = stopped
    done += chunk.length
    onProgress(done, draftIds.length)
  }
  return summary
}

export interface WriteAndSendSummary {
  sent: string[]
  needsReview: string[]
  failed: { leadId: string; message: string }[]
  skipped: number
  insufficient: number
  stopped: string | null
  /** Leads left untouched because sending stopped (Gmail limit or access). */
  notAttempted: number
  drafts: EmailDraft[]
}

/** Write & send, 5 leads per request (each writes, then sends the confident ones one by one). */
export async function writeAndSend(
  previewToken: string,
  leadIds: string[],
  onProgress: (done: number, total: number, sent: number) => void,
): Promise<WriteAndSendSummary> {
  const summary: WriteAndSendSummary = {
    sent: [],
    needsReview: [],
    failed: [],
    skipped: 0,
    insufficient: 0,
    stopped: null,
    notAttempted: 0,
    drafts: [],
  }
  let done = 0
  onProgress(0, leadIds.length, 0)
  for (const chunk of chunks(leadIds, 5)) {
    if (summary.stopped) {
      summary.notAttempted += chunk.length
      continue
    }
    try {
      let response
      try {
        response = await writeAndSendEmails(previewToken, chunk)
      } catch (e) {
        // An older or very long run can outlive its preview: renew it for the remaining leads and carry on.
        if (!(e instanceof Error && /preview expired/i.test(e.message))) throw e
        const remaining = leadIds.slice(done)
        const renewed = await previewEmailGeneration({ lead_ids: remaining })
        if (!renewed.preview_token) throw e
        previewToken = renewed.preview_token
        const stillEligible = chunk.filter((id) => renewed.eligible_lead_ids.includes(id))
        response = stillEligible.length
          ? await writeAndSendEmails(previewToken, stillEligible)
          : { results: [], stopped: null }
      }
      const { results, stopped } = response
      for (const r of results) {
        if (r.draft) summary.drafts.push(r.draft)
        if (r.outcome === 'sent') summary.sent.push(r.lead_id)
        else if (r.outcome === 'needs_review') summary.needsReview.push(r.lead_id)
        else if (r.outcome === 'skipped') summary.skipped++
        else if (r.outcome === 'insufficient_evidence') summary.insufficient++
        else summary.failed.push({ leadId: r.lead_id, message: ERROR_LABEL[r.code ?? ''] ?? r.message ?? 'Failed' })
      }
      summary.stopped = summary.stopped ?? stopped
    } catch (e) {
      // Nothing was written or sent for this chunk (e.g. Gmail isn't connected): stop here.
      for (const leadId of chunk) summary.failed.push({ leadId, message: e instanceof Error ? e.message : 'Failed' })
      summary.stopped = 'error'
    }
    done += chunk.length
    onProgress(done, leadIds.length, summary.sent.length)
  }
  return summary
}
