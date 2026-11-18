export type JobOutreachStatus = 'analyzing' | 'analyzed' | 'draft' | 'needs_review' | 'sending' | 'sent' | 'failed'

export interface JobOutreachInfo {
  title: string | null
  company: string | null
  role_family: string | null
  seniority: string | null
  technologies: string[]
  responsibilities: string[]
  requirements: string[]
  application_method: 'email' | 'portal' | 'other' | 'unclear'
  application_method_evidence: string
  application_emails: string[]
  recipient_email: string | null
  recipient_confident: boolean
  recipient_ambiguous: boolean
  recipient_evidence: string
  application_instructions: string | null
  instructions_present: boolean
  instructions_confident: boolean
  instructions_evidence: string
  requested_subject: string | null
  subject_uncertain: boolean
  review_reasons?: string[]
}

export interface JobOutreachResume {
  id: string
  label: string | null
  name: string
  file_name: string | null
  file_type: 'pdf' | 'docx'
}

export interface JobOutreachResponse {
  id: string
  status: JobOutreachStatus
  job_info: JobOutreachInfo
  recipient_email: string | null
  subject: string
  body: string
  resume_id: string | null
  resume_selection: 'auto' | 'user' | 'needs_selection'
  match_confidence: 'high' | 'medium' | 'low' | 'none' | null
  match_reason: string | null
  recommended_resume: JobOutreachResume | null
  resumes: JobOutreachResume[]
  review_reasons: string[]
  error_code: string | null
  error_message: string | null
  sent_at: string | null
  can_auto_send: boolean
  can_send: boolean
}

export interface SendJobOutreachRequest {
  automatic?: boolean
  recipient_email?: string
  subject?: string
  body?: string
  resume_id?: string
}
