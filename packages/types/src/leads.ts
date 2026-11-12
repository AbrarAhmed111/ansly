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
