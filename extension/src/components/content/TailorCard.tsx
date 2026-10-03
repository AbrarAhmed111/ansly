import type { TailoringResponse, TailoringStatus } from '@ansly/types'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DetectedJob, ExtractResult } from '@/lib/job/detect'
import { send, type ApiFailure } from '@/lib/messages'

const POLL_MS = 2000

type State =
  | { step: 'pill' }
  | { step: 'offer' }
  | { step: 'checking' }
  | { step: 'no_master' }
  | { step: 'needs_review'; resumeId: string | null }
  | { step: 'not_enough' }
  | { step: 'running'; status: TailoringStatus; id: string | null; requirements: number | null }
  | { step: 'ready'; result: TailoringResponse }
  | { step: 'error'; error: ApiFailure | null }

const RUNNING_COPY: Record<TailoringStatus, string> = {
  queued: 'Analyzing job…',
  analyzing: 'Analyzing job…',
  matching: 'Matching requirements with your experience…',
  tailoring: 'Tailoring resume…',
  validating: 'Checking every change against your experience…',
  rendering: 'Applying changes to your Word document…',
  ready: 'Your resume is ready.',
  failed: 'Resume tailoring failed.',
}

const FAILED = 'Resume tailoring failed. Your original resume has not been changed.'

export function TailorCard({
  job,
  extract,
  stacked,
  onDismiss,
}: {
  /** What the page shows (title and company only). */
  job: DetectedJob
  /** Reads the full posting; called only when the user clicks Tailor Resume. */
  extract: () => ExtractResult
  /** Sit above the fill-all pill. */
  stacked: boolean
  onDismiss: () => void
}) {
  const [state, setState] = useState<State>({ step: 'pill' })
  const [pasteUrl, setPasteUrl] = useState('/resume/tailor')
  const mounted = useRef(true)
  useEffect(() => () => void (mounted.current = false), [])

  const fail = useCallback((error: ApiFailure | null) => {
    if (!mounted.current) return
    if (error?.code === 'conflict' && /master resume/i.test(error.message)) setState({ step: 'no_master' })
    else if (error?.code === 'conflict' && /confirm/i.test(error.message)) setState({ step: 'needs_review', resumeId: null })
    else setState({ step: 'error', error })
  }, [])

  const tailor = useCallback(async () => {
    const extracted = extract()
    if (!extracted.ok) {
      const partial = extracted.partial ?? job
      const params = new URLSearchParams({ title: partial.title, company: partial.company, url: window.location.href })
      setPasteUrl(`/resume/tailor?${params}`)
      setState({ step: 'not_enough' })
      return
    }
    setState({ step: 'checking' })
    const master = await send('getMasterResume', null)
    if (!master.ok) return fail(master.error)
    const resume = master.data.resume
    if (!resume) return setState({ step: 'no_master' })
    if (resume.parseStatus !== 'parsed') return setState({ step: 'needs_review', resumeId: resume.id })

    setState({ step: 'running', status: 'analyzing', id: null, requirements: null })
    const analyzed = await send('analyzeJob', { job: extracted.job })
    if (!analyzed.ok) return fail(analyzed.error)
    const requirements = analyzed.data.analysis.mustHave.length + analyzed.data.analysis.niceToHave.length
    const started = await send('startTailoring', { jobContextId: analyzed.data.jobContextId })
    if (!started.ok) return fail(started.error)
    if (mounted.current) setState({ step: 'running', status: started.data.status, id: started.data.id, requirements })
  }, [extract, job, fail])

  // Poll while the tailoring runs.
  const runningId = state.step === 'running' ? state.id : null
  const runningStatus = state.step === 'running' ? state.status : null
  useEffect(() => {
    if (!runningId) return
    const timer = setTimeout(async () => {
      const result = await send('getTailoring', { id: runningId })
      if (!mounted.current) return
      if (!result.ok) return fail(result.error)
      const data = result.data
      if (data.status === 'ready') setState({ step: 'ready', result: data })
      else if (data.status === 'failed') setState({ step: 'error', error: { code: 'server', message: data.error ?? FAILED } })
      else setState((s) => (s.step === 'running' ? { ...s, status: data.status } : s))
    }, POLL_MS)
    return () => clearTimeout(timer)
  }, [runningId, runningStatus, fail])

  const open = (path: string) => void send('openWebApp', { path })

  if (state.step === 'pill') {
    return (
      <div className={`tailor-pill-wrap${stacked ? ' stacked' : ''}`}>
        <button className="pill tailor-pill" onClick={() => setState({ step: 'offer' })} aria-label={`Tailor your resume for ${job.title}`}>
          <span className="pill-brand">📄 Tailor resume</span>
        </button>
        <button className="pill-dismiss" onClick={onDismiss} aria-label="Hide for this job" title="Hide for this job">
          ✕
        </button>
      </div>
    )
  }

  const busy = state.step === 'checking' || state.step === 'running'

  return (
    <div className={`tailor-card${stacked ? ' stacked' : ''}`} role="dialog" aria-label="Tailor your resume">
      <div className="header">
        <span className="brand">Ansly</span>
        <span className="spacer" />
        {!busy && (
          <button className="icon-btn" onClick={() => setState({ step: 'pill' })} aria-label="Minimize">
            ▾
          </button>
        )}
        <button className="icon-btn" onClick={onDismiss} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="body">
        <div>
          <div className="tailor-title">{job.title}</div>
          {job.company && <div className="muted">{job.company}</div>}
        </div>

        {state.step === 'offer' && <div>Tailor your resume for this job?</div>}

        {(state.step === 'checking' || state.step === 'running') && (
          <div className="loading">
            <span className="spinner" />
            <span>
              {state.step === 'checking' ? 'Checking your master resume…' : RUNNING_COPY[state.status]}
              {state.step === 'running' && state.requirements ? (
                <span className="muted"> · {state.requirements} requirements detected</span>
              ) : null}
            </span>
          </div>
        )}

        {state.step === 'no_master' && (
          <div className="notice hint">Upload your master resume as a Word (.docx) file first.</div>
        )}
        {state.step === 'needs_review' && (
          <div className="notice hint">Check and confirm what Ansly read from your master resume before tailoring.</div>
        )}
        {state.step === 'not_enough' && (
          <div className="notice hint">There’s not enough job information to tailor your resume.</div>
        )}

        {state.step === 'error' && (
          <div className="notice error">
            {state.error?.code === 'not_connected' ? (
              <>
                <strong>Ansly isn’t connected</strong>
                {state.error.message}
              </>
            ) : state.error?.code === 'rate_limited' ? (
              state.error.message
            ) : (
              <>
                {FAILED}
                {state.error?.message && state.error.message !== FAILED && <div className="muted">{state.error.message}</div>}
              </>
            )}
          </div>
        )}

        {state.step === 'ready' && <Result result={state.result} />}
      </div>

      <div className="footer">
        {state.step === 'offer' && (
          <>
            <span className="spacer" />
            <button className="btn" onClick={onDismiss}>Not now</button>
            <button className="btn primary" onClick={() => void tailor()}>Tailor Resume</button>
          </>
        )}
        {state.step === 'no_master' && (
          <>
            <span className="spacer" />
            <button className="btn primary" onClick={() => open('/resume/upload')}>Upload Resume</button>
          </>
        )}
        {state.step === 'needs_review' && (
          <>
            <span className="spacer" />
            <button className="btn primary" onClick={() => open(state.resumeId ? `/resume/upload?id=${state.resumeId}` : '/resume')}>
              Review resume
            </button>
          </>
        )}
        {state.step === 'not_enough' && (
          <>
            <span className="spacer" />
            <button className="btn primary" onClick={() => open(pasteUrl)}>Paste description</button>
          </>
        )}
        {state.step === 'error' && (
          <>
            <span className="spacer" />
            {state.error?.code === 'not_connected' ? (
              <button className="btn primary" onClick={() => open('/extension')}>Connect Ansly</button>
            ) : (
              <button className="btn primary" onClick={() => void tailor()}>Retry</button>
            )}
          </>
        )}
        {state.step === 'ready' && (
          <>
            <span className="spacer" />
            <button className="btn" onClick={() => void send('downloadTailoring', { id: state.result.id })}>
              Download DOCX
            </button>
            <button className="btn primary" onClick={() => open(`/resume/${state.result.id}`)}>
              Preview Resume
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function Result({ result }: { result: TailoringResponse }) {
  const s = result.summary
  const needsReview = result.unsupportedRequirements.length > 0 || result.warnings.length > 0
  return (
    <>
      <div className="tailor-ready">Your resume is ready.</div>
      <div className="muted">Your original formatting has been preserved. Preview it before you download.</div>
      {s && (
        <dl className="tailor-stats">
          <dt>Requirements analyzed</dt>
          <dd>{s.analyzed}</dd>
          <dt>Supported by your experience</dt>
          <dd>{s.supported}</dd>
          <dt>Partially supported</dt>
          <dd>{s.partial}</dd>
          <dt>No supporting evidence</dt>
          <dd>{s.unsupported}</dd>
        </dl>
      )}
      {result.changes.length > 0 && (
        <div className="tailor-changes">
          <div className="muted">Changes</div>
          <ul>
            {result.changes.slice(0, 5).map((c) => (
              <li key={c.label}>{c.label}</li>
            ))}
            {result.changes.length > 5 && <li className="muted">and {result.changes.length - 5} more</li>}
          </ul>
        </div>
      )}
      {needsReview && (
        <div className="notice warning">
          Some requirements aren’t supported by your profile. Review before downloading.
        </div>
      )}
    </>
  )
}
