import type { JobContext } from '@ansly/types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { classifyField, fieldKind } from '@/lib/detection/classify'
import { extractQuestion } from '@/lib/detection/question'
import { watchFields, type TrackedField } from '@/lib/detection/scan'
import { isOnScreen, sparklePosition } from '@/lib/geometry'
import { extractJobContext } from '@/lib/job-context'
import type { TabMessage } from '@/lib/messages'
import { isEnabledOn, type Settings } from '@/lib/settings'
import { Popover, type PopoverTarget } from './Popover'

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

function toTarget(el: HTMLElement, question: string): PopoverTarget {
  const kind = fieldKind(el)
  const maxLength = (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) && el.maxLength > 0 ? el.maxLength : null
  return {
    el,
    question,
    field: {
      label: question,
      maxLength,
      kind: kind === 'select' ? null : kind,
    },
  }
}

export function App({ host, initialSettings, subscribe }: {
  host: HTMLElement
  initialSettings: Settings
  subscribe: (onChange: (s: Settings) => void) => () => void
}) {
  const [settings, setSettings] = useState(initialSettings)
  const [fields, setFields] = useState<TrackedField[]>([])
  const [target, setTarget] = useState<PopoverTarget | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const enabled = isEnabledOn(settings, window.location.hostname)
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  useEffect(() => subscribe(setSettings), [subscribe])

  useEffect(() => {
    if (!enabled) {
      setFields([])
      setTarget(null)
      return
    }
    return watchFields(document, setFields, { ignore: (el) => host.contains(el) || el === host })
  }, [enabled, host])

  useLayoutTick(enabled && (fields.length > 0 || target !== null))

  const getJobContext = useCallback(
    (): JobContext => extractJobContext(document, { includeDescription: settingsRef.current.useJobDescription }),
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

  // Keyboard shortcut (from the background): open Ansly for the focused field.
  useEffect(() => {
    const listener = (message: unknown) => {
      if ((message as TabMessage)?.type !== 'shortcut' || !enabled) return
      const el = deepActiveElement()
      if (!(el instanceof HTMLElement) || host.contains(el)) return
      const kind = fieldKind(el)
      if (!kind || kind === 'select') return
      if (el instanceof HTMLInputElement && !['text', ''].includes(el.type)) return
      const tracked = fields.find((f) => f.el === el)
      const question = tracked?.question.text || classifyField(el).question.text || extractQuestion(el).text
      if (question) setTarget(toTarget(el, question))
      else showToast("Ansly couldn't find the question for this field")
    }
    browser.runtime.onMessage.addListener(listener)
    return () => browser.runtime.onMessage.removeListener(listener)
  }, [enabled, fields, host, showToast])

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

  if (!enabled) return null
  const viewport = { width: window.innerWidth, height: window.innerHeight }

  return (
    <div className="root" data-theme={settings.theme}>
      {fields.map((f) => {
        const r = f.el.getBoundingClientRect()
        const box = { top: r.top, left: r.left, width: r.width, height: r.height }
        if (!isOnScreen(box, viewport) || box.width < 60) return null
        const pos = sparklePosition(box, f.kind !== 'input')
        return (
          <button
            key={keyFor(f.el)}
            className="sparkle"
            style={{ top: pos.top, left: pos.left }}
            data-active={target?.el === f.el}
            aria-label={`Answer with Ansly: ${f.question.text}`}
            title="Answer with Ansly"
            // Keep focus in the field (some forms validate on blur).
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setTarget(target?.el === f.el ? null : toTarget(f.el, f.question.text))}
          >
            ✨
          </button>
        )
      })}
      {target && (
        <Popover
          key={keyFor(target.el)}
          target={target}
          getJobContext={getJobContext}
          onClose={close}
          onFilled={showToast}
        />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}
