/**
 * What a running tailoring shows: a progress bar and the work its current step is doing.
 * Shared by the web app and the extension so both tell the same story.
 */

import type { TailoringStatus } from './tailoring'

interface Stage {
  /** Percent when the step starts, and the most it reaches before the step finishes. */
  from: number
  to: number
  /** About how long the step takes; the bar slows down as it gets close. */
  expectedMs: number
  /** What the step does, in the order it does it. Each shows for a few seconds; the last one stays. */
  activities: string[]
}

export const TAILORING_STAGES: Record<TailoringStatus, Stage> = {
  queued: { from: 0, to: 6, expectedMs: 2000, activities: ['Starting…'] },
  analyzing: {
    from: 6,
    to: 18,
    expectedMs: 6000,
    activities: ['Reading the job description…', 'Picking out the must-have requirements…'],
  },
  matching: {
    from: 18,
    to: 42,
    expectedMs: 8000,
    activities: [
      'Matching requirements with your experience…',
      'Finding evidence in your profile…',
      'Checking which required skills you have…',
    ],
  },
  tailoring: {
    from: 42,
    to: 78,
    expectedMs: 15000,
    activities: [
      'Changing your title to fit the role…',
      'Tailoring your summary…',
      'Rewording bullets to match the job…',
      'Moving your most relevant work up…',
      'Choosing the skills to put first…',
    ],
  },
  validating: {
    from: 78,
    to: 86,
    expectedMs: 2000,
    activities: ['Checking every change against your experience…', 'Adding the job’s required skills for you to review…'],
  },
  rendering: {
    from: 86,
    to: 98,
    expectedMs: 6000,
    activities: [
      'Applying changes to your Word document…',
      'Keeping your original formatting…',
      'Final truthfulness review…',
    ],
  },
  ready: { from: 100, to: 100, expectedMs: 1, activities: ['Your resume is ready.'] },
  failed: { from: 0, to: 0, expectedMs: 1, activities: ['Resume tailoring failed.'] },
}

export const TAILORING_STEP_COUNT = 5
const ORDER: TailoringStatus[] = ['analyzing', 'matching', 'tailoring', 'validating', 'rendering']
export const ACTIVITY_MS = 3500

export interface TailoringProgress {
  /** 0–100. */
  percent: number
  activity: string
  /** 1-based, of TAILORING_STEP_COUNT. */
  step: number
}

/** Progress for `status`, `elapsedMs` after the step started. */
export function tailoringProgress(status: TailoringStatus, elapsedMs: number): TailoringProgress {
  const stage = TAILORING_STAGES[status]
  const t = Math.max(0, elapsedMs)
  const eased = 1 - Math.exp(-t / stage.expectedMs)
  const index = Math.min(stage.activities.length - 1, Math.floor(t / ACTIVITY_MS))
  return {
    percent: Math.round(stage.from + (stage.to - stage.from) * eased),
    activity: stage.activities[index] ?? '',
    step: Math.max(1, ORDER.indexOf(status) + 1),
  }
}

/** Poll interval when the server gives no `retryAfterMs` hint. */
export const TAILORING_POLL_MS = 2000
/** In a hidden tab, polls that only watch another worker slow down to this. */
const HIDDEN_POLL_MS = 10_000

/**
 * How long to wait before polling a running tailoring again, from the server's `retryAfterMs`.
 * A short hint means the next poll runs the next step itself (hosts without background work), so it
 * continues even in a hidden tab; otherwise a hidden tab polls rarely.
 */
export function tailoringPollDelay(retryAfterMs: number | null | undefined, hidden: boolean): number {
  const delay = retryAfterMs ?? TAILORING_POLL_MS
  return hidden && delay >= 1000 ? Math.max(delay, HIDDEN_POLL_MS) : delay
}
