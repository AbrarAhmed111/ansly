/**
 * @jest-environment jsdom
 */

import type { JobOutreachResponse } from '@ansly/types'
import {
  clearJobOutreachDraft,
  JOB_OUTREACH_STORAGE_KEY,
  loadJobOutreachDraft,
  saveJobOutreachDraft,
} from '@/lib/job-outreach-storage'

const result: JobOutreachResponse = {
  id: '11111111-1111-1111-1111-111111111111',
  status: 'draft',
  job_info: {
    title: 'Backend Engineer',
    company: 'Acme',
    role_family: 'backend',
    seniority: 'senior',
    technologies: ['Node.js'],
    responsibilities: [],
    requirements: ['Node.js'],
    application_method: 'email',
    application_method_evidence: 'Send to jobs@acme.test',
    application_emails: ['jobs@acme.test'],
    recipient_email: 'jobs@acme.test',
    recipient_confident: true,
    recipient_ambiguous: false,
    recipient_evidence: 'Send to jobs@acme.test',
    application_instructions: null,
    instructions_present: false,
    instructions_confident: true,
    instructions_evidence: '',
    requested_subject: null,
    subject_uncertain: false,
  },
  recipient_email: 'jobs@acme.test',
  subject: 'Backend Engineer application',
  body: 'Hello Hiring Team.',
  resume_id: '22222222-2222-2222-2222-222222222222',
  resume_selection: 'auto',
  match_confidence: 'high',
  match_reason: 'Backend role matches the resume.',
  recommended_resume: null,
  resumes: [],
  review_reasons: [],
  error_code: null,
  error_message: null,
  sent_at: null,
  can_auto_send: true,
  can_send: true,
}

beforeEach(() => window.localStorage.clear())

test('saves and restores an editable Job Outreach draft', () => {
  saveJobOutreachDraft({
    jobText: 'A complete backend job advertisement',
    result,
    recipient: 'edited@acme.test',
    subject: 'Edited subject',
    body: 'Edited application body',
    resumeId: '33333333-3333-3333-3333-333333333333',
  })

  expect(JSON.parse(window.localStorage.getItem(JOB_OUTREACH_STORAGE_KEY) ?? '{}')).toMatchObject({
    recipient: 'edited@acme.test',
    subject: 'Edited subject',
  })
  expect(loadJobOutreachDraft()).toMatchObject({
    jobText: 'A complete backend job advertisement',
    recipient: 'edited@acme.test',
    subject: 'Edited subject',
    body: 'Edited application body',
    resumeId: '33333333-3333-3333-3333-333333333333',
  })
})

test('clears the saved draft', () => {
  saveJobOutreachDraft({ jobText: 'A job', result, recipient: '', subject: '', body: '', resumeId: '' })
  clearJobOutreachDraft()
  expect(loadJobOutreachDraft()).toBeNull()
})
