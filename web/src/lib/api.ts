import type { AnswerResponse, CreateSavedAnswerRequest, GenerateAnswerRequest, RegenerateAnswerRequest, SavedAnswer } from '@ansly/types'
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

/** Calls the llm API as the signed-in user (the API checks the Supabase JWT). */
async function call<T>(path: string, body: unknown): Promise<T> {
  if (!BASE_URL) throw new ApiError('The Ansly API is not configured (NEXT_PUBLIC_BASE_URL).', 0)
  const {
    data: { session },
  } = await createClient().auth.getSession()
  if (!session) throw new ApiError('Your session has expired. Sign in again.', 401)

  let res: Response
  try {
    res = await fetch(`${BASE_URL.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new ApiError('Could not reach the Ansly API. Check that it is running and try again.', 0)
  }
  if (!res.ok) {
    let detail =
      res.status === 404
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
  return (await res.json()) as T
}

export const generateAnswer = (req: GenerateAnswerRequest) => call<AnswerResponse>('/api/v1/answers/generate', req)

export const regenerateAnswer = (req: RegenerateAnswerRequest) => call<AnswerResponse>('/api/v1/answers/regenerate', req)

export const saveAnswer = (req: CreateSavedAnswerRequest) => call<SavedAnswer>('/api/v1/saved-answers', req)
