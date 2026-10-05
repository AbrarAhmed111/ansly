import type { FullProfile, StructuredResume } from '@ansly/types'
import { timeAgo } from '../format'
import { countPlan, planResumeImport, toDate } from '../resume-profile'

const RESUME: StructuredResume = {
  schemaVersion: 1,
  contact: {
    name: 'Sam Rivera', headline: 'Full-stack engineer', email: 'sam@example.com', phone: null, location: 'Lahore',
    links: [{ label: 'GitHub', url: 'https://github.com/sam' }, { label: 'LinkedIn', url: 'https://linkedin.com/in/sam' }],
  },
  summary: 'Builds web products.',
  experience: [
    { id: 'e1', company: 'Acme Labs', title: 'Software Engineer', location: null, startDate: '2023-01', endDate: null, isCurrent: true,
      bullets: [{ id: 'b1', text: 'Built the dashboard' }], technologies: ['Next.js'] },
    { id: 'e2', company: 'Beta Studio', title: 'Frontend Developer', location: null, startDate: '2021', endDate: 'Dec 2022', isCurrent: false,
      bullets: [], technologies: [] },
  ],
  projects: [{ id: 'p1', name: 'TaskFlow', role: null, url: null, startDate: null, endDate: null, bullets: [{ id: 'pb', text: 'Task app' }], technologies: ['React'] }],
  skills: [{ id: 's', label: 'Languages', items: ['TypeScript', 'Python', 'typescript'] }],
  education: [{ id: 'ed', institution: 'State University', degree: 'BSc', fieldOfStudy: 'CS', startDate: null, endDate: '2020-06', grade: null, bullets: [] }],
  achievements: [],
  certifications: [{ id: 'c', name: 'AWS Certified Developer', issuer: 'Amazon', date: '2022-05', url: null }],
  customSections: [],
}

const EMPTY: FullProfile = {
  profile: null, experiences: [], projects: [], skills: [], education: [], achievements: [], profile_facts: [],
} as unknown as FullProfile

describe('resume-first onboarding', () => {
  it('builds a profile from the resume', () => {
    const plan = planResumeImport(RESUME, EMPTY)
    expect(countPlan(plan)).toEqual({ experiences: 2, projects: 1, skills: 2, education: 1, achievements: 1, profileFields: 6 })
    expect(plan.profile.links).toEqual({ github: 'https://github.com/sam', linkedin: 'https://linkedin.com/in/sam' })
    expect(plan.experiences[0]).toMatchObject({ company: 'Acme Labs', start_date: '2023-01-01', end_date: null, is_current: true, highlights: ['Built the dashboard'] })
    expect(plan.experiences[1]).toMatchObject({ start_date: '2021-01-01', end_date: '2022-12-01' })
    expect(plan.achievements[0]).toMatchObject({ title: 'AWS Certified Developer', description: 'Issued by Amazon' })
  })

  it('never overwrites or duplicates what the profile has', () => {
    const current = {
      ...EMPTY,
      profile: { full_name: 'Samuel R.', headline: '', summary: null, links: { github: 'https://github.com/other' } },
      experiences: [{ company: 'ACME LABS', title: 'Software engineer' }],
      skills: [{ name: 'Python' }],
    } as unknown as FullProfile
    const plan = planResumeImport(RESUME, current)
    expect(plan.profile.full_name).toBeUndefined()
    expect(plan.profile.headline).toBe('Full-stack engineer')
    expect(plan.profile.links).toEqual({ github: 'https://github.com/other', linkedin: 'https://linkedin.com/in/sam' })
    expect(plan.experiences.map((e) => e.company)).toEqual(['Beta Studio'])
    expect(plan.skills.map((s) => s.name)).toEqual(['TypeScript'])
  })

  it.each([
    ['2021-03', '2021-03-01'],
    ['2021', '2021-01-01'],
    ['Mar 2021', '2021-03-01'],
    ['Present', null],
    [null, null],
  ])('reads the date %s', (input, expected) => {
    expect(toDate(input)).toBe(expected)
  })
})

describe('timeAgo', () => {
  const now = Date.parse('2026-10-05T12:00:00Z')
  it.each([
    ['2026-10-05T08:00:00Z', 'today'],
    ['2026-09-23T12:00:00Z', '12 days ago'],
    ['2026-02-01T12:00:00Z', '8 months ago'],
    [null, ''],
  ])('%s', (iso, expected) => {
    expect(timeAgo(iso, now)).toBe(expected)
  })
})
