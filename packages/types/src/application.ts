export type ApplicationAgentMode = 'normal' | 'aggressive'

export type ApplicationRoute = 'email' | 'website'

export type ApplicationRunStatus =
  | 'detected'
  | 'awaiting_authorization'
  | 'authorized'
  | 'analyzing_job'
  | 'email_route_check'
  | 'email_drafting'
  | 'email_sending'
  | 'email_sent'
  | 'matching_resume'
  | 'inspecting_application'
  | 'filling_application'
  | 'uploading_resume'
  | 'generating_cover_letter'
  | 'answering_questions'
  | 'navigating_steps'
  | 'human_intervention'
  | 'captcha_paused'
  | 'ready_to_submit'
  | 'submitting'
  | 'verifying_submission'
  | 'submitted'
  | 'failed'
  | 'cancelled'

export type ApplicationActivityStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'needs_attention'
  | 'paused'
  | 'failed'
  | 'cancelled'

export type ApplicationPlatform =
  | 'indeed'
  | 'linkedin'
  | 'greenhouse'
  | 'lever'
  | 'workday'
  | 'ashby'
  | 'smartrecruiters'
  | 'workable'
  | 'bamboohr'
  | 'company'
  | 'unknown'

export interface ApplicationAuthorization {
  grantedAt: string
  route: 'email' | 'website' | 'email_then_website'
  websiteSubmissionAllowed: boolean
  behaviorMode: ApplicationAgentMode
  jobUrl: string
  platform: ApplicationPlatform
}

export interface ApplicationActivityEvent {
  id: string
  runId: string
  type: 'activity' | 'checkpoint' | 'intervention' | 'error'
  activity: string
  status: ApplicationActivityStatus
  occurredAt: string
  checkpointId?: string | null
  detail?: string | null
}

export interface ApplicationRun {
  id: string
  userId: string
  jobKey: string
  jobContextId?: string | null
  jobOutreachId?: string | null
  title: string
  company?: string | null
  jobUrl?: string | null
  platform: ApplicationPlatform
  route: ApplicationRoute
  behaviorMode: ApplicationAgentMode
  resumeId?: string | null
  status: ApplicationRunStatus
  authorization: ApplicationAuthorization
  submissionEvidence?: Record<string, unknown> | null
  selectedResumeName?: string | null
  recipientEmail?: string | null
  emailSubject?: string | null
  providerMessageId?: string | null
  startedAt: string
  completedAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface ApplicationDecisionEvidence {
  confidence: 'high' | 'medium' | 'low' | 'none'
  sources: string[]
  reason: string
  missing: string[]
  material: boolean
  userConfirmed: boolean
}

export interface StartApplicationRequest {
  id: string
  jobKey: string
  jobContextId?: string | null
  title: string
  company?: string | null
  jobUrl?: string | null
  platform: ApplicationPlatform
  route: ApplicationRoute
  behaviorMode: ApplicationAgentMode
}

export interface AuthorizeApplicationRequest {
  route: 'email' | 'website' | 'email_then_website'
  websiteSubmissionAllowed: boolean
}

export interface ApplicationStatusRequest {
  status: ApplicationRunStatus
}

export interface ApplicationOutcomeRequest {
  status: 'email_sent' | 'submitted' | 'failed' | 'cancelled'
  jobOutreachId?: string | null
  resumeId?: string | null
  selectedResumeName?: string | null
  recipientEmail?: string | null
  emailSubject?: string | null
  providerMessageId?: string | null
  submissionEvidence?: Record<string, unknown>
}
