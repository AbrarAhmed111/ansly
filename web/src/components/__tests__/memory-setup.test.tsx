/**
 * @jest-environment jsdom
 */
import type { MemoryItem, MemoryResponse } from '@ansly/types'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import MemoryPage from '@/app/(app)/memory/page'
import SetupPage from '@/app/(app)/setup/page'
import { confirmMemory, deleteMemory, getMasterResume, getMemory, resolveMemoryConflict, saveMissing, updateMemory } from '@/lib/api'
import { loadFullProfile } from '@/lib/profile'

jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }))
jest.mock('@/lib/api', () => ({
  getMemory: jest.fn(),
  updateMemory: jest.fn(),
  confirmMemory: jest.fn(),
  deleteMemory: jest.fn(),
  resolveMemoryConflict: jest.fn(),
  getMasterResume: jest.fn(),
  saveMissing: jest.fn(),
  trackEvent: jest.fn(() => Promise.resolve(null)),
}))
jest.mock('@/lib/profile', () => ({ loadFullProfile: jest.fn() }))
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => ({ select: () => ({ in: () => ({ limit: async () => ({ data: [] }) }) }) }),
  }),
}))

const item = (over: Partial<MemoryItem>): MemoryItem => ({
  id: 'f1', key: 'travel_willingness', label: 'Willingness to travel', group: 'Preferences', value: 'Yes', valueType: 'choice',
  options: ['Yes', 'No', 'Occasionally'], scope: 'category', company: null, sourceType: 'ask_and_learn',
  sourceLabel: 'Acme · Backend Engineer', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
  lastConfirmedAt: '2026-10-01T00:00:00Z', status: 'active', stale: false, answersDirectly: true, ...over,
})

const MEMORY: MemoryResponse = {
  items: [
    item({}),
    item({ id: 'profile:notice_period', key: 'notice_period', label: 'Notice period', group: 'Availability', value: '2 weeks',
      valueType: 'text', options: null, scope: 'global', sourceType: 'profile', sourceLabel: 'Profile → Application preferences' }),
    item({ id: 'f2', key: 'work_mode', label: 'Preferred work arrangement', value: 'Remote', stale: true, lastConfirmedAt: '2026-01-01T00:00:00Z' }),
    item({ id: 'f3', key: 'salary_expectation', label: 'Salary expectation', group: 'Compensation', value: '$100k', status: 'superseded' }),
  ],
  conflicts: [{ key: 'requires_sponsorship', label: 'Visa sponsorship', winner: 'No', winnerSource: 'profile', other: 'Yes',
    otherSource: 'memory', otherId: 'f9', rule: 'Your profile is used: it always wins over older Application Memory.' }],
  groups: ['Personal', 'Availability', 'Preferences', 'Compensation'],
  counts: { learned: 2, preferences: 2, profile: 1, stale: 1, conflicts: 1 },
}

const mocked = <T,>(fn: T) => fn as unknown as jest.Mock

beforeEach(() => jest.clearAllMocks())
// jsdom has no <dialog> modal API: the confirm dialog needs it.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
})

describe('Application Memory page', () => {
  beforeEach(() => mocked(getMemory).mockResolvedValue(MEMORY))

  it('shows facts by group with provenance, scope and counts', async () => {
    render(<MemoryPage />)
    expect(await screen.findByText('Willingness to travel')).toBeTruthy()
    expect(screen.getAllByText(/Asked during an application to Acme · Backend Engineer/).length).toBe(2)
    expect(screen.getByText('Profile → Application preferences', { exact: false })).toBeTruthy()
    expect(screen.getAllByText('General preference').length).toBeGreaterThan(0)
    expect(screen.getByText('Availability')).toBeTruthy()
    // Retired facts are kept out of the main list.
    expect(screen.queryByText('Salary expectation')).toBeNull()
  })

  it('asks about stale preferences and confirms them', async () => {
    mocked(confirmMemory).mockResolvedValue(item({ id: 'f2' }))
    render(<MemoryPage />)
    expect(await screen.findByText(/Still accurate\?/)).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Yes' })))
    expect(confirmMemory).toHaveBeenCalledWith('f2')
  })

  it('edits a fact inline with its choices and scope', async () => {
    mocked(updateMemory).mockResolvedValue(item({ value: 'No' }))
    render(<MemoryPage />)
    await screen.findByText('Willingness to travel')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Edit Willingness to travel' })))
    fireEvent.click(screen.getByRole('radio', { name: 'No' }))
    fireEvent.change(screen.getByLabelText('Applies to'), { target: { value: 'global' } })
    const editor = screen.getByRole('radiogroup', { name: 'Willingness to travel' }).parentElement!
    await act(async () => fireEvent.click(within(editor).getByRole('button', { name: 'Update' })))
    expect(updateMemory).toHaveBeenCalledWith('f1', { value: 'No', scope: 'global', company: null })
  })

  it('surfaces conflicts with the rule and resolves them', async () => {
    mocked(resolveMemoryConflict).mockResolvedValue({ ...MEMORY, conflicts: [] })
    render(<MemoryPage />)
    expect(await screen.findByText(/Ansly found conflicting information: Visa sponsorship/)).toBeTruthy()
    expect(screen.getByText(/always wins over older Application Memory/)).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Use profile' })))
    expect(resolveMemoryConflict).toHaveBeenCalledWith({ id: 'f9', use: 'profile' })
    await waitFor(() => expect(screen.queryByText(/conflicting information/)).toBeNull())
  })

  it('forgets a fact after confirmation', async () => {
    mocked(deleteMemory).mockResolvedValue(undefined)
    render(<MemoryPage />)
    await screen.findByText('Willingness to travel')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Forget Willingness to travel' })))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Forget' })))
    expect(deleteMemory).toHaveBeenCalledWith('f1')
  })
})

const EMPTY_PROFILE = { profile: null, experiences: [], projects: [], skills: [], education: [], achievements: [], profile_facts: [] }

describe('Setup page', () => {
  beforeEach(() => {
    mocked(loadFullProfile).mockResolvedValue(EMPTY_PROFILE)
    mocked(getMasterResume).mockResolvedValue({ resume: null, discrepancies: [] })
  })

  it('starts resume-first with progress and skippable steps', async () => {
    render(<SetupPage />)
    expect(await screen.findByText('Let’s build your profile')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Upload resume/ }).getAttribute('href')).toBe('/resume/upload?next=/setup')
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('17')
    expect(screen.getByText(/Never submits automatically/)).toBeTruthy()
    fireEvent.click(screen.getAllByText('Skip for now')[0]!)
    expect(JSON.parse(localStorage.getItem('ansly:setup-skipped')!)).toEqual(['resume'])
  })

  it('saves the preferences a resume never has, as onboarding answers', async () => {
    mocked(saveMissing).mockResolvedValue({ saved: [] })
    render(<SetupPage />)
    await screen.findByText('Answer what a resume doesn’t say')
    fireEvent.click(screen.getByRole('radio', { name: 'Depends on the role' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Remote' }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save preferences' })))
    expect(saveMissing).toHaveBeenCalledWith({
      source: 'onboarding',
      items: [
        { key: 'willing_to_relocate', target: { type: 'profile_field', field: 'willing_to_relocate' }, value: 'Depends on the role', scope: 'global' },
        { key: 'preferred_work_mode', target: { type: 'profile_field', field: 'preferred_work_mode' }, value: 'Remote', scope: 'global' },
      ],
    })
  })

  it('knows the extension is connected from its bridge', async () => {
    render(<SetupPage />)
    await screen.findByText('Connect the extension')
    expect(screen.getByRole('link', { name: 'Install and connect' })).toBeTruthy()
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        source: window, origin: window.location.origin,
        data: { source: 'ansly-extension', type: 'ANSLY_STATUS', connected: true, version: '1', email: null },
      }))
    })
    expect(screen.queryByRole('link', { name: 'Install and connect' })).toBeNull()
  })
})
