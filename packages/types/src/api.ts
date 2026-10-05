/**
 * Contracts for the `llm` FastAPI service.
 * Keep in sync with the Pydantic models in `llm/src/app/schemas`.
 *
 * v1.2 resume tailoring endpoints live next to their domain types:
 * `resume.ts` (/resumes), `job.ts` (/jobs/analyze), `tailoring.ts` (/tailorings).
 */

import type { MemoryScope, Profile, SavedAnswer, Skill, SkillLevel, UsageEventKind } from './database'
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
  /** The stored job (`jobContextId` from `POST /api/v1/jobs/analyze`), when known: links answer usage to it. */
  id?: string | null
  company?: string | null
  role?: string | null
  /** Only sent when the user has opted in to sharing job descriptions. */
  description?: string | null
  url?: string | null
}

export interface FieldContext {
  /** Visible label / surrounding question text, if different from the question. */
  label?: string | null
  /** The field's maxlength, or a character limit stated in its helper text, so the answer fits. */
  maxLength?: number | null
  /** A word limit stated near the field ("Max 250 words"). */
  maxWords?: number | null
  /** A minimum stated near the field ("Minimum 100 characters"). */
  minLength?: number | null
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
  /** Where it came from (no model for profile / memory): shown as plain language, never as model details. */
  origin?: AnswerOrigin | null
}

export type AnswerOrigin = 'profile' | 'memory' | 'saved' | 'adapted' | 'generated'

/** Profile columns that ask-and-learn may write. */
export type ProfileField = Extract<
  keyof Profile,
  'work_authorization' | 'requires_sponsorship' | 'notice_period' | 'salary_expectation' | 'willing_to_relocate' | 'preferred_work_mode'
>

export type MissingTarget =
  | { type: 'profile_field'; field: ProfileField }
  | { type: 'skill'; name: string }
  /** `key`: an Application Memory key ('travel_willingness') for facts Ansly answers directly; else free text. */
  | { type: 'fact'; category: string; key?: string | null }

/** Ask-and-Learn groups, in display order. */
export type MemoryGroup =
  | 'Personal'
  | 'Work authorization'
  | 'Availability'
  | 'Relocation'
  | 'Compensation'
  | 'Skills'
  | 'Experience'
  | 'Education'
  | 'Preferences'
  | 'Other'

export interface MissingInfo {
  /** e.g. 'notice_period', 'skill:kubernetes', 'fact:leadership' */
  key: string
  /** Question shown to the user. */
  prompt: string
  input: 'text' | 'textarea' | 'select' | 'choice' | 'boolean' | 'number' | 'skill'
  options?: string[] | null
  target: MissingTarget
  group?: MemoryGroup | string
  /** How long the answer is remembered unless the user changes it: 'job' for answers about one employer. */
  scope?: MemoryScope
  /** Short name for the fact ("Relocation"). */
  label?: string | null
}

/** Value for a `skill` target: "I don't have this" is a valid answer. */
export interface SkillAnswer {
  have: boolean
  years?: number | null
  level?: Exclude<SkillLevel, 'none'> | null
}

/** `POST /api/v1/profile/missing` */
export interface SaveMissingRequest {
  items: {
    key: string
    target: MissingTarget
    value: string | boolean | SkillAnswer
    prompt?: string | null
    /** Omitted: profile fields go to the profile, everything else is remembered globally. */
    scope?: MemoryScope | null
  }[]
  /** The application the facts were given for (company / job scope and provenance; no description is stored). */
  job_context?: JobContext | null
  /** Where they were given: inline while applying (default) or in the web app's setup. */
  source?: 'ask_and_learn' | 'onboarding'
}

export interface SaveMissingResponse {
  saved: {
    key: string
    target: MissingTarget
    row: Partial<Profile> | Skill | Record<string, unknown>
    destination: 'profile' | 'skills' | 'memory'
    scope: MemoryScope
    group: string
  }[]
}

export type RewriteAction =
  | 'shorter'
  | 'longer'
  | 'natural'
  | 'professional'
  | 'concise'
  | 'technical'
  | 'confident'
  | 'simpler'
  | 'fit'
  | 'custom'

/** `POST /api/v1/answers/rewrite`: transforms the user's current text; never rebuilds it from the profile. */
export interface RewriteRequest {
  text: string
  action: RewriteAction
  /** Required for 'custom'. */
  instruction?: string | null
  question?: string | null
  field?: FieldContext | null
  /** Only company and role are used. */
  job_context?: JobContext | null
}

export interface RewriteResponse {
  answer: string
  /** False when the rewrite would have changed facts (or broken the limit): `answer` is the original. */
  changed: boolean
  reason: string | null
}

/** `POST /api/v1/answers/generate-batch` */
export interface GenerateBatchRequest {
  job_context?: JobContext | null
  /** Page-level default. */
  style?: AnswerStyle | null
  items: { id: string; question: string; field?: FieldContext | null; additional_facts?: string[] | null }[]
  /** Answer free-text questions from saved answers first (adapted when written for another job). */
  check_saved?: boolean
}

export type BatchAnswerResult = AnswerResponse & {
  id: string
  /** Set when this question couldn't be generated at all (the others still were). */
  error?: string | null
  /** The saved answer this result came from (used as is, or adapted: then `adaptedFrom` is set too). */
  savedAnswerId?: string | null
  adaptedFrom?: string | null
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
  /** Set when `answer` is a saved answer (this id) adapted to the current job instead of a new one. */
  adaptedFrom?: string | null
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
  kind: Extract<
    UsageEventKind,
    | 'fill'
    | 'use_saved_answer'
    | 'fill_all'
    | 'job_detected'
    | 'resume_previewed'
    | 'ask_and_learn_shown'
    | 'ask_and_learn_skipped'
    | 'fill_all_completed'
    | 'undo'
    | 'onboarding_step'
    | 'extension_connected'
    | 'first_answer'
  >
  category?: string | null
  /** 'fill': the user's wait, field opened to answer shown (ms). */
  duration_ms?: number | null
  /** 'fill': whether the user changed the answer before filling it. */
  edited?: boolean | null
}

export interface ApiError {
  detail: string
}
