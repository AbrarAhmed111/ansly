import { profileCompleteness, type FullProfile } from '@ansly/types'
import seed from '../../../../supabase/seed/profile.seed.json'
import { planImport } from '../profile-import'
import { companyKey, fileStem, linesToBullets, masterPath, resumeFileProblem, stepState, wordDiff } from '../resume'
import { safeNext } from '../safe-next'
import { sectionBySlug, toFormValues, toRow, type Row } from '../sections'
import { compactNumber, tokenUsage } from '../usage'

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
  const empty: FullProfile = { profile: null, experiences: [], projects: [], skills: [], education: [], achievements: [], profile_facts: [] }

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
      profile_facts: [{}],
    } as unknown as FullProfile
    expect(profileCompleteness(full).percent).toBe(100)
    const partial = { ...full, achievements: [], education: [] } as FullProfile
    expect(profileCompleteness(partial).percent).toBe(90)
  })

  it("doesn't count declined skills", () => {
    const skills = Array.from({ length: 5 }, (_, i) => ({ name: `s${i}`, level: i === 0 ? 'none' : null }))
    const item = profileCompleteness({ ...empty, skills } as unknown as FullProfile).items.find((i) => i.key === 'skills')
    expect(item?.done).toBe(false)
  })
})

describe('resume helpers', () => {
  it('accepts only Word (.docx) files, with a clear reason otherwise', () => {
    expect(resumeFileProblem({ name: 'cv.DOCX', type: '', size: 1000 })).toBeNull()
    expect(resumeFileProblem({ name: 'Resume.PDF', type: '', size: 1000 })).toMatch(/PDF resumes aren’t supported.*\.docx/)
    expect(resumeFileProblem({ name: 'cv', type: 'application/pdf', size: 1000 })).toMatch(/PDF/)
    expect(resumeFileProblem({ name: 'cv.doc', type: 'application/msword', size: 1000 })).toMatch(/older Word/)
    expect(resumeFileProblem({ name: 'cv.pages', type: '', size: 1000 })).toBe('Upload your resume as a Word (.docx) file.')
    expect(resumeFileProblem({ name: 'cv.docx', type: '', size: 11 * 1024 * 1024 })).toMatch(/over 10 MB/)
    expect(fileStem('Sam Rivera Resume.docx')).toBe('Sam Rivera Resume')
  })

  it('keeps uploads under the user’s own masters folder', () => {
    expect(masterPath('u1', 'My Resume (final).pdf', 42)).toBe('u1/masters/42-My_Resume_final_.pdf')
    expect(masterPath('u1', '../../etc/passwd', 1).startsWith('u1/masters/1-')).toBe(true)
    expect(masterPath('u1', '../../etc/passwd', 1)).not.toContain('..')
  })

  it('keeps bullet ids by position when editing lines', () => {
    const previous = [
      { id: 'exp_1_b1', text: 'Old one' },
      { id: 'exp_1_b2', text: 'Old two' },
    ]
    expect(linesToBullets('• New one\n\n- New two\nNew three', previous, 'exp_1')).toEqual([
      { id: 'exp_1_b1', text: 'New one' },
      { id: 'exp_1_b2', text: 'New two' },
      { id: 'exp_1_b3', text: 'New three' },
    ])
  })

  it('diffs words', () => {
    const parts = wordDiff('Built web apps with React.', 'Built SaaS web apps with React and TypeScript.')
    expect(parts.filter((p) => p.kind === 'added').map((p) => p.text.trim())).toEqual(['SaaS', 'React and TypeScript.'])
    expect(parts.filter((p) => p.kind === 'removed').map((p) => p.text.trim())).toEqual(['React.'])
    expect(parts.map((p) => (p.kind === 'removed' ? '' : p.text)).join('')).toBe('Built SaaS web apps with React and TypeScript.')
  })

  it('matches company names the way the API does', () => {
    expect(companyKey('Nizam, LLC.')).toBe(companyKey('Nizam LLC'))
    expect(companyKey('Northwind Labs Inc')).toBe('northwindlabs')
  })

  it('tracks tailoring progress', () => {
    expect(stepState('matching', 'analyzing')).toBe('done')
    expect(stepState('matching', 'matching')).toBe('active')
    expect(stepState('matching', 'rendering')).toBe('idle')
    expect(stepState('queued', 'analyzing')).toBe('active')
    expect(stepState('ready', 'rendering')).toBe('done')
  })
})

describe('tokenUsage', () => {
  const now = new Date(2026, 9, 3, 15, 0)
  const at = (daysAgo: number, hour = 10) => new Date(2026, 9, 3 - daysAgo, hour).toISOString()

  it('totals today and averages from the first day with usage', () => {
    const usage = tokenUsage(
      [
        { created_at: at(0), tokens: 1000 },
        { created_at: at(0, 1), tokens: 500 },
        { created_at: at(3), tokens: 2500 },
        { created_at: at(1), tokens: null },
      ],
      now,
    )
    expect(usage).toEqual({ today: 1500, perDay: 1000, days: 4 })
  })

  it('ignores usage outside the window and handles no usage', () => {
    expect(tokenUsage([{ created_at: at(45), tokens: 9000 }], now)).toEqual({ today: 0, perDay: 0, days: 1 })
  })

  it('formats large numbers compactly', () => {
    expect([compactNumber(950), compactNumber(12_400), compactNumber(2_300_000)]).toEqual(['950', '12.4K', '2.3M'])
  })
})
