/**
 * Row types for the Supabase tables in `supabase/migrations`.
 * Dates are ISO strings (`YYYY-MM-DD`), timestamps are ISO date-times.
 */

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
  links: ProfileLinks
  work_authorization: string | null
  requires_sponsorship: boolean | null
  notice_period: string | null
  salary_expectation: string | null
  willing_to_relocate: boolean | null
  preferred_work_mode: WorkMode | null
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

export type SkillLevel = 'beginner' | 'intermediate' | 'advanced' | 'expert'

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

/** Everything that makes up a user's profile. */
export interface FullProfile {
  profile: Profile | null
  experiences: Experience[]
  projects: Project[]
  skills: Skill[]
  education: Education[]
  achievements: Achievement[]
}

export type ProfileSection =
  | 'experiences'
  | 'projects'
  | 'skills'
  | 'education'
  | 'achievements'
