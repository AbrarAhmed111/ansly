import type { AnswerLength, AnswerTone, BatchAnswerResult, FieldContext, JobContext, MissingInfo, ProfileKey } from '@ansly/types'
import { ANSWER_STATE_LABELS, answerSource, REVIEW_RECOMMENDED } from '@ansly/types'
import { useEffect, useRef, useState } from 'react'
import type { TrackedField } from '@/lib/detection/scan'
import { friendlyError } from '@/lib/errors'
import { trapTab } from '@/lib/focus'
import { fillChoice, fillField, hasValue, restoreValue, snapshotValue, type Snapshot } from '@/lib/fill'
import { send } from '@/lib/messages'
import { LENGTHS, TONES } from '@/lib/style'
import { applyMissing, LEARNED, MissingForm, type MissingSubmit } from './MissingForm'

/** One vocabulary everywhere (see ANSWER_STATE_LABELS): idle and skipped are the panel's own. */
export type RowStatus = 'idle' | 'generating' | 'ready' | 'review' | 'needs_info' | 'filled' | 'failed' | 'skipped'

export interface Row {
  status: RowStatus
  answer?: string
  /** Shown under the question: why it was skipped / failed, or where the answer came from. */
  note?: string
  result?: BatchAnswerResult
  snapshot?: Snapshot
  /** Ticked to be filled ("Fill N ready answers"). */
  selected?: boolean
}

// Questions per generate request (the API's limit). The server answers what it can without a model (profile
// facts, saved answers, its cache) and writes the rest in as few model calls as it can (up to 6 questions each,
// run side by side), so one request costs fewer calls than several smaller ones.
const GENERATE_CHUNK = 50

const PROFILE_LABELS: Record<ProfileKey, string> = {
  full_name: 'name', first_name: 'first name', last_name: 'last name', email: 'email', phone: 'phone number',
  location: 'location', city: 'location', headline: 'headline', linkedin: 'LinkedIn URL', github: 'GitHub URL',
  website: 'website', portfolio: 'portfolio URL', current_company: 'current role', current_title: 'current role',
}

const STATUS_LABELS: Partial<Record<RowStatus, string>> = {
  generating: ANSWER_STATE_LABELS.generating,
  ready: ANSWER_STATE_LABELS.ready,
  review: ANSWER_STATE_LABELS.review,
  needs_info: ANSWER_STATE_LABELS.needs_info,
  filled: ANSWER_STATE_LABELS.filled,
  failed: ANSWER_STATE_LABELS.failed,
  skipped: 'Skipped',
}
const STATUS_ICONS: Partial<Record<RowStatus, string>> = {
  generating: '…', ready: '✓', review: '!', needs_info: '?', filled: '✓', failed: '×', skipped: '–',
}

const isChoice = (f: TrackedField) => f.kind === 'choice_single' || f.kind === 'choice_multi'

/** What the API needs to know about a field. Comboboxes whose options aren't rendered are answered as text. */
export function fieldContext(f: TrackedField): FieldContext {
  const kind = isChoice(f) && !f.options?.length ? 'short_text' : f.kind
  return {
    label: f.question.text,
    maxLength: f.maxLength,
    ...(f.maxWords ? { maxWords: f.maxWords } : {}),
    ...(f.minLength ? { minLength: f.minLength } : {}),
    kind: kind === 'profile' || kind === 'ignored' ? null : kind,
    options: isChoice(f) ? (f.options ?? null) : null,
  }
}

/** Puts an answer into a field and checks it stuck. */
export async function fillAnswer(f: TrackedField, answer: string): Promise<boolean> {
  if (isChoice(f) || f.control === 'select' || f.control === 'combobox' || f.control === 'listbox') {
    return fillChoice(f.controls, answer, f.options ?? [])
  }
  return fillField(f.controls[0]!, answer).ok
}

/** Every distinct gap behind the blocked answers, asked once ("Ansly needs 3 details"). */
export function missingItems(rows: { f: TrackedField; row: Row }[]): MissingInfo[] {
  const seen = new Map<string, MissingInfo>()
  for (const { row } of rows) {
    if (row.status !== 'needs_info') continue
    for (const item of row.result?.missing ?? []) if (!seen.has(item.key)) seen.set(item.key, item)
  }
  return [...seen.values()]
}

/** What the panel is doing, shown while it works so a single long request doesn't look stuck. */
type Progress = { step: 'profile' } | { step: 'answers'; count: number } | null

export function Panel({ fields, ignoredCount, defaults, useJobDescription, getJobContext, onClose, onRowsChange, onOpenField, run, job }: {
  /** Detected fields (not ignored), in page order. */
  fields: TrackedField[]
  ignoredCount: number
  defaults: { length: AnswerLength; tone: AnswerTone; reviewBeforeFill: boolean; overwriteFilled: boolean }
  useJobDescription: boolean
  getJobContext: (questions?: string[]) => JobContext
  onClose: () => void
  onRowsChange: (rows: Record<string, Row>) => void
  /** Opens the normal popover for a field (edit / regenerate one answer). */
  onOpenField: (f: TrackedField) => void
  /** Answer just these fields now ("Answer the rest together" in a popover); a new nonce runs it again. */
  run?: { ids: string[]; nonce: number } | null
  /** The job posting detected on the page, shown in the header (read locally). */
  job?: { title: string | null; company: string | null } | null
}) {
  const [rows, setRows] = useState<Record<string, Row>>({})
  const [length, setLength] = useState<AnswerLength>(defaults.length)
  const [tone, setTone] = useState<AnswerTone>(defaults.tone)
  const [overwrite, setOverwrite] = useState(defaults.overwriteFilled)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [learning, setLearning] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null })
  const [progress, setProgress] = useState<Progress>(null)
  const [onlyWarnings, setOnlyWarnings] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const alive = useRef(true)
  const askedShown = useRef(false)
  useEffect(() => () => void (alive.current = false), [])
  useEffect(() => onRowsChange(rows), [rows, onRowsChange])

  // The ref is updated at once, so a step that runs right after another (fill after prepare) sees its rows.
  const update = (id: string, row: Partial<Row>) => {
    if (!alive.current) return
    const next = { ...rowsRef.current, [id]: { ...(rowsRef.current[id] ?? { status: 'idle' as RowStatus }), ...row } }
    rowsRef.current = next
    setRows(next)
  }

  async function put(f: TrackedField, answer: string, note?: string): Promise<boolean> {
    const snapshot = rowsRef.current[f.id]?.snapshot ?? snapshotValue(f.controls)
    const ok = await fillAnswer(f, answer)
    update(f.id, ok
      ? { status: 'filled', answer, snapshot, note, selected: false }
      : { status: 'failed', answer, snapshot, selected: false, note: isChoice(f) ? `Couldn't select "${answer}". Select it yourself.` : "This field didn't accept the text." })
    return ok
  }

  /** A result becomes Ready (ticked to fill), Review (unticked: read it first), Needs info or Failed. */
  function handle(f: TrackedField, result: BatchAnswerResult) {
    if (result.error) return update(f.id, { status: 'failed', note: 'Ansly couldn’t generate this one. Open it to try again.', result, selected: false })
    if (result.status === 'insufficient_information') {
      return update(f.id, { status: 'needs_info', result, selected: false,
        note: result.missing.length ? undefined : (result.missingInformation ?? 'Ansly needs more information from you.') })
    }
    if (result.savedAnswerId) void send('useSaved', { id: result.savedAnswerId })
    const source = answerSource(result)
    const note = [source.title, source.detail].filter(Boolean).join(' · ')
    if (result.confidence === 'low') {
      return update(f.id, { status: 'review', answer: result.answer, result, selected: false, note: `${REVIEW_RECOMMENDED.title}. ${REVIEW_RECOMMENDED.detail}` })
    }
    update(f.id, { status: 'ready', answer: result.answer, result, selected: true, note })
  }

  async function generate(targets: TrackedField[], facts?: Record<string, string[] | null>) {
    targets.forEach((f) => update(f.id, { status: 'generating', note: undefined, selected: false }))
    const job = getJobContext(targets.map((f) => f.question.text))
    const result = await send('generateBatch', {
      job_context: job,
      style: { length, tone },
      items: targets.map((f) => ({ id: f.id, question: f.question.text, field: fieldContext(f), additional_facts: facts?.[f.id] ?? null })),
      check_saved: !facts,
    })
    if (!alive.current) return
    if (!result.ok) {
      const friendly = friendlyError(result.error, 'prepare these answers')
      setError(result.error.code === 'rate_limited' ? result.error.message : `${friendly.title}. ${friendly.message}`)
      targets.forEach((f) => update(f.id, { status: 'failed', note: 'Not answered. Try again.' }))
      return
    }
    const byId = new Map(result.data.results.map((r) => [r.id, r]))
    for (const f of targets) {
      const r = byId.get(f.id)
      if (r) handle(f, r)
    }
  }

  /** Prepares every open field (or only `only`): profile values instantly, the questions in one request. */
  async function prepare(only?: Set<string>) {
    setRunning(true)
    setError(null)
    setBanner(null)
    const targets: TrackedField[] = []
    for (const f of fields) {
      if (only && !only.has(f.id)) continue
      const status = rowsRef.current[f.id]?.status
      if (status === 'filled') continue
      if (!overwrite && hasValue(f.controls)) update(f.id, { status: 'skipped', note: 'Already has an answer' })
      else targets.push(f)
    }

    const profile = targets.filter((f) => f.kind === 'profile')
    const questions = targets.filter((f) => f.kind !== 'profile')
    // The profile values (read locally) and the questions don't depend on each other: both start at once.
    setProgress(questions.length ? { step: 'answers', count: questions.length } : { step: 'profile' })
    const chunks: TrackedField[][] = []
    for (let i = 0; i < questions.length; i += GENERATE_CHUNK) chunks.push(questions.slice(i, i + GENERATE_CHUNK))
    // Saved answers, profile facts, memory and the cache are resolved on the server in the same request; only the
    // rest reach the model.
    const answering = Promise.all(chunks.map((chunk) => generate(chunk)))

    if (profile.length) {
      const values = await send('getProfileValues', null)
      if (!alive.current) return
      if (!values.ok) {
        setError(values.error.code === 'not_connected' ? 'Connect Ansly to your account first.' : friendlyError(values.error, 'read your profile').title)
      } else {
        for (const f of profile) {
          const value = f.profileKey ? values.data[f.profileKey] : undefined
          if (value) update(f.id, { status: 'ready', answer: value, selected: true, note: 'Instant · From your profile' })
          else update(f.id, { status: 'skipped', note: `Add your ${PROFILE_LABELS[f.profileKey!] ?? 'details'} to your profile` })
        }
      }
    }

    await answering
    void send('track', { kind: 'fill_all', category: null })
    if (!alive.current) return
    setRunning(false)
    setProgress(null)
    // Without review, what's ready goes in now; anything to review or answer waits for the user.
    if (!defaults.reviewBeforeFill) await fillSelected(only)
  }

  // "Answer the rest together" from a popover: answer those fields, once per request.
  const lastRun = useRef<number | null>(null)
  useEffect(() => {
    if (!run || run.nonce === lastRun.current || running) return
    lastRun.current = run.nonce
    void prepare(new Set(run.ids))
  }, [run, running])

  async function fillSelected(only?: Set<string>) {
    let filled = 0
    for (const f of fields) {
      if (only && !only.has(f.id)) continue
      const row = rowsRef.current[f.id]
      if (row?.selected && row.answer && (row.status === 'ready' || row.status === 'review')) {
        if (await put(f, row.answer, row.note)) filled++
      }
    }
    if (filled) {
      setBanner(`${filled} field${filled === 1 ? '' : 's'} filled. Review the form, then submit it yourself.`)
      void send('track', { kind: 'fill_all_completed', category: null })
    }
  }

  function undo(f: TrackedField, track = true) {
    const row = rowsRef.current[f.id]
    if (!row?.snapshot) return
    const ok = restoreValue(row.snapshot)
    update(f.id, ok ? { status: 'idle', answer: undefined, snapshot: undefined, note: undefined, selected: false } : { note: 'Reset this one by hand' })
    if (track) void send('track', { kind: 'undo', category: null })
  }

  function undoAll() {
    filled.forEach(({ f }) => undo(f, false))
    setBanner(null)
    void send('track', { kind: 'undo', category: 'all' })
  }

  // One form for every blocked answer; then every one of them is answered again, in one request.
  async function learn(submit: MissingSubmit) {
    const blocked = all.filter(({ row }) => row.status === 'needs_info').map(({ f }) => f)
    setLearning({ busy: true, error: null })
    const result = await applyMissing(submit, blocked[0]?.question.text ?? '', getJobContext())
    if (!alive.current) return
    if (!result.ok) return setLearning({ busy: false, error: result.error })
    setLearning({ busy: false, error: null })
    await generate(blocked, Object.fromEntries(blocked.map((f) => [f.id, result.facts])))
    if (!alive.current) return
    if (!defaults.reviewBeforeFill) await fillSelected(new Set(blocked.map((f) => f.id)))
    if (submit.remember) setBanner(LEARNED)
  }

  const toggle = (id: string) => update(id, { selected: !rowsRef.current[id]?.selected })
  const all = fields.map((f) => ({ f, row: rows[f.id] ?? { status: 'idle' as RowStatus } }))
  const count = (s: RowStatus) => all.filter(({ row }) => row.status === s).length
  const filled = all.filter(({ row }) => row.snapshot && ['filled', 'failed'].includes(row.status))
  const selected = all.filter(({ row }) => row.selected && row.answer && ['ready', 'review'].includes(row.status))
  const prepared = all.some(({ row }) => row.status !== 'idle')
  const asks = missingItems(all)
  const hasCoverLetter = fields.some((f) => /\bcover(ing)? letter\b/i.test(f.question.text))
  const profileCount = fields.filter((f) => f.kind === 'profile').length
  const visible = onlyWarnings ? all.filter(({ row }) => ['review', 'needs_info', 'failed'].includes(row.status)) : all

  useEffect(() => {
    if (asks.length && !askedShown.current) {
      askedShown.current = true
      void send('track', { kind: 'ask_and_learn_shown', category: 'fill_all' })
    }
  }, [asks.length])

  return (
    <div ref={panelRef} className="panel" role="dialog" aria-label="Ansly application assistant" tabIndex={-1}
      onKeyDown={(e) => {
        trapTab(e, panelRef.current)
        if (e.key === 'Escape') {
          e.stopPropagation()
          onClose()
        }
      }}>
      <div className="header">
        <span className="brand">Ansly</span>
        <span className="question">
          Application Assistant · {fields.length} field{fields.length === 1 ? '' : 's'}
          {ignoredCount > 0 && <span className="muted"> · {ignoredCount} skipped</span>}
        </span>
        <button className="icon-btn" aria-label="Close" onClick={onClose}>×</button>
      </div>

      <div className="body">
        {job && (job.title || job.company) && (
          <p className="job-line">
            <strong>{job.title ?? 'This job'}</strong>{job.company && <> · {job.company}</>}
          </p>
        )}
        {prepared ? (
          <div className="summary" role="status" aria-live="polite">
            <span className="sum s-ready"><b>{count('ready')}</b> Ready</span>
            <span className="sum s-review"><b>{count('review')}</b> Review</span>
            <span className="sum s-needs_info"><b>{count('needs_info')}</b> Needs info</span>
            {count('filled') > 0 && <span className="sum s-filled"><b>{count('filled')}</b> Filled</span>}
          </div>
        ) : (
          <p className="intro">
            {profileCount > 0 && <>{profileCount} from your profile, instantly. </>}
            {fields.length - profileCount > 0 && <>{fields.length - profileCount} question{fields.length - profileCount === 1 ? '' : 's'}, answered together. </>}
            Nothing is filled until you say so.
          </p>
        )}

        {banner && <div className="notice success" role="status">{banner}</div>}

        {asks.length > 0 && !running && (
          <MissingForm items={asks} busy={learning.busy} error={learning.error} company={getJobContext().company ?? null}
            onSubmit={(s) => void learn(s)} />
        )}

        <ul className="cards">
          {visible.map(({ f, row }) => {
            const selectable = !!row.answer && ['ready', 'review'].includes(row.status)
            return (
              <li key={f.id} className={`card s-${row.status}`}>
                <div className="row-main">
                  {selectable ? (
                    <input type="checkbox" checked={!!row.selected} onChange={() => toggle(f.id)} aria-label={`Fill “${f.question.text}”`} />
                  ) : (
                    <span className={`state-icon s-${row.status}`} aria-hidden="true">{STATUS_ICONS[row.status] ?? '○'}</span>
                  )}
                  <button className="row-q link-plain" title={`${f.question.text}: edit this answer`} onClick={() => onOpenField(f)}>{f.question.text}</button>
                  {STATUS_LABELS[row.status] && <span className={`status s-${row.status}`}>{STATUS_LABELS[row.status]}</span>}
                  {row.snapshot && ['filled', 'failed'].includes(row.status) && (
                    <button className="btn small" onClick={() => undo(f)}>Undo</button>
                  )}
                </div>
                {selectable && row.answer && (
                  <div className={`row-answer ${row.status === 'review' ? 'open' : ''}`}>{row.answer}</div>
                )}
                {row.note && <div className="row-note">{row.note}</div>}
              </li>
            )
          })}
        </ul>

        {showSettings && (
          <div className="details">
            <div className="style-row">
              <label className="inline">Length
                <select value={length} onChange={(e) => setLength(e.target.value as AnswerLength)}>
                  <option value="auto">Auto</option>
                  {LENGTHS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
              </label>
              <label className="inline">Tone
                <select value={tone} onChange={(e) => setTone(e.target.value as AnswerTone)}>
                  {TONES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </label>
            </div>
            <label className="check">
              <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
              Overwrite fields that already have text
            </label>
          </div>
        )}
        {hasCoverLetter && !useJobDescription && (
          <div className="notice hint">Cover letters are better with the job description. Enable “Use job descriptions” in the Ansly popup.</div>
        )}
        {progress && (
          <div className="loading" role="status">
            <span className="spinner" aria-hidden="true" />
            {progress.step === 'profile'
              ? 'Reading your profile…'
              : `Preparing ${progress.count} answer${progress.count === 1 ? '' : 's'}: your profile and saved answers first, then the rest together…`}
          </div>
        )}
        {error && <div className="notice error" role="alert">{error}</div>}
      </div>

      <div className="footer">
        {prepared && !running && (
          <div className="secondary">
            <button className="link" onClick={() => all.forEach(({ f, row }) => row.status === 'ready' && row.answer && update(f.id, { selected: true }))}>Select all ready</button>
            <button className="link" aria-pressed={onlyWarnings} onClick={() => setOnlyWarnings((v) => !v)}>{onlyWarnings ? 'Show all' : 'Review only warnings'}</button>
          </div>
        )}
        <button className="link" aria-expanded={showSettings} onClick={() => setShowSettings((v) => !v)}>Settings</button>
        <span className="spacer" />
        {filled.length > 0 && <button className="btn" disabled={running} onClick={undoAll}>Undo all</button>}
        {selected.length > 0 && !running ? (
          <button className="btn primary" onClick={() => void fillSelected()}>
            Fill {selected.length} {selected.every(({ row }) => row.status === 'ready') ? 'ready ' : ''}answer{selected.length === 1 ? '' : 's'}
          </button>
        ) : (
          <button className="btn primary" disabled={running || fields.length === 0} onClick={() => void prepare()}>
            {running ? 'Preparing…' : defaults.reviewBeforeFill ? (prepared ? 'Prepare the rest' : 'Prepare answers') : 'Fill all'}
          </button>
        )}
      </div>
      <p className="panel-foot muted">Uses your profile only · Never submits automatically · Review before you submit</p>
    </div>
  )
}
