import type { JobContext } from '@ansly/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fieldKind } from '@/lib/detection/classify'
import { extractQuestion } from '@/lib/detection/question'
import { watchFields, type TrackedField } from '@/lib/detection/scan'
import { diagnostics } from '@/lib/diagnostics'
import { hasValue } from '@/lib/fill'
import { isOnScreen, sparklePosition, type Box } from '@/lib/geometry'
import { extractJobContext, isCoverLetter } from '@/lib/job-context'
import { explainNoJob, extractJob, jobKey, peekJob, type DetectedJob } from '@/lib/job/detect'
import { detectLimits } from '@/lib/limits'
import { send, type TabMessage } from '@/lib/messages'
import { firstTailorOffer, type Settings } from '@/lib/settings'
import { Panel, type Row, type RowStatus } from './Panel'
import { Popover, type PopoverTarget } from './Popover'
import { TailorCard } from './TailorCard'

const JOB_CHECK_MS = 1500
// Checks after a navigation before giving up (content often renders after the URL changes).
const JOB_CHECK_ATTEMPTS = 8

/**
 * The job posting on this page, if any (title and company only, read locally).
 * Re-checks when the URL or title changes, because job boards are single-page apps.
 */
function useJobPage(active: boolean, debug = false): { key: string; job: DetectedJob } | null {
  const [page, setPage] = useState<{ key: string; job: DetectedJob } | null>(null)
  useEffect(() => {
    if (!active) {
      setPage(null)
      return
    }
    let signature = ''
    let attempts = 0
    const check = () => {
      // A hidden tab can wait: the check runs again when it is shown.
      if (document.hidden) return
      const next = `${window.location.href}|${document.title}`
      if (next !== signature) {
        signature = next
        attempts = 0
      }
      if (attempts >= JOB_CHECK_ATTEMPTS) return
      attempts++
      const job = peekJob(document)
      const key = job ? jobKey(document) : null
      if (job && key) attempts = JOB_CHECK_ATTEMPTS
      else if (debug && attempts === JOB_CHECK_ATTEMPTS) {
        console.info(`[Ansly] No resume-tailoring offer on this page: ${explainNoJob(document)}`)
      }
      setPage((prev) => (prev?.key === key ? prev : job && key ? { key, job } : null))
    }
    check()
    const timer = setInterval(check, JOB_CHECK_MS)
    document.addEventListener('visibilitychange', check)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', check)
    }
  }, [active, debug])
  return page
}

/**
 * Re-renders (one frame at a time) when fields may have moved, so buttons follow them: on scroll and resize, when
 * the page or a field changes size (accordions, async content), and after CSS transitions/animations. No polling:
 * an idle page costs nothing.
 */
function useLayoutTick(active: boolean, elements: HTMLElement[]) {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!active) return
    let frame = 0
    const bump = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setTick((t) => t + 1))
    }
    window.addEventListener('scroll', bump, true)
    window.addEventListener('resize', bump)
    document.addEventListener('transitionend', bump, true)
    document.addEventListener('animationend', bump, true)
    const observer = new ResizeObserver(bump)
    observer.observe(document.documentElement)
    if (document.body) observer.observe(document.body)
    elements.forEach((el) => observer.observe(el))
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('scroll', bump, true)
      window.removeEventListener('resize', bump)
      document.removeEventListener('transitionend', bump, true)
      document.removeEventListener('animationend', bump, true)
    }
  }, [active, elements])
}

// Stable React keys for page elements.
const elementKeys = new WeakMap<HTMLElement, number>()
let nextKey = 0
function keyFor(el: HTMLElement): number {
  let key = elementKeys.get(el)
  if (key === undefined) {
    key = nextKey++
    elementKeys.set(el, key)
  }
  return key
}

function deepActiveElement(): Element | null {
  let el: Element | null = document.activeElement
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement
  return el
}

/** The editable element at (or around) `el`: the field itself, or the rich editor it sits in. */
function editableAt(el: Element | null): HTMLElement | null {
  if (!(el instanceof HTMLElement)) return null
  if (fieldKind(el) && fieldKind(el) !== 'select') return el
  return el.closest('[contenteditable]:not([contenteditable="false"]), [role=textbox]') as HTMLElement | null
}

function boxOf(el: HTMLElement): Box {
  const r = el.getBoundingClientRect()
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

function toTarget(el: HTMLElement, question: string, tracked?: TrackedField): PopoverTarget {
  const kind = fieldKind(el)
  // A detected field knows its limits already; a field opened from the context menu is read now.
  const limits = tracked
    ? { maxLength: tracked.maxLength, maxWords: tracked.maxWords ?? null, minLength: tracked.minLength ?? null }
    : detectLimits(el, [question])
  return {
    el,
    question,
    fieldId: tracked?.id,
    field: {
      label: question,
      maxLength: limits.maxLength,
      ...(limits.maxWords ? { maxWords: limits.maxWords } : {}),
      ...(limits.minLength ? { minLength: limits.minLength } : {}),
      kind: tracked?.kind === 'number' ? 'number' : kind === 'select' ? null : kind,
    },
  }
}

// The quiet per-field icon: what Ansly knows about the field at a glance.
const FIELD_ICONS: Partial<Record<RowStatus, { icon: string; label: string }>> = {
  generating: { icon: '◌', label: 'Generating' },
  ready: { icon: '✓', label: 'Ready' },
  filled: { icon: '✓', label: 'Filled' },
  review: { icon: '!', label: 'Review' },
  needs_info: { icon: '?', label: 'Needs info' },
  failed: { icon: '×', label: 'Failed' },
}

// Long fields still open besides the one being answered, before the popover offers to answer them together.
const ANSWER_REST_MIN = 2

const KIND_LABELS: Record<string, string> = {
  open_text: 'open text', short_text: 'short text', profile: 'profile', choice_single: 'choice', choice_multi: 'multi-choice',
  number: 'number', ignored: 'ignored',
}

export function App({ host, initialSettings, subscribe }: {
  host: HTMLElement
  initialSettings: Settings
  subscribe: (onChange: (s: Settings) => void) => () => void
}) {
  const [settings, setSettings] = useState(initialSettings)
  const [all, setAll] = useState<TrackedField[]>([])
  const [target, setTarget] = useState<PopoverTarget | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  // Once opened, the panel stays mounted (hidden) so its rows and Undo survive closing it.
  const [panelMounted, setPanelMounted] = useState(false)
  const [rows, setRows] = useState<Record<string, Row>>({})
  // Fields the panel should fill now ("Answer the rest together").
  const [run, setRun] = useState<{ ids: string[]; nonce: number } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  // The script only runs on enabled sites (or a one-time scan); this is the master switch.
  const enabled = settings.enabled
  const settingsRef = useRef(settings)
  // The stored job for this page once the user tailored to it, so answers count toward that application's tokens.
  const jobContextIdRef = useRef<{ url: string; id: string } | null>(null)
  settingsRef.current = settings
  const allRef = useRef(all)
  allRef.current = all
  const lastContextTarget = useRef<Element | null>(null)
  const jobPage = useJobPage(enabled && settings.offerTailoring, settings.detectionDebug)
  const [dismissedJobs, setDismissedJobs] = useState<Set<string>>(new Set())
  const trackedJobs = useRef(new Set<string>())
  // Per job: open the offer card by itself (first visit, full description on the page) or start as the pill.
  const [autoOpen, setAutoOpen] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!jobPage || jobPage.key in autoOpen) return
    const key = jobPage.key
    // Read locally only (nothing is sent): offer when the page has a description tailoring can use.
    const usable = extractJob(document).ok
    void (usable ? firstTailorOffer(key) : Promise.resolve(false)).then(
      (first) => setAutoOpen((m) => ({ ...m, [key]: first })),
      () => setAutoOpen((m) => ({ ...m, [key]: false })),
    )
  }, [jobPage, autoOpen])

  // One "job_detected" event per job shown (no job text is sent).
  useEffect(() => {
    if (!jobPage || trackedJobs.current.has(jobPage.key)) return
    trackedJobs.current.add(jobPage.key)
    void send('track', { kind: 'job_detected' })
  }, [jobPage])

  useEffect(() => subscribe(setSettings), [subscribe])

  useEffect(() => {
    if (!enabled) {
      setAll([])
      setTarget(null)
      setPanelOpen(false)
      setPanelMounted(false)
      return
    }
    return watchFields(document, setAll, {
      ignore: (el) => host.contains(el) || el === host,
      // Detection debug mode (popup) reports what each scan cost.
      onScan: (stats) => {
        if (settingsRef.current.detectionDebug) {
          console.debug(`[Ansly] scan: ${stats.fields} fields in ${stats.roots} root(s), ${stats.durationMs.toFixed(1)}ms`)
        }
      },
    })
  }, [enabled, host])

  const fields = useMemo(() => all.filter((f) => f.eligible), [all])
  const detected = useMemo(() => all.filter((f) => f.kind !== 'ignored'), [all])
  const ignoredCount = all.length - detected.length
  const filledIds = Object.entries(rows).filter(([, r]) => r.snapshot && ['filled', 'failed'].includes(r.status))

  const trackedElements = useMemo(() => fields.map((f) => f.el), [fields])
  useLayoutTick(enabled && (fields.length > 0 || target !== null || filledIds.length > 0 || settings.detectionDebug), trackedElements)

  // "Copy diagnostics" in the popup reads this (no field values, only structure).
  useEffect(() => {
    const key = Symbol.for('ansly.diagnostics')
    const w = window as unknown as Record<symbol, () => unknown>
    w[key] = () => diagnostics(allRef.current)
    return () => void delete w[key]
  }, [])

  // Remember what was right-clicked, for "Answer with Ansly" in the context menu.
  useEffect(() => {
    const onContext = (e: MouseEvent) => (lastContextTarget.current = e.composedPath()[0] as Element)
    document.addEventListener('contextmenu', onContext, true)
    return () => document.removeEventListener('contextmenu', onContext, true)
  }, [])

  /** The job description goes along when the user opted in, and always for cover letters (they're written for the job). */
  const getJobContext = useCallback(
    (questions: string[] = []): JobContext => {
      const context = extractJobContext(document, {
        includeDescription: settingsRef.current.useJobDescription || questions.some(isCoverLetter),
      })
      const stored = jobContextIdRef.current
      return stored && stored.url === location.href ? { ...context, id: stored.id } : context
    },
    [],
  )

  const close = useCallback((opts?: { refocus?: boolean }) => {
    setTarget((current) => {
      if (opts?.refocus) current?.el.focus()
      return null
    })
  }, [])

  const showToast = useCallback((message: string) => {
    setToast(message)
    setTimeout(() => setToast(null), 2500)
  }, [])

  /** Opens the popover for any text field, detected or not. Misses are never a dead end. */
  const openFor = useCallback((el: HTMLElement | null) => {
    if (!el || host.contains(el)) return
    if (el instanceof HTMLInputElement && !['text', '', 'search', 'number', 'url', 'email'].includes(el.type)) {
      showToast('Ansly answers text fields only')
      return
    }
    const tracked = allRef.current.find((f) => f.controls.includes(el))
    const question = tracked?.question.text || extractQuestion(el).text
    if (question) setTarget(toTarget(el, question, tracked))
    else showToast("Ansly couldn't find the question for this field")
  }, [host, showToast])

  // Keyboard shortcut / context menu (from the background).
  useEffect(() => {
    const listener = (message: unknown) => {
      if (!enabled) return
      const type = (message as TabMessage)?.type
      if (type === 'shortcut') {
        const el = deepActiveElement()
        if (el instanceof HTMLElement && fieldKind(el) && fieldKind(el) !== 'select') openFor(el)
      } else if (type === 'contextAnswer') {
        const el = editableAt(lastContextTarget.current) ?? editableAt(deepActiveElement())
        if (el) openFor(el)
        else showToast('Right-click inside a text field to answer it with Ansly')
      }
    }
    browser.runtime.onMessage.addListener(listener)
    return () => browser.runtime.onMessage.removeListener(listener)
  }, [enabled, openFor, showToast])

  // Close the popover on clicks outside it (and outside its field).
  useEffect(() => {
    if (!target) return
    const onDown = (e: MouseEvent) => {
      const path = e.composedPath()
      if (path.includes(host) || path.includes(target.el)) return
      setTarget(null)
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [target, host])

  /** Empty long-answer fields other than `el`, not already filled or being written by the panel. */
  const openLongFields = useCallback((el: HTMLElement | null) => fields.filter((f) =>
    f.kind === 'open_text' && !f.controls.includes(el as HTMLElement) && !hasValue(f.controls)
    && !['filled', 'generating', 'ready', 'review'].includes(rows[f.id]?.status ?? 'idle')), [fields, rows])

  const answerRest = useCallback((el: HTMLElement) => {
    const ids = openLongFields(el).map((f) => f.id)
    if (!ids.length) return
    setRun({ ids, nonce: Date.now() })
    setPanelMounted(true)
    setPanelOpen(true)
  }, [openLongFields])

  const openField = useCallback((f: TrackedField) => {
    f.el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    if (f.eligible) setTarget(toTarget(f.controls[0]!, f.question.text, f))
    else f.controls[0]?.focus()
  }, [])

  if (!enabled) return null
  const viewport = { width: window.innerWidth, height: window.innerHeight }
  const visible = (f: TrackedField) => {
    const box = boxOf(f.el)
    return isOnScreen(box, viewport) ? box : null
  }

  return (
    <div className="root" data-theme={settings.theme}>
      {settings.detectionDebug &&
        all.map((f) => {
          const box = visible(f)
          if (!box) return null
          const label = f.kind === 'ignored' ? `ignored: ${f.skipReason}` : `${KIND_LABELS[f.kind]}${f.profileKey ? ` · ${f.profileKey}` : ''}`
          return (
            <div key={`d-${f.id}`} className={`debug-box ${f.kind === 'ignored' ? 'ignored' : 'detected'}`}
              style={{ top: box.top - 2, left: box.left - 2, width: box.width + 4, height: box.height + 4 }}>
              <span title={`${f.question.text || '(no question)'}\n${label}`}>{label}</span>
            </div>
          )
        })}

      {filledIds.map(([id, row]) => {
        const f = all.find((x) => x.id === id)
        const box = f && visible(f)
        if (!box) return null
        return <div key={`o-${id}`} className={`filled-outline s-${row.status}`} style={{ top: box.top - 3, left: box.left - 3, width: box.width + 6, height: box.height + 6 }} />
      })}

      {fields.map((f) => {
        const box = visible(f)
        if (!box || box.width < 60) return null
        const pos = sparklePosition(box, f.control !== 'input')
        const el = f.controls[0]!
        const state = FIELD_ICONS[rows[f.id]?.status ?? 'idle']
        return (
          <button
            key={f.id}
            className={`sparkle ${state ? `s-${rows[f.id]!.status}` : ''}`}
            style={{ top: pos.top, left: pos.left }}
            data-active={target?.el === el}
            aria-label={`Answer with Ansly${state ? ` (${state.label})` : ''}: ${f.question.text}`}
            title={state ? `Ansly: ${state.label}` : 'Answer with Ansly'}
            // Keep focus in the field (some forms validate on blur).
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setTarget(target?.el === el ? null : toTarget(el, f.question.text, f))}
          >
            {state?.icon ?? '✦'}
          </button>
        )
      })}

      {detected.length > 0 && !panelOpen && (() => {
        // Page-level status: always know where the application stands.
        const statuses = detected.map((f) => rows[f.id]?.status ?? 'idle')
        const n = (s: RowStatus[]) => statuses.filter((x) => s.includes(x)).length
        const answered = n(['filled', 'ready'])
        const review = n(['review'])
        const missing = n(['needs_info'])
        const started = statuses.some((s) => s !== 'idle')
        const job = jobPage?.job
        const jobName = job ? [job.title, job.company].filter(Boolean).join(' at ') : ''
        const summary = started
          ? `${answered} answered, ${review} to review, ${missing} need info`
          : `${jobName ? `${jobName}: ` : ''}${detected.length} fields detected`
        return (
          <button className="pill" onClick={() => { setPanelOpen(true); setPanelMounted(true) }} aria-label={`Ansly: ${summary}. Open the application assistant`}>
            <span className="pill-brand">Ansly</span>
            {started ? (
              <>
                <span className="pill-stat s-ready">✓ {answered}</span>
                {review > 0 && <span className="pill-stat s-review">! {review}</span>}
                {missing > 0 && <span className="pill-stat s-needs_info">? {missing}</span>}
                <span className="pill-action">Open</span>
              </>
            ) : (
              <>
                {jobName && <span className="pill-job" title={jobName}>{jobName}</span>}
                <span>{detected.length} field{detected.length === 1 ? '' : 's'}</span>
                {/* Nothing runs until the user asks: preparing is their call. */}
                <span className="pill-action">{jobName ? 'Prepare application' : 'Review & Fill'}</span>
              </>
            )}
          </button>
        )
      })()}
      {panelMounted && (
        <div hidden={!panelOpen}>
        <Panel
          fields={detected}
          ignoredCount={ignoredCount}
          defaults={{
            length: settings.defaultLength,
            tone: settings.defaultTone,
            reviewBeforeFill: settings.reviewBeforeFill,
            overwriteFilled: settings.overwriteFilled,
          }}
          useJobDescription={settings.useJobDescription}
          getJobContext={getJobContext}
          onClose={() => setPanelOpen(false)}
          onRowsChange={setRows}
          onOpenField={openField}
          run={run}
          job={jobPage ? { title: jobPage.job.title || null, company: jobPage.job.company || null } : null}
        />
        </div>
      )}

      {jobPage && !dismissedJobs.has(jobPage.key) && jobPage.key in autoOpen && (
        // Hidden (not unmounted) while the fill-all panel is open, so a running tailoring keeps its progress.
        <div hidden={panelOpen}>
          <TailorCard
            key={jobPage.key}
            job={jobPage.job}
            extract={() => extractJob(document)}
            stacked={detected.length > 0}
            autoOpen={autoOpen[jobPage.key]}
            onDismiss={() => setDismissedJobs((s) => new Set(s).add(jobPage.key))}
            onJobContextId={(id) => (jobContextIdRef.current = { url: location.href, id })}
          />
        </div>
      )}

      {target && (
        <Popover
          key={keyFor(target.el)}
          target={target}
          getJobContext={getJobContext}
          defaultStyle={{ length: settings.defaultLength, tone: settings.defaultTone }}
          useJobDescription={settings.useJobDescription}
          onClose={close}
          onFilled={showToast}
          restCount={openLongFields(target.el).length >= ANSWER_REST_MIN ? openLongFields(target.el).length : 0}
          onAnswerRest={() => answerRest(target.el)}
        />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}
