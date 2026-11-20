import type { ApplicationAgentMode } from '@ansly/types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { type DetectedJob, type ExtractResult } from '@/lib/job/detect'
import { send } from '@/lib/messages'
import { scanAll, type TrackedField } from '@/lib/detection/scan'
import { fillAnswer, fieldContext } from './Panel'
import { detectCaptcha, detectLoginOrSession, type Intervention } from '@/lib/apply/interventions'
import { attachedResumeNames, findResumeInputs, uploadResumeToInput } from '@/lib/apply/resume'
import { Brand, Icon, LogoMark } from '@/components/brand'

type State =
  | { step: 'pill' }
  | { step: 'offer' }
  | { step: 'running'; route: 'email' | 'website'; activity: string }
  | { step: 'paused'; intervention: Intervention }
  | { step: 'done'; route: 'email' | 'website'; detail: string }
  | { step: 'error'; detail: string }

const MATERIAL_FIELD =
  /\b(work authorization|authorized to work|visa|sponsorship|require sponsorship|criminal|felony|conviction|date of birth|gender|race|ethnicity|disability|veteran|social security|salary history)\b/i

function successEvidence(doc: Document): string | null {
  const text = `${doc.title} ${doc.body?.innerText ?? ''}`.toLowerCase()
  if (/application (submitted|received)|successfully submitted|thank you for (your )?(applying|application)|we received your application|confirmation number/.test(text)) {
    return text.slice(0, 2000)
  }
  return null
}

function submitButtons(doc: Document): HTMLButtonElement[] {
  return [...doc.querySelectorAll<HTMLButtonElement>('button, [role="button"], input[type="submit"]')]
    .filter((element) => {
      const text = `${element.textContent ?? ''} ${element.getAttribute('aria-label') ?? ''}`.trim().toLowerCase()
      return /^(submit|submit application|send application|apply now|finish|send)$/.test(text)
    })
}

export function ApplyCard({
  job,
  extract,
  mode,
  stacked,
  onDismiss,
}: {
  job: DetectedJob
  extract: () => ExtractResult
  mode: ApplicationAgentMode
  stacked: boolean
  onDismiss: () => void
}) {
  const [state, setState] = useState<State>({ step: 'pill' })
  const mounted = useRef(true)
  const runId = useRef<string | null>(null)
  useEffect(() => () => void (mounted.current = false), [])

  const platform = useCallback(() => {
    const host = window.location.hostname
    if (host.includes('indeed')) return 'indeed'
    if (host.includes('linkedin')) return 'linkedin'
    if (host.includes('greenhouse')) return 'greenhouse'
    if (host.includes('lever')) return 'lever'
    if (host.includes('workday')) return 'workday'
    if (host.includes('ashby')) return 'ashby'
    if (host.includes('smartrecruiters')) return 'smartrecruiters'
    if (host.includes('workable')) return 'workable'
    if (host.includes('bamboohr')) return 'bamboohr'
    return 'company'
  }, [])

  const completeRun = useCallback((status: 'email_sent' | 'submitted' | 'failed' | 'cancelled', detail?: Record<string, unknown>) => {
    if (!runId.current) return
    void send('completeApplication', {
      id: runId.current,
      request: { status, submissionEvidence: detail ?? {} },
    })
  }, [])

  const pause = useCallback((intervention: Intervention) => {
    if (!mounted.current) return
    setState({ step: 'paused', intervention })
    if (runId.current) {
      void send('setApplicationStatus', {
        id: runId.current,
        request: { status: intervention.kind === 'captcha' ? 'captcha_paused' : 'human_intervention' },
      })
    }
    void browser.notifications.create({
      type: 'basic',
      iconUrl: browser.runtime.getURL('/icon/128.png'),
      title: intervention.title,
      message: intervention.detail,
      requireInteraction: true,
    })
  }, [])

  const fillWebsite = useCallback(async () => {
    setState({ step: 'running', route: 'website', activity: 'Inspecting application fields' })

    const captcha = detectCaptcha(document)
    if (captcha) return pause(captcha)
    const login = detectLoginOrSession(document)
    if (login) return pause(login)

    const extracted = extract()
    if (!extracted.ok) {
      setState({ step: 'error', detail: 'The full job description could not be read. Paste it in Job Outreach or complete the form manually.' })
      completeRun('failed', { reason: 'job_description_unavailable' })
      return
    }

    const match = await send('matchRoleResume', {
      title: extracted.job.title,
      company: extracted.job.company,
      technologies: [],
      responsibilities: [],
      requirements: extracted.job.description,
    })
    if (!match.ok) {
      setState({ step: 'error', detail: match.error.message })
      completeRun('failed', { reason: 'resume_match_failed' })
      return
    }

    if (match.data.resumeId && (match.data.confidence === 'high' || mode === 'aggressive')) {
      const attached = attachedResumeNames(document)
      const library = await send('getRoleResumes', null)
      const selected = library.ok
        ? library.data.items.find((resume) => resume.id === match.data.resumeId)
        : null
      if (!attached.length && selected) {
        setState({ step: 'running', route: 'website', activity: `Uploading ${selected.name}` })
        const download = await send('downloadRoleResume', { id: selected.id })
        if (download.ok) {
          const input = findResumeInputs(document)[0]
          if (input) {
            const name = selected.fileName ?? selected.name
            const ok = await uploadResumeToInput(input, download.data.url, name)
            if (!ok) {
              pause({
                kind: 'unsupported_upload',
                title: 'Resume upload could not be verified',
                detail: 'Choose the selected resume from your existing Roles Resume Library using the page upload control.',
              })
              return
            }
          } else {
            pause({
              kind: 'unsupported_upload',
              title: 'Resume upload not found',
              detail: 'Ansly could not find a supported resume file control on this step.',
            })
            return
          }
        }
      }
    } else if (match.data.confidence === 'low' || match.data.confidence === 'none') {
      pause({
        kind: 'unknown_required_field',
        title: 'Choose a resume',
        detail: 'The role-resume match was insufficiently confident. Choose a resume from your existing Roles Resume Library.',
      })
      return
    }

    setState({ step: 'running', route: 'website', activity: 'Answering application fields' })
    const fields: TrackedField[] = scanAll(document).filter((field) =>
      field.kind !== 'ignored' &&
      field.control !== null &&
      !field.question.text.match(MATERIAL_FIELD),
    )

    if (!fields.length) {
      setState({ step: 'running', route: 'website', activity: 'Reviewing application' })
    } else {
      const result = await send('generateBatch', {
        job_context: extracted.job,
        style: { length: 'auto', tone: 'professional' },
        items: fields.map((field) => ({
          id: field.id,
          question: field.question.text,
          field: fieldContext(field),
        })),
        check_saved: true,
      })
      if (!result.ok) {
        setState({ step: 'error', detail: result.error.message })
        completeRun('failed', { reason: 'answer_generation_failed' })
        return
      }

      for (const field of fields) {
        const answer = result.data.results.find((item) => item.id === field.id)
        if (!answer || answer.status === 'insufficient_information' || answer.error) {
          if (field.required) {
            pause({
              kind: 'unknown_required_field',
              title: 'An answer is missing',
              detail: `The required field "${field.question.text || 'Unknown question'}" could not be verified from your profile.`,
            })
            return
          }
          continue
        }
        if (answer.confidence === 'low' && mode === 'normal') {
          pause({
            kind: 'unknown_required_field',
            title: 'Review the generated answer',
            detail: `Ansly is unsure about "${field.question.text}". Review it manually, then press Resume.`,
          })
          return
        }
        if (answer.answer) await fillAnswer(field, answer.answer)
      }
    }

    const known = successEvidence(document)
    if (known) {
      setState({ step: 'done', route: 'website', detail: 'Application submitted and confirmation detected.' })
      completeRun('submitted', { evidence: known })
      return
    }

    setState({ step: 'running', route: 'website', activity: 'Reviewing application and looking for final submit' })
  }, [extract, mode, pause, completeRun])

  const start = useCallback(async () => {
    const extracted = extract()
    if (!extracted.ok) {
      setState({ step: 'error', detail: 'Open a complete job posting before starting the Apply Agent.' })
      return
    }

    runId.current = crypto.randomUUID()
    await send('startApplication', {
      id: runId.current,
      jobKey: crypto.randomUUID(),
      title: extracted.job.title,
      company: extracted.job.company,
      jobUrl: window.location.href,
      platform: platform(),
      route: 'website',
      behaviorMode: mode,
    })
    await send('authorizeApplication', {
      id: runId.current,
      request: {
        route: 'email_then_website',
        websiteSubmissionAllowed: true,
      },
    })

    const captcha = detectCaptcha(document)
    if (captcha) return pause(captcha)

    setState({ step: 'running', route: 'email', activity: 'Analyzing job description' })
    const id = crypto.randomUUID()
    const analysis = await send('analyzeJobOutreach', { id, job_text: extracted.job.description })
    if (!analysis.ok) {
      setState({ step: 'error', detail: analysis.error.message })
      completeRun('failed', { reason: 'job_analysis_failed' })
      return
    }

    const info = analysis.data.job_info
    if (
    info.application_method === 'email' &&
    info.recipient_confident &&
    !info.recipient_ambiguous &&
    info.recipient_email
    ) {
      setState({ step: 'running', route: 'email', activity: 'Preparing direct employer email' })
      const composed = await send('composeJobOutreach', {
        id: analysis.data.id,
        request: { mode: 'analyze_and_send' },
      })
      if (!composed.ok) {
        setState({ step: 'error', detail: composed.error.message })
        completeRun('failed', { reason: 'outreach_compose_failed' })
        return
      }
      if (composed.data.status === 'needs_review') {
        pause({
          kind: 'unknown_required_field',
          title: 'Review application email',
          detail: composed.data.review_reasons.join(' ') || 'The direct email could not be sent confidently.',
        })
        return
      }
      if (composed.data.can_auto_send) {
        setState({ step: 'running', route: 'email', activity: 'Sending application email' })
        const sent = await send('sendJobOutreach', {
          id: composed.data.id,
          request: { automatic: true },
        })
        if (sent.ok && sent.data.status === 'sent') {
          setState({ step: 'done', route: 'email', detail: `Application email sent to ${sent.data.recipient_email ?? 'the employer'}.` })
          if (runId.current) {
            void send('completeApplication', {
              id: runId.current,
              request: {
                status: 'email_sent',
                jobOutreachId: sent.data.id,
                resumeId: sent.data.resume_id,
                recipientEmail: sent.data.recipient_email,
                emailSubject: sent.data.subject,
                providerMessageId: sent.data.sent_at ? sent.data.sent_at : null,
                submissionEvidence: { sentAt: sent.data.sent_at, status: sent.data.status },
              },
            })
          }
          return
        }
        pause({
          kind: 'session_expired',
          title: 'Email sending was not confirmed',
          detail: sent.ok
            ? sent.data.error_message ?? 'The send outcome was uncertain. Check Gmail before retrying.'
            : sent.error.message,
        })
        return
      }
    }

    await fillWebsite()
  }, [extract, fillWebsite, pause, mode, platform, completeRun])

  const resume = useCallback(() => {
    setState({ step: 'running', route: 'website', activity: 'Revalidating application after human intervention' })
    const captcha = detectCaptcha(document)
    if (captcha) return pause(captcha)
    const login = detectLoginOrSession(document)
    if (login) return pause(login)
    void fillWebsite()
  }, [fillWebsite, pause])

  const submit = useCallback(() => {
    const evidence = successEvidence(document)
    if (evidence) {
      setState({ step: 'done', route: 'website', detail: 'Application submitted and confirmation detected.' })
      completeRun('submitted', { evidence })
      return
    }
    const button = submitButtons(document)[0]
    if (!button) {
      pause({
        kind: 'unknown_required_field',
        title: 'Review is ready',
        detail: 'Ansly could not find the final submit control. Review the form, submit it yourself, or return to the page.',
      })
      return
    }
    setState({ step: 'running', route: 'website', activity: 'Submitting application once' })
    button.click()
    window.setTimeout(() => {
      const confirmation = successEvidence(document)
      if (confirmation) {
        setState({ step: 'done', route: 'website', detail: 'Application submitted and confirmation detected.' })
        completeRun('submitted', { evidence: confirmation })
      } else {
        pause({
          kind: 'session_expired',
          title: 'Submission could not be verified',
          detail: 'Ansly clicked Submit but did not detect confirmation. Do not submit again until you verify the page state.',
        })
      }
    }, 2500)
  }, [pause, completeRun])

  if (state.step === 'pill') {
    return (
      <div className={`apply-pill-wrap${stacked ? ' stacked' : ''}`}>
        <button className="pill apply-pill" onClick={() => setState({ step: 'offer' })} aria-label={`Apply to ${job.title}`}>
          <LogoMark size={16} />
          <span className="pill-brand">Apply with Ansly</span>
        </button>
      </div>
    )
  }

  return (
    <div className="tailor-card apply-card" role="dialog" aria-label="Ansly Apply Agent">
      <div className="header">
        <Brand />
        <span className="spacer" />
        <button className="icon-btn" onClick={onDismiss} aria-label="Close" title="Close">
          <Icon name="x" size={16} />
        </button>
      </div>
      <div className="body">
        {state.step === 'offer' && (
          <>
            <div className="tailor-title">Apply to {job.title}</div>
            {job.company && <div className="tailor-description">{job.company}</div>}
            <p className="tailor-description">
              Ansly may use a direct employer email or complete this website application. It will never solve CAPTCHA or fabricate personal facts.
            </p>
            <div className="tailor-actions">
              <button className="btn primary" onClick={() => void start()}>Yes, apply for me</button>
              <button className="btn" onClick={onDismiss}>Not now</button>
            </div>
          </>
        )}
        {state.step === 'running' && (
          <>
            <div className="tailor-title">{state.route === 'email' ? 'Direct email application' : 'Website application'}</div>
            <div className="tailor-description">{state.activity}</div>
            <div className="tailor-actions">
              {state.route === 'website' && state.activity.includes('Reviewing') && (
                <button className="btn primary" onClick={submit}>Submit application</button>
              )}
              <button className="btn" onClick={onDismiss}>Minimize</button>
            </div>
          </>
        )}
        {state.step === 'paused' && (
          <>
            <div className="tailor-title">{state.intervention.title}</div>
            <div className="tailor-description">{state.intervention.detail}</div>
            <div className="tailor-actions">
              <button className="btn primary" onClick={resume}>Resume</button>
              <button className="btn" onClick={onDismiss}>Pause</button>
            </div>
          </>
        )}
        {state.step === 'done' && (
          <>
            <div className="tailor-title">Application complete</div>
            <div className="tailor-description">{state.detail}</div>
            <button className="btn" onClick={onDismiss}>Close</button>
          </>
        )}
        {state.step === 'error' && (
          <>
            <div className="tailor-title">Could not continue safely</div>
            <div className="tailor-description">{state.detail}</div>
            <button className="btn" onClick={onDismiss}>Close</button>
          </>
        )}
      </div>
    </div>
  )
}
