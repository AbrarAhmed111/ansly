import type { JobContext } from '@ansly/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fieldKind } from '@/lib/detection/classify'
import { extractQuestion } from '@/lib/detection/question'
import { watchFields, type TrackedField } from '@/lib/detection/scan'
import { diagnostics } from '@/lib/diagnostics'
import { isOnScreen, sparklePosition, type Box } from '@/lib/geometry'
import { extractJobContext, isCoverLetter } from '@/lib/job-context'
import { extractJob, jobKey, peekJob, type DetectedJob } from '@/lib/job/detect'
import { send, type TabMessage } from '@/lib/messages'
import type { Settings } from '@/lib/settings'
import { Panel, type Row } from './Panel'
import { Popover, type PopoverTarget } from './Popover'
import { TailorCard } from './TailorCard'

const JOB_CHECK_MS = 1500
// Checks after a navigation before giving up (content often renders after the URL changes).
const JOB_CHECK_ATTEMPTS = 8

/**
 * The job posting on this page, if any (title and company only, read locally).
 * Re-checks when the URL or title changes, because job boards are single-page apps.
 */
function useJobPage(active: boolean): { key: string; job: DetectedJob } | null {
  const [page, setPage] = useState<{ key: string; job: DetectedJob } | null>(null)
  useEffect(() => {
    if (!active) {
      setPage(null)
      return
    }
    let signature = ''
    let attempts = 0
    const check = () => {
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
      setPage((prev) => (prev?.key === key ? prev : job && key ? { key, job } : null))
    }
    check()
    const timer = setInterval(check, JOB_CHECK_MS)
    return () => clearInterval(timer)
  }, [active])
  return page
}

/** Re-renders on scroll/resize (one frame at a time) so buttons follow their fields. */
function useLayoutTick(active: boolean) {
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
    // Layout can also shift without scrolling (accordions, async content).
    const interval = setInterval(bump, 700)
    return () => {
      cancelAnimationFrame(frame)
      clearInterval(interval)
      window.removeEventListener('scroll', bump, true)
      window.removeEventListener('resize', bump)
    }
  }, [active])
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
  const maxLength = (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) && el.maxLength > 0 ? el.maxLength : null
  return {
    el,
    question,
    field: {
      label: question,
      maxLength,
      kind: tracked?.kind === 'number' ? 'number' : kind === 'select' ? null : kind,
    },
  }
}

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
  const [toast, setToast] = useState<string | null>(null)
  // The script only runs on enabled sites (or a one-time scan); this is the master switch.
  const enabled = settings.enabled
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const allRef = useRef(all)
  allRef.current = all
  const lastContextTarget = useRef<Element | null>(null)
  const jobPage = useJobPage(enabled && settings.offerTailoring)
  const [dismissedJobs, setDismissedJobs] = useState<Set<string>>(new Set())
  const trackedJobs = useRef(new Set<string>())

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
    return watchFields(document, setAll, { ignore: (el) => host.contains(el) || el === host })
  }, [enabled, host])

  const fields = useMemo(() => all.filter((f) => f.eligible), [all])
  const detected = useMemo(() => all.filter((f) => f.kind !== 'ignored'), [all])
  const ignoredCount = all.length - detected.length
  const filledIds = Object.entries(rows).filter(([, r]) => ['filled', 'low', 'failed'].includes(r.status))

  useLayoutTick(enabled && (fields.length > 0 || target !== null || filledIds.length > 0 || settings.detectionDebug))

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
    (questions: string[] = []): JobContext =>
      extractJobContext(document, {
        includeDescription: settingsRef.current.useJobDescription || questions.some(isCoverLetter),
      }),
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
        return (
          <button
            key={f.id}
            className="sparkle"
            style={{ top: pos.top, left: pos.left }}
            data-active={target?.el === el}
            aria-label={`Answer with Ansly: ${f.question.text}`}
            title="Answer with Ansly"
            // Keep focus in the field (some forms validate on blur).
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setTarget(target?.el === el ? null : toTarget(el, f.question.text, f))}
          >
            ✨
          </button>
        )
      })}

      {detected.length > 0 && !panelOpen && (
        <button className="pill" onClick={() => { setPanelOpen(true); setPanelMounted(true) }} aria-label={`Ansly found ${detected.length} fields. Open fill all`}>
          <span className="pill-brand">✨ Ansly</span> · {detected.length} field{detected.length === 1 ? '' : 's'} ▸
        </button>
      )}
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
        />
        </div>
      )}

      {jobPage && !dismissedJobs.has(jobPage.key) && (
        // Hidden (not unmounted) while the fill-all panel is open, so a running tailoring keeps its progress.
        <div hidden={panelOpen}>
          <TailorCard
            key={jobPage.key}
            job={jobPage.job}
            extract={() => extractJob(document)}
            stacked={detected.length > 0}
            onDismiss={() => setDismissedJobs((s) => new Set(s).add(jobPage.key))}
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
        />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}
