import type { AnswerResponse, AnswerStyle, FieldContext, JobContext, RewriteAction, SavedAnswer, UsedSource } from '@ansly/types'
import { answerSource, REVIEW_RECOMMENDED } from '@ansly/types'
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import { clearDraft, draftKey, loadDraft, saveDraft } from '@/lib/drafts'
import { friendlyError } from '@/lib/errors'
import { fillField } from '@/lib/fill'
import { trapTab } from '@/lib/focus'
import { popoverPosition, popoverWidth, type Box } from '@/lib/geometry'
import { countFor } from '@/lib/limits'
import { MEMORY_OPTIONS } from '@/lib/memory-options'
import { send, type ApiFailure } from '@/lib/messages'
import { autoLabel, LENGTHS, localCategory, resolveLength, sameStyle, TONES } from '@/lib/style'
import { applyMissing, directAnswer, LEARNED, MissingForm, type MissingSubmit } from './MissingForm'

export interface PopoverTarget {
  el: HTMLElement
  question: string
  field: FieldContext
  /** The detected field's id, for keeping the user's draft (falls back to the question). */
  fieldId?: string
}

type Busy = 'regenerate' | 'save' | 'rewrite' | 'memory' | null
type Notice = { tone: 'success' | 'info' | 'warning'; text: string; undo?: boolean } | null

type AnswerState = {
  step: 'answer'
  response: AnswerResponse | null
  text: string
  /** The answer as Ansly gave it (or as last saved): "edited" compares against it. */
  original: string
  savedId: string | null
  busy: Busy
  fillError: string | null
  notice: Notice
  /** The text before the last rewrite, for Undo. */
  previous: string | null
}

type State =
  | { step: 'matching' }
  | { step: 'saved'; match: SavedAnswer }
  | { step: 'generating' }
  | AnswerState
  | { step: 'insufficient'; response: AnswerResponse; learning: boolean; learnError: string | null }
  | { step: 'error'; error: ApiFailure; retry: 'generate' | 'match' }

type Action =
  | { type: 'matching' }
  | { type: 'matched'; match: SavedAnswer | null }
  | { type: 'generate' }
  | { type: 'generated'; response: AnswerResponse; notice?: Notice }
  | { type: 'useSaved'; match: SavedAnswer }
  | { type: 'useText'; text: string; original?: string; notice?: Notice }
  | { type: 'learning'; busy: boolean; error?: string | null }
  | { type: 'edit'; text: string }
  | { type: 'busy'; busy: Busy }
  | { type: 'rewritten'; text: string | null; notice: Notice }
  | { type: 'undoRewrite' }
  | { type: 'notice'; notice: Notice }
  | { type: 'saved'; id: string }
  | { type: 'fillError'; message: string }
  | { type: 'failed'; error: ApiFailure; retry: 'generate' | 'match' }

const answerState = (text: string, rest: Partial<AnswerState> = {}): AnswerState => ({
  step: 'answer', response: null, text, original: text, savedId: null, busy: null, fillError: null, notice: null, previous: null, ...rest,
})

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'matching':
      return { step: 'matching' }
    case 'matched':
      return action.match ? { step: 'saved', match: action.match } : { step: 'generating' }
    case 'generate':
      return { step: 'generating' }
    case 'generated':
      if (action.response.status === 'insufficient_information') {
        return { step: 'insufficient', response: action.response, learning: false, learnError: null }
      }
      return answerState(action.response.answer, { response: action.response, notice: action.notice ?? null })
    case 'useSaved':
      return answerState(action.match.answer, { savedId: action.match.id })
    case 'useText':
      return answerState(action.text, { original: action.original ?? action.text, notice: action.notice ?? null })
    case 'learning':
      return state.step === 'insufficient' ? { ...state, learning: action.busy, learnError: action.error ?? null } : state
    case 'edit':
      return state.step === 'answer' ? { ...state, text: action.text, fillError: null } : state
    case 'busy':
      return state.step === 'answer' ? { ...state, busy: action.busy } : state
    case 'rewritten':
      if (state.step !== 'answer') return state
      return action.text === null
        ? { ...state, busy: null, notice: action.notice }
        : { ...state, busy: null, previous: state.text, text: action.text, notice: action.notice, fillError: null }
    case 'undoRewrite':
      return state.step === 'answer' && state.previous !== null ? { ...state, text: state.previous, previous: null, notice: null } : state
    case 'notice':
      return state.step === 'answer' ? { ...state, notice: action.notice, busy: null } : state
    case 'saved':
      return state.step === 'answer' ? { ...state, savedId: action.id, original: state.text, busy: null } : state
    case 'fillError':
      return state.step === 'answer' ? { ...state, fillError: action.message } : state
    case 'failed':
      return { step: 'error', error: action.error, retry: action.retry }
  }
}

const DEFAULT_STYLE: AnswerStyle = { length: 'auto', tone: 'professional' }

// The rewrite toolbar: three common actions up front, the rest under "More".
const QUICK: { action: RewriteAction; label: string }[] = [
  { action: 'shorter', label: 'Shorter' },
  { action: 'natural', label: 'Natural' },
  { action: 'professional', label: 'Professional' },
]
const MORE: { action: RewriteAction; label: string }[] = [
  { action: 'longer', label: 'Longer' },
  { action: 'concise', label: 'More concise' },
  { action: 'technical', label: 'More technical' },
  { action: 'confident', label: 'More confident' },
  { action: 'simpler', label: 'Simpler' },
]

/** Length / tone / instruction for a fresh generation. Changes are staged; "Apply" regenerates once. */
function StyleBar({ draft, applied, category, disabled, onChange, onApply }: {
  draft: AnswerStyle
  applied: AnswerStyle
  category: string | null
  disabled: boolean
  onChange: (style: AnswerStyle) => void
  onApply: () => void
}) {
  const current = resolveLength(draft.length, category)
  return (
    <div className="style-bar">
      <div className="style-row">
        <div className="segmented" role="radiogroup" aria-label="Length">
          {LENGTHS.map((l) => (
            <button
              key={l.value}
              role="radio"
              aria-checked={current === l.value}
              className={current === l.value ? 'on' : ''}
              disabled={disabled}
              onClick={() => onChange({ ...draft, length: l.value })}
            >
              {l.label}
            </button>
          ))}
        </div>
        <select
          aria-label="Tone"
          value={draft.tone}
          disabled={disabled}
          onChange={(e) => onChange({ ...draft, tone: e.target.value as AnswerStyle['tone'] })}
        >
          {TONES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>
      <div className="style-row">
        <input
          className="instruction"
          aria-label="Custom instruction"
          placeholder="Optional instruction, e.g. mention my open-source work"
          maxLength={500}
          value={draft.instruction ?? ''}
          disabled={disabled}
          onChange={(e) => onChange({ ...draft, instruction: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !sameStyle(draft, applied)) {
              e.preventDefault()
              onApply()
            }
          }}
        />
        {!sameStyle(draft, applied) && (
          <button className="btn small primary" disabled={disabled} onClick={onApply}>Apply</button>
        )}
      </div>
      {draft.length === 'auto' && <span className="style-hint">{autoLabel(category)}</span>}
    </div>
  )
}

/** "Used memory: Relocation → Yes [Edit]": change the remembered fact without leaving the page. */
function MemoryUsed({ source, value, busy, onSave }: {
  source: UsedSource
  value: string
  busy: boolean
  onSave: (value: string, everywhere: boolean) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [everywhere, setEverywhere] = useState(true)
  const options = MEMORY_OPTIONS[source.label]
  if (!editing) {
    return (
      <div className="memory-used">
        <span>Used memory: <strong>{source.label}</strong> → {value}</span>
        <button className="link" onClick={() => setEditing(true)}>Edit</button>
      </div>
    )
  }
  return (
    <form className="memory-used editing" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) onSave(draft.trim(), everywhere) }}>
      <strong>{source.label}</strong>
      {options ? (
        <div className="segmented wrap" role="radiogroup" aria-label={source.label}>
          {options.map((o) => (
            <button key={o} type="button" role="radio" aria-checked={draft === o} className={draft === o ? 'on' : ''} onClick={() => setDraft(o)}>{o}</button>
          ))}
        </div>
      ) : (
        <input aria-label={source.label} value={draft} onChange={(e) => setDraft(e.target.value)} />
      )}
      <label className="check">
        <input type="checkbox" checked={everywhere} onChange={(e) => setEverywhere(e.target.checked)} />
        Save for all applications
      </label>
      <div className="style-row">
        <button type="button" className="link" onClick={() => setEditing(false)}>Cancel</button>
        <span className="spacer" />
        <button type="submit" className="btn small primary" disabled={busy || !draft.trim()}>{busy ? 'Updating…' : 'Update'}</button>
      </div>
    </form>
  )
}

function boxOf(el: HTMLElement): Box {
  const r = el.getBoundingClientRect()
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

export function Popover({
  target,
  getJobContext,
  defaultStyle = DEFAULT_STYLE,
  useJobDescription = true,
  onClose,
  onFilled,
  restCount = 0,
  onAnswerRest,
}: {
  target: PopoverTarget
  getJobContext: (questions?: string[]) => JobContext
  /** From popup settings; the user can change it per field. */
  defaultStyle?: AnswerStyle
  /** Off -> cover letters show a hint to turn it on. */
  useJobDescription?: boolean
  onClose: (opts?: { refocus?: boolean }) => void
  onFilled: (message: string) => void
  /** Other empty long fields on the page (0: don't offer to answer them together). */
  restCount?: number
  /** Answers those fields in one request (through the fill-all panel). */
  onAnswerRest?: () => void
}) {
  const [state, dispatch] = useReducer(reducer, { step: 'matching' })
  // `style` is what requests use; `draft` is what the controls show until Apply.
  const [style, setStyle] = useState<AnswerStyle>(defaultStyle)
  const [draft, setDraft] = useState<AnswerStyle>(defaultStyle)
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null)
  const [showDetails, setShowDetails] = useState(false)
  const [showMore, setShowMore] = useState(false)
  const [custom, setCustom] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const alive = useRef(true)
  useEffect(() => () => void (alive.current = false), [])
  // How long the user waited for an answer (opened -> answer shown), sent with "fill" as a latency signal.
  const openedAt = useRef(performance.now())
  const waitMs = useRef<number | null>(null)
  const [restOffered, setRestOffered] = useState(true)
  const draftId = useRef(draftKey(target.fieldId ?? '', target.question)).current
  const shownAsk = useRef(false)

  const request = useCallback(
    (s: AnswerStyle = style, facts: string[] | null = null) => ({
      question: target.question,
      job_context: getJobContext([target.question]),
      field: target.field,
      style: s,
      additional_facts: facts,
    }),
    [target, getJobContext, style],
  )

  const generate = useCallback(async (facts: string[] | null = null, notice: Notice = null) => {
    dispatch({ type: 'generate' })
    const result = await send('generate', request(style, facts))
    if (!alive.current) return
    if (result.ok) dispatch({ type: 'generated', response: result.data, notice })
    else dispatch({ type: 'failed', error: result.error, retry: 'generate' })
  }, [request])

  // Saved-answer match and generation in one request: a saved answer comes back at once, otherwise the answer.
  const match = useCallback(async (notice: Notice = null) => {
    dispatch({ type: 'matching' })
    const result = await send('resolve', request(style))
    if (!alive.current) return
    if (!result.ok) dispatch({ type: 'failed', error: result.error, retry: 'match' })
    else if (result.data?.savedMatch) dispatch({ type: 'matched', match: result.data.savedMatch })
    else if (result.data?.answer) dispatch({ type: 'generated', response: result.data.answer, notice })
  }, [request])

  // On open: the user's unsaved edit for this field if there is one (no request), else find or write an answer.
  useEffect(() => {
    const kept = loadDraft(draftId)
    if (kept) dispatch({ type: 'useText', text: kept, original: '', notice: { tone: 'info', text: 'Restored your unsaved edit.' } })
    else void match()
  }, [target.question])

  // Keep the user's work: an edited (or rewritten) answer is stored until it's filled or discarded.
  const text = state.step === 'answer' ? state.text : null
  const original = state.step === 'answer' ? state.original : null
  useEffect(() => {
    if (text === null) return
    if (text.trim() && text !== original) saveDraft(draftId, text)
    else if (text === original) clearDraft(draftId)
  }, [text, original, draftId])

  // Position: follow the field while the page scrolls or resizes.
  useLayoutEffect(() => {
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const viewport = { width: window.innerWidth, height: window.innerHeight }
        const field = boxOf(target.el)
        const width = popoverWidth(field, viewport)
        const height = ref.current?.offsetHeight ?? 260
        const { top, left } = popoverPosition(field, { width, height }, viewport)
        setPosition({ top, left, width })
      })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    const observer = new ResizeObserver(update)
    if (ref.current) observer.observe(ref.current)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
      observer.disconnect()
    }
  }, [target.el])

  useEffect(() => {
    if (state.step === 'answer') {
      textareaRef.current?.focus()
      waitMs.current ??= Math.round(performance.now() - openedAt.current)
    }
    if (state.step === 'insufficient' && state.response.missing.length > 0 && !shownAsk.current) {
      shownAsk.current = true
      void send('track', { kind: 'ask_and_learn_shown', category: state.response.category })
    }
  }, [state.step])

  async function regenerate(next: AnswerStyle = style) {
    if (state.step !== 'answer') return
    dispatch({ type: 'busy', busy: 'regenerate' })
    setStyle(next)
    // A saved answer has no previous generation to vary; regenerate still steers away from its text.
    const result = await send('regenerate', { ...request(next), previous_answer: state.text })
    if (!alive.current) return
    if (result.ok) dispatch({ type: 'generated', response: result.data })
    else dispatch({ type: 'failed', error: result.error, retry: 'generate' })
  }

  // Rewrite the text as it is now (the user's latest edit), not the first generation.
  async function rewrite(action: RewriteAction, instruction: string | null = null) {
    if (state.step !== 'answer' || !state.text.trim()) return
    setShowMore(false)
    dispatch({ type: 'busy', busy: 'rewrite' })
    const job = getJobContext()
    const result = await send('rewrite', {
      text: state.text.trim(),
      action,
      instruction,
      question: target.question,
      field: target.field,
      job_context: { company: job.company ?? null, role: job.role ?? null },
    })
    if (!alive.current) return
    if (!result.ok) {
      const error = friendlyError(result.error, 'rewrite this answer')
      return dispatch({ type: 'rewritten', text: null, notice: { tone: 'warning', text: `${error.title}. ${error.message}` } })
    }
    if (!result.data.changed) {
      return dispatch({ type: 'rewritten', text: null, notice: { tone: 'warning', text: result.data.reason ?? 'The answer was kept as it was.' } })
    }
    if (action === 'custom') setCustom(null)
    dispatch({ type: 'rewritten', text: result.data.answer, notice: { tone: 'success', text: action === 'fit' ? 'Fitted to the limit.' : 'Rewritten.', undo: true } })
  }

  async function save() {
    if (state.step !== 'answer') return
    dispatch({ type: 'busy', busy: 'save' })
    const job = getJobContext()
    const result = await send('saveAnswer', {
      question: target.question,
      answer: state.text.trim(),
      category: state.response?.category ?? null,
      company: job.company ?? null,
      role: job.role ?? null,
    })
    if (!alive.current) return
    if (result.ok) {
      dispatch({ type: 'saved', id: result.data.id })
      onFilled('Saved as your preferred answer')
    } else {
      dispatch({ type: 'busy', busy: null })
      dispatch({ type: 'fillError', message: friendlyError(result.error, 'save this answer').title })
    }
  }

  function fill() {
    if (state.step !== 'answer' || !state.text.trim()) return
    const result = fillField(target.el, state.text.trim())
    if (!result.ok) {
      dispatch({ type: 'fillError', message: "This field didn't accept the text. Copy it and paste it in instead." })
      return
    }
    clearDraft(draftId)
    void send('track', {
      kind: 'fill',
      category: state.response?.category ?? null,
      duration_ms: waitMs.current,
      edited: state.text.trim() !== state.original.trim(),
    })
    onFilled('Answer filled. Review it before submitting.')
    onClose()
  }

  function discardDraft() {
    clearDraft(draftId)
    void match()
  }

  // Ask-and-Learn: save what the user gave (if they chose to remember it), then answer with it straight away.
  async function learn(submit: MissingSubmit) {
    const text = submit.remember ? null : directAnswer(submit)
    dispatch({ type: 'learning', busy: true })
    const result = await applyMissing(submit, target.question, getJobContext())
    if (!alive.current) return
    if (!result.ok) {
      dispatch({ type: 'learning', busy: false, error: result.error })
      return
    }
    const notice: Notice = submit.remember ? { tone: 'success', text: LEARNED } : null
    // A preference given just for this form is the answer itself; no need to generate.
    if (text) dispatch({ type: 'useText', text, notice })
    else if (submit.remember) void match(notice)
    else void generate(result.facts, notice)
  }

  function skip() {
    if (state.step === 'insufficient') void send('track', { kind: 'ask_and_learn_skipped', category: state.response.category })
    onClose({ refocus: true })
  }

  async function updateMemory(source: UsedSource, value: string, everywhere: boolean) {
    dispatch({ type: 'busy', busy: 'memory' })
    const result = await send('updateMemory', { id: source.id, changes: { value, ...(everywhere ? { scope: 'global' as const } : {}) } })
    if (!alive.current) return
    if (!result.ok) return dispatch({ type: 'notice', notice: { tone: 'warning', text: friendlyError(result.error, 'update your memory').title } })
    void match({ tone: 'success', text: `Application Memory updated: ${source.label} → ${result.data.value}` })
  }

  async function useSaved(saved: SavedAnswer) {
    dispatch({ type: 'useSaved', match: saved })
    void send('useSaved', { id: saved.id })
  }

  // Keyboard users land in the dialog when it opens (the answer box takes focus once there is one).
  useEffect(() => {
    if (state.step !== 'answer') ref.current?.focus({ preventScroll: true })
  }, [])

  function onKeyDown(e: React.KeyboardEvent) {
    trapTab(e, ref.current)
    if (e.key === 'Escape') {
      e.stopPropagation()
      if (showMore) setShowMore(false)
      else onClose({ refocus: true })
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && state.step === 'answer') {
      e.preventDefault()
      fill()
    }
  }

  const category = (state.step === 'answer' && state.response?.category) || localCategory(target.question)
  const kind = target.field.kind
  const freeText = !(kind === 'number' || kind === 'choice_single' || kind === 'choice_multi')
  const limits = { maxLength: target.field.maxLength ?? null, maxWords: target.field.maxWords ?? null, minLength: target.field.minLength ?? null }
  const count = state.step === 'answer' ? countFor(state.text, limits) : null
  const tooLong = count?.state === 'over'
  const response = state.step === 'answer' ? state.response : null
  const source = response ? answerSource(response) : state.step === 'answer' && state.savedId ? { title: 'Saved answer', detail: null } : null
  const memoryUsed = response?.origin === 'memory' ? response.usedSources.find((s) => s.type === 'fact' && s.id) : undefined
  const busy = state.step === 'answer' ? state.busy : null
  const error = state.step === 'error' ? friendlyError(state.error) : null

  return (
    <div
      ref={ref}
      className="popover"
      role="dialog"
      tabIndex={-1}
      aria-label={`Ansly answer: ${target.question}`}
      aria-busy={state.step === 'matching' || state.step === 'generating'}
      style={{ top: position?.top ?? -9999, left: position?.left ?? -9999, width: position?.width ?? 420 }}
      onKeyDown={onKeyDown}
    >
      <div className="header">
        <span className="brand">Ansly</span>
        <span className="question" title={target.question}>{target.question}</span>
        <button className="icon-btn" aria-label="Close" onClick={() => onClose({ refocus: true })}>×</button>
      </div>

      <div className="body">
        {(state.step === 'matching' || state.step === 'generating') && (
          <div className="loading" role="status">
            <span className="spinner" aria-hidden="true" />
            {state.step === 'matching' ? 'Finding your answer…' : 'Generating answer…'}
            <div className="skeleton" aria-hidden="true"><span /><span /><span /></div>
          </div>
        )}

        {restOffered && onAnswerRest && restCount > 0 && state.step !== 'error' && (
          <div className="notice hint">
            {restCount} more long questions on this page are empty. Answer them together for faster generation.{' '}
            <button className="link" onClick={() => { setRestOffered(false); onAnswerRest() }}>Answer the rest together</button>
          </div>
        )}

        {state.step === 'saved' && (
          <>
            <p><strong>A similar saved answer was found.</strong></p>
            <p className="muted">Saved for: “{state.match.question}”</p>
            <div className="saved-preview">{state.match.answer}</div>
          </>
        )}

        {state.step === 'answer' && (
          <>
            {state.notice && (
              <div className={`notice ${state.notice.tone}`} role="status">
                {state.notice.text}
                {state.notice.undo && state.previous !== null && (
                  <> <button className="link" onClick={() => dispatch({ type: 'undoRewrite' })}>Undo</button></>
                )}
                {state.original === '' && (
                  <> <button className="link" onClick={discardDraft}>Discard</button></>
                )}
              </div>
            )}
            <textarea
              ref={textareaRef}
              className="answer"
              aria-label="Answer (you can edit it)"
              aria-describedby="ansly-count"
              value={state.text}
              readOnly={busy === 'rewrite'}
              onChange={(e) => dispatch({ type: 'edit', text: e.target.value })}
            />
            <div className="meta">
              {source && (
                <span className="source">
                  <strong>{source.title}</strong>{source.detail && <> · {source.detail}</>}
                </span>
              )}
              <span className="spacer" />
              {count && (
                <span id="ansly-count" className={`count ${count.state}`} aria-live="polite">{count.label}</span>
              )}
            </div>
            {tooLong && count && freeText && (
              <div className="notice warning limit">
                {count.over} {count.unit} over the limit.
                <button className="btn small" disabled={busy !== null} onClick={() => void rewrite('fit')}>
                  {busy === 'rewrite' ? 'Fitting…' : 'Fit to limit'}
                </button>
              </div>
            )}
            {response?.confidence === 'low' && (
              <div className="notice warning"><strong>{REVIEW_RECOMMENDED.title}</strong> {REVIEW_RECOMMENDED.detail}</div>
            )}
            {response && response.usedSources.length > 0 && !memoryUsed && (
              <div className="based-on">
                <span className="muted">Based on</span>
                <ul>{response.usedSources.map((s, i) => <li key={`${s.type}-${s.id}-${i}`}>{s.label}</li>)}</ul>
              </div>
            )}
            {memoryUsed && (
              <MemoryUsed source={memoryUsed} value={state.text} busy={busy === 'memory'} onSave={(v, all) => void updateMemory(memoryUsed, v, all)} />
            )}
            {freeText && (
              <div className="rewrite-bar" role="toolbar" aria-label="Rewrite">
                {QUICK.map((q) => (
                  <button key={q.action} className="chip-btn" disabled={busy !== null || !state.text.trim()} onClick={() => void rewrite(q.action)}>{q.label}</button>
                ))}
                <div className="menu-wrap">
                  <button className="chip-btn" aria-haspopup="menu" aria-expanded={showMore} disabled={busy !== null} onClick={() => setShowMore((v) => !v)}>More ▾</button>
                  {showMore && (
                    <div className="menu" role="menu">
                      {MORE.map((m) => (
                        <button key={m.action} role="menuitem" onClick={() => void rewrite(m.action)}>{m.label}</button>
                      ))}
                      <button role="menuitem" onClick={() => { setShowMore(false); setCustom('') }}>Rewrite…</button>
                    </div>
                  )}
                </div>
                {busy === 'rewrite' && <span className="muted" role="status">Rewriting…</span>}
              </div>
            )}
            {custom !== null && (
              <div className="style-row">
                <input className="instruction" aria-label="How should Ansly rewrite it?" autoFocus maxLength={500}
                  placeholder="e.g. More direct, emphasize backend experience" value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && custom.trim()) {
                      e.preventDefault()
                      void rewrite('custom', custom.trim())
                    }
                  }} />
                <button className="btn small primary" disabled={!custom.trim() || busy !== null} onClick={() => void rewrite('custom', custom.trim())}>Rewrite</button>
                <button className="link" onClick={() => setCustom(null)}>Cancel</button>
              </div>
            )}
            {showDetails && (
              <div className="details">
                <StyleBar
                  draft={draft}
                  applied={style}
                  category={category}
                  disabled={busy !== null}
                  onChange={setDraft}
                  onApply={() => void regenerate(draft)}
                />
                {response?.provider && <span className="muted small">Model: {response.provider}{response.model ? ` · ${response.model}` : ''}</span>}
              </div>
            )}
            {category === 'cover_letter' && !useJobDescription && (
              <div className="notice hint">
                Cover letters are better with the job description. Enable “Use job descriptions” in the Ansly popup.
              </div>
            )}
            {state.fillError && <div className="notice error" role="alert">{state.fillError}</div>}
          </>
        )}

        {state.step === 'insufficient' && (
          state.response.missing.length > 0 ? (
            <MissingForm items={state.response.missing} busy={state.learning} error={state.learnError} question={target.question}
              company={getJobContext().company ?? null} onSubmit={(s) => void learn(s)} onSkip={skip} />
          ) : (
            <div className="notice warning">
              <strong>Ansly needs more information from you.</strong>
              {state.response.missingInformation}
            </div>
          )
        )}

        {error && (
          <div className="notice error" role="alert">
            <strong>{error.title}</strong>
            {error.message}
          </div>
        )}
      </div>

      <div className="footer">
        {state.step === 'saved' && (
          <>
            <button className="btn" onClick={() => void generate()}>Generate new answer</button>
            <span className="spacer" />
            <button className="btn primary" onClick={() => void useSaved(state.match)}>Use saved answer</button>
          </>
        )}
        {state.step === 'answer' && (
          <>
            <div className="secondary">
              <button
                className="link"
                disabled={busy !== null || !state.text.trim() || (state.savedId !== null && state.text === state.original)}
                onClick={() => void save()}
                title="Offer this answer next time a similar question comes up"
              >
                {busy === 'save' ? 'Saving…' : state.savedId !== null && state.text === state.original ? 'Saved' : 'Save'}
              </button>
              <button className="link" disabled={busy !== null} onClick={() => void regenerate()} title="Write a new version from your profile">
                {busy === 'regenerate' ? 'Regenerating…' : 'Regenerate'}
              </button>
              <button className="link" aria-expanded={showDetails} onClick={() => setShowDetails((v) => !v)}>Details</button>
            </div>
            <span className="spacer" />
            <button className="btn primary" disabled={!state.text.trim() || tooLong || busy === 'rewrite'} onClick={fill} title="Ctrl+Enter">
              Fill answer
            </button>
          </>
        )}
        {state.step === 'insufficient' && state.response.missing.length === 0 && (
          <>
            <button className="btn" onClick={() => void generate()}>Try again</button>
            <span className="spacer" />
            <button className="btn primary" onClick={() => void send('openWebApp', { path: '/profile' })}>Add information</button>
          </>
        )}
        {error && (
          <>
            <span className="spacer" />
            {error.action === 'connect' ? (
              <button className="btn primary" onClick={() => void send('openWebApp', { path: '/extension' })}>Connect Ansly</button>
            ) : error.action === 'reload' ? (
              <button className="btn primary" onClick={() => location.reload()}>Reload page</button>
            ) : (
              <button className="btn primary" onClick={() => void (state.step === 'error' && state.retry === 'match' ? match() : generate())}>Try again</button>
            )}
          </>
        )}
        {(state.step === 'matching' || state.step === 'generating') && (
          <>
            <span className="spacer" />
            <button className="btn" onClick={() => onClose({ refocus: true })}>Cancel</button>
          </>
        )}
      </div>
      <p className="trust muted">Uses your profile only · Never submits automatically</p>
    </div>
  )
}
