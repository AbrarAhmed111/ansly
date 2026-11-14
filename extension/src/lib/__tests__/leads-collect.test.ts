import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BATCH_SIZE, collectInBatches, CollectionError, leadsPath, retryAfter } from '../leads/collect'
import type { LinkedInPostCandidate } from '../leads/linkedin-posts'

const send = vi.fn()
vi.mock('@/lib/messages', () => ({ send: (...args: unknown[]) => send(...args) }))

const post = (id: number): LinkedInPostCandidate => ({
  sourcePostId: `urn:li:activity:${id}`,
  originalPostUrl: null,
  authorName: null,
  authorProfileUrl: null,
  postText: `Post ${id}`,
  publishedAt: null,
})
const posts = (count: number) => Array.from({ length: count }, (_, i) => post(i))

const response = (session: string, size: number, saved: number) => ({
  ok: true,
  data: {
    session_id: session,
    status: 'completed',
    loaded_count: size,
    extracted_count: size,
    unidentified_count: 0,
    relevant_count: saved + 1,
    filtered_count: size - saved - 1,
    duplicate_count: 1,
    saved_count: saved,
    leads: Array.from({ length: saved }, (_, i) => ({
      contact_info: i % 2 ? { application_url: 'https://example.test/jobs' } : { email: 'jobs@example.test' },
    })),
  },
})

type Call = [string, { candidates: Record<string, unknown>[] }]
const call = (index: number) => send.mock.calls[index] as Call

describe('collectInBatches', () => {
  beforeEach(() => send.mockReset())
  afterEach(() => vi.useRealTimers())

  it('sends any number of posts in batches and adds up the results', async () => {
    const total = BATCH_SIZE + 59
    send.mockResolvedValueOnce(response('s1', BATCH_SIZE, 20)).mockResolvedValueOnce(response('s2', 59, 3))
    const progress: number[] = []
    const result = await collectInBatches(posts(total), (p) => progress.push(p.done))

    expect(send).toHaveBeenCalledTimes(2)
    expect(call(0)[1].candidates).toHaveLength(BATCH_SIZE)
    expect(call(1)[1].candidates).toHaveLength(59)
    expect(call(0)[1].candidates[0]).toEqual({
      source_post_id: 'urn:li:activity:0',
      original_post_url: null,
      author_name: null,
      author_profile_url: null,
      post_text: 'Post 0',
      published_at: null,
    })
    expect(progress).toEqual([0, BATCH_SIZE, total])
    expect(result).toMatchObject({
      detected: total,
      saved: 23,
      withEmail: 12,
      withLink: 11,
      duplicates: 2,
      skipped: BATCH_SIZE - 21 + (59 - 4),
      failed: 0,
    })
    expect(leadsPath(result)).toBe('/leads?session=s1,s2')
  })

  it('waits out the rate limit and retries the same batch', async () => {
    vi.useFakeTimers()
    send
      .mockResolvedValueOnce({ ok: false, error: { code: 'rate_limited', message: 'Too many requests. Try again in 3 seconds.' } })
      .mockResolvedValueOnce(response('s1', 5, 2))
    const waits: number[] = []
    const run = collectInBatches(posts(5), (p) => p.waitSeconds && waits.push(p.waitSeconds))
    await vi.runAllTimersAsync()
    const result = await run

    expect(waits).toEqual([3, 2, 1])
    expect(send).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ saved: 2, failed: 0 })
  })

  it('stops with the reason when the first batch fails', async () => {
    send.mockResolvedValueOnce({ ok: false, error: { code: 'not_connected', message: 'Not connected' } })
    await expect(collectInBatches([post(1)], () => {})).rejects.toBeInstanceOf(CollectionError)
  })

  it('keeps earlier results when a later batch fails', async () => {
    send
      .mockResolvedValueOnce(response('s1', BATCH_SIZE, 5))
      .mockResolvedValueOnce({ ok: false, error: { code: 'server', message: 'Boom' } })
    const result = await collectInBatches(posts(BATCH_SIZE + 10), () => {})
    expect(result).toMatchObject({ saved: 5, failed: 10, sessionIds: ['s1'] })
  })
})

describe('retryAfter', () => {
  it('reads the server message and stays within bounds', () => {
    expect(retryAfter('Too many requests. Try again in 23 seconds.')).toBe(23)
    expect(retryAfter('Try again in 900 seconds')).toBe(60)
    expect(retryAfter('Too many requests.')).toBe(15)
  })
})
