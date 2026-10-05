import type { FullProfile, StructuredResume } from '@ansly/types'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Resume-first onboarding: builds the structured profile from the master resume
 * the user uploaded and reviewed. Only adds: a profile field is filled only when
 * it is empty, and a row is added only when the profile has nothing like it, so
 * running it again (or after editing the profile) never overwrites or duplicates.
 */

/** "2021-03" / "2021" / "Mar 2021" → a date column value ("2021-03-01"), or null when it can't be read. */
export function toDate(value: string | null | undefined): string | null {
  const text = (value ?? '').trim()
  let m = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(text)
  if (m) return `${m[1]}-${m[2]!.padStart(2, '0')}-${(m[3] ?? '1').padStart(2, '0')}`
  m = /^(\d{4})$/.exec(text)
  if (m) return `${m[1]}-01-01`
  const parsed = Date.parse(`1 ${text}`)
  if (!Number.isNaN(parsed) && /\d{4}/.test(text)) {
    const d = new Date(parsed)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
  }
  return null
}

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const empty = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && !v.trim())

export interface ImportCounts {
  experiences: number
  projects: number
  skills: number
  education: number
  achievements: number
  profileFields: number
}

export interface ResumeImportPlan {
  profile: Record<string, unknown>
  experiences: Record<string, unknown>[]
  projects: Record<string, unknown>[]
  skills: Record<string, unknown>[]
  education: Record<string, unknown>[]
  achievements: Record<string, unknown>[]
}

/** What importing `resume` would add to `current` (pure: no writes). */
export function planResumeImport(resume: StructuredResume, current: FullProfile): ResumeImportPlan {
  const p = current.profile
  const profile: Record<string, unknown> = {}
  const c = resume.contact
  const set = (key: string, value: unknown) => {
    if (!empty(value) && (!p || empty((p as unknown as Record<string, unknown>)[key]))) profile[key] = value
  }
  set('full_name', c.name)
  set('headline', c.headline)
  set('email', c.email)
  set('phone', c.phone)
  set('location', c.location)
  set('summary', resume.summary)
  const links = { ...(p?.links ?? {}) } as Record<string, string>
  let linksAdded = false
  for (const link of c.links) {
    const key = /linkedin/i.test(link.url) ? 'linkedin' : /github/i.test(link.url) ? 'github' : /portfolio/i.test(link.label) ? 'portfolio' : 'website'
    if (!links[key]) {
      links[key] = link.url
      linksAdded = true
    }
  }
  if (linksAdded) profile.links = links

  const haveExp = new Set(current.experiences.map((e) => `${norm(e.company)}|${norm(e.title)}`))
  const experiences = resume.experience
    .filter((e) => e.company && e.title && !haveExp.has(`${norm(e.company)}|${norm(e.title)}`))
    .map((e, i) => ({
      company: e.company, title: e.title, location: e.location, start_date: toDate(e.startDate),
      end_date: e.isCurrent ? null : toDate(e.endDate), is_current: e.isCurrent,
      highlights: e.bullets.map((b) => b.text), technologies: e.technologies, sort_order: current.experiences.length + i,
    }))

  const haveProj = new Set(current.projects.map((x) => norm(x.name)))
  const projects = resume.projects
    .filter((x) => x.name && !haveProj.has(norm(x.name)))
    .map((x, i) => ({
      name: x.name, role: x.role, url: x.url, start_date: toDate(x.startDate), end_date: toDate(x.endDate),
      description: x.bullets[0]?.text ?? null, highlights: x.bullets.slice(1).map((b) => b.text), technologies: x.technologies,
      sort_order: current.projects.length + i,
    }))

  const haveSkill = new Set(current.skills.map((s) => norm(s.name)))
  const skills: Record<string, unknown>[] = []
  for (const name of resume.skills.flatMap((g) => g.items)) {
    const key = norm(name)
    if (!key || haveSkill.has(key)) continue
    haveSkill.add(key)
    skills.push({ name: name.trim(), sort_order: current.skills.length + skills.length })
  }

  const haveEdu = new Set(current.education.map((e) => norm(e.institution)))
  const education = resume.education
    .filter((e) => e.institution && !haveEdu.has(norm(e.institution)))
    .map((e, i) => ({
      institution: e.institution, degree: e.degree, field_of_study: e.fieldOfStudy, start_date: toDate(e.startDate),
      end_date: toDate(e.endDate), grade: e.grade, description: e.bullets.map((b) => b.text).join('\n') || null,
      sort_order: current.education.length + i,
    }))

  const haveAch = new Set(current.achievements.map((a) => norm(a.title)))
  const achievements = [
    ...resume.achievements.map((a) => ({ title: a.title, description: a.description, date: toDate(a.date), url: a.url })),
    ...resume.certifications.map((a) => ({ title: a.name, description: a.issuer ? `Issued by ${a.issuer}` : null, date: toDate(a.date), url: a.url })),
  ]
    .filter((a) => a.title && !haveAch.has(norm(a.title)))
    .map((a, i) => ({ ...a, sort_order: current.achievements.length + i }))

  return { profile, experiences, projects, skills, education, achievements }
}

export function countPlan(plan: ResumeImportPlan): ImportCounts {
  return {
    experiences: plan.experiences.length, projects: plan.projects.length, skills: plan.skills.length,
    education: plan.education.length, achievements: plan.achievements.length, profileFields: Object.keys(plan.profile).length,
  }
}

/** Writes the plan as the signed-in user (row-level security applies). */
export async function applyResumeImport(supabase: SupabaseClient, userId: string, plan: ResumeImportPlan): Promise<void> {
  if (Object.keys(plan.profile).length) {
    const { error } = await supabase.from('profiles').update(plan.profile).eq('id', userId)
    if (error) throw new Error(error.message)
  }
  for (const table of ['experiences', 'projects', 'skills', 'education', 'achievements'] as const) {
    const rows = plan[table]
    if (!rows.length) continue
    const { error } = await supabase.from(table).insert(rows)
    if (error) throw new Error(error.message)
  }
}
