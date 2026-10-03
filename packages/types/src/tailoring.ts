/**
 * Tailoring plans, validation, and the tailoring API.
 * Keep in sync with `llm/src/app/schemas/tailoring.py`.
 */

import type { MatchSummary, RequirementMatch } from './matching'

export type TailoringStatus =
  | 'queued'
  | 'analyzing'
  | 'matching'
  | 'tailoring'
  | 'validating'
  | 'rendering'
  | 'ready'
  | 'failed'

/**
 * The only operations a tailoring plan may use. They're applied to the JSON in
 * code, validated, then applied in place to a copy of the user's Word document.
 */
export type TailoringAction =
  | 'reorder'
  | 'emphasize'
  | 'rewrite_bullet'
  | 'add_bullet'
  | 'select'
  | 'reduce'
  | 'align_terms'
  | 'update_summary'
  /** The title line under the name, set to the job's role. */
  | 'update_headline'

export type ResumeSection =
  | 'headline'
  | 'summary'
  | 'experience'
  | 'projects'
  | 'skills'
  | 'education'
  | 'achievements'
  | 'certifications'

export interface TailoringChange {
  section: ResumeSection
  /** Resume item id (experience, project, skill group...); null for the summary. */
  item: string | null
  action: TailoringAction
  /** Evidence the change rests on; required for rewrite_bullet, align_terms and update_summary. */
  evidenceIds: string[]
  reason: string
  /** reorder: the new index. */
  position?: number | null
  /** rewrite_bullet / align_terms / reduce: the bullet being changed. add_bullet: set by the executor. */
  bulletId?: string | null
  /** rewrite_bullet / align_terms / add_bullet / update_summary: the new text. */
  text?: string | null
  /** emphasize: skills to move forward. select: items to keep. */
  values?: string[] | null
}

export interface TailoringPlan {
  changes: TailoringChange[]
}

export type ValidationCheck =
  | 'protected_fields'
  | 'metrics'
  | 'unsupported_technology'
  | 'traceability'
  | 'keyword_integrity'
  | 'hallucination_review'
  | 'formatting'
  /** A change left out because that part of the Word document couldn't be edited safely. */
  | 'document'
  /** A skill the job requires that isn't in the profile, added for the user to confirm or remove. */
  | 'unverified_skill'

/** What the validator did about a problem. */
export type ValidationOutcome = 'reverted' | 'removed' | 'restored' | 'flagged' | 'warning'

export interface ValidationIssue {
  check: ValidationCheck
  outcome: ValidationOutcome
  section: ResumeSection | null
  item: string | null
  /** User-facing, e.g. "1 metric removed: not found in your profile". */
  message: string
  original?: string | null
  attempted?: string | null
}


/** Human-readable change for the result card and review screen. */
export interface ChangeSummary {
  section: ResumeSection
  action: TailoringAction
  label: string
}

/** One rewritten or added (before = '') bullet or summary, for the review screen's diff view. */
export interface TextDiff {
  section: ResumeSection
  item: string | null
  itemLabel: string
  before: string
  after: string
  evidenceLabels: string[]
}

export interface ValidationReport {
  issues: ValidationIssue[]
  /** Unused since tailoring keeps the user's document: page count depends on Word's layout (the preview shows it). */
  pageCount: number | null
  /** What survived validation, for the result card and the review screen's diff view. */
  changes: ChangeSummary[]
  diffs: TextDiff[]
}

/** Returned with `GET /api/v1/tailorings/{id}?detail=true` once ready. */
export interface TailoringDetail {
  requirements: RequirementMatch[]
  diffs: TextDiff[]
  issues: ValidationIssue[]
  pageCount: number | null
}

/** `POST /api/v1/tailorings` */
export interface StartTailoringRequest {
  jobContextId: string
  /** Defaults to the current master. */
  resumeId?: string | null
}

export interface StartTailoringResponse {
  id: string
  status: TailoringStatus
}

/** `GET /api/v1/tailorings/{id}` */
export interface TailoringResponse {
  id: string
  status: TailoringStatus
  jobContextId: string
  jobTitle: string
  company: string | null
  /** Set once status is 'ready'. */
  summary: MatchSummary | null
  changes: ChangeSummary[]
  unsupportedRequirements: string[]
  warnings: string[]
  pipelineVersion: string
  /** User-safe reason when status is 'failed'. */
  error: string | null
  createdAt: string
  detail: TailoringDetail | null
  /** While it runs: when to poll next (see tailoringPollDelay). Absent from older API versions. */
  retryAfterMs?: number | null
}

/** `GET /api/v1/tailorings` */
export interface TailoringListItem {
  id: string
  status: TailoringStatus
  jobTitle: string
  company: string | null
  hasFile: boolean
  createdAt: string
}

export interface TailoringListResponse {
  items: TailoringListItem[]
}

/** `GET /api/v1/tailorings/{id}/download` */
export interface TailoringDownloadResponse {
  /** Short-lived signed URL that downloads the tailored .docx. */
  url: string
  expiresIn: number
  /** e.g. "Sam Rivera Resume - Tailored - Company X.docx" */
  fileName: string
}

export interface TailoringFile {
  /** Short-lived signed URL (no download disposition): fetch it and render it. */
  url: string
  fileName: string
}

/** `GET /api/v1/tailorings/{id}/files` — what the preview renders. */
export interface TailoringFilesResponse {
  /** 'pdf' only for tailorings made before tailoring kept the user's Word document. */
  format: 'docx' | 'pdf'
  tailored: TailoringFile
  /** The original upload; null when that resume version was deleted. */
  original: TailoringFile | null
  expiresIn: number
}
