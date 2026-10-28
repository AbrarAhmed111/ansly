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
const PROFILE_FIELD_TYPES: Record<string, string> = {
  full_name: 'string', headline: 'string', email: 'string', phone: 'string', location: 'string', summary: 'string',
  additional_context: 'string', links: 'object with string values', work_authorization: 'string',
  requires_sponsorship: 'boolean', notice_period: 'string', salary_expectation: 'string',
  willing_to_relocate: 'boolean', preferred_work_mode: '"remote", "hybrid", "onsite", or "flexible"',
  resume_page_limit: 'number from 1 to 3',
}
export const PROFILE_IMPORT_PROFILE_SCHEMA = PROFILE_FIELD_TYPES
const PROFILE_PROTECTED_FIELDS = ['id', 'created_at', 'updated_at', 'user_id', 'role', 'permissions', 'ownership']
const ROW_PROTECTED_FIELDS = ['id', 'user_id', 'created_at', 'updated_at']
const PROFILE_IMPORT_KEYS = [
  'version', 'profile', ...SECTIONS.map((section) => section.table), 'saved_answers', 'resumes', 'resume_tailorings',
]
export const MAX_PROFILE_IMPORT_BYTES = 1_000_000

export const PROFILE_IMPORT_EXAMPLE = {
  version: 1,
  profile: {
    full_name: 'Alex Morgan',
    headline: 'Operations coordinator',
    email: 'alex@example.com',
    links: { portfolio: 'https://example.com' },
    requires_sponsorship: false,
    resume_page_limit: 2,
  },
  experiences: [{
    title: 'Operations Coordinator',
    company: 'Northstar Services',
    start_date: '2022-01',
    end_date: null,
    is_current: true,
    highlights: ['Improved the weekly reporting process'],
    technologies: ['Excel'],
  }],
  projects: [{ name: 'Volunteer scheduling guide', description: 'Created a reusable scheduling process.' }],
  skills: [{ name: 'Process improvement', category: 'other', level: 'intermediate', years: 3 }],
  education: [{ institution: 'City College', degree: 'Associate degree' }],
  achievements: [{ title: 'Community service award', date: '2021-01' }],
  profile_facts: [{ prompt: 'What motivates you at work?', answer: 'I enjoy helping teams work more smoothly.', category: 'motivation' }],
  saved_answers: [{ question: 'What are your work preferences?', answer: 'I value collaborative teams.', category: 'general' }],
}

export interface ImportPlan {
  profile: Record<string, unknown> | null
  rows: { table: string; rows: Record<string, unknown>[] }[]
  errors: string[]
  warnings: string[]
}

const blank = (v: unknown) => v == null || (typeof v === 'string' && !v.trim())
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function pick(source: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    // Keys starting with "_" are notes for humans and are never imported.
    if (f in source && !f.startsWith('_')) out[f] = source[f] === '' ? null : source[f]
  }
  return out
}

function warnUnknownFields(
  source: Record<string, unknown>,
  supported: string[],
  protectedFields: string[],
  location: string,
  warnings: string[],
) {
  const protectedKeys = Object.keys(source).filter((key) => protectedFields.includes(key))
  const unknownKeys = Object.keys(source).filter((key) => !supported.includes(key) && !protectedFields.includes(key) && !key.startsWith('_'))
  if (protectedKeys.length) warnings.push(`${location}: system-controlled fields were ignored: ${protectedKeys.join(', ')}.`)
  if (unknownKeys.length) warnings.push(`${location}: unknown fields were ignored: ${unknownKeys.join(', ')}.`)
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}(?:-\d{2})?$/.test(value)) return false
  const normalized = value.length === 7 ? `${value}-01` : value
  const date = new Date(`${normalized}T00:00:00Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === normalized
}

function validFieldValue(type: SectionDef['fields'][number]['type'], value: unknown, options?: { value: string }[]): boolean {
  if (value === null) return type !== 'checkbox' && type !== 'list'
  if (type === 'checkbox') return typeof value === 'boolean'
  if (type === 'list') return Array.isArray(value) && value.every((item) => typeof item === 'string')
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 999.9
  if (type === 'month') return validDate(value)
  if (type === 'select') return typeof value === 'string' && (!options?.length || options.some((option) => option.value === value))
  if (typeof value !== 'string') return false
  if (type === 'url' && value.trim()) {
    try {
      const url = new URL(value)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    } catch {
      return false
    }
  }
  return true
}

function sectionRows(section: SectionDef, input: unknown, errors: string[], warnings: string[]) {
  if (input == null) return []
  if (!Array.isArray(input)) {
    errors.push(`"${section.table}" must be a list.`)
    return []
  }
  const fields = [...section.fields.map((f) => f.name), 'sort_order']
  const required = section.fields.filter((f) => f.required).map((f) => f.name)
  return input.flatMap((raw, i) => {
    if (!isRecord(raw)) {
      errors.push(`${section.title} #${i + 1} is not an object.`)
      return []
    }
    const location = `${section.title} #${i + 1}`
    warnUnknownFields(raw, fields, ROW_PROTECTED_FIELDS, location, warnings)
    const row = pick(raw, fields)
    let invalid = false
    for (const field of section.fields) {
      if (!(field.name in row)) continue
      const value = row[field.name]
      if (value === '' && ['number', 'month'].includes(field.type)) {
        row[field.name] = null
      } else if (value === '' && !['checkbox', 'list'].includes(field.type)) {
        row[field.name] = null
      } else if (!validFieldValue(field.type, value, field.options)) {
        errors.push(`${location}.${field.name} must be ${field.type === 'select' ? `one of ${field.options?.map((o) => o.value).join(', ')}` : field.type}.`)
        invalid = true
      }
    }
    if ('sort_order' in row && (!Number.isInteger(row.sort_order) || Number(row.sort_order) < 0)) {
      errors.push(`${location}.sort_order must be a non-negative integer.`)
      invalid = true
    }
    const missing = required.filter((f) => blank(row[f]))
    if (missing.length) {
      const name = section.itemTitle({ id: '', sort_order: 0, ...row }).replace(/undefined|null/g, '?')
      errors.push(`${location} (${name}) is missing: ${missing.join(', ')}.`)
      invalid = true
    }
    if (invalid) {
      return []
    }
    for (const f of ['start_date', 'end_date', 'date']) {
      if (typeof row[f] === 'string' && /^\d{4}-\d{2}$/.test(row[f])) row[f] = `${row[f]}-01`
    }
    // Supabase bulk inserts need identical keys on every row, so fill in every field.
    for (const f of section.fields) {
      if (f.type === 'list') {
        row[f.name] ??= []
      } else if (f.type === 'checkbox') {
        row[f.name] ??= false
      } else {
        row[f.name] ??= null
      }
    }
    row.sort_order ??= i
    return [row]
  })
}

/** Validates an import file and turns it into rows to insert. Never trusts ids or user ids from the file. */
export function planImport(input: unknown): ImportPlan {
  const errors: string[] = []
  const warnings: string[] = []
  if (!isRecord(input)) return { profile: null, rows: [], errors: ['The JSON root must be an object.'], warnings }
  const data = input
  warnUnknownFields(data, PROFILE_IMPORT_KEYS, [], 'Import', warnings)
  if ('version' in data && data.version !== 1) errors.push('version must be 1.')
  let profile: Record<string, unknown> | null = null
  if (data.profile != null) {
    if (!isRecord(data.profile)) {
      errors.push('"profile" must be an object.')
    } else {
      warnUnknownFields(data.profile, PROFILE_FIELDS, PROFILE_PROTECTED_FIELDS, 'Profile', warnings)
      profile = {}
      for (const [field, value] of Object.entries(pick(data.profile, PROFILE_FIELDS))) {
        let valid = false
        if (value === null || value === '') {
          valid = field !== 'links'
          if (value === '') profile[field] = null
        } else if (PROFILE_FIELD_TYPES[field] === 'string') {
          valid = typeof value === 'string'
        } else if (field === 'links') {
          valid = isRecord(value) && Object.values(value).every((item) => typeof item === 'string')
        } else if (field === 'requires_sponsorship' || field === 'willing_to_relocate') {
          valid = typeof value === 'boolean'
        } else if (field === 'preferred_work_mode') {
          valid = ['remote', 'hybrid', 'onsite', 'flexible'].includes(String(value))
        } else if (field === 'resume_page_limit') {
          valid = Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 3
        }
        if (!valid) errors.push(`Profile.${field} has an invalid value; expected ${PROFILE_FIELD_TYPES[field]}.`)
        else if (value !== '') profile[field] = value
      }
    }
  }
  const rows: ImportPlan['rows'] = SECTIONS.map((section) => ({
    table: section.table,
    rows: sectionRows(section, data[section.table], errors, warnings),
  }))
  if (data.saved_answers != null && !Array.isArray(data.saved_answers)) {
    errors.push('"saved_answers" must be a list.')
  } else if (Array.isArray(data.saved_answers)) {
    const savedAnswers: Record<string, unknown>[] = []
    data.saved_answers.forEach((raw, i) => {
      if (!isRecord(raw)) {
        errors.push(`Saved answers #${i + 1} is not an object.`)
        return
      }
      warnUnknownFields(raw, SAVED_ANSWER_FIELDS, ROW_PROTECTED_FIELDS, `Saved answers #${i + 1}`, warnings)
      const row = pick(raw, SAVED_ANSWER_FIELDS)
      if (typeof row.question !== 'string' || !row.question.trim() || typeof row.answer !== 'string' || !row.answer.trim()) {
        errors.push(`Saved answers #${i + 1} must include a question and answer as strings.`)
        return
      }
      const invalid = SAVED_ANSWER_FIELDS.filter((field) => field !== 'question' && field !== 'answer'
        && row[field] != null && typeof row[field] !== 'string')
      if (invalid.length) {
        errors.push(`Saved answers #${i + 1} fields must be strings: ${invalid.join(', ')}.`)
        return
      }
      savedAnswers.push(Object.fromEntries(SAVED_ANSWER_FIELDS.map((field) => [field, row[field] ?? null])))
    })
    rows.push({
      table: 'saved_answers',
      rows: savedAnswers,
    })
  }
  return { profile: profile && Object.keys(profile).length ? profile : null, rows, errors, warnings }
}

export const byteLength = (text: string) => {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).byteLength
  if (typeof Buffer !== 'undefined') return Buffer.byteLength(text, 'utf8')
  return text.length
}

export function parseImportJson(text: string): ImportPlan {
  if (byteLength(text) > MAX_PROFILE_IMPORT_BYTES) {
    throw new Error('JSON files must be 1 MB or smaller.')
  }
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Invalid JSON syntax.'
    throw new Error(`Could not parse JSON: ${detail}`)
  }
  return planImport(data)
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
