import type { CollectLinkedInPostsResponse } from '@ansly/types'
import { send, type ApiFailure } from '@/lib/messages'
import type { LinkedInPostCandidate } from './linkedin-posts'

/** The API accepts at most this many posts per request. */
export const BATCH_SIZE = 100
/** Rate-limited batches wait for the server's Retry-After and try again, this many times at most. */
const MAX_WAITS = 8
const DEFAULT_WAIT_SECONDS = 15

export interface CollectionProgress {
  /** Posts sent and answered so far. */
  done: number
  total: number
  /** Set while waiting out the API's per-minute limit before retrying a batch. */
  waitSeconds?: number
}

export interface CollectionResult {
  /** Posts read from the page. */
  detected: number
  saved: number
  withEmail: number
  withLink: number
  duplicates: number
  /** Not relevant, excluded words, no email or apply link, or no post link. */
  skipped: number
  /** Posts in batches that failed; they were not processed. */
  failed: number
  sessionIds: string[]
}

export class CollectionError extends Error {
  constructor(readonly failure: ApiFailure) {
    super(failure.message)
  }
}

/**
 * Sends the posts in batches and adds up the server's counts. A rate-limited batch waits and retries. A failed batch is counted as failed
 * and the rest still run, unless nothing can succeed (not connected, no targeting profile).
 */
export async function collectInBatches(
  candidates: LinkedInPostCandidate[],
  onProgress: (progress: CollectionProgress) => void,
): Promise<CollectionResult> {
  const result: CollectionResult = {
    detected: candidates.length,
    saved: 0,
    withEmail: 0,
    withLink: 0,
    duplicates: 0,
    skipped: 0,
    failed: 0,
    sessionIds: [],
  }
  onProgress({ done: 0, total: candidates.length })

  for (let start = 0; start < candidates.length; start += BATCH_SIZE) {
    const batch = candidates.slice(start, start + BATCH_SIZE)
    const request = () => send('collectLinkedInLeads', {
      loaded_count: batch.length,
      candidates: batch.map((post) => ({
        source_post_id: post.sourcePostId,
        original_post_url: post.originalPostUrl,
        author_name: post.authorName,
        author_profile_url: post.authorProfileUrl,
        post_text: post.postText,
        published_at: post.publishedAt,
      })),
    })
    let response = await request()
    for (let waits = 0; !response.ok && response.error.code === 'rate_limited' && waits < MAX_WAITS; waits++) {
      const seconds = retryAfter(response.error.message)
      for (let left = seconds; left > 0; left--) {
        onProgress({ done: start, total: candidates.length, waitSeconds: left })
        await sleep(1000)
      }
      response = await request()
    }
    if (!response.ok) {
      // Nothing saved yet: the cause (not connected, no profile, offline) would fail every batch, so stop and say why.
      if (result.sessionIds.length === 0) throw new CollectionError(response.error)
      result.failed += batch.length
    } else {
      add(result, response.data)
    }
    onProgress({ done: Math.min(start + batch.length, candidates.length), total: candidates.length })
  }
  return result
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** "Too many requests. Try again in 23 seconds." → 23 (bounded to 1–60). */
export function retryAfter(message: string): number {
  const seconds = Number(message.match(/(\d+)\s*second/)?.[1])
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 60) : DEFAULT_WAIT_SECONDS
}

function add(result: CollectionResult, data: CollectLinkedInPostsResponse) {
  result.saved += data.saved_count
  result.duplicates += data.duplicate_count
  result.skipped += data.filtered_count + data.unidentified_count
  result.failed += data.relevant_count - data.saved_count - data.duplicate_count
  result.withEmail += data.leads.filter((lead) => lead.contact_info?.email).length
  result.withLink += data.leads.filter((lead) => !lead.contact_info?.email && lead.contact_info?.application_url).length
  result.sessionIds.push(data.session_id)
}

/** The dashboard highlights the leads from these collection runs. */
export function leadsPath(result: CollectionResult): string {
  return result.sessionIds.length ? `/leads?session=${result.sessionIds.join(',')}` : '/leads'
}
