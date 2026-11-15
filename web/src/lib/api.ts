import type {
  AnalyzeJobRequest,
  AnalyzeJobResponse,
  AnswerResponse,
  CleanupResponse,
  CreateLeadRequest,
  EmailConnection,
  EmailDraft,
  EmailDraftListResponse,
  GeneratePreviewResponse,
  GenerateResult,
  ReplaceResumeRequest,
  ReplaceResumeResponse,
  SendPreviewResponse,
  SendResponse,
  UpdateDraftRequest,
  WriteAndSendResponse,
  CreateResumeRequest,
  CreateSavedAnswerRequest,
  GenerateAnswerRequest,
  Lead,
  LeadListResponse,
  MasterResumeResponse,
  MemoryItem,
  MemoryResponse,
  RegenerateAnswerRequest,
  ResolveConflictRequest,
  RewriteRequest,
  RewriteResponse,
  UpdateMemoryRequest,
  ResumeListResponse,
  ResumeRecord,
  SavedAnswer,
  SaveMissingRequest,
  SaveMissingResponse,
  TrackEventRequest,
  StartTailoringRequest,
  StartTailoringResponse,
  TailoringDownloadResponse,
  TailoringFilesResponse,
  TailoringListResponse,
  TailoringResponse,
  UpdateTailoringChangeRequest,
  UpdateResumeRequest,
} from '@ansly/types'
import { invalidate } from '@/lib/cache'
import { createClient } from '@/lib/supabase/client'

// Referenced as a literal so Next.js inlines it into the browser bundle.
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'

/** Calls the llm API as the signed-in user (the API checks the Supabase JWT). */
async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  if (!BASE_URL) throw new ApiError('The Ansly API is not configured (NEXT_PUBLIC_BASE_URL).', 0)
  const {
    data: { session },
  } = await createClient().auth.getSession()
  if (!session) throw new ApiError('Your session has expired. Sign in again.', 401)

  let res: Response
  try {
    res = await fetch(`${BASE_URL.replace(/\/$/, '')}${path}`, {
      method,
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError('Could not reach the Ansly API. Check that it is running and try again.', 0)
  }
  if (!res.ok) {
    let detail =
      res.status === 404 && !path.match(/\/(resumes|tailorings)\//)
        ? `The Ansly API wasn't found at ${BASE_URL}. Check NEXT_PUBLIC_BASE_URL in web/.env (the llm service, usually http://localhost:8000).`
        : `Request failed (HTTP ${res.status})`
    try {
      const data = await res.json()
      if (typeof data?.detail === 'string') detail = data.detail
    } catch {
      // Non-JSON error body.
    }
    throw new ApiError(detail, res.status)
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

const call = <T>(path: string, body: unknown) => request<T>('POST', path, body)

export const generateAnswer = (req: GenerateAnswerRequest) => call<AnswerResponse>('/api/v1/answers/generate', req)

export const regenerateAnswer = (req: RegenerateAnswerRequest) => call<AnswerResponse>('/api/v1/answers/regenerate', req)

export const saveAnswer = (req: CreateSavedAnswerRequest) => call<SavedAnswer>('/api/v1/saved-answers', req)

export const listLeads = () => request<LeadListResponse>('GET', '/api/v1/leads')


export const createLead = (req: CreateLeadRequest) => call<Lead>('/api/v1/leads', req)

/** Ansly Cleanup for up to 50 leads: confident non-matches are deleted, unsure ones come back for review. */
export const cleanupLeads = (leadIds: string[]) => call<CleanupResponse>('/api/v1/leads/cleanup', { lead_ids: leadIds })

/** Saves answers to the questions a resume doesn't cover (onboarding) or that Ansly asked for. */
export const saveMissing = (req: SaveMissingRequest) => call<SaveMissingResponse>('/api/v1/profile/missing', req)

/** A non-sensitive product event (no question or answer text). Never fails the caller. */
export const trackEvent = (req: TrackEventRequest) => call<null>('/api/v1/events', req).catch(() => null)

export const rewriteAnswer = (req: RewriteRequest) => call<RewriteResponse>('/api/v1/answers/rewrite', req)

// Application Memory: everything Ansly learned, with provenance (see llm/src/app/memory).

export const getMemory = () => request<MemoryResponse>('GET', '/api/v1/memory')

export const updateMemory = (id: string, req: UpdateMemoryRequest) =>
  request<MemoryItem>('PATCH', `/api/v1/memory/${encodeURIComponent(id)}`, req)

export const confirmMemory = (id: string) => call<MemoryItem>(`/api/v1/memory/${encodeURIComponent(id)}/confirm`, {})

export const deleteMemory = (id: string) => request<void>('DELETE', `/api/v1/memory/${encodeURIComponent(id)}`)

export const resolveMemoryConflict = (req: ResolveConflictRequest) =>
  call<MemoryResponse>('/api/v1/memory/conflicts/resolve', req)

// v1.2 resume tailoring. Reads go through `@/lib/cache` (see the KEYS); every write invalidates what it changes.

export const KEYS = {
  master: 'resumes:master',
  resumes: 'resumes:list',
  tailorings: 'tailorings:list',
  tailoring: (id: string) => `tailorings:${id}`,
}

const changedResumes = <T>(p: Promise<T>) => p.then((v) => (invalidate('resumes:'), v))
const changedTailorings = <T>(p: Promise<T>) => p.then((v) => (invalidate('tailorings:list'), v))

export const createResume = (req: CreateResumeRequest) => changedResumes(call<ResumeRecord>('/api/v1/resumes', req))

export const listResumes = () => request<ResumeListResponse>('GET', '/api/v1/resumes')

export const getMasterResume = () => request<MasterResumeResponse>('GET', '/api/v1/resumes/master')

export const updateResume = (id: string, req: UpdateResumeRequest) =>
  changedResumes(request<ResumeRecord>('PATCH', `/api/v1/resumes/${encodeURIComponent(id)}`, req))

export const makeMasterResume = (id: string) =>
  changedResumes(call<ResumeRecord>(`/api/v1/resumes/${encodeURIComponent(id)}/master`, {}))

export const deleteResume = (id: string) =>
  changedResumes(request<void>('DELETE', `/api/v1/resumes/${encodeURIComponent(id)}`))

// Role resume library (Leads)

export const listRoleResumes = () => request<ResumeListResponse>('GET', '/api/v1/resumes?library=true')

export const replaceRoleResume = (id: string, req: ReplaceResumeRequest) =>
  changedResumes(call<ReplaceResumeResponse>(`/api/v1/resumes/${encodeURIComponent(id)}/replace`, req))

/** A short-lived link to the original file; `inline` opens it in the browser instead of downloading. */
export const resumeFileLink = (id: string, inline = false) =>
  request<{ url: string }>('GET', `/api/v1/resumes/${encodeURIComponent(id)}/download${inline ? '?inline=true' : ''}`)

// Lead emails

const lead = (id: string) => `/api/v1/leads/${encodeURIComponent(id)}/email-draft`

export const listEmailDrafts = (leadIds?: string[]) =>
  request<EmailDraftListResponse>(
    'GET',
    `/api/v1/leads/email-drafts${leadIds?.length ? `?lead_ids=${leadIds.map(encodeURIComponent).join(',')}` : ''}`,
  )

export const previewEmailGeneration = (req: { lead_ids?: string[]; all_eligible?: boolean }) =>
  call<GeneratePreviewResponse>('/api/v1/leads/email-drafts/preview', req)

export const generateEmailDrafts = (previewToken: string, leadIds: string[]) =>
  call<{ results: GenerateResult[] }>('/api/v1/leads/email-drafts/generate', {
    preview_token: previewToken,
    lead_ids: leadIds,
  })

/** The fast path: write each email and send it at once when its resume match is confident. */
export const writeAndSendEmails = (previewToken: string, leadIds: string[]) =>
  call<WriteAndSendResponse>('/api/v1/leads/email-drafts/write-and-send', {
    preview_token: previewToken,
    lead_ids: leadIds,
    confirm_send: true,
  })

/** Match resumes again for drafts still waiting for one; confident matches are attached (nothing is sent). */
export const rematchEmailDrafts = (draftIds: string[]) =>
  call<{ checked: number; matched: number; drafts: EmailDraft[] }>('/api/v1/leads/email-drafts/rematch', {
    draft_ids: draftIds,
  })

/** Approve every unsent draft whose only remaining step is approval (nothing is sent). */
export const approveReadyEmailDrafts = (draftIds: string[] = []) =>
  call<{ approved: number; drafts: EmailDraft[] }>('/api/v1/leads/email-drafts/approve-ready', { draft_ids: draftIds })

export const updateEmailDraft = (leadId: string, req: UpdateDraftRequest) =>
  request<EmailDraft>('PATCH', lead(leadId), req)

export const approveEmailDraft = (leadId: string, expectedVersion: number) =>
  call<EmailDraft>(`${lead(leadId)}/approve`, { expected_version: expectedVersion })

export const unapproveEmailDraft = (leadId: string, expectedVersion: number) =>
  call<EmailDraft>(`${lead(leadId)}/unapprove`, { expected_version: expectedVersion })

export const regenerateEmailDraft = (
  leadId: string,
  req: { expected_version: number; confirm_replace: true; confirm_discard_edits?: boolean; rematch_resume?: boolean },
) => call<EmailDraft>(`${lead(leadId)}/regenerate`, req)

export const previewSend = (req: { draft_ids?: string[]; all_ready?: boolean; retry?: boolean }) =>
  call<SendPreviewResponse>('/api/v1/leads/email-drafts/send-preview', req)

export const sendEmailDrafts = (confirmToken: string, draftIds: string[], confirmMayDuplicate = false) =>
  call<SendResponse>('/api/v1/leads/email-drafts/send', {
    confirm_token: confirmToken,
    draft_ids: draftIds,
    confirm_may_duplicate: confirmMayDuplicate,
  })

// Email connection (Gmail, send-only)

export const getEmailConnection = () => request<EmailConnection>('GET', '/api/v1/email/connection')

export const startGmailConnect = () => call<{ authorization_url: string }>('/api/v1/email/gmail/connect', {})

export const finishGmailConnect = (code: string, state: string) =>
  call<EmailConnection>('/api/v1/email/gmail/callback', { code, state })

export const disconnectEmail = () => request<void>('DELETE', '/api/v1/email/connection')

export const analyzeJob = (req: AnalyzeJobRequest) => call<AnalyzeJobResponse>('/api/v1/jobs/analyze', req)

export const startTailoring = (req: StartTailoringRequest) =>
  changedTailorings(call<StartTailoringResponse>('/api/v1/tailorings', req))

export const getTailoring = (id: string, detail = false) =>
  request<TailoringResponse>('GET', `/api/v1/tailorings/${encodeURIComponent(id)}${detail ? '?detail=true' : ''}`)

export const updateTailoringChange = (id: string, changeId: string, req: UpdateTailoringChangeRequest) =>
  request<TailoringResponse>(
    'PATCH',
    `/api/v1/tailorings/${encodeURIComponent(id)}/changes/${encodeURIComponent(changeId)}`,
    req,
  ).then((response) => {
    invalidate(`${KEYS.tailoring(id)}:detail`)
    invalidate('tailorings:list')
    return response
  })

export const listTailorings = () => request<TailoringListResponse>('GET', '/api/v1/tailorings')

/** Signed URL that downloads the tailored .docx. */
export const tailoringFileUrl = (id: string) =>
  request<TailoringDownloadResponse>('GET', `/api/v1/tailorings/${encodeURIComponent(id)}/download`)

/** Signed URLs for the preview: the tailored document and the original it was made from. */
export const tailoringFiles = (id: string) =>
  request<TailoringFilesResponse>('GET', `/api/v1/tailorings/${encodeURIComponent(id)}/files`)

export const deleteTailoring = (id: string) =>
  request<void>('DELETE', `/api/v1/tailorings/${encodeURIComponent(id)}`).then(() => {
    invalidate('tailorings:')
  })
