import type { AnswerResponse, AnswerStyle, FieldContext, JobContext, SavedAnswer } from '@ansly/types'
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import { fillField } from '@/lib/fill'
import { popoverPosition, popoverWidth, type Box } from '@/lib/geometry'
import { send, type ApiFailure } from '@/lib/messages'
import { autoLabel, LENGTHS, localCategory, resolveLength, sameStyle, TONES } from '@/lib/style'
import { applyMissing, directAnswer, MissingForm, type MissingSubmit } from './MissingForm'

export interface PopoverTarget {
  el: HTMLElement
  question: string
  field: FieldContext
}

type State =
  | { step: 'matching' }
  | { step: 'saved'; match: SavedAnswer }
  | { step: 'generating' }
  | { step: 'answer'; response: AnswerResponse | null; text: string; original: string; savedId: string | null; busy: 'regenerate' | 'save' | null; fillError: string | null }
  | { step: 'insufficient'; response: AnswerResponse; learning: boolean; learnError: string | null }
  | { step: 'error'; error: ApiFailure; retry: 'generate' | 'match' }

type Action =
  | { type: 'matched'; match: SavedAnswer | null }
  | { type: 'generate' }
  | { type: 'generated'; response: AnswerResponse }
  | { type: 'useSaved'; match: SavedAnswer }
  | { type: 'useText'; text: string }
  | { type: 'learning'; busy: boolean; error?: string | null }
  | { type: 'edit'; text: string }
  | { type: 'busy'; busy: 'regenerate' | 'save' | null }
  | { type: 'saved'; id: string }
  | { type: 'fillError'; message: string }
  | { type: 'failed'; error: ApiFailure; retry: 'generate' | 'match' }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'matched':
      return action.match ? { step: 'saved', match: action.match } : { step: 'generating' }
    case 'generate':
      return { step: 'generating' }
    case 'generated':
      if (action.response.status === 'insufficient_information') {
        return { step: 'insufficient', response: action.response, learning: false, learnError: null }
      }
      return { step: 'answer', response: action.response, text: action.response.answer, original: action.response.answer, savedId: null, busy: null, fillError: null }
    case 'useSaved':
      return { step: 'answer', response: null, text: action.match.answer, original: action.match.answer, savedId: action.match.id, busy: null, fillError: null }
    case 'useText':
      return { step: 'answer', response: null, text: action.text, original: action.text, savedId: null, busy: null, fillError: null }
    case 'learning':
      return state.step === 'insufficient' ? { ...state, learning: action.busy, learnError: action.error ?? null } : state
    case 'edit':
      return state.step === 'answer' ? { ...state, text: action.text, fillError: null } : state
    case 'busy':
      return state.step === 'answer' ? { ...state, busy: action.busy } : state
    case 'saved':
      return state.step === 'answer' ? { ...state, savedId: action.id, original: state.text, busy: null } : state
    case 'fillError':
      return state.step === 'answer' ? { ...state, fillError: action.message } : state
    case 'failed':
      return { step: 'error', error: action.error, retry: action.retry }
  }
}

const DEFAULT_STYLE: AnswerStyle = { length: 'auto', tone: 'professional' }

/** Length / tone / instruction. Changes are staged; "Apply" regenerates once instead of on every click. */
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
}: {
  target: PopoverTarget
  getJobContext: (questions?: string[]) => JobContext
  /** From popup settings; the user can change it per field. */
  defaultStyle?: AnswerStyle
  /** Off -> cover letters show a hint to turn it on. */
  useJobDescription?: boolean
  onClose: (opts?: { refocus?: boolean }) => void
  onFilled: (message: string) => void
}) {
  const [state, dispatch] = useReducer(reducer, { step: 'matching' })
  // `style` is what requests use; `draft` is what the controls show until Apply.
  const [style, setStyle] = useState<AnswerStyle>(defaultStyle)
  const [draft, setDraft] = useState<AnswerStyle>(defaultStyle)
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const alive = useRef(true)
  useEffect(() => () => void (alive.current = false), [])

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

  const generate = useCallback(async (facts: string[] | null = null) => {
    dispatch({ type: 'generate' })
    const result = await send('generate', request(style, facts))
    if (!alive.current) return
    if (result.ok) dispatch({ type: 'generated', response: result.data })
    else dispatch({ type: 'failed', error: result.error, retry: 'generate' })
  }, [request])

  const match = useCallback(async () => {
    const result = await send('matchSaved', { question: target.question })
    if (!alive.current) return
    if (!result.ok) {
      // A broken saved-answer lookup shouldn't block generating; only auth problems stop here.
      if (result.error.code === 'not_connected') dispatch({ type: 'failed', error: result.error, retry: 'match' })
      else void generate()
      return
    }
    dispatch({ type: 'matched', match: result.data.match })
    if (!result.data.match) void generate()
  }, [target.question, generate])

  // Only on open: later style changes regenerate via Apply, not by re-matching.
  useEffect(() => {
    void match()
  }, [target.question])

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
    if (state.step === 'answer') textareaRef.current?.focus()
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
      dispatch({ type: 'fillError', message: result.error.message })
    }
  }

  function fill() {
    if (state.step !== 'answer' || !state.text.trim()) return
    const result = fillField(target.el, state.text.trim())
    if (!result.ok) {
      dispatch({ type: 'fillError', message: "This field didn't accept the text. Copy it and paste it in instead." })
      return
    }
    void send('track', { kind: 'fill', category: state.response?.category ?? null })
    onFilled('Answer filled — review it before submitting')
    onClose()
  }

  // Ask-and-learn: save what the user gave, then answer with it.
  async function learn(submit: MissingSubmit) {
    const text = submit.saveToProfile ? null : directAnswer(submit)
    dispatch({ type: 'learning', busy: true })
    const result = await applyMissing(submit, target.question)
    if (!alive.current) return
    if (!result.ok) {
      dispatch({ type: 'learning', busy: false, error: result.error })
      return
    }
    // A preference given just for this form is the answer itself; no need to generate.
    if (text) dispatch({ type: 'useText', text })
    else void generate(result.facts)
  }

  async function useSaved(saved: SavedAnswer) {
    dispatch({ type: 'useSaved', match: saved })
    void send('useSaved', { id: saved.id })
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose({ refocus: true })
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && state.step === 'answer') {
      e.preventDefault()
      fill()
    }
  }

  const category = (state.step === 'answer' && state.response?.category) || localCategory(target.question)
  const maxLength = target.field.maxLength ?? null
  const textLength = state.step === 'answer' ? state.text.trim().length : 0
  const tooLong = maxLength != null && textLength > maxLength

  return (
    <div
      ref={ref}
      className="popover"
      role="dialog"
      aria-label="Ansly answer"
      style={{ top: position?.top ?? -9999, left: position?.left ?? -9999, width: position?.width ?? 420 }}
      onKeyDown={onKeyDown}
    >
      <div className="header">
        <span className="brand">✨ Ansly</span>
        <span className="question" title={target.question}>{target.question}</span>
        <button className="icon-btn" aria-label="Close" onClick={() => onClose({ refocus: true })}>×</button>
      </div>

      <div className="body">
        {(state.step === 'matching' || state.step === 'generating') && (
          <div className="loading" role="status">
            <span className="spinner" />
            {state.step === 'matching' ? 'Checking your saved answers…' : 'Writing your answer from your profile…'}
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
            <textarea
              ref={textareaRef}
              className="answer"
              aria-label="Answer (you can edit it)"
              value={state.text}
              onChange={(e) => dispatch({ type: 'edit', text: e.target.value })}
            />
            <div className="meta">
              {state.response ? (
                <>
                  <span className={`chip ${state.response.confidence}`}>{state.response.confidence} confidence</span>
                  {state.response.usedSources.length > 0 && (
                    <span>Based on: {state.response.usedSources.map((s) => s.label).join(', ')}</span>
                  )}
                </>
              ) : (
                <span className="chip">Saved answer</span>
              )}
              <span className="spacer" />
              <span className={`count ${tooLong ? 'over' : ''}`}>
                {textLength}{maxLength != null ? ` / ${maxLength}` : ''} characters
              </span>
            </div>
            <StyleBar
              draft={draft}
              applied={style}
              category={category}
              disabled={state.busy !== null}
              onChange={setDraft}
              onApply={() => void regenerate(draft)}
            />
            {category === 'cover_letter' && !useJobDescription && (
              <div className="notice hint">
                Cover letters are better with the job description — enable “Use job descriptions” in the Ansly popup.
              </div>
            )}
            {state.fillError && <div className="notice error">{state.fillError}</div>}
          </>
        )}

        {state.step === 'insufficient' && (
          (state.response.missing ?? []).length > 0 ? (
            <MissingForm items={state.response.missing} busy={state.learning} error={state.learnError} onSubmit={(s) => void learn(s)} />
          ) : (
            <div className="notice warning">
              <strong>Your profile doesn&apos;t have enough to answer this truthfully.</strong>
              {state.response.missingInformation}
            </div>
          )
        )}

        {state.step === 'error' && (
          <div className="notice error">
            <strong>{state.error.code === 'not_connected' ? 'Ansly isn’t connected' : 'Couldn’t generate an answer'}</strong>
            {state.error.message}
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
            <button className="btn" disabled={state.busy !== null} onClick={() => void regenerate()} title="Same settings, new attempt">
              {state.busy === 'regenerate' ? 'Regenerating…' : 'Regenerate'}
            </button>
            <button
              className="btn"
              disabled={state.busy !== null || !state.text.trim() || (state.savedId !== null && state.text === state.original)}
              onClick={() => void save()}
              title="Offer this answer next time a similar question comes up"
            >
              {state.busy === 'save' ? 'Saving…' : state.savedId !== null && state.text === state.original ? 'Saved' : 'Save as preferred'}
            </button>
            <span className="spacer" />
            <button className="btn primary" disabled={!state.text.trim() || tooLong} onClick={fill} title="Ctrl+Enter">
              Fill
            </button>
          </>
        )}
        {state.step === 'insufficient' && (
          <>
            <button className="btn" onClick={() => void generate()}>Try again</button>
            <span className="spacer" />
            {(state.response.missing ?? []).length > 0 ? (
              <button className="link" onClick={() => void send('openWebApp', { path: '/profile' })}>Edit profile on the web</button>
            ) : (
              <button className="btn primary" onClick={() => void send('openWebApp', { path: '/profile' })}>Add information</button>
            )}
          </>
        )}
        {state.step === 'error' && (
          <>
            <span className="spacer" />
            {state.error.code === 'not_connected' ? (
              <button className="btn primary" onClick={() => void send('openWebApp', { path: '/extension' })}>Connect Ansly</button>
            ) : (
              <button className="btn primary" onClick={() => void (state.retry === 'match' ? match() : generate())}>Retry</button>
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
    </div>
  )
}
