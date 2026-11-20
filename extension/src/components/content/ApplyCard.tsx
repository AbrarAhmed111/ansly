import type { ApplicationAgentMode } from '@ansly/types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { type DetectedJob, type ExtractResult } from '@/lib/job/detect'
import { send } from '@/lib/messages'
import { allRoots, scanAll, type TrackedField } from '@/lib/detection/scan'
import { isHidden } from '@/lib/detection/classify'
import { fillAnswer, fieldContext } from './Panel'
import { detectCaptcha, detectLoginOrSession, type Intervention } from '@/lib/apply/interventions'
import { clickAndWaitForIndeedStep, findIndeedNextAction } from '@/lib/apply/navigation'
import { attachedResumeNames, findResumeInputs, uploadResumeToInput } from '@/lib/apply/resume'
import { hasValue } from '@/lib/fill'
import { Brand, Icon, LogoMark } from '@/components/brand'

type State =
  | { step: 'pill' }
  | { step: 'offer' }
  | { step: 'running'; route: 'email' | 'website'; activity: string }
  | { step: 'paused'; intervention: Intervention }
  | { step: 'done'; route: 'email' | 'website'; detail: string }
  | { step: 'error'; detail: string }

type SelectedResume = { id: string; name: string; fileName: string }

const MAX_INDEED_STEPS = 10

const MATERIAL_FIELD =
  /\b(work authorization|authorized to work|visa|sponsorship|require sponsorship|criminal|felony|conviction|date of birth|gender|race|ethnicity|disability|veteran|social security|salary history)\b/i

function successEvidence(doc: Document): string | null {
  const pageText = allRoots(doc)
    .map((root) => (root instanceof Document ? root.body?.innerText : root.textContent) ?? '')
    .join(' ')
  const text = `${doc.title} ${pageText}`.toLowerCase()
  if (/application (submitted|received)|successfully submitted|thank you for (your )?(applying|application)|we received your application|confirmation number/.test(text)) {
    return text.slice(0, 2000)
  }
  return null
}

function submitButtons(doc: Document): HTMLElement[] {
  return allRoots(doc)
    .flatMap((root) => [...root.querySelectorAll<HTMLElement>('button, [role="button"], input[type="submit"]')])
    .filter((element) => {
      const labels = [
        element.getAttribute('aria-label') ?? '',
        element instanceof HTMLInputElement ? element.value : '',
        element.innerText ?? element.textContent ?? '',
      ].map((text) => text.replace(/\s+/g, ' ').trim().toLowerCase())
      return (
        !isHidden(element) &&
        !(element instanceof HTMLButtonElement && element.disabled) &&
        !(element instanceof HTMLInputElement && element.disabled) &&
        labels.some((text) =>
          /^(submit|submit application|submit your application|send application|finish|finish application|complete application)$/.test(text),
        )
      )
    })
}

export function ApplyCard({
  job,
  jobKey,
  extract,
  mode,
  stacked,
  onDismiss,
}: {
  job: DetectedJob
  jobKey: string
  extract: () => ExtractResult
  mode: ApplicationAgentMode
  stacked: boolean
  onDismiss: () => void
}) {
  const [state, setState] = useState<State>({ step: 'pill' })
  const mounted = useRef(true)
  const runId = useRef<string | null>(null)
  const selectedResume = useRef<SelectedResume | null | undefined>(undefined)
  const applicationStarted = useRef(false)
  useEffect(() => () => void (mounted.current = false), [])

  useEffect(() => {
    runId.current = null
    selectedResume.current = undefined
    applicationStarted.current = false
    setState({ step: 'pill' })
  }, [jobKey])

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

  const fillWebsite = useCallback(async function fillWebsiteStep(stepIndex = 0): Promise<void> {
    if (stepIndex >= MAX_INDEED_STEPS) {
      pause({
        kind: 'unknown_required_field',
        title: 'Application has more steps',
        detail: 'Ansly stopped after several Indeed steps. Review the current page and press Resume to continue.',
      })
      return
    }

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

    if (selectedResume.current === undefined) {
      const match = await send('matchRoleResume', {
        title: extracted.job.title,
        company: extracted.job.company,
        technologies: [],
        responsibilities: [],
        requirements: extracted.job.description,
      })
      if (!match.ok) {
        setState({ step: 'error', detail: `Resume matching failed (/api/v1/resumes/match): ${match.error.message}` })
        completeRun('failed', { reason: 'resume_match_failed' })
        return
      }

      if (match.data.resumeId && (match.data.confidence === 'high' || mode === 'aggressive')) {
        const library = await send('getRoleResumes', null)
        if (!library.ok) {
          pause({
            kind: 'unsupported_upload',
            title: 'Resume library unavailable',
            detail: `Ansly could not load the matched resume: ${library.error.message}`,
          })
          return
        }
        const resume = library.data.items.find((item) => item.id === match.data.resumeId)
        if (!resume) {
          pause({
            kind: 'unsupported_upload',
            title: 'Matched resume unavailable',
            detail: 'The matched resume is no longer in your Roles Resume Library. Choose the resume manually, then press Resume.',
          })
          return
        }
        selectedResume.current = {
          id: resume.id,
          name: resume.name,
          fileName: resume.fileName ?? resume.name,
        }
      } else {
        selectedResume.current = null
      }
    }

    const attached = attachedResumeNames(document)
    const selection = selectedResume.current
    if (selection) {
      const alreadyAttached = attached.some((name) => name.toLowerCase() === selection.fileName.toLowerCase())
      if (!alreadyAttached && attached.length) {
        pause({
          kind: 'unsupported_upload',
          title: 'Another resume is already attached',
          detail: `The page already has ${attached.join(', ')} attached. Replace it with ${selection.fileName} manually, then press Resume.`,
        })
        return
      }
      if (!alreadyAttached) {
        const input = findResumeInputs(document)[0]
        if (input) {
          setState({ step: 'running', route: 'website', activity: `Uploading ${selection.name}` })
          const download = await send('downloadRoleResume', { id: selection.id })
          if (!download.ok) {
            pause({
              kind: 'unsupported_upload',
              title: 'Resume download failed',
              detail: `Ansly could not retrieve ${selection.fileName}: ${download.error.message}. Upload it manually, then press Resume.`,
            })
            return
          }
          try {
            const uploaded = await uploadResumeToInput(input, download.data.url, selection.fileName)
            if (!uploaded) {
              pause({
                kind: 'unsupported_upload',
                title: 'Resume upload could not be verified',
                detail: 'Choose the selected resume from your existing Roles Resume Library using the page upload control, then press Resume.',
              })
              return
            }
          } catch (error) {
            pause({
              kind: 'unsupported_upload',
              title: 'Resume upload failed',
              detail: `Ansly could not attach ${selection.fileName}: ${error instanceof Error ? error.message : String(error)}. Upload it manually, then press Resume.`,
            })
            return
          }
        }
      }
    }

    setState({ step: 'running', route: 'website', activity: 'Answering application fields' })
    const fields: TrackedField[] = scanAll(document).filter((field) =>
      field.kind !== 'ignored' &&
      field.control !== null &&
      !field.question.text.match(MATERIAL_FIELD) &&
      !hasValue(field.controls),
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
        setState({
          step: 'error',
          detail: `Application answer generation failed (/api/v1/answers/generate-batch): ${result.error.message}`,
        })
        completeRun('failed', { reason: 'answer_generation_failed' })
        return
      }

      for (const field of fields) {
        const answer = result.data.results.find((item) => item.id === field.id)
        const isCoverLetter = /\bcover letter\b/i.test(field.question.text)
        if (!answer || answer.status === 'insufficient_information' || answer.error || !answer.answer?.trim()) {
          if (field.required || isCoverLetter) {
            pause({
              kind: 'unknown_required_field',
              title: isCoverLetter ? 'Cover letter needs review' : 'An answer is missing',
              detail: `The field "${field.question.text || 'Unknown question'}" could not be filled with a grounded answer. Enter it manually, then press Resume.`,
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
        if (answer.answer) {
          setState({
            step: 'running',
            route: 'website',
            activity: isCoverLetter ? 'Writing cover letter' : 'Filling application fields',
          })
          if (!(await fillAnswer(field, answer.answer))) {
            pause({
              kind: 'unknown_required_field',
              title: 'Could not fill an application field',
              detail: `Ansly generated an answer for "${field.question.text}" but could not verify it on the page. Enter it manually, then press Resume.`,
            })
            return
          }
        }
      }
    }

    const known = successEvidence(document)
    if (known) {
      setState({ step: 'done', route: 'website', detail: 'Application submitted and confirmation detected.' })
      completeRun('submitted', { evidence: known })
      return
    }

    if (platform() === 'indeed') {
      const action = findIndeedNextAction(document, !applicationStarted.current)
      if (action) {
        applicationStarted.current = true
        setState({ step: 'running', route: 'website', activity: 'Continuing to the next Indeed step' })
        if (!(await clickAndWaitForIndeedStep(action, document))) {
          pause({
            kind: 'unknown_required_field',
            title: 'Indeed did not advance',
            detail: 'The page did not show a new step after clicking its Continue control. Check for validation messages, then press Resume.',
          })
          return
        }
        return fillWebsiteStep(stepIndex + 1)
      }
    }

    if (selection && !attachedResumeNames(document).some((name) => name.toLowerCase() === selection.fileName.toLowerCase())) {
      pause({
        kind: 'unsupported_upload',
        title: 'Resume upload not found',
        detail: 'Ansly reached a page without a supported resume input. Upload the matched resume manually, then press Resume.',
      })
      return
    }
    if (!selection && !attachedResumeNames(document).length) {
      pause({
        kind: 'unknown_required_field',
        title: 'Choose a resume',
        detail: 'Ansly reached the review step without a confidently matched or attached resume. Attach your chosen resume manually, then press Resume.',
      })
      return
    }

    setState({ step: 'running', route: 'website', activity: 'Reviewing application and looking for final submit' })
  }, [extract, mode, pause, completeRun, platform])

  const start = useCallback(async () => {
    const extracted = extract()
    if (!extracted.ok) {
      setState({ step: 'error', detail: 'Open a complete job posting before starting the Apply Agent.' })
      return
    }

    runId.current = crypto.randomUUID()
    selectedResume.current = undefined
    applicationStarted.current = false
    const runStarted = await send('startApplication', {
      id: runId.current,
      jobKey: crypto.randomUUID(),
      title: extracted.job.title,
      company: extracted.job.company,
      jobUrl: window.location.href,
      platform: platform(),
      route: 'website',
      behaviorMode: mode,
    })
    if (runStarted.ok) {
      await send('authorizeApplication', {
        id: runId.current,
        request: {
          route: 'email_then_website',
          websiteSubmissionAllowed: true,
        },
      })
    }

    const captcha = detectCaptcha(document)
    if (captcha) return pause(captcha)

    setState({ step: 'running', route: 'email', activity: 'Analyzing job description' })
    const id = crypto.randomUUID()
    const analysis = await send('analyzeJobOutreach', { id, job_text: extracted.job.description })
    if (!analysis.ok) {
      setState({ step: 'running', route: 'website', activity: 'Direct email unavailable; continuing with website application' })
      await fillWebsite()
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
        setState({
          step: 'error',
          detail: `Email preparation failed (/api/v1/job-outreach/${analysis.data.id}/compose): ${composed.error.message}`,
        })
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
