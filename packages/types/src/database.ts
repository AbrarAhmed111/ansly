/**
 * Row types for the Supabase tables in `supabase/migrations`.
 * Dates are ISO strings (`YYYY-MM-DD`), timestamps are ISO date-times.
 */

import type { JobAnalysis, JobSource } from './job'
import type { MatchAnalysis } from './matching'
import type { ResumeFileType, ResumeParseStatus, StructuredResume } from './resume'
import type { TailoringPlan, TailoringStatus, ValidationReport } from './tailoring'

export interface ProfileLinks {
  linkedin?: string
  github?: string
  website?: string
  portfolio?: string
  other?: string
}

export type WorkMode = 'remote' | 'hybrid' | 'onsite' | 'flexible'

export interface Profile {
  id: string
  full_name: string | null
  headline: string | null
  email: string | null
  phone: string | null
  location: string | null
  summary: string | null
  /** Free-form "anything else Ansly should know" (≤ 6000 chars), used like the rest of the profile. */
  additional_context: string | null
  links: ProfileLinks
  work_authorization: string | null
  requires_sponsorship: boolean | null
  notice_period: string | null
  salary_expectation: string | null
  willing_to_relocate: boolean | null
  preferred_work_mode: WorkMode | null
  /** Page limit for tailored resumes (1–3, default 2). */
  resume_page_limit: number
  created_at: string
  updated_at: string
}

interface OwnedRow {
  id: string
  user_id: string
  sort_order: number
  created_at: string
  updated_at: string
}

export interface Experience extends OwnedRow {
  company: string
  title: string
  location: string | null
  employment_type: string | null
  start_date: string | null
  end_date: string | null
  is_current: boolean
  description: string | null
  highlights: string[]
  technologies: string[]
}

export interface Project extends OwnedRow {
  name: string
  role: string | null
  url: string | null
  repo_url: string | null
  description: string | null
  highlights: string[]
  technologies: string[]
  start_date: string | null
  end_date: string | null
}

export type SkillCategory =
  | 'language'
  | 'framework'
  | 'database'
  | 'cloud'
  | 'tool'
  | 'ai'
  | 'soft'
  | 'other'

/** 'none' = the user said they don't have this skill (Ansly answers "No" instead of asking again). */
export type SkillLevel = 'none' | 'beginner' | 'intermediate' | 'advanced' | 'expert'

export interface Skill extends OwnedRow {
  name: string
  category: SkillCategory | null
  level: SkillLevel | null
  years: number | null
}

export interface Education extends OwnedRow {
  institution: string
  degree: string | null
  field_of_study: string | null
  start_date: string | null
  end_date: string | null
  grade: string | null
  description: string | null
}

export interface Achievement extends OwnedRow {
  title: string
  description: string | null
  date: string | null
  url: string | null
}

export type MemoryScope = 'global' | 'category' | 'company' | 'job'

/**
 * Application Memory: facts the user gave when Ansly asked (extension), on /profile/additional or on the memory
 * page (web). See llm/src/app/memory for scope, precedence and conflict rules.
 */
export interface ProfileFact extends OwnedRow {
  category: string | null
  prompt: string
  answer: string
  source: 'extension' | 'web'
  /** Normalized fact key ('relocation_preference', 'notice_period'...); null for free text. */
  key: string | null
  value_type: 'text' | 'boolean' | 'number' | 'choice'
  scope: MemoryScope
  company: string | null
  job_key: string | null
  source_type: 'ask_and_learn' | 'web' | 'onboarding' | 'memory_edit'
  /** "Acme · Software Engineer": the application it was learned during. */
  source_label: string | null
  source_id: string | null
  confirmed: boolean
  status: 'active' | 'outdated' | 'superseded'
  last_confirmed_at: string
  last_used_at: string | null
}

export interface SavedAnswer {
  id: string
  user_id: string
  question: string
  answer: string
  category: string | null
  company: string | null
  role: string | null
  use_count: number
  last_used_at: string | null
  created_at: string
  updated_at: string
}

export type UsageEventKind =
  | 'generate'
  | 'regenerate'
  | 'fill'
  | 'save_answer'
  | 'use_saved_answer'
  | 'fill_all'
  | 'resume_uploaded'
  | 'resume_parse_failed'
  | 'job_detected'
  | 'tailoring_started'
  | 'tailoring_completed'
  | 'tailoring_failed'
  | 'resume_previewed'
  | 'resume_downloaded'
  | 'tailoring_deleted'
  | 'job_analyzed'
  | 'adapt_saved_answer'
  | 'ask_and_learn_shown'
  | 'ask_and_learn_completed'
  | 'ask_and_learn_skipped'
  | 'memory_fact_saved'
  | 'memory_fact_edited'
  | 'memory_fact_deleted'
  | 'memory_fact_confirmed'
  | 'memory_used'
  | 'rewrite'
  | 'fit_to_limit'
  | 'fill_all_completed'
  | 'undo'
  | 'onboarding_step'
  | 'extension_connected'
  | 'first_answer'

/** `job_token_usage` view: model tokens spent per job application (one row per posting). */
export interface JobTokenUsage {
  user_id: string
  /** Hash of the posting's URL (or company + role); no job text is stored. */
  job_key: string
  job_context_id: string | null
  /** Job analysis + resume tailoring. */
  tailoring_tokens: number
  /** Generated, regenerated and adapted answers. */
  answer_tokens: number
  total_tokens: number
  llm_calls: number
  first_at: string
  last_at: string
}

/** `application_usage` view: provider-reported tokens, calls and cost per job application, by stage. */
export interface ApplicationUsage {
  user_id: string
  job_key: string
  job_context_id: string | null
  job_analysis_tokens: number
  matching_tokens: number
  tailoring_tokens: number
  validation_tokens: number
  answer_tokens: number
  regeneration_tokens: number
  adaptation_tokens: number
  /** Every model call but embeddings: tokens per application. */
  total_tokens: number
  cached_input_tokens: number
  thinking_tokens: number
  llm_calls: number
  failed_calls: number
  single_answer_calls: number
  batch_calls: number
  regenerations: number
  tailoring_calls: number
  job_analysis_cost_usd: number
  matching_cost_usd: number
  tailoring_cost_usd: number
  validation_cost_usd: number
  answer_cost_usd: number
  regeneration_cost_usd: number
  adaptation_cost_usd: number
  generation_cost_usd: number
  /** Calls on models without a configured price (their cost isn't in the totals). */
  unpriced_calls: number
  query_embedding_tokens: number
  profile_embedding_tokens: number
  embedding_cost_usd: number
  total_cost_usd: number
  llm_ms: number
  first_at: string
  last_at: string
  usage_pattern:
    | 'tailoring_fill_all'
    | 'tailoring_manual_answers'
    | 'tailoring_only'
    | 'fill_all_heavy'
    | 'single_answer_heavy'
    | 'other'
}

/** Everything that makes up a user's profile. */
export interface FullProfile {
  profile: Profile | null
  experiences: Experience[]
  projects: Project[]
  skills: Skill[]
  education: Education[]
  achievements: Achievement[]
  profile_facts: ProfileFact[]
}

export type ProfileSection =
  | 'experiences'
  | 'projects'
  | 'skills'
  | 'education'
  | 'achievements'
  | 'profile_facts'

// ---------------------------------------------------------------------------
// v1.2 resume tailoring
// ---------------------------------------------------------------------------

/** An uploaded resume. Replacing the master inserts a new version; old ones are kept. */
export interface ResumeRow {
  id: string
  user_id: string
  name: string
  /** `{user_id}/masters/...` in the private `resumes` bucket. */
  file_path: string
  file_type: ResumeFileType
  parsed_content: StructuredResume | null
  parse_status: ResumeParseStatus
  parse_error: string | null
  version: number
  is_master: boolean
  /** Discrepancy keys the user chose to keep as they are. */
  dismissed_discrepancies: string[]
  created_at: string
  updated_at: string
}

export interface JobContextRow {
  id: string
  user_id: string
  title: string
  company: string | null
  location: string | null
  employment_type: string | null
  url: string | null
  /** Job description text only; never page HTML. */
  description: string
  source: JobSource
  analysis: JobAnalysis | null
  created_at: string
}

export interface ResumeTailoringRow {
  id: string
  user_id: string
  /** Null once that resume version was deleted; resume_version still records it. */
  resume_id: string | null
  resume_version: number
  job_context_id: string
  match_analysis: MatchAnalysis | null
  tailoring_plan: TailoringPlan | null
  tailored_content: StructuredResume | null
  validation_report: ValidationReport | null
  /** `{user_id}/tailored/...` in the private `resumes` bucket. */
  output_file_path: string | null
  pipeline_version: string
  status: TailoringStatus
  error: string | null
  created_at: string
  updated_at: string
}
