import type { AnswerLength, AnswerTone, BatchAnswerResult, FieldContext, JobContext, ProfileKey } from '@ansly/types'
import { useEffect, useRef, useState } from 'react'
import type { TrackedField } from '@/lib/detection/scan'
import { fillChoice, fillField, hasValue, restoreValue, snapshotValue, type Snapshot } from '@/lib/fill'
import { send } from '@/lib/messages'
import { LENGTHS, TONES } from '@/lib/style'
import { applyMissing, directAnswer, MissingForm, type MissingSubmit } from './MissingForm'

export type RowStatus = 'idle' | 'working' | 'review' | 'filled' | 'low' | 'needs' | 'failed' | 'skipped'

export interface Row {
  status: RowStatus
  answer?: string
  /** Shown under the question: why it was skipped / failed, or where the answer came from. */
  note?: string
  result?: BatchAnswerResult
  snapshot?: Snapshot
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
  working: 'Working…', review: 'Ready', filled: 'Filled', low: 'Check this', needs: 'Needs you', failed: 'Not filled', skipped: 'Skipped',
}

const isChoice = (f: TrackedField) => f.kind === 'choice_single' || f.kind === 'choice_multi'

/** What the API needs to know about a field. Comboboxes whose options aren't rendered are answered as text. */
export function fieldContext(f: TrackedField): FieldContext {
  const kind = isChoice(f) && !f.options?.length ? 'short_text' : f.kind
  return {
    label: f.question.text,
    maxLength: f.maxLength,
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

/** What the panel is doing, shown while it works so a single long request doesn't look stuck. */
type Progress = { step: 'profile' } | { step: 'answers'; count: number } | null

export function Panel({ fields, ignoredCount, defaults, useJobDescription, getJobContext, onClose, onRowsChange, onOpenField, run }: {
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
  /** Fill just these fields now ("Answer the rest together" in a popover); a new nonce runs it again. */
  run?: { ids: string[]; nonce: number } | null
}) {
  const [rows, setRows] = useState<Record<string, Row>>({})
  const [length, setLength] = useState<AnswerLength>(defaults.length)
  const [tone, setTone] = useState<AnswerTone>(defaults.tone)
  const [overwrite, setOverwrite] = useState(defaults.overwriteFilled)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [asking, setAsking] = useState<string | null>(null)
  const [learning, setLearning] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null })
  const [progress, setProgress] = useState<Progress>(null)
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const alive = useRef(true)
  useEffect(() => () => void (alive.current = false), [])
  useEffect(() => onRowsChange(rows), [rows, onRowsChange])

  const update = (id: string, row: Partial<Row>) => {
    if (alive.current) setRows((r) => ({ ...r, [id]: { ...(r[id] ?? { status: 'idle' }), ...row } }))
  }

  async function put(f: TrackedField, answer: string, low: boolean, note?: string) {
    const snapshot = rowsRef.current[f.id]?.snapshot ?? snapshotValue(f.controls)
    const ok = await fillAnswer(f, answer)
    update(f.id, ok
      ? { status: low ? 'low' : 'filled', answer, snapshot, note: low ? 'Low confidence: read this one first' : note }
      : { status: 'failed', answer, snapshot, note: isChoice(f) ? `Couldn't select "${answer}": select it manually` : "This field didn't accept the text" })
  }

  function handle(f: TrackedField, result: BatchAnswerResult, review: boolean) {
    if (result.error) return update(f.id, { status: 'failed', note: result.error, result })
    if (result.status === 'insufficient_information') {
      return update(f.id, { status: 'needs', result, note: result.missingInformation ?? undefined })
    }
    let note: string | undefined
    if (result.savedAnswerId) {
      void send('useSaved', { id: result.savedAnswerId })
      note = result.adaptedFrom ? 'Saved answer, adapted to this job' : 'Saved answer'
    }
    if (review) return update(f.id, { status: 'review', answer: result.answer, result, note })
    return put(f, result.answer, result.confidence === 'low', note)
  }

  async function generate(targets: TrackedField[], review: boolean, facts?: Record<string, string[] | null>) {
    targets.forEach((f) => update(f.id, { status: 'working', note: undefined }))
    const job = getJobContext(targets.map((f) => f.question.text))
    const result = await send('generateBatch', {
      job_context: job,
      style: { length, tone },
      items: targets.map((f) => ({ id: f.id, question: f.question.text, field: fieldContext(f), additional_facts: facts?.[f.id] ?? null })),
      check_saved: !facts,
    })
    if (!alive.current) return
    if (!result.ok) {
      setError(result.error.message)
      targets.forEach((f) => update(f.id, { status: 'failed', note: result.error.message }))
      return
    }
    const byId = new Map(result.data.results.map((r) => [r.id, r]))
    for (const f of targets) {
      const r = byId.get(f.id)
      if (r) await handle(f, r, review)
    }
  }

  /** Fills every open field, or only `only` (the popover's "Answer the rest together"). */
  async function fillAll(only?: Set<string>) {
    setRunning(true)
    setError(null)
    setAsking(null)
    const review = defaults.reviewBeforeFill
    const targets: TrackedField[] = []
    for (const f of fields) {
      if (only && !only.has(f.id)) continue
      const status = rowsRef.current[f.id]?.status
      if (status === 'filled' || status === 'low') continue
      if (!overwrite && hasValue(f.controls)) update(f.id, { status: 'skipped', note: 'Already has an answer' })
      else targets.push(f)
    }

    const profile = targets.filter((f) => f.kind === 'profile')
    const questions = targets.filter((f) => f.kind !== 'profile')
    // The profile values (read locally) and the questions don't depend on each other: both start at once.
    setProgress(questions.length ? { step: 'answers', count: questions.length } : { step: 'profile' })
    questions.forEach((f) => update(f.id, { status: 'working', note: undefined }))
    const chunks: TrackedField[][] = []
    for (let i = 0; i < questions.length; i += GENERATE_CHUNK) chunks.push(questions.slice(i, i + GENERATE_CHUNK))
    // Saved answers, profile facts and the cache are resolved on the server in the same request; only the rest
    // reach the model.
    const answering = Promise.all(chunks.map((chunk) => generate(chunk, review)))

    // Profile fields: straight from the profile, no model. They fill while the answers are written.
    if (profile.length) {
      const values = await send('getProfileValues', null)
      if (!alive.current) return
      if (!values.ok) {
        setError(values.error.code === 'not_connected' ? 'Connect Ansly to your account first.' : values.error.message)
      } else {
        for (const f of profile) {
          const value = f.profileKey ? values.data[f.profileKey] : undefined
          if (value) await put(f, value, false, 'From your profile')
          else update(f.id, { status: 'skipped', note: `Add your ${PROFILE_LABELS[f.profileKey!] ?? 'details'} to your profile` })
        }
      }
    }

    await answering
    void send('track', { kind: 'fill_all', category: null })
    if (alive.current) {
      setRunning(false)
      setProgress(null)
    }
  }

  // "Answer the rest together" from a popover: fill those fields, once per request.
  const lastRun = useRef<number | null>(null)
  useEffect(() => {
    if (!run || run.nonce === lastRun.current || running) return
    lastRun.current = run.nonce
    void fillAll(new Set(run.ids))
  }, [run, running])

  async function fillReviewed() {
    for (const f of fields) {
      const row = rowsRef.current[f.id]
      if (row?.status === 'review' && row.answer) await put(f, row.answer, row.result?.confidence === 'low', row.note)
    }
  }

  function undo(f: TrackedField) {
    const row = rowsRef.current[f.id]
    if (!row?.snapshot) return
    const ok = restoreValue(row.snapshot)
    update(f.id, ok ? { status: 'idle', answer: undefined, snapshot: undefined, note: undefined } : { note: 'Reset this one by hand' })
  }

  async function learn(f: TrackedField, submit: MissingSubmit) {
    const direct = submit.saveToProfile ? null : directAnswer(submit)
    setLearning({ busy: true, error: null })
    const result = await applyMissing(submit, f.question.text)
    if (!alive.current) return
    if (!result.ok) return setLearning({ busy: false, error: result.error })
    setLearning({ busy: false, error: null })
    setAsking(null)
    if (direct) await put(f, direct, false)
    else await generate([f], false, { [f.id]: result.facts })
  }

  const all = fields.map((f) => ({ f, row: rows[f.id] ?? { status: 'idle' as RowStatus } }))
  const groups = [
    { title: 'Profile', items: all.filter(({ f, row }) => f.kind === 'profile' && row.status !== 'needs'), hint: 'instant' },
    { title: 'Questions', items: all.filter(({ f, row }) => f.kind !== 'profile' && row.status !== 'needs') },
    { title: 'Needs you', items: all.filter(({ row }) => row.status === 'needs') },
  ].filter((g) => g.items.length)
  const filled = all.filter(({ row }) => row.snapshot && ['filled', 'low', 'failed'].includes(row.status))
  const reviewCount = all.filter(({ row }) => row.status === 'review').length
  const hasCoverLetter = fields.some((f) => /\bcover(ing)? letter\b/i.test(f.question.text))

  return (
    <div className="panel" role="dialog" aria-label="Ansly: fill this page">
      <div className="header">
        <span className="brand">✨ Ansly</span>
        <span className="question">
          Found {fields.length} field{fields.length === 1 ? '' : 's'} on this page
          {ignoredCount > 0 && <span className="muted"> · {ignoredCount} skipped</span>}
        </span>
        <button className="icon-btn" aria-label="Close" onClick={onClose}>×</button>
      </div>

      <div className="body">
        {groups.map((g) => (
          <section key={g.title} className="group">
            <h3>{g.title} ({g.items.length}){g.hint && <span className="muted"> · {g.hint}</span>}</h3>
            <ul>
              {g.items.map(({ f, row }) => (
                <li key={f.id} className={`row s-${row.status}`}>
                  <div className="row-main">
                    <button className="row-q link-plain" title={f.question.text} onClick={() => onOpenField(f)}>{f.question.text}</button>
                    {STATUS_LABELS[row.status] && <span className={`status s-${row.status}`}>{STATUS_LABELS[row.status]}</span>}
                    {row.status === 'needs' && (row.result?.missing ?? []).length > 0 && (
                      <button className="btn small" onClick={() => setAsking(asking === f.id ? null : f.id)}>Answer</button>
                    )}
                    {row.snapshot && ['filled', 'low', 'failed'].includes(row.status) && (
                      <button className="btn small" onClick={() => undo(f)}>Undo</button>
                    )}
                  </div>
                  {row.status === 'review' && row.answer && <div className="row-answer">{row.answer}</div>}
                  {row.note && <div className="row-note">{row.note}</div>}
                  {asking === f.id && row.result && (
                    <MissingForm items={row.result.missing} busy={learning.busy} error={learning.error} onSubmit={(s) => void learn(f, s)} />
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}

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
        {hasCoverLetter && !useJobDescription && (
          <div className="notice hint">Cover letters are better with the job description — enable “Use job descriptions” in the Ansly popup.</div>
        )}
        {progress && (
          <div className="loading" role="status">
            <span className="spinner" />
            {progress.step === 'profile'
              ? 'Filling from your profile…'
              : `Answering ${progress.count} question${progress.count === 1 ? '' : 's'}: saved answers and your profile first, then one request for the rest…`}
          </div>
        )}
        {error && <div className="notice error">{error}</div>}
      </div>

      <div className="footer">
        {filled.length > 0 && <button className="btn" disabled={running} onClick={() => filled.forEach(({ f }) => undo(f))}>Undo all</button>}
        <span className="spacer" />
        {reviewCount > 0 ? (
          <button className="btn primary" disabled={running} onClick={() => void fillReviewed()}>Fill {reviewCount} answer{reviewCount === 1 ? '' : 's'}</button>
        ) : (
          <button className="btn primary" disabled={running || fields.length === 0} onClick={() => void fillAll()}>
            {running ? 'Filling…' : 'Fill all'}
          </button>
        )}
      </div>
      <p className="panel-foot muted">Ansly never submits. Review the form, then submit it yourself.</p>
    </div>
  )
}
