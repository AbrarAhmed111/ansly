/**
 * Structured Resume JSON: the internal format every resume is parsed into and
 * tailored as. The AI never edits the file: validated changes are applied by
 * code to a copy of the user's own Word document, which stays the design master.
 *
 * Versioned by `schemaVersion`; bump it on any breaking change and keep the
 * Pydantic model in `llm/src/app/schemas/resume.py` in sync. Sample fixtures
 * live in `packages/types/fixtures/structured-resume/`.
 *
 * Dates are kept as written on the resume ("Jan 2023", "2021", "Present") so the
 * validator can compare protected fields to the source exactly.
 */

export const STRUCTURED_RESUME_SCHEMA_VERSION = 1

export interface ResumeLink {
  label: string
  url: string
}

export interface ResumeContact {
  name: string
  headline: string | null
  email: string | null
  phone: string | null
  location: string | null
  links: ResumeLink[]
}

/** Every item and bullet has a stable id, so tailoring plans and validation can point at it. */
export interface ResumeBullet {
  id: string
  text: string
}

export interface ResumeExperience {
  id: string
  company: string
  title: string
  location: string | null
  startDate: string | null
  endDate: string | null
  isCurrent: boolean
  bullets: ResumeBullet[]
  technologies: string[]
}

export interface ResumeProject {
  id: string
  name: string
  role: string | null
  url: string | null
  startDate: string | null
  endDate: string | null
  bullets: ResumeBullet[]
  technologies: string[]
}

export interface ResumeSkillGroup {
  id: string
  /** e.g. "Languages", "Frameworks"; null for a flat skills list. */
  label: string | null
  items: string[]
}

export interface ResumeEducation {
  id: string
  institution: string
  degree: string | null
  fieldOfStudy: string | null
  startDate: string | null
  endDate: string | null
  grade: string | null
  bullets: ResumeBullet[]
}

export interface ResumeAchievement {
  id: string
  title: string
  description: string | null
  date: string | null
  url: string | null
}

export interface ResumeCertification {
  id: string
  name: string
  issuer: string | null
  date: string | null
  url: string | null
}

/** Anything that doesn't fit a known section (Languages, Volunteering, ...). */
export interface ResumeCustomSection {
  id: string
  heading: string
  bullets: ResumeBullet[]
}

export interface StructuredResume {
  schemaVersion: typeof STRUCTURED_RESUME_SCHEMA_VERSION
  contact: ResumeContact
  summary: string | null
  experience: ResumeExperience[]
  projects: ResumeProject[]
  skills: ResumeSkillGroup[]
  education: ResumeEducation[]
  achievements: ResumeAchievement[]
  certifications: ResumeCertification[]
  customSections: ResumeCustomSection[]
}

/** New uploads are always 'docx'; 'pdf' only appears on versions uploaded before tailoring became DOCX-only. */
export type ResumeFileType = 'pdf' | 'docx'

export type ResumeParseStatus = 'pending' | 'parsed' | 'needs_review' | 'failed'

/** A resume as the API returns it (the `resumes` row, camelCased). */
export interface ResumeRecord {
  id: string
  name: string
  fileType: ResumeFileType
  parseStatus: ResumeParseStatus
  /** User-safe reason when parseStatus is 'failed'. */
  parseError: string | null
  parsedContent: StructuredResume | null
  version: number
  isMaster: boolean
  /** Discrepancy keys the user chose to keep as they are. */
  dismissedDiscrepancies: string[]
  createdAt: string
  updatedAt: string
}

/** A place where the master resume and the structured profile disagree. The user picks; nothing is overwritten silently. */
export interface ResumeDiscrepancy {
  key: string
  field: 'title' | 'company' | 'dates' | 'skill' | 'education' | 'contact'
  /** What the resume says (null = missing from the resume). */
  resumeValue: string | null
  /** What the profile says (null = missing from the profile). */
  profileValue: string | null
  label: string
}

/** `POST /api/v1/resumes` — after the web app uploads the file to Storage. */
export interface CreateResumeRequest {
  name: string
  /** `{user_id}/masters/....docx` in the `resumes` bucket. */
  filePath: string
  /** Only Word documents are accepted. */
  fileType: 'docx'
}

/** `GET /api/v1/resumes/master` */
export interface MasterResumeResponse {
  resume: ResumeRecord | null
  discrepancies: ResumeDiscrepancy[]
}

/** `PATCH /api/v1/resumes/{id}` — the user's corrections to the parsed content. */
export interface UpdateResumeRequest {
  name?: string
  /** Saving corrections also confirms a 'needs_review' parse. */
  parsedContent?: StructuredResume
  /** Discrepancy keys the user chose to keep as they are. */
  dismissedDiscrepancies?: string[]
}

/** `GET /api/v1/resumes` — every version, newest first. */
export interface ResumeListResponse {
  items: ResumeRecord[]
}
