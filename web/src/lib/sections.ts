import type { ProfileSection } from '@ansly/types'

export type FieldType = 'text' | 'textarea' | 'url' | 'month' | 'checkbox' | 'list' | 'select' | 'number'

export interface FieldDef {
  name: string
  label: string
  type: FieldType
  required?: boolean
  placeholder?: string
  help?: string
  options?: { value: string; label: string }[]
  /** Spans both columns of the form grid. */
  wide?: boolean
  /** Edits a list as chips instead of one item per line. */
  tags?: boolean
}

export type Row = Record<string, unknown> & { id: string; sort_order: number }

export interface SectionDef {
  slug: string
  table: ProfileSection
  title: string
  singular: string
  description: string
  fields: FieldDef[]
  itemTitle: (row: Row) => string
  itemSubtitle: (row: Row) => string
}

const month = (value: unknown) => (typeof value === 'string' && value ? value.slice(0, 7) : '')
const range = (row: Row) => {
  const start = month(row.start_date)
  const end = row.is_current ? 'Present' : month(row.end_date)
  return start || end ? `${start || '?'} – ${end || '?'}` : ''
}
const join = (...parts: unknown[]) => parts.filter((p) => typeof p === 'string' && p).join(' · ')

const TECH_HELP = 'Press Enter or comma after each one. Ansly only claims skills you list somewhere in your profile.'

export const SECTIONS: SectionDef[] = [
  {
    slug: 'experience',
    table: 'experiences',
    title: 'Experience',
    singular: 'experience',
    description: 'Roles you have held. Specific descriptions and highlights make for specific answers.',
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Full Stack Engineer' },
      { name: 'company', label: 'Company', type: 'text', required: true },
      { name: 'location', label: 'Location', type: 'text', placeholder: 'Remote' },
      { name: 'employment_type', label: 'Employment type', type: 'select', options: [
        { value: 'full-time', label: 'Full-time' },
        { value: 'part-time', label: 'Part-time' },
        { value: 'contract', label: 'Contract' },
        { value: 'freelance', label: 'Freelance' },
        { value: 'internship', label: 'Internship' },
      ] },
      { name: 'start_date', label: 'Start', type: 'month' },
      { name: 'end_date', label: 'End', type: 'month' },
      { name: 'is_current', label: 'I currently work here', type: 'checkbox', wide: true },
      { name: 'description', label: 'What you did', type: 'textarea', wide: true,
        help: 'Responsibilities, what you built, who you worked with.' },
      { name: 'highlights', label: 'Highlights', type: 'list', wide: true,
        help: 'Concrete outcomes, one per line, e.g. "Cut page load time by 40%".' },
      { name: 'technologies', label: 'Technologies', type: 'list', wide: true, tags: true, placeholder: 'React, PostgreSQL…', help: TECH_HELP },
    ],
    itemTitle: (r) => `${r.title} at ${r.company}`,
    itemSubtitle: (r) => join(range(r), r.location),
  },
  {
    slug: 'projects',
    table: 'projects',
    title: 'Projects',
    singular: 'project',
    description: 'Products, open-source work and side projects.',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'role', label: 'Your role', type: 'text', placeholder: 'Creator, Lead engineer…' },
      { name: 'url', label: 'URL', type: 'url' },
      { name: 'repo_url', label: 'Repository', type: 'url' },
      { name: 'start_date', label: 'Start', type: 'month' },
      { name: 'end_date', label: 'End', type: 'month' },
      { name: 'description', label: 'Description', type: 'textarea', wide: true,
        help: 'What it is, what problem it solves, and what you built.' },
      { name: 'highlights', label: 'Highlights', type: 'list', wide: true, help: 'Outcomes, users, challenges solved — one per line.' },
      { name: 'technologies', label: 'Technologies', type: 'list', wide: true, tags: true, placeholder: 'React, PostgreSQL…', help: TECH_HELP },
    ],
    itemTitle: (r) => String(r.name),
    itemSubtitle: (r) => join(r.role, range(r)),
  },
  {
    slug: 'skills',
    table: 'skills',
    title: 'Skills',
    singular: 'skill',
    description: 'Ansly says "not in your profile" for any technology that is not listed here or in your experience and projects.',
    fields: [
      { name: 'name', label: 'Skill', type: 'text', required: true, placeholder: 'TypeScript' },
      { name: 'category', label: 'Category', type: 'select', options: [
        { value: 'language', label: 'Language' },
        { value: 'framework', label: 'Framework / library' },
        { value: 'database', label: 'Database' },
        { value: 'cloud', label: 'Cloud / DevOps' },
        { value: 'tool', label: 'Tool' },
        { value: 'ai', label: 'AI / ML' },
        { value: 'soft', label: 'Soft skill' },
        { value: 'other', label: 'Other' },
      ] },
      { name: 'level', label: 'Level', type: 'select', options: [
        { value: 'none', label: "None — I don't have this skill" },
        { value: 'beginner', label: 'Beginner' },
        { value: 'intermediate', label: 'Intermediate' },
        { value: 'advanced', label: 'Advanced' },
        { value: 'expert', label: 'Expert' },
      ] },
      { name: 'years', label: 'Years', type: 'number', help: 'Only used if a question asks for years.' },
    ],
    itemTitle: (r) => String(r.name),
    itemSubtitle: (r) => join(r.category, r.level, r.years ? `${r.years} yrs` : ''),
  },
  {
    slug: 'education',
    table: 'education',
    title: 'Education',
    singular: 'education entry',
    description: 'Degrees, bootcamps and certifications.',
    fields: [
      { name: 'institution', label: 'Institution', type: 'text', required: true },
      { name: 'degree', label: 'Degree', type: 'text', placeholder: 'BSc' },
      { name: 'field_of_study', label: 'Field of study', type: 'text' },
      { name: 'grade', label: 'Grade', type: 'text' },
      { name: 'start_date', label: 'Start', type: 'month' },
      { name: 'end_date', label: 'End', type: 'month' },
      { name: 'description', label: 'Notes', type: 'textarea', wide: true },
    ],
    itemTitle: (r) => join(r.degree, r.field_of_study) || String(r.institution),
    itemSubtitle: (r) => join(r.institution, range(r)),
  },
  {
    slug: 'achievements',
    table: 'achievements',
    title: 'Achievements',
    singular: 'achievement',
    description: 'Awards, recognitions, publications, talks and other wins.',
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true },
      { name: 'date', label: 'Date', type: 'month' },
      { name: 'url', label: 'URL', type: 'url' },
      { name: 'description', label: 'Description', type: 'textarea', wide: true },
    ],
    itemTitle: (r) => String(r.title),
    itemSubtitle: (r) => month(r.date),
  },
  {
    slug: 'additional',
    table: 'profile_facts',
    title: 'Additional details',
    singular: 'detail',
    description:
      'Answers you gave when Ansly asked for something your profile was missing. Ansly uses them like the rest of your profile.',
    fields: [
      { name: 'prompt', label: 'Question', type: 'text', required: true, wide: true, placeholder: 'Describe a time you led a team' },
      { name: 'answer', label: 'Your answer', type: 'textarea', required: true, wide: true,
        help: 'Facts only: Ansly treats this as true about you.' },
      { name: 'category', label: 'Topic', type: 'select', options: [
        { value: 'general', label: 'General' },
        { value: 'leadership', label: 'Leadership' },
        { value: 'challenge', label: 'Challenges' },
        { value: 'conflict', label: 'Conflict' },
        { value: 'failure', label: 'Failure / mistakes' },
        { value: 'motivation', label: 'Motivation' },
        { value: 'strengths', label: 'Strengths' },
        { value: 'weakness', label: 'Weaknesses' },
        { value: 'project', label: 'Projects' },
        { value: 'experience', label: 'Experience' },
        { value: 'other', label: 'Other' },
      ] },
    ],
    itemTitle: (r) => String(r.prompt),
    itemSubtitle: (r) => join(r.category === 'general' ? '' : r.category, r.source === 'extension' ? 'From the extension' : ''),
  },
]

export const sectionBySlug = (slug: string) => SECTIONS.find((s) => s.slug === slug)

/** Converts form values to a row for Supabase. */
export function toRow(section: SectionDef, values: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  for (const field of section.fields) {
    const value = values[field.name]
    switch (field.type) {
      case 'checkbox':
        row[field.name] = Boolean(value)
        break
      case 'list':
        row[field.name] = String(value ?? '')
          .split(/\n|,(?![^(]*\))/)
          .map((s) => s.trim())
          .filter(Boolean)
        break
      case 'month':
        row[field.name] = value ? `${value}-01` : null
        break
      case 'number':
        row[field.name] = value === '' || value == null ? null : Number(value)
        break
      default:
        row[field.name] = typeof value === 'string' && value.trim() ? value.trim() : null
    }
  }
  if ('is_current' in row && row.is_current) row.end_date = null
  return row
}

/** Converts a Supabase row to form values. */
export function toFormValues(section: SectionDef, row?: Row): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const field of section.fields) {
    const value = row?.[field.name]
    switch (field.type) {
      case 'checkbox':
        values[field.name] = Boolean(value)
        break
      case 'list':
        values[field.name] = Array.isArray(value) ? value.join('\n') : ''
        break
      case 'month':
        values[field.name] = typeof value === 'string' ? value.slice(0, 7) : ''
        break
      default:
        values[field.name] = value ?? ''
    }
  }
  return values
}
