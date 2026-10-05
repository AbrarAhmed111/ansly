/**
 * One vocabulary for an answer's state, used the same way in the extension, the
 * web app, the resume workflow and the playground.
 */

export type AnswerState = 'ready' | 'generating' | 'review' | 'needs_info' | 'saved' | 'filled' | 'failed'

export const ANSWER_STATE_LABELS: Record<AnswerState, string> = {
  ready: 'Ready',
  generating: 'Generating',
  review: 'Review',
  needs_info: 'Needs info',
  saved: 'Saved',
  filled: 'Filled',
  failed: 'Failed',
}

export interface AnswerSourceInput {
  origin?: 'profile' | 'memory' | 'saved' | 'adapted' | 'generated' | null
  usedSources?: { type: string; label: string }[]
  confidence?: 'high' | 'medium' | 'low'
}

/**
 * Where an answer came from, in plain language ("Instant · From your profile", "AI generated · Grounded in 3
 * profile records"). Model, provider and scores belong in details, never here.
 */
export function answerSource(answer: AnswerSourceInput): { title: string; detail: string | null } {
  const used = answer.usedSources ?? []
  switch (answer.origin) {
    case 'profile':
      return { title: 'Instant', detail: 'From your profile' }
    case 'memory':
      return { title: 'Instant', detail: 'From your Application Memory' }
    case 'saved':
      return { title: 'Saved answer', detail: null }
    case 'adapted':
      return { title: 'Saved answer', detail: 'Adapted for this job' }
    default:
      return {
        title: 'AI generated',
        detail: used.length ? `Grounded in ${used.length} profile record${used.length === 1 ? '' : 's'}` : null,
      }
  }
}

/** Low confidence as an explanation, not a number. */
export const REVIEW_RECOMMENDED = {
  title: 'Review recommended',
  detail: 'Ansly found limited supporting information.',
}

export function needsReview(answer: AnswerSourceInput): boolean {
  return answer.confidence === 'low'
}
