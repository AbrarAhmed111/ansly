import { describe, expect, it } from 'vitest'
import {
  canTransitionApplicationStatus,
  isTerminalApplicationStatus,
  transitionApplicationStatus,
} from '../state'

describe('Apply Agent state machine', () => {
  it('allows normal recovery transitions', () => {
    expect(canTransitionApplicationStatus('awaiting_authorization', 'authorized')).toBe(true)
    expect(canTransitionApplicationStatus('authorized', 'analyzing_job')).toBe(true)
    expect(canTransitionApplicationStatus('inspecting_application', 'captcha_paused')).toBe(true)
    expect(canTransitionApplicationStatus('captcha_paused', 'inspecting_application')).toBe(true)
  })

  it('rejects terminal transitions and invalid jumps', () => {
    expect(isTerminalApplicationStatus('submitted')).toBe(true)
    expect(canTransitionApplicationStatus('submitted', 'submitting')).toBe(false)
    expect(canTransitionApplicationStatus('detected', 'submitted')).toBe(false)
  })

  it('returns the target status for valid transitions', () => {
    expect(transitionApplicationStatus('submitting', 'verifying_submission')).toBe('verifying_submission')
  })

  it('throws for invalid transitions', () => {
    expect(() => transitionApplicationStatus('email_sent', 'submitting')).toThrow(/Invalid Apply Agent state/)
  })
})
