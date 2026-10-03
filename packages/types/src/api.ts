/**
 * Contracts for the `llm` FastAPI service.
 * Keep in sync with the Pydantic models in `llm/src/app/schemas`.
 *
 * v1.2 resume tailoring endpoints live next to their domain types:
 * `resume.ts` (/resumes), `job.ts` (/jobs/analyze), `tailoring.ts` (/tailorings).
 */

import type { Profile, SavedAnswer, Skill, SkillLevel, UsageEventKind } from './database'
import type { FieldKind } from './fields'

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
  /** The element type (popover) or the detected field kind (fill all). */
  kind?: 'textarea' | 'input' | 'contenteditable' | Exclude<FieldKind, 'profile' | 'ignored'> | null
  /** For choice fields: the answer must be one of these (several for choice_multi). */
  options?: string[] | null
}

/** `auto` = the question category's default (cover letters: detailed; yes/no and logistics: concise). */
export type AnswerLength = 'auto' | 'concise' | 'standard' | 'detailed'

export type AnswerTone = 'professional' | 'friendly' | 'enthusiastic' | 'confident' | 'formal' | 'technical'

export interface AnswerStyle {
  length: AnswerLength
  tone: AnswerTone
  /** Free-text steer, e.g. "mention my open-source work". */
  instruction?: string | null
}

/** Question categories returned in `AnswerResponse.category`. */
export type AnswerCategory =
  | 'cover_letter'
  | 'about_me'
  | 'motivation'
  | 'project'
  | 'experience'
  | 'skill_check'
  | 'behavioral'
  | 'strengths'
  | 'education'
  | 'achievement'
  | 'logistics'
  | 'general'

/** `POST /api/v1/answers/generate` */
export interface GenerateAnswerRequest {
  question: string
  job_context?: JobContext | null
  field?: FieldContext | null
  style?: AnswerStyle | null
  /** Facts the candidate just gave without saving them to their profile. */
  additional_facts?: string[] | null
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
  type: 'profile' | 'experience' | 'project' | 'skill' | 'education' | 'achievement' | 'fact'
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
  /** The same gaps as questions the extension can ask inline (ask-and-learn). */
  missing: MissingInfo[]
  category: string
  intent: string
  provider: string | null
  model: string | null
}

/** Profile columns that ask-and-learn may write. */
export type ProfileField = Extract<
  keyof Profile,
  'work_authorization' | 'requires_sponsorship' | 'notice_period' | 'salary_expectation' | 'willing_to_relocate' | 'preferred_work_mode'
>

export type MissingTarget =
  | { type: 'profile_field'; field: ProfileField }
  | { type: 'skill'; name: string }
  | { type: 'fact'; category: string }

export interface MissingInfo {
  /** e.g. 'notice_period', 'skill:kubernetes', 'fact:leadership' */
  key: string
  /** Question shown to the user. */
  prompt: string
  input: 'text' | 'textarea' | 'select' | 'boolean' | 'number' | 'skill'
  options?: string[] | null
  target: MissingTarget
}

/** Value for a `skill` target: "I don't have this" is a valid answer. */
export interface SkillAnswer {
  have: boolean
  years?: number | null
  level?: Exclude<SkillLevel, 'none'> | null
}

/** `POST /api/v1/profile/missing` */
export interface SaveMissingRequest {
  items: { key: string; target: MissingTarget; value: string | boolean | SkillAnswer; prompt?: string | null }[]
}

export interface SaveMissingResponse {
  saved: { key: string; target: MissingTarget; row: Partial<Profile> | Skill | Record<string, unknown> }[]
}

/** `POST /api/v1/answers/generate-batch` */
export interface GenerateBatchRequest {
  job_context?: JobContext | null
  /** Page-level default. */
  style?: AnswerStyle | null
  items: { id: string; question: string; field?: FieldContext | null; additional_facts?: string[] | null }[]
}

export type BatchAnswerResult = AnswerResponse & {
  id: string
  /** Set when this question couldn't be generated at all (the others still were). */
  error?: string | null
}

export interface GenerateBatchResponse {
  results: BatchAnswerResult[]
}

/**
 * `POST /api/v1/answers/resolve` (body: GenerateAnswerRequest): one request per field. Returns a similar
 * saved answer when there is one (`answer` null), otherwise the generated answer (`savedMatch` null).
 */
export interface ResolveAnswerResponse {
  savedMatch: SavedAnswer | null
  score: number
  answer: AnswerResponse | null
}

/** `POST /api/v1/saved-answers/match-batch` */
export interface MatchSavedBatchRequest {
  items: { id: string; question: string }[]
}

export interface MatchSavedBatchResponse {
  results: (MatchSavedAnswerResponse & { id: string })[]
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
  kind: Extract<UsageEventKind, 'fill' | 'use_saved_answer' | 'fill_all' | 'job_detected' | 'resume_previewed'>
  category?: string | null
}

export interface ApiError {
  detail: string
}
