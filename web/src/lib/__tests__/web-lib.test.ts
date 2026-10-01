import { profileCompleteness, type FullProfile } from '@ansly/types'
import seed from '../../../../supabase/seed/profile.seed.json'
import { planImport } from '../profile-import'
import { safeNext } from '../safe-next'
import { sectionBySlug, toFormValues, toRow, type Row } from '../sections'

describe('safeNext', () => {
  it.each([
    ['/profile/skills', '/profile/skills'],
    [null, '/dashboard'],
    ['https://evil.example', '/dashboard'],
    ['//evil.example', '/dashboard'],
    ['/\\evil.example', '/dashboard'],
  ])('%s -> %s', (input, expected) => {
    expect(safeNext(input)).toBe(expected)
  })
})

describe('section form conversion', () => {
  const experience = sectionBySlug('experience')!

  it('converts form values to a row', () => {
    const row = toRow(experience, {
      title: ' Engineer ',
      company: 'Acme',
      location: '',
      start_date: '2023-01',
      end_date: '2024-05',
      is_current: true,
      highlights: 'Shipped X\n\nCut costs by 20%',
      technologies: 'React, Next.js,TypeScript',
    })
    expect(row).toMatchObject({
      title: 'Engineer',
      location: null,
      start_date: '2023-01-01',
      end_date: null, // current roles have no end date
      is_current: true,
      highlights: ['Shipped X', 'Cut costs by 20%'],
      technologies: ['React', 'Next.js', 'TypeScript'],
    })
  })

  it('round-trips a row through the form', () => {
    const row = { id: '1', sort_order: 0, title: 'Engineer', company: 'Acme', start_date: '2023-01-01', end_date: null,
      is_current: false, technologies: ['React', 'Go'], highlights: [] } as unknown as Row
    const values = toFormValues(experience, row)
    expect(values).toMatchObject({ start_date: '2023-01', technologies: 'React\nGo', is_current: false })
    expect(toRow(experience, values)).toMatchObject({ start_date: '2023-01-01', technologies: ['React', 'Go'] })
  })

  it('parses skill years as numbers', () => {
    const skills = sectionBySlug('skills')!
    expect(toRow(skills, { name: 'Go', years: '2.5' }).years).toBe(2.5)
    expect(toRow(skills, { name: 'Go', years: '' }).years).toBeNull()
  })
})

const sectionRowsKeys = (plan: ReturnType<typeof planImport>, table: string) =>
  plan.rows.find((r) => r.table === table)!.rows.map((r) => Object.keys(r).sort().join(','))

describe('planImport', () => {
  it('imports valid rows, skips incomplete ones, and ignores ids', () => {
    const plan = planImport({
      profile: { full_name: 'Abrar Ahmed', headline: '', _note: 'ignored', id: 'evil' } as Record<string, unknown>,
      experiences: [
        { company: 'WebWhiz', title: '', start_date: '' },
        { company: 'Acme', title: 'Engineer', start_date: '2022-03', user_id: 'someone-else', id: 'x' },
      ],
      skills: [{ name: 'React' }, { name: '' }],
      saved_answers: [{ question: 'Q', answer: 'A', use_count: 99 }],
    })
    expect(plan.profile).toEqual({ full_name: 'Abrar Ahmed', headline: null })
    const experiences = plan.rows.find((r) => r.table === 'experiences')!.rows
    expect(experiences).toHaveLength(1)
    expect(experiences[0]).not.toHaveProperty('user_id')
    expect(experiences[0]).not.toHaveProperty('id')
    expect(experiences[0].start_date).toBe('2022-03-01')
    expect(plan.rows.find((r) => r.table === 'saved_answers')!.rows).toEqual([
      { question: 'Q', answer: 'A', category: null, company: null, role: null },
    ])
    // Every row in a table has the same keys (required for Supabase bulk inserts).
    const skills = sectionRowsKeys(plan, 'skills')
    expect(new Set(skills).size).toBeLessThanOrEqual(1)
    expect(experiences[0]).toMatchObject({ highlights: [], technologies: [], is_current: false, location: null })
    expect(plan.errors).toEqual([
      'Experience #1 (? at WebWhiz) is missing: title.',
      'Skills #2 (?) is missing: name.',
    ])
  })

  it('accepts the bundled seed file', () => {
    const plan = planImport(seed)
    expect(plan.rows.find((r) => r.table === 'skills')!.rows).toHaveLength(9)
    expect(plan.rows.find((r) => r.table === 'projects')!.rows).toHaveLength(3)
    // Experiences need real titles before they can be imported.
    expect(plan.errors.filter((e) => e.startsWith('Experience'))).toHaveLength(2)
  })
})

describe('profileCompleteness', () => {
  const empty: FullProfile = { profile: null, experiences: [], projects: [], skills: [], education: [], achievements: [] }

  it('is 0 for an empty profile', () => {
    expect(profileCompleteness(empty).percent).toBe(0)
  })

  it('weights sections and reaches 100 when complete', () => {
    const full = {
      profile: { full_name: 'A', headline: 'B', location: 'C', summary: 'x'.repeat(100), links: { github: 'g' } },
      experiences: [{ description: 'did things', highlights: [] }],
      projects: [{ description: 'a project' }],
      skills: Array.from({ length: 5 }, (_, i) => ({ name: `s${i}` })),
      education: [{}],
      achievements: [{}],
    } as unknown as FullProfile
    expect(profileCompleteness(full).percent).toBe(100)
    const partial = { ...full, achievements: [], education: [] } as FullProfile
    expect(profileCompleteness(partial).percent).toBe(90)
  })
})
