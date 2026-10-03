import type { FullProfile, Profile } from './database'

export interface CompletenessItem {
  key: string
  label: string
  weight: number
  done: boolean
  /** Web app route where the user can fill this in. */
  href: string
}

export interface Completeness {
  /** 0–100 */
  percent: number
  items: CompletenessItem[]
}

/** What completeness is scored from: a few profile fields plus counts (the dashboard gets these pre-aggregated). */
export interface CompletenessSignals {
  profile: Pick<Profile, 'full_name' | 'headline' | 'location' | 'summary' | 'links'> | null
  experiences: number
  /** Every experience has a description or highlights. */
  experiencesDescribed: boolean
  /** At least one project has a description. */
  projectsDescribed: boolean
  /** Skills excluding "I don't have this" rows (level 'none'). */
  knownSkills: number
  education: number
  achievements: number
  facts: number
}

const filled = (value: string | null | undefined) =>
  typeof value === 'string' && value.trim().length > 0

export function completenessSignals(data: FullProfile): CompletenessSignals {
  return {
    profile: data.profile,
    experiences: data.experiences.length,
    experiencesDescribed: data.experiences.every((e) => filled(e.description) || e.highlights.length > 0),
    projectsDescribed: data.projects.some((pr) => filled(pr.description)),
    knownSkills: data.skills.filter((s) => s.level !== 'none').length,
    education: data.education.length,
    achievements: data.achievements.length,
    facts: (data.profile_facts ?? []).length,
  }
}

/**
 * Scores how much of the profile is filled in. Weighted toward what answer
 * generation draws on most: experience, projects, skills and the summary.
 */
export function profileCompleteness(data: FullProfile): Completeness {
  return completenessFromSignals(completenessSignals(data))
}

export function completenessFromSignals(data: CompletenessSignals): Completeness {
  const p = data.profile
  const items: CompletenessItem[] = [
    {
      key: 'personal',
      label: 'Name, headline and location',
      weight: 10,
      done: filled(p?.full_name) && filled(p?.headline) && filled(p?.location),
      href: '/profile/personal',
    },
    {
      key: 'summary',
      label: 'Professional summary',
      weight: 15,
      done: filled(p?.summary) && (p?.summary?.trim().length ?? 0) >= 80,
      href: '/profile/personal',
    },
    {
      key: 'links',
      label: 'At least one link (LinkedIn, GitHub, website)',
      weight: 5,
      done: Object.values(p?.links ?? {}).some((v) => filled(v)),
      href: '/profile/personal',
    },
    {
      key: 'experience',
      label: 'Work experience with descriptions',
      weight: 25,
      done: data.experiences > 0 && data.experiencesDescribed,
      href: '/profile/experience',
    },
    {
      key: 'projects',
      label: 'At least one project',
      weight: 20,
      done: data.projectsDescribed,
      href: '/profile/projects',
    },
    {
      key: 'skills',
      label: 'At least five skills',
      weight: 15,
      done: data.knownSkills >= 5,
      href: '/profile/skills',
    },
    {
      key: 'education',
      label: 'Education',
      weight: 5,
      done: data.education > 0,
      href: '/profile/education',
    },
    {
      key: 'achievements',
      label: 'At least one achievement',
      weight: 5,
      done: data.achievements > 0,
      href: '/profile/achievements',
    },
    {
      key: 'additional',
      label: 'Additional details (answers you gave Ansly)',
      weight: 5,
      done: data.facts > 0,
      href: '/profile/additional',
    },
  ]

  const total = items.reduce((sum, i) => sum + i.weight, 0)
  const done = items.reduce((sum, i) => sum + (i.done ? i.weight : 0), 0)
  return { percent: Math.round((done / total) * 100), items }
}
