import type { JobPosting, TailoringResponse } from '@ansly/types'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DetectedJob, ExtractResult } from '@/lib/job/detect'
import type { RequestType, Result } from '@/lib/messages'
import { TailorCard } from '../TailorCard'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const responses: Partial<Record<RequestType, Result<unknown>[]>> = {}
const calls: { type: RequestType; payload: unknown }[] = []

vi.mock('@/lib/messages', () => ({
  send: vi.fn(async (type: RequestType, payload: unknown) => {
    calls.push({ type, payload })
    const queue = responses[type]
    return queue?.length ? queue.shift() : { ok: true, data: null }
  }),
}))

const ok = (data: unknown): Result<unknown> => ({ ok: true, data })
const fail = (code: string, message: string): Result<unknown> => ({ ok: false, error: { code, message } } as Result<unknown>)

const JOB: DetectedJob = { title: 'Senior Full Stack Engineer', company: 'Company X', location: null, employmentType: null, description: '', source: 'linkedin' }
const POSTING: JobPosting = { ...JOB, description: 'Requirements…'.repeat(30), url: 'https://www.linkedin.com/jobs/view/1/' }
const MASTER = { resume: { id: 'r1', parseStatus: 'parsed' }, discrepancies: [] }
const READY: TailoringResponse = {
  id: 't1', status: 'ready', jobContextId: 'j1', jobTitle: JOB.title, company: JOB.company,
  summary: { analyzed: 18, supported: 14, partial: 2, unsupported: 2 },
  changes: [{ section: 'experience', action: 'rewrite_bullet', label: '3 experience bullets rewritten' },
    { section: 'projects', action: 'reorder', label: 'OnTask moved higher' }],
  unsupportedRequirements: ['Kubernetes', 'AWS EKS'], warnings: [], pipelineVersion: '1.2.0', error: null,
  createdAt: '2026-10-02T00:00:00Z', detail: null,
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  calls.length = 0
  for (const key of Object.keys(responses)) delete responses[key as RequestType]
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

async function render(extract: () => ExtractResult = () => ({ ok: true, job: POSTING })) {
  const onDismiss = vi.fn()
  await act(async () => root.render(<TailorCard job={JOB} extract={extract} stacked={false} onDismiss={onDismiss} />))
  return { onDismiss }
}

const button = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === label || b.getAttribute('aria-label')?.startsWith(label))

async function click(label: string) {
  const el = button(label)
  if (!el) throw new Error(`No button "${label}" in: ${container.textContent}`)
  await act(async () => el.click())
}

describe('TailorCard', () => {
  it('starts as a small pill and never reads the job until Tailor Resume', async () => {
    const extract = vi.fn((): ExtractResult => ({ ok: true, job: POSTING }))
    await render(extract)
    expect(container.textContent).toContain('Tailor resume')
    await click('Tailor your resume for')
    expect(container.textContent).toContain('Tailor your resume for this job')
    expect(extract).not.toHaveBeenCalled()
    expect(calls).toEqual([])
  })

  it('tailors, shows progress, and ends with the result card', async () => {
    responses.getMasterResume = [ok(MASTER)]
    responses.analyzeJob = [ok({ jobContextId: 'j1', analysis: { mustHave: new Array(12).fill({}), niceToHave: new Array(6).fill({}) } })]
    responses.startTailoring = [ok({ id: 't1', status: 'queued' })]
    responses.getTailoring = [ok({ ...READY, status: 'matching' }), ok(READY)]
    await render()
    await click('Tailor your resume for')
    await click('Tailor Resume')
    expect(container.textContent).toContain('18 requirements detected')
    expect(calls.find((c) => c.type === 'analyzeJob')?.payload).toEqual({ job: POSTING })

    await act(async () => vi.advanceTimersByTime(2000))
    expect(container.textContent).toContain('Matching requirements with your experience…')
    await act(async () => vi.advanceTimersByTime(2000))
    expect(container.textContent).toContain('Your resume is ready.')
    expect(container.textContent).toContain('Supported by your experience14')
    expect(container.textContent).toContain('OnTask moved higher')
    expect(container.textContent).toContain('Some requirements aren’t supported by your profile. Review before downloading.')

    expect(container.textContent).toContain('Your original formatting has been preserved.')
    await click('Download DOCX')
    expect(calls.at(-1)).toEqual({ type: 'downloadTailoring', payload: { id: 't1' } })
    await click('Preview Resume')
    expect(calls.at(-1)).toEqual({ type: 'openWebApp', payload: { path: '/resume/t1' } })
    await click('Download PDF')
    expect(calls.at(-1)).toEqual({ type: 'openWebApp', payload: { path: '/resume/t1?pdf=1' } })
  })

  it('keeps polling while the status stays the same, with progress that moves', async () => {
    responses.getMasterResume = [ok(MASTER)]
    responses.analyzeJob = [ok({ jobContextId: 'j1', analysis: { mustHave: [], niceToHave: [] } })]
    responses.startTailoring = [ok({ id: 't1', status: 'queued' })]
    responses.getTailoring = [
      ok({ ...READY, status: 'tailoring' }),
      ok({ ...READY, status: 'tailoring' }),
      ok({ ...READY, status: 'tailoring' }),
      ok(READY),
    ]
    await render()
    await click('Tailor your resume for')
    await click('Tailor Resume')
    expect(container.textContent).toContain('Step 2 of 5')

    await act(async () => vi.advanceTimersByTime(2000))
    expect(container.textContent).toContain('Changing your title to fit the role…')
    const first = Number(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow'))
    await act(async () => vi.advanceTimersByTime(2000))
    await act(async () => vi.advanceTimersByTime(2000))
    expect(container.textContent).toContain('Tailoring your summary…')
    expect(Number(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow'))).toBeGreaterThan(first)
    await act(async () => vi.advanceTimersByTime(2000))
    expect(calls.filter((c) => c.type === 'getTailoring')).toHaveLength(4)
    expect(container.textContent).toContain('Your resume is ready.')
  })

  it('asks for a master resume first', async () => {
    responses.getMasterResume = [ok({ resume: null, discrepancies: [] })]
    await render()
    await click('Tailor your resume for')
    await click('Tailor Resume')
    expect(container.textContent).toContain('Upload your master resume as a Word (.docx) file first.')
    await click('Upload Resume')
    expect(calls.at(-1)).toEqual({ type: 'openWebApp', payload: { path: '/resume/upload' } })
    expect(calls.some((c) => c.type === 'analyzeJob')).toBe(false)
  })

  it('sends an unconfirmed master to review', async () => {
    responses.getMasterResume = [ok({ resume: { id: 'r9', parseStatus: 'needs_review' }, discrepancies: [] })]
    await render()
    await click('Tailor your resume for')
    await click('Tailor Resume')
    await click('Review resume')
    expect(calls.at(-1)).toEqual({ type: 'openWebApp', payload: { path: '/resume/upload?id=r9' } })
  })

  it('offers the paste fallback when the description is too short', async () => {
    await render(() => ({ ok: false, reason: 'too_short', partial: { ...JOB, title: 'Engineer' } }))
    await click('Tailor your resume for')
    await click('Tailor Resume')
    expect(container.textContent).toContain('There’s not enough job information to tailor your resume.')
    await click('Paste description')
    const path = (calls.at(-1)?.payload as { path: string }).path
    expect(path.startsWith('/resume/tailor?')).toBe(true)
    expect(new URLSearchParams(path.split('?')[1]).get('title')).toBe('Engineer')
  })

  it('shows the connect prompt when not connected, and a safe message when tailoring fails', async () => {
    responses.getMasterResume = [fail('not_connected', 'Connect Ansly to your account.')]
    await render()
    await click('Tailor your resume for')
    await click('Tailor Resume')
    expect(container.textContent).toContain('Ansly isn’t connected')
    await click('Connect Ansly')
    expect(calls.at(-1)).toEqual({ type: 'openWebApp', payload: { path: '/extension' } })

    responses.getMasterResume = [ok(MASTER)]
    responses.analyzeJob = [ok({ jobContextId: 'j1', analysis: { mustHave: [], niceToHave: [] } })]
    responses.startTailoring = [ok({ id: 't2', status: 'queued' })]
    responses.getTailoring = [ok({ ...READY, id: 't2', status: 'failed', error: null })]
    act(() => root.unmount())
    root = createRoot(container)
    await render()
    await click('Tailor your resume for')
    await click('Tailor Resume')
    await act(async () => vi.advanceTimersByTime(2000))
    expect(container.textContent).toContain('Resume tailoring failed. Your original resume has not been changed.')
    expect(button('Retry')).toBeTruthy()
  })

  it('can be dismissed for this job', async () => {
    const { onDismiss } = await render()
    await click('Hide for this job')
    expect(onDismiss).toHaveBeenCalled()
  })
})

describe('TailorCard first offer', () => {
  it('opens as a clear offer the first time a job is seen, and minimizes to the pill', async () => {
    await act(async () => root.render(<TailorCard job={JOB} extract={() => ({ ok: true, job: POSTING })} stacked={false} autoOpen onDismiss={vi.fn()} />))
    expect(container.textContent).toContain('New')
    expect(container.textContent).toContain('Ansly found the job description.')
    expect(button('Tailor Resume')).toBeTruthy()
    await act(async () => button('Minimize')!.click())
    expect(container.textContent).not.toContain('Ansly found the job description.')
    expect(button('Tailor your resume for')).toBeTruthy()
  })
})
