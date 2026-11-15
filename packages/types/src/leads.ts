export type LeadStatus = 'new' | 'contacted'
export type Contactability = 'email_available' | 'application_link_available' | 'dm_only' | 'contact_form_available' | 'no_contact_information_found' | 'unknown'
export type OpportunityType = 'job' | 'contract' | 'freelance' | 'consulting' | 'startup' | 'part_time'
export type SourcePlatform = 'linkedin' | 'twitter' | 'reddit' | 'other'

export interface TargetingProfile {
  id: string
  user_id: string
  name: string
  description?: string | null
  is_active: boolean
  target_roles: string[]
  keywords: string[]
  excluded_keywords: string[]
  industries: string[]
  locations: string[]
  remote_preferences: 'any' | 'remote' | 'hybrid' | 'onsite'
  employment_types: string[]
  opportunity_types: string[]
  minimum_requirements: string | null
  contactability_preferences: string | null
  qualification_preferences: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface LeadCollectionSession {
  id: string
  user_id: string
  targeting_profile_id?: string | null
  source_platform: SourcePlatform
  status: 'pending' | 'processing' | 'completed' | 'partially_completed' | 'failed'
  started_at: string
  completed_at?: string | null
  total_candidates_reviewed: number
  relevant_candidates: number
  irrelevant_candidates: number
  duplicates_skipped: number
  new_leads_saved: number
  created_at: string
  updated_at: string
}

export interface LeadProfileSnapshot {
  id: string
  name: string
  description?: string | null
  target_roles: string[]
  keywords: string[]
}

export interface LeadContactInfo {
  email?: string | null
  profile_url?: string | null
  company_url?: string | null
  application_url?: string | null
  contact_form_url?: string | null
}

export interface Lead {
  id: string
  user_id?: string | null
  targeting_profile_id?: string | null
  collection_session_id?: string | null
  source_platform: SourcePlatform
  source_name: string
  source_post_id?: string | null
  author_name: string
  author_profile_url?: string | null
  company_name: string
  title: string
  opportunity_type: OpportunityType
  status: LeadStatus
  contactability: Contactability
  description: string
  publication_date?: string | null
  collected_at?: string | null
  original_post_url?: string | null
  tags: string[]
  profile_snapshot?: LeadProfileSnapshot | null
  contact_info?: LeadContactInfo | null
  confidence?: number | null
  qualification_reason?: string | null
  /** Set when Ansly Cleanup removed the lead; it stays stored so the same post isn't collected again. */
  removed_at?: string | null
  removed_by?: 'cleanup' | 'user' | null
  removed_category?: CleanupCategory | null
  removed_reason?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export interface LeadDraft {
  id: string
  lead_id: string
  recipient_email?: string | null
  subject: string
  body: string
  status: 'draft' | 'generated' | 'edited' | 'failed'
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------------------
// Lead emails: drafts, sending, and the Gmail connection (keep in sync with llm/src/app/schemas/lead_emails.py)
// ---------------------------------------------------------------------------

export type ResumeSelection = 'auto' | 'user' | 'none_by_user' | 'needs_selection'
export type DeliveryStatus = 'draft' | 'sending' | 'sent' | 'failed'
export type MatchConfidence = 'high' | 'medium' | 'low' | 'none'

export interface DetectedRole {
  title: string
  role_family: string
  seniority: string | null
  technologies: string[]
  responsibilities: string[]
  evidence_quote: string
  other_roles?: string[]
  /** The hiring company as the post names it. */
  company?: string | null
  /** What the post says the company does. */
  company_context?: string | null
}

export interface DraftResume {
  id: string
  label: string | null
  name: string
  file_name: string | null
  file_type: 'pdf' | 'docx'
  file_size: number | null
}

export interface EmailDraft {
  id: string
  lead_id: string
  recipient_email: string | null
  recipient_source: 'post' | 'user'
  /** The address written in the post, for comparison when the user changed the recipient. */
  post_email: string | null
  subject: string
  body: string
  resume: DraftResume | null
  resume_selection: ResumeSelection
  match_confidence: MatchConfidence | null
  match_reason: string | null
  detected_role: DetectedRole | null
  is_user_edited: boolean
  approved: boolean
  approved_at: string | null
  delivery_status: DeliveryStatus
  sent_at: string | null
  last_error_code: string | null
  version: number
  updated_at: string | null
  /** What blocks sending right now (not counting the Gmail connection). */
  issues: string[]
}

export interface EmailDraftListResponse {
  drafts: EmailDraft[]
}

export interface GeneratePreviewResponse {
  eligible: number
  no_email: number
  existing_drafts: number
  eligible_lead_ids: string[]
  preview_token: string | null
}

export interface GenerateResult {
  lead_id: string
  outcome: 'created' | 'existing' | 'insufficient_evidence' | 'failed'
  message: string | null
  draft: EmailDraft | null
}

export interface UpdateDraftRequest {
  expected_version: number
  recipient_email?: string
  subject?: string
  body?: string
  resume_id?: string
  send_without_resume?: boolean
}

export interface SendPreviewItem {
  draft_id: string
  lead_id: string
  recipient_email: string
  subject: string
  attachment_name: string | null
  may_duplicate: boolean
}

export interface SendPreviewResponse {
  ready: SendPreviewItem[]
  excluded: { draft_id: string; lead_id: string; issues: string[] }[]
  connection_email: string | null
  connection_issue: 'not_connected' | 'reauth_required' | null
  confirm_token: string | null
}

export interface SendResult {
  draft_id: string
  lead_id: string | null
  outcome: 'sent' | 'failed' | 'skipped' | 'not_attempted'
  code: string | null
  message: string | null
}

export interface SendResponse {
  results: SendResult[]
  stopped: string | null
}

export interface EmailConnection {
  configured: boolean
  connected: boolean
  provider: 'gmail' | null
  email_address: string | null
  status: 'connected' | 'needs_reauth' | null
  granted_scopes: string[]
}

export interface WriteAndSendResult {
  lead_id: string
  outcome: 'sent' | 'needs_review' | 'failed' | 'skipped' | 'insufficient_evidence'
  code: string | null
  message: string | null
  draft: EmailDraft | null
}

export interface WriteAndSendResponse {
  results: WriteAndSendResult[]
  stopped: string | null
}

// Ansly Cleanup

export type CleanupCategory = 'job_seeker' | 'stack_mismatch' | 'not_hiring' | 'match' | 'unclear'

export interface CleanupResult {
  lead_id: string
  /** removed: deleted (a confident non-match). review: Ansly would remove it; the user decides. */
  outcome: 'removed' | 'review' | 'kept'
  category: CleanupCategory
  reason: string
  included_keywords: string[]
  excluded_keywords: string[]
  /** Set for removed and review leads only. */
  title: string | null
  description: string | null
  contacted: boolean
  /** False when the AI couldn't check this lead (it was kept). */
  checked: boolean
}

export interface CleanupResponse {
  results: CleanupResult[]
  removed: number
  review: number
  kept: number
  unchecked: number
}
