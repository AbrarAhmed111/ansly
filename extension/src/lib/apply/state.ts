import type { ApplicationRunStatus } from '@ansly/types'

const terminalStates = new Set<ApplicationRunStatus>([
  'email_sent',
  'submitted',
  'failed',
  'cancelled',
])

const allowedTransitions: Partial<Record<ApplicationRunStatus, readonly ApplicationRunStatus[]>> = {
  detected: ['awaiting_authorization', 'cancelled'],
  awaiting_authorization: ['authorized', 'cancelled'],
  authorized: ['analyzing_job', 'email_route_check', 'matching_resume', 'cancelled'],
  analyzing_job: ['email_route_check', 'matching_resume', 'failed', 'cancelled'],
  email_route_check: ['email_drafting', 'matching_resume', 'human_intervention', 'failed', 'cancelled'],
  email_drafting: ['email_sending', 'human_intervention', 'failed', 'cancelled'],
  email_sending: ['email_sent', 'human_intervention', 'failed', 'cancelled'],
  matching_resume: ['inspecting_application', 'human_intervention', 'failed', 'cancelled'],
  inspecting_application: ['filling_application', 'uploading_resume', 'ready_to_submit', 'human_intervention', 'captcha_paused', 'failed', 'cancelled'],
  filling_application: ['uploading_resume', 'generating_cover_letter', 'answering_questions', 'navigating_steps', 'human_intervention', 'captcha_paused', 'failed', 'cancelled'],
  uploading_resume: ['filling_application', 'generating_cover_letter', 'navigating_steps', 'human_intervention', 'captcha_paused', 'failed', 'cancelled'],
  generating_cover_letter: ['answering_questions', 'navigating_steps', 'ready_to_submit', 'human_intervention', 'failed', 'cancelled'],
  answering_questions: ['navigating_steps', 'ready_to_submit', 'human_intervention', 'captcha_paused', 'failed', 'cancelled'],
  navigating_steps: ['inspecting_application', 'filling_application', 'uploading_resume', 'ready_to_submit', 'human_intervention', 'captcha_paused', 'failed', 'cancelled'],
  human_intervention: ['inspecting_application', 'filling_application', 'uploading_resume', 'matching_resume', 'navigating_steps', 'ready_to_submit', 'failed', 'cancelled'],
  captcha_paused: ['inspecting_application', 'filling_application', 'navigating_steps', 'ready_to_submit', 'human_intervention', 'failed', 'cancelled'],
  ready_to_submit: ['submitting', 'human_intervention', 'cancelled'],
  submitting: ['verifying_submission', 'failed', 'cancelled'],
  verifying_submission: ['submitted', 'failed', 'human_intervention', 'cancelled'],
  email_sent: [],
  submitted: [],
  failed: [],
  cancelled: [],
}

export function isTerminalApplicationStatus(status: ApplicationRunStatus): boolean {
  return terminalStates.has(status)
}

export function canTransitionApplicationStatus(
  from: ApplicationRunStatus,
  to: ApplicationRunStatus,
): boolean {
  if (from === to) return true
  if (isTerminalApplicationStatus(from)) return false
  return allowedTransitions[from]?.includes(to) ?? false
}

export function transitionApplicationStatus(
  from: ApplicationRunStatus,
  to: ApplicationRunStatus,
): ApplicationRunStatus {
  if (!canTransitionApplicationStatus(from, to)) {
    throw new Error(`Invalid Apply Agent state transition: ${from} -> ${to}`)
  }
  return to
}
