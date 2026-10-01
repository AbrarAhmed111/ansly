/**
 * Contracts for the `llm` FastAPI service.
 * Keep in sync with the Pydantic models in `llm/src/app/schemas`.
 */

import type { SavedAnswer, UsageEventKind } from './database'
import type { Application, ApplicationAnswer, ApplicationAnswerSource, ApplicationStatus, MatchTier, SearchFilters } from './jobs'

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
  /** A tracked application: its job, requirements and earlier answers shape the answer. */
  application_id?: string | null
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

/** `POST /api/v1/jobs/refresh-matches` */
export interface RefreshMatchesResponse {
  matched: number
  by_tier: Record<MatchTier, number>
  new_alerts: number
  computed_at: string
}

/** `POST /api/v1/saved-searches/parse` */
export interface ParseSearchResponse {
  name: string
  filters: SearchFilters
}

/** `POST /api/v1/saved-searches` */
export interface CreateSavedSearchRequest {
  query: string
  name?: string | null
  filters?: SearchFilters | null
  alerts_enabled?: boolean
}

/** `POST /api/v1/applications/{id}/prepare` */
export interface PrepareApplicationResponse {
  application: Application
  answers: ApplicationAnswer[]
  /** False when AI providers were busy: no cover letter or summary, template interview questions. */
  llm_available: boolean
}

/** `POST /api/v1/applications/{id}/answers` */
export interface SaveApplicationAnswerRequest {
  question: string
  answer: string
  category?: string | null
  source?: ApplicationAnswerSource
}

/** A tracked application the extension recognized from the page URL. */
export interface TrackedApplication {
  id: string
  job_id: string | null
  company: string
  role: string
  job_url: string | null
  status: ApplicationStatus
  resume_id: string | null
  location: string | null
  skills: string[]
}

/** `GET /api/v1/applications/lookup?url=` */
export interface LookupApplicationResponse {
  application: TrackedApplication | null
}

/** `GET /api/v1/profile/autofill`: values for standard personal fields. */
export interface AutofillProfile {
  full_name: string
  first_name: string
  last_name: string
  email: string
  phone: string
  location: string
  city: string
  linkedin: string
  github: string
  website: string
  portfolio: string
  headline: string
}
