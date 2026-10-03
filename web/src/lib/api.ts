import type {
  AnalyzeJobRequest,
  AnalyzeJobResponse,
  AnswerResponse,
  CreateResumeRequest,
  CreateSavedAnswerRequest,
  GenerateAnswerRequest,
  MasterResumeResponse,
  RegenerateAnswerRequest,
  ResumeListResponse,
  ResumeRecord,
  SavedAnswer,
  StartTailoringRequest,
  StartTailoringResponse,
  TailoringDownloadResponse,
  TailoringFilesResponse,
  TailoringListResponse,
  TailoringResponse,
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

export const analyzeJob = (req: AnalyzeJobRequest) => call<AnalyzeJobResponse>('/api/v1/jobs/analyze', req)

export const startTailoring = (req: StartTailoringRequest) =>
  changedTailorings(call<StartTailoringResponse>('/api/v1/tailorings', req))

export const getTailoring = (id: string, detail = false) =>
  request<TailoringResponse>('GET', `/api/v1/tailorings/${encodeURIComponent(id)}${detail ? '?detail=true' : ''}`)

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
