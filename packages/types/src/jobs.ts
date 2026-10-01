/**
 * V2 row types: jobs, matching, saved searches, alerts and the application
 * workspace. Mirrors `supabase/migrations/2026100{3,4}*.sql`.
 */

export type JobSourceKind = 'greenhouse' | 'lever' | 'ashby' | 'arbeitnow'

export interface JobSource {
  id: string
  kind: JobSourceKind
  identifier: string
  name: string
  enabled: boolean
  terms_url: string | null
  terms_notes: string | null
  /** Credit to show beside jobs from this source, e.g. "via Arbeitnow". */
  attribution: string | null
  last_run_at: string | null
  last_status: 'ok' | 'error' | null
  last_error: string | null
  last_job_count: number | null
}

export type Workplace = 'remote' | 'hybrid' | 'onsite'
export type EmploymentType = 'full_time' | 'part_time' | 'contract' | 'internship' | 'temporary'
export type Seniority = 'intern' | 'junior' | 'mid' | 'senior' | 'lead' | 'principal'
export type SalaryPeriod = 'year' | 'month' | 'hour'

export interface Job {
  id: string
  source_id: string
  external_id: string
  dedupe_key: string
  url: string
  apply_url: string | null
  title: string
  company: string
  location: string | null
  workplace: Workplace | null
  employment_type: EmploymentType | null
  department: string | null
  seniority: Seniority | null
  description: string | null
  /** Canonical skill names extracted from the posting. */
  skills: string[]
  experience_years_min: number | null
  salary_min: number | null
  salary_max: number | null
  salary_currency: string | null
  salary_period: SalaryPeriod | null
  also_listed_on: { source_id: string; url: string }[]
  posted_at: string | null
  first_seen_at: string
  last_seen_at: string
  is_active: boolean
}

export type MatchTier = 'strong' | 'good' | 'potential' | 'low'
export type ExperienceFit = 'meets' | 'close' | 'below' | 'unknown'

export interface JobMatch {
  user_id: string
  job_id: string
  tier: MatchTier
  /** 0–1, for ordering only. Show the reasons, not the number. */
  score: number
  matched_skills: string[]
  missing_skills: string[]
  experience: { required?: number | null; profile?: number | null; fit?: ExperienceFit }
  workplace_fit: 'match' | 'mismatch' | 'unknown' | null
  location_fit: 'match' | 'remote' | 'relocate' | 'mismatch' | 'unknown' | null
  role_fit: 'match' | 'related' | 'unrelated' | null
  reasons: string[]
  saved: boolean
  dismissed: boolean
  computed_at: string
}

/** A job with the current user's match, as the feed shows it. */
export type JobWithMatch = Job & { match: JobMatch | null }

export interface SearchFilters {
  roles?: string[]
  skills?: string[]
  workplace?: Workplace[]
  locations?: string[]
  experience_years?: number | null
  min_salary?: number | null
  employment_types?: EmploymentType[]
  keywords?: string[]
}

export interface SavedSearch {
  id: string
  user_id: string
  name: string
  query: string
  filters: SearchFilters
  alerts_enabled: boolean
  last_checked_at: string | null
  created_at: string
  updated_at: string
}

export interface JobAlert {
  id: string
  user_id: string
  saved_search_id: string
  job_id: string
  tier: MatchTier
  seen_at: string | null
  created_at: string
}

export interface Resume {
  id: string
  user_id: string
  name: string
  file_path: string
  file_name: string
  mime_type: string | null
  size_bytes: number | null
  is_default: boolean
  target_roles: string[]
  created_at: string
  updated_at: string
}

export const APPLICATION_STATUSES = ['interested', 'preparing', 'applied', 'interview', 'offer', 'rejected', 'withdrawn'] as const
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number]

/** Output of "Prepare application". */
export interface ApplicationPrep {
  /** Profile items most relevant to this job, strongest first. */
  relevant: { type: 'experience' | 'project'; id: string; label: string; why: string }[]
  resume: { resume_id: string | null; reason: string } | null
  /** Short resume summary tailored to the job, grounded in the profile. */
  tailored_summary: string | null
  matched_skills: string[]
  missing_skills: string[]
  interview_questions: { question: string; why: string }[]
  generated_at: string
}

export interface Application {
  id: string
  user_id: string
  job_id: string | null
  company: string
  role: string
  job_url: string | null
  location: string | null
  description: string | null
  status: ApplicationStatus
  applied_at: string | null
  resume_id: string | null
  cover_letter: string | null
  notes: string | null
  prep: ApplicationPrep | null
  prepared_at: string | null
  created_at: string
  updated_at: string
}

export type ApplicationEventKind = 'created' | 'status_change' | 'note' | 'interview' | 'prepared' | 'answer'

export interface ApplicationEvent {
  id: string
  user_id: string
  application_id: string
  kind: ApplicationEventKind
  from_status: ApplicationStatus | null
  to_status: ApplicationStatus | null
  title: string | null
  details: string | null
  occurs_at: string
  created_at: string
}

export type ApplicationAnswerSource = 'prepared' | 'extension' | 'manual'

export interface ApplicationAnswer {
  id: string
  user_id: string
  application_id: string
  question: string
  answer: string
  category: string | null
  source: ApplicationAnswerSource
  created_at: string
  updated_at: string
}
