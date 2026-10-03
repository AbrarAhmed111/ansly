/**
 * The job a resume is tailored for, and what the analysis step extracts from it.
 * Keep in sync with `llm/src/app/schemas/job.py`.
 */

export type JobSource = 'json-ld' | 'linkedin' | 'indeed' | 'generic' | 'manual'

/**
 * A job posting detected on the page (or pasted in the web app).
 * Named JobPosting because `JobContext` is V1's answer-generation context.
 * Only these fields are ever sent; never page HTML.
 */
export interface JobPosting {
  title: string
  company: string
  location?: string | null
  employmentType?: string | null
  /** Required for tailoring. */
  description: string
  url: string
  source: JobSource
}

export type JobRequirementType =
  | 'skill'
  | 'experience'
  | 'education'
  | 'certification'
  | 'domain'
  | 'soft_skill'
  | 'other'

export interface JobRequirement {
  /** Stable within one analysis, e.g. "req_3". */
  id: string
  requirement: string
  type: JobRequirementType
}

export interface JobAnalysis {
  role: string
  company: string
  mustHave: JobRequirement[]
  niceToHave: JobRequirement[]
  responsibilities: string[]
  /** e.g. 5 for "5+ years experience", when stated. */
  minYearsExperience: number | null
}

/** `POST /api/v1/jobs/analyze` */
export interface AnalyzeJobRequest {
  job: JobPosting
}

export interface AnalyzeJobResponse {
  jobContextId: string
  analysis: JobAnalysis
}
