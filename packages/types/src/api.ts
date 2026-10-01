/**
 * Contracts for the `llm` FastAPI service.
 * Keep in sync with the Pydantic models in `llm/src/app/schemas`.
 */

import type { SavedAnswer, UsageEventKind } from './database'

export type ServiceStatus = 'ok' | 'error' | 'not_configured'

/** `GET /health` */
export interface HealthResponse {
  status: 'healthy'
  app_name: string
  environment: string
  supabase: {
    status: ServiceStatus
    detail?: string
  }
  gateway: {
    total_deployments: number
    available_deployments: number
  }
}

export interface JobContext {
  company?: string | null
  role?: string | null
  /** Only sent when the user has opted in to sharing job descriptions. */
  description?: string | null
  url?: string | null
}

export interface FieldContext {
  /** Visible label / surrounding question text, if different from the question. */
  label?: string | null
  /** The field's maxlength, so the answer fits. */
  maxLength?: number | null
  kind?: 'textarea' | 'input' | 'contenteditable' | null
}

/** `POST /api/v1/answers/generate` */
export interface GenerateAnswerRequest {
  question: string
  job_context?: JobContext | null
  field?: FieldContext | null
}

/** `POST /api/v1/answers/regenerate` */
export interface RegenerateAnswerRequest extends GenerateAnswerRequest {
  previous_answer: string
  /** Optional steer, e.g. "shorter" or "more technical". */
  instruction?: string | null
}

export type AnswerStatus = 'answered' | 'insufficient_information'

export type Confidence = 'high' | 'medium' | 'low'

export interface UsedSource {
  type: 'profile' | 'experience' | 'project' | 'skill' | 'education' | 'achievement'
  id: string
  label: string
}

export interface AnswerResponse {
  status: AnswerStatus
  answer: string
  confidence: Confidence
  usedSources: UsedSource[]
  /** What's missing from the profile, when status is insufficient_information. */
  missingInformation: string | null
  category: string
  intent: string
  provider: string | null
  model: string | null
}

/** `POST /api/v1/saved-answers/match` */
export interface MatchSavedAnswerRequest {
  question: string
}

export interface MatchSavedAnswerResponse {
  match: SavedAnswer | null
  score: number
}

/** `POST /api/v1/saved-answers` */
export interface CreateSavedAnswerRequest {
  question: string
  answer: string
  category?: string | null
  company?: string | null
  role?: string | null
}

/** `POST /api/v1/saved-answers/{id}/use` */
export type UseSavedAnswerResponse = SavedAnswer

/** `POST /api/v1/events` */
export interface TrackEventRequest {
  kind: Extract<UsageEventKind, 'fill' | 'use_saved_answer'>
  category?: string | null
}

export interface ApiError {
  detail: string
}
