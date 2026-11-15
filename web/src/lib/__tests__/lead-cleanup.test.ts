import type { CleanupResult, EmailDraft } from '@ansly/types'
import { CLEANUP_CHUNK, runCleanup } from '../lead-cleanup'
import { needsReview, pendingDraftCount } from '../lead-emails'

jest.mock('@/lib/api', () => ({ cleanupLeads: jest.fn() }))

const result = (lead_id: string, outcome: CleanupResult['outcome'], checked = true): CleanupResult => ({
  lead_id,
  outcome,
  category: outcome === 'kept' ? 'match' : 'job_seeker',
  reason: 'r',
  included_keywords: [],
  excluded_keywords: [],
  title: outcome === 'kept' ? null : 'Title',
  description: outcome === 'kept' ? null : 'Post',
  contacted: false,
  checked,
})

describe('runCleanup', () => {
  it('sends every lead in chunks and sorts removed, review and kept results', async () => {
    const ids = Array.from({ length: CLEANUP_CHUNK * 2 + 3 }, (_, i) => `lead-${i}`)
    const request = jest.fn(async (chunk: string[]) => ({
      results: chunk.map((id, i) => result(id, i === 0 ? 'removed' : i === 1 ? 'review' : 'kept', i !== 2)),
      removed: 1,
      review: 1,
      kept: chunk.length - 2,
      unchecked: 1,
    }))
    const progress = jest.fn()
    const summary = await runCleanup(ids, progress, request)

    expect(request).toHaveBeenCalledTimes(3)
    expect(request.mock.calls.flatMap(([chunk]) => chunk)).toEqual(ids)
    expect(summary.removed.map((r) => r.lead_id)).toEqual(['lead-0', `lead-${CLEANUP_CHUNK}`, `lead-${CLEANUP_CHUNK * 2}`])
    expect(summary.review).toHaveLength(3)
    expect(summary.kept).toBe(ids.length - 6)
    expect(summary.unchecked).toBe(3)
    expect(progress).toHaveBeenLastCalledWith(ids.length, ids.length, 3)
  })

  it('a failed chunk changes nothing and the rest still run', async () => {
    const ids = Array.from({ length: CLEANUP_CHUNK + 1 }, (_, i) => `lead-${i}`)
    const request = jest
      .fn()
      .mockRejectedValueOnce(new Error('busy'))
      .mockResolvedValueOnce({ results: [result(`lead-${CLEANUP_CHUNK}`, 'removed')], removed: 1, review: 0, kept: 0, unchecked: 0 })
    const summary = await runCleanup(ids, () => undefined, request)
    expect(summary.failed).toEqual(ids.slice(0, CLEANUP_CHUNK))
    expect(summary.removed).toHaveLength(1)
  })
})

describe('needsReview', () => {
  const draft = (extra: Partial<EmailDraft>) =>
    ({ delivery_status: 'draft', resume_selection: 'auto', approved: false, ...extra }) as EmailDraft

  it('keeps unsent drafts in To review', () => {
    expect(needsReview(draft({}), { status: 'new' })).toBe(true)
    expect(needsReview(draft({ delivery_status: 'failed' }), undefined)).toBe(true)
    expect(needsReview(draft({ resume_selection: 'needs_selection' }), { status: 'new' })).toBe(true)
  })

  it('drops sent drafts, approved ones, and drafts whose lead was already contacted', () => {
    expect(needsReview(draft({ delivery_status: 'sent' }), { status: 'new' })).toBe(false)
    expect(needsReview(draft({ approved: true }), { status: 'new' })).toBe(false)
    expect(needsReview(draft({}), { status: 'contacted' })).toBe(false)
    expect(needsReview(draft({ delivery_status: 'failed' }), { status: 'contacted' })).toBe(false)
  })
})

describe('pendingDraftCount', () => {
  it('counts drafts to review or approved, never sent ones', () => {
    const d = (lead_id: string, extra: Partial<EmailDraft>) =>
      ({ lead_id, delivery_status: 'draft', resume_selection: 'auto', approved: false, ...extra }) as EmailDraft
    const drafts = [
      d('a', {}),
      d('b', { approved: true }),
      d('c', { delivery_status: 'sent' }),
      d('d', { delivery_status: 'sent' }),
      d('e', {}),
    ]
    expect(pendingDraftCount(drafts, { a: { status: 'new' }, b: { status: 'new' }, e: { status: 'contacted' } })).toBe(2)
  })
})
