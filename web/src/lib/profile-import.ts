import type { SupabaseClient } from '@supabase/supabase-js'
import { SECTIONS, type SectionDef } from './sections'

/** File format for profile export/import (also used by supabase/seed/profile.seed.json). */
export interface ProfileExport {
  version?: number
  profile?: Record<string, unknown>
  experiences?: Record<string, unknown>[]
  projects?: Record<string, unknown>[]
  skills?: Record<string, unknown>[]
  education?: Record<string, unknown>[]
  achievements?: Record<string, unknown>[]
  profile_facts?: Record<string, unknown>[]
  saved_answers?: Record<string, unknown>[]
  /** Resume metadata (v1.2). Export only: files and their contents are never imported. */
  resumes?: Record<string, unknown>[]
  /** Tailoring history (v1.2). Export only. */
  resume_tailorings?: Record<string, unknown>[]
}

const PROFILE_FIELDS = [
  'full_name', 'headline', 'email', 'phone', 'location', 'summary', 'additional_context', 'links', 'work_authorization',
  'requires_sponsorship', 'notice_period', 'salary_expectation', 'willing_to_relocate', 'preferred_work_mode',
  'resume_page_limit',
]
const SAVED_ANSWER_FIELDS = ['question', 'answer', 'category', 'company', 'role']

export interface ImportPlan {
  profile: Record<string, unknown> | null
  rows: { table: string; rows: Record<string, unknown>[] }[]
  errors: string[]
}

const blank = (v: unknown) => v == null || (typeof v === 'string' && !v.trim())

function pick(source: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    // Keys starting with "_" are notes for humans and are never imported.
    if (f in source && !f.startsWith('_')) out[f] = source[f] === '' ? null : source[f]
  }
  return out
}

function normalizeDate(value: unknown): unknown {
  if (typeof value !== 'string' || !value) return value
  return /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : value
}

function sectionRows(section: SectionDef, input: unknown, errors: string[]) {
  if (input == null) return []
  if (!Array.isArray(input)) {
    errors.push(`"${section.table}" must be a list.`)
    return []
  }
  const fields = [...section.fields.map((f) => f.name), 'sort_order']
  const required = section.fields.filter((f) => f.required).map((f) => f.name)
  return input.flatMap((raw, i) => {
    if (typeof raw !== 'object' || raw === null) {
      errors.push(`${section.title} #${i + 1} is not an object.`)
      return []
    }
    const row = pick(raw as Record<string, unknown>, fields)
    const missing = required.filter((f) => blank(row[f]))
    if (missing.length) {
      const name = section.itemTitle({ id: '', sort_order: 0, ...row }).replace(/undefined|null/g, '?')
      errors.push(`${section.title} #${i + 1} (${name}) is missing: ${missing.join(', ')}.`)
      return []
    }
    for (const f of ['start_date', 'end_date', 'date']) if (f in row) row[f] = normalizeDate(row[f])
    // Supabase bulk inserts need identical keys on every row, so fill in every field.
    for (const f of section.fields) {
      if (f.type === 'list') {
        row[f.name] = typeof row[f.name] === 'string' ? [row[f.name]] : Array.isArray(row[f.name]) ? row[f.name] : []
      } else if (f.type === 'checkbox') {
        row[f.name] = Boolean(row[f.name])
      } else {
        row[f.name] ??= null
      }
    }
    row.sort_order ??= i
    return [row]
  })
}

/** Validates an import file and turns it into rows to insert. Never trusts ids or user ids from the file. */
export function planImport(data: ProfileExport): ImportPlan {
  const errors: string[] = []
  const profile = data.profile && typeof data.profile === 'object' ? pick(data.profile, PROFILE_FIELDS) : null
  const rows: ImportPlan['rows'] = SECTIONS.map((section) => ({
    table: section.table,
    rows: sectionRows(section, data[section.table], errors),
  }))
  if (Array.isArray(data.saved_answers)) {
    rows.push({
      table: 'saved_answers',
      rows: data.saved_answers
        .map((a) => Object.fromEntries(SAVED_ANSWER_FIELDS.map((f) => [f, pick(a, SAVED_ANSWER_FIELDS)[f] ?? null])))
        .filter((a) => !blank(a.question) && !blank(a.answer)),
    })
  }
  return { profile: profile && Object.keys(profile).length ? profile : null, rows, errors }
}

export async function runImport(supabase: SupabaseClient, userId: string, plan: ImportPlan) {
  if (plan.profile) {
    const { error } = await supabase.from('profiles').upsert({ id: userId, ...plan.profile })
    if (error) throw new Error(`Profile: ${error.message}`)
  }
  let inserted = 0
  for (const { table, rows: planned } of plan.rows) {
    let rows = planned
    if (table === 'skills' && rows.length) {
      // Skill names are unique per user (case-insensitive); skip ones that already exist.
      const { data, error } = await supabase.from('skills').select('name')
      if (error) throw new Error(`skills: ${error.message}`)
      const existing = new Set((data ?? []).map((s) => String(s.name).toLowerCase()))
      rows = rows.filter((r) => {
        const key = String(r.name).toLowerCase()
        if (existing.has(key)) return false
        existing.add(key)
        return true
      })
    }
    if (!rows.length) continue
    const { error } = await supabase.from(table).insert(rows)
    if (error) throw new Error(`${table}: ${error.message}`)
    inserted += rows.length
  }
  return inserted
}

/**
 * Resume metadata and tailoring history. File contents (parsed and tailored resumes) are only included when
 * `includeContents` is set; the original and tailored files themselves never are.
 */
export async function exportResumes(
  supabase: SupabaseClient,
  includeContents: boolean,
): Promise<Pick<ProfileExport, 'resumes' | 'resume_tailorings'>> {
  const resumeColumns = `name, file_type, version, is_master, parse_status, created_at, updated_at${includeContents ? ', parsed_content' : ''}`
  const tailoringColumns = `status, pipeline_version, resume_version, job_context_id, created_at${
    includeContents ? ', match_analysis, tailored_content, validation_report' : ''
  }`
  const [resumes, tailorings, jobs] = await Promise.all([
    supabase.from('resumes').select(resumeColumns).order('version'),
    supabase.from('resume_tailorings').select(tailoringColumns).order('created_at'),
    supabase.from('job_contexts').select('id, title, company, location, url, source'),
  ])
  // Before the v1.2 migration these tables don't exist: export the rest.
  if (resumes.error || tailorings.error || jobs.error) return {}
  const byId = new Map((jobs.data ?? []).map(({ id, ...job }) => [id as string, job]))
  return {
    resumes: (resumes.data ?? []) as unknown as Record<string, unknown>[],
    resume_tailorings: ((tailorings.data ?? []) as unknown as Record<string, unknown>[]).map(({ job_context_id, ...row }) => ({
      ...row,
      job: byId.get(job_context_id as string) ?? null,
    })),
  }
}

export async function exportProfile(supabase: SupabaseClient): Promise<ProfileExport> {
  const strip = ({ id: _id, user_id: _uid, created_at: _c, updated_at: _u, ...rest }: Record<string, unknown>) => rest
  const [profile, ...rest] = await Promise.all([
    supabase.from('profiles').select('*').maybeSingle(),
    ...[...SECTIONS.map((s) => s.table), 'saved_answers'].map((t) => supabase.from(t).select('*').order('created_at')),
  ])
  const failed = [profile, ...rest].find((r) => r.error)
  if (failed?.error) throw new Error(failed.error.message)
  const tables = [...SECTIONS.map((s) => s.table), 'saved_answers']
  const out: ProfileExport = { version: 1, profile: profile.data ? pick(profile.data, PROFILE_FIELDS) : undefined }
  tables.forEach((t, i) => {
    ;(out as Record<string, unknown>)[t] = (rest[i].data ?? []).map((r: Record<string, unknown>) => {
      const row = strip(r)
      delete row.use_count
      delete row.last_used_at
      return row
    })
  })
  return out
}
