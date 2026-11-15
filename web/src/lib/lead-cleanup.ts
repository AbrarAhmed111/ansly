import type { CleanupCategory, CleanupResponse, CleanupResult } from '@ansly/types'
import { cleanupLeads } from '@/lib/api'

/** Why Ansly flags a lead, in the user's words. */
export const CLEANUP_CATEGORY_LABEL: Record<CleanupCategory, string> = {
  job_seeker: 'Job seeker, not hiring',
  stack_mismatch: 'Outside your stack',
  not_hiring: 'No role offered',
  match: 'Matches your profile',
  unclear: 'Unclear',
}

/** Leads per request: each request makes at most two AI calls, so it stays well inside the API's time limit. */
export const CLEANUP_CHUNK = 25

export interface CleanupSummary {
  removed: CleanupResult[]
  review: CleanupResult[]
  kept: number
  /** Kept because the AI couldn't check them. */
  unchecked: number
  /** Leads whose request failed: nothing changed for them. */
  failed: string[]
}

/** Runs Ansly Cleanup over every lead, chunk by chunk, reporting progress. A failed chunk is skipped, not retried. */
export async function runCleanup(
  leadIds: string[],
  onProgress: (done: number, total: number, removed: number) => void,
  request: (ids: string[]) => Promise<CleanupResponse> = cleanupLeads,
): Promise<CleanupSummary> {
  const summary: CleanupSummary = { removed: [], review: [], kept: 0, unchecked: 0, failed: [] }
  let done = 0
  onProgress(0, leadIds.length, 0)
  for (let i = 0; i < leadIds.length; i += CLEANUP_CHUNK) {
    const chunk = leadIds.slice(i, i + CLEANUP_CHUNK)
    try {
      const { results } = await request(chunk)
      for (const result of results) {
        if (result.outcome === 'removed') summary.removed.push(result)
        else if (result.outcome === 'review') summary.review.push(result)
        else summary.kept++
        if (!result.checked) summary.unchecked++
      }
    } catch {
      summary.failed.push(...chunk)
    }
    done += chunk.length
    onProgress(done, leadIds.length, summary.removed.length)
  }
  return summary
}
