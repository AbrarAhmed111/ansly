'use client'

import type { JobOutreachResponse } from '@ansly/types'
import { AlertCircle, Check, FileText, LoaderCircle, Mail, Send, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { Button, Card, Field, Input, Select, Textarea } from '@/components/ui'
import { GmailStatus } from '@/components/email-connection'
import { useRoleResumes } from '@/components/resume/role-resumes'
import {
  analyzeJobOutreach,
  composeJobOutreach,
  deleteJobOutreach,
  sendJobOutreach,
} from '@/lib/api'
import { errorMessage } from '@/lib/format'
import {
  clearJobOutreachDraft,
  loadJobOutreachDraft,
  saveJobOutreachDraft,
} from '@/lib/job-outreach-storage'

const STEPS = [
  'Analyzing job advertisement',
  'Identifying recipient and application instructions',
  'Generating application email',
  'Selecting the best matching resume',
  'Sending email',
]

type Mode = 'analyze' | 'analyze_and_send'

export default function JobOutreachPage() {
  const [jobText, setJobText] = useState('')
  const [result, setResult] = useState<JobOutreachResponse | null>(null)
  const [recipient, setRecipient] = useState('')
  const [ccRecipient, setCcRecipient] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [resumeId, setResumeId] = useState('')
  const [busy, setBusy] = useState<'analyze' | 'analyze_and_send' | 'send' | null>(null)
  const [progressStep, setProgressStep] = useState(-1)
  const [error, setError] = useState<string | null>(null)
  const requestKey = useRef<{ text: string; mode: Mode; id: string } | null>(null)
  const progressRef = useRef<HTMLDivElement>(null)
  const [restored, setRestored] = useState(false)
  const library = useRoleResumes()

  useEffect(() => {
    const saved = loadJobOutreachDraft()
    if (saved) {
      setJobText(saved.jobText)
      setResult(saved.result)
      setRecipient(saved.recipient)
      setCcRecipient(saved.ccRecipient ?? '')
      setSubject(saved.subject)
      setBody(saved.body)
      setResumeId(saved.resumeId)
      requestKey.current = {
        text: saved.jobText,
        mode: saved.result.status === 'sent' ? 'analyze' : 'analyze',
        id: saved.result.id,
      }
    }
    setRestored(true)
  }, [])

  useEffect(() => {
    if (!restored || !result) return
    saveJobOutreachDraft({
      jobText,
      result,
      recipient,
      ccRecipient,
      subject,
      body,
      resumeId,
    })
  }, [restored, result, jobText, recipient, ccRecipient, subject, body, resumeId])

  useEffect(() => {
    if (result?.status !== 'sent') return
    const timer = window.setTimeout(() => {
      requestKey.current = null
      setResult(null)
      setJobText('')
      setRecipient('')
      setCcRecipient('')
      setCcRecipient('')
      setSubject('')
      setBody('')
      setResumeId('')
      setProgressStep(-1)
      setError(null)
      clearJobOutreachDraft()
    }, 5000)
    return () => window.clearTimeout(timer)
  }, [result?.status])

  useEffect(() => {
    if (busy === 'analyze' || busy === 'analyze_and_send') {
      progressRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [busy])

  function show(next: JobOutreachResponse) {
    setResult(next)
    setRecipient(next.recipient_email ?? '')
    setCcRecipient(next.cc_email ?? '')
    setSubject(next.subject)
    setBody(next.body)
    setResumeId(next.resume_id ?? '')
  }

  async function run(mode: Mode) {
    const text = jobText.trim()
    if (text.length < 30) {
      setError('Paste the complete job advertisement to get started.')
      return
    }
    if (text.length > 20000) {
      setError('The job advertisement is too long. Paste a shorter copy (up to 20,000 characters).')
      return
    }
    const key =
      requestKey.current?.text === text && requestKey.current.mode === mode
        ? requestKey.current.id
        : crypto.randomUUID()
    requestKey.current = { text, mode, id: key }
    setBusy(mode)
    setError(null)
    setProgressStep(0)
    try {
      const analysis = await analyzeJobOutreach({ id: key, job_text: text })
      setProgressStep(1)
      setProgressStep(2)
      const composed = await composeJobOutreach(analysis.id, mode)
      show(composed)
      setProgressStep(3)
      if (mode === 'analyze_and_send' && composed.can_auto_send) {
        setProgressStep(4)
        show(await sendJobOutreach(composed.id, { automatic: true }))
      }
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(null)
    }
  }

  async function send() {
    if (!result) return
    setBusy('send')
    setError(null)
    try {
      show(await sendJobOutreach(result.id, {
        recipient_email: recipient.trim(),
        cc_email: ccRecipient.trim() || undefined,
        subject,
        body,
        resume_id: resumeId || undefined,
      }))
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(null)
    }
  }

  async function startOver() {
    if (result && result.status !== 'sent') {
      try {
        await deleteJobOutreach(result.id)
      } catch (reason) {
        setError(errorMessage(reason))
        return
      }
    }
    requestKey.current = null
    setResult(null)
    setJobText('')
    setRecipient('')
    setSubject('')
    setBody('')
    setResumeId('')
    setProgressStep(-1)
    setError(null)
    clearJobOutreachDraft()
  }

  const active = busy === 'analyze' || busy === 'analyze_and_send'
  const job = result?.job_info
  const libraryItems = library.items?.length
    ? library.items.map((resume) => ({ id: resume.id, label: resume.roleLabel ?? null, name: resume.name }))
    : (result?.resumes ?? []).map((resume) => ({ id: resume.id, label: resume.label, name: resume.name }))
  const canSend = Boolean(
    result &&
      ['draft', 'needs_review', 'failed'].includes(result.status) &&
      result.error_code !== 'outcome_unknown' &&
      job?.application_method !== 'portal' &&
      recipient.split(/[,\s;]+/).filter(Boolean).every((address) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) &&
      recipient.split(/[,\s;]+/).filter(Boolean).length > 0 &&
      ccRecipient.split(/[,\s;]+/).filter(Boolean).every((address) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) &&
      subject.trim() &&
      body.trim() &&
      libraryItems.some((resume) => resume.id === resumeId) &&
      busy === null,
  )

  return (
    <div className="animate-fade-up space-y-6 pb-24">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-caption font-semibold uppercase tracking-wide text-accent">Job Outreach</p>
          <h1 className="mt-1 text-h1">Apply from a pasted job ad</h1>
          <p className="mt-2 max-w-2xl text-body-sm text-muted">
            Paste the complete advertisement. Ansly will find the application details and prepare an email grounded
            in your profile.
          </p>
        </div>
        <GmailStatus returnTo="/job-outreach" />
      </header>

      {!result && (
        <Card className="space-y-4">
          <Field label="Job advertisement" htmlFor="job-advertisement">
            <Textarea
              id="job-advertisement"
              rows={12}
              maxLength={20000}
              value={jobText}
              disabled={active}
              onChange={(event) => setJobText(event.target.value)}
              placeholder="Paste any job advertisement here. Ansly will identify the application details and prepare your application email."
              className="min-h-64 resize-y"
            />
          </Field>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-caption text-subtle">{jobText.length.toLocaleString()} / 20,000</span>
            <div className="flex flex-wrap gap-2">
              <Button
                icon={Sparkles}
                loading={busy === 'analyze'}
                disabled={Boolean(busy)}
                onClick={() => void run('analyze')}
              >
                Analyze
              </Button>
              <Button
                variant="primary"
                icon={Send}
                loading={busy === 'analyze_and_send'}
                disabled={Boolean(busy)}
                onClick={() => void run('analyze_and_send')}
              >
                Analyze and Send
              </Button>
            </div>
          </div>
        </Card>
      )}

      {active && (
        <div ref={progressRef}>
          <Card>
            <ol className="space-y-3" aria-live="polite">
              {STEPS.slice(0, busy === 'analyze' ? 4 : 5).map((step, index) => {
                const complete = index < progressStep
                const current = index === progressStep
                return (
                  <li key={step} className="flex items-center gap-3 text-body-sm">
                    <span className="grid h-6 w-6 place-items-center rounded-full border border-border">
                      {complete ? <Check className="h-4 w-4 text-success" /> : current ? <LoaderCircle className="h-4 w-4 animate-spin text-accent" /> : null}
                    </span>
                    <span className={current ? 'font-medium text-fg' : 'text-muted'}>{step}</span>
                  </li>
                )
              })}
            </ol>
          </Card>
        </div>
      )}

      {error && (
        <div role="alert">
          <AlertCircle className="mr-2 inline h-4 w-4 text-danger" aria-hidden />
          <span className="text-body-sm text-danger">{error}</span>
        </div>
      )}

      {result && job && (
        <>
          {result.status === 'sent' ? (
            <Card className="border-success/30 bg-success/5">
              <div className="flex items-start gap-3">
                <Check className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />
                <div>
                  <h2 className="text-title">Application email sent</h2>
                  <p className="mt-1 text-body-sm text-muted">
                    Your email to {result.recipient_email} for {job.title ?? 'this role'} was sent successfully.
                  </p>
                  <p className="mt-2 text-caption text-muted">This confirmation will close shortly so you can start another outreach.</p>
                </div>
              </div>
            </Card>
          ) : (
            <Card className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-caption font-semibold uppercase tracking-wide text-accent">Job details</p>
                  <h2 className="mt-1 text-h2">{job.title ?? 'Job advertisement'}</h2>
                  <p className="text-body-sm text-muted">{job.company ?? 'Company not identified'}</p>
                </div>
                {job.application_method === 'portal' && (
                  <span className="rounded-full bg-warning-soft px-3 py-1 text-caption font-medium text-warning">
                    Apply through external portal
                  </span>
                )}
              </div>

              {result.review_reasons.length > 0 && (
                <div className="rounded-lg border border-warning/40 bg-warning-soft/40 p-4">
                  <p className="text-body-sm font-medium text-fg">Review needed before sending</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-body-sm text-muted">
                    {result.review_reasons.map((reason) => <li key={reason}>{reason}</li>)}
                  </ul>
                </div>
              )}
              {result.error_message && result.error_code !== 'outcome_unknown' && (
                <p className="text-body-sm text-danger">{result.error_message}</p>
              )}
              {result.error_code === 'outcome_unknown' && (
                <div role="alert" className="rounded-lg border border-danger/30 bg-danger/5 p-4 text-body-sm text-danger">
                  {result.error_message}
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <h3 className="text-label">Requirements and skills</h3>
                  <p className="mt-1 text-body-sm text-muted">
                    {[...job.requirements, ...job.technologies].length
                      ? [...new Set([...job.requirements, ...job.technologies])].join(' · ')
                      : 'No specific requirements were extracted.'}
                  </p>
                </div>
                <div>
                  <h3 className="text-label">Application instructions</h3>
                  <p className="mt-1 text-body-sm text-muted">
                    {job.application_instructions ?? job.application_method_evidence ?? 'No clear email instructions found.'}
                  </p>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <Field label="Recipient" htmlFor="outreach-recipient">
                  <Input
                    id="outreach-recipient"
                    className="input w-full"
                    type="text"
                    value={recipient}
                    onChange={(event) => setRecipient(event.target.value)}
                    disabled={Boolean(busy) || job.application_method === 'portal'}
                    list="job-outreach-recipient-options"
                  />
                  <datalist id="job-outreach-recipient-options">
                    {job.application_emails.map((address) => <option key={address} value={address} />)}
                  </datalist>
                  {job.application_emails.length > 0 && (
                    <p className="text-caption text-muted">
                      Addresses found in the advertisement: {job.application_emails.join(', ')}
                    </p>
                  )}
                </Field>
                <Field label="CC" htmlFor="outreach-cc">
                  <Input
                    id="outreach-cc"
                    className="input w-full"
                    type="text"
                    value={ccRecipient}
                    onChange={(event) => setCcRecipient(event.target.value)}
                    disabled={Boolean(busy) || job.application_method === 'portal'}
                    placeholder="Optional CC recipients"
                  />
                  {job.application_cc_emails?.length > 0 && (
                    <p className="text-caption text-muted">
                      CC addresses found: {job.application_cc_emails.join(', ')}
                    </p>
                  )}
                </Field>
                <Field label="Subject" htmlFor="outreach-subject">
                  <Input
                    id="outreach-subject"
                    className="input w-full"
                    value={subject}
                    maxLength={200}
                    onChange={(event) => setSubject(event.target.value)}
                    disabled={Boolean(busy) || job.application_method === 'portal'}
                  />
                </Field>
              </div>

              <Field label="Application email" htmlFor="outreach-body">
                <Textarea
                  id="outreach-body"
                  rows={14}
                  value={body}
                  maxLength={10000}
                  onChange={(event) => setBody(event.target.value)}
                  disabled={Boolean(busy) || job.application_method === 'portal'}
                  className="resize-y"
                />
              </Field>

              <Field
                label="Resume attachment"
                htmlFor="outreach-resume"
                help={result.match_reason ?? 'Select a resume from your Roles Resume library.'}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <Select
                    id="outreach-resume"
                    value={resumeId}
                    onChange={(event) => setResumeId(event.target.value)}
                    disabled={Boolean(busy) || job.application_method === 'portal'}
                  >
                    <option value="">Choose a resume</option>
                    {libraryItems.map((resume) => (
                      <option key={resume.id} value={resume.id}>
                        {resume.label || resume.name}
                      </option>
                    ))}
                  </Select>
                  {!libraryItems.length && <span className="text-body-sm text-muted">No role resumes found.</span>}
                  <Link href="/resume/roles" className="text-body-sm font-medium text-accent hover:underline">
                    Manage role resumes
                  </Link>
                </div>
                {result.match_confidence && (
                  <p className="mt-2 flex items-center gap-1.5 text-caption text-muted">
                    <FileText className="h-3.5 w-3.5" aria-hidden />
                    Resume match: {result.match_confidence}
                  </p>
                )}
              </Field>

              <div className="flex flex-wrap justify-between gap-3 border-t border-border pt-4">
                <Button variant="secondary" disabled={Boolean(busy)} onClick={() => void startOver()}>
                  Start another application
                </Button>
                <Button
                  icon={Mail}
                  loading={busy === 'send'}
                  disabled={!canSend}
                  onClick={() => void send()}
                >
                  Send Email
                </Button>
              </div>
            </Card>
          )}

          <div className="flex justify-end">
            <Button variant="ghost" disabled={Boolean(busy)} onClick={() => void startOver()}>
              Clear Job Outreach
            </Button>
          </div>
        </>
      )}

      {library.error && <p className="text-caption text-danger">{library.error}</p>}
    </div>
  )
}
