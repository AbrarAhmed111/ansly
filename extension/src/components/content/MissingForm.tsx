import type { JobContext, MemoryScope, MissingInfo, SaveMissingRequest, SkillAnswer } from '@ansly/types'
import { useId, useState } from 'react'
import { send } from '@/lib/messages'

type Value = string | boolean | SkillAnswer

export interface MissingSubmit {
  /** What to write with POST /profile/missing (when remembering). */
  items: SaveMissingRequest['items']
  /** The user ticked "Remember": only then is anything saved. */
  remember: boolean
  /** Also store the typed answer verbatim as a saved answer. */
  reuse: boolean
  /** The answers as plain sentences, for answering once without saving. */
  facts: string[]
  /** The single typed value, when there is exactly one text answer. */
  text: string | null
}

export const LEARNED = 'Saved to your Application Memory. Ansly can now answer similar questions automatically.'

/**
 * Saves what the user gave (profile field / skill / memory fact) when they chose to remember it, and a saved
 * answer if asked. Returns the facts to send with the next generation when nothing was saved.
 */
export async function applyMissing(
  submit: MissingSubmit,
  question: string,
  job?: JobContext | null,
): Promise<{ ok: true; facts: string[] | null } | { ok: false; error: string }> {
  if (submit.remember) {
    // Only who and where the job is: provenance and scope, never the description.
    const job_context = job ? { company: job.company ?? null, role: job.role ?? null, url: job.url ?? null } : null
    const result = await send('saveMissing', { items: submit.items, job_context })
    if (!result.ok) return { ok: false, error: result.error.code === 'bad_request' ? result.error.message : 'Ansly couldn’t save that. Your answers are still here: try again.' }
  }
  if (submit.reuse && submit.text) void send('saveAnswer', { question, answer: submit.text })
  return { ok: true, facts: submit.remember ? null : submit.facts }
}

/** A preference typed in the form, as the text to put in the field ("Yes", "1 month"): no need to generate. */
export function directAnswer(submit: MissingSubmit): string | null {
  if (submit.items.length !== 1) return null
  const [item] = submit.items
  const direct = item!.target.type === 'profile_field' || (item!.target.type === 'fact' && item!.target.key)
  if (!direct) return null
  const value = item!.value
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return typeof value === 'string' ? (WORK_MODE_LABELS[value] ?? value) : null
}

const WORK_MODE_LABELS: Record<string, string> = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'On-site', flexible: 'Flexible' }

const SCOPE_LABELS: Record<MemoryScope, string> = {
  global: 'All applications',
  category: 'As a general preference',
  company: 'Only this company',
  job: 'Only this application',
}

function describe(item: MissingInfo, value: Value): string {
  if (item.target.type === 'skill') {
    const v = value as SkillAnswer
    if (!v.have) return `I have not used ${item.target.name}.`
    if (v.level === 'beginner' && v.years == null) return `I have some exposure to ${item.target.name}.`
    const detail = [v.years != null ? `${v.years} years` : null, v.level].filter(Boolean).join(', ')
    return `I have used ${item.target.name}${detail ? ` (${detail})` : ''}.`
  }
  if (typeof value === 'boolean') return `${item.prompt} ${value ? 'Yes' : 'No'}.`
  return `${item.prompt} ${String(value).trim()}`
}

const filled = (item: MissingInfo, value: Value | undefined) =>
  value !== undefined && (typeof value !== 'string' || value.trim() !== '') &&
  !(item.input === 'number' && typeof value === 'string' && Number.isNaN(Number(value))) &&
  !(item.input === 'skill' && typeof value === 'object' && value.have && value.years != null && Number.isNaN(value.years))

/** Options for a choice: its own, or Yes / No. */
function choices(item: MissingInfo): { value: string | boolean; label: string }[] {
  if (item.input === 'boolean') return [{ value: true, label: 'Yes' }, { value: false, label: 'No' }]
  return (item.options ?? []).map((o) => ({ value: o, label: WORK_MODE_LABELS[o] ?? o }))
}

const SKILL_CHOICES: { label: string; value: SkillAnswer }[] = [
  { label: 'Yes', value: { have: true, years: null, level: null } },
  { label: 'Some exposure', value: { have: true, years: null, level: 'beginner' } },
  { label: 'No', value: { have: false, years: null, level: null } },
]

function Segmented<T>({ id, label, options, value, equals, onChange }: {
  id: string
  label: string
  options: { label: string; value: T }[]
  value: T | undefined
  equals: (a: T | undefined, b: T) => boolean
  onChange: (value: T) => void
}) {
  return (
    <div className="segmented wrap" role="radiogroup" aria-labelledby={id}>
      {options.map((o) => {
        const on = equals(value, o.value)
        return (
          <button key={o.label} type="button" role="radio" aria-checked={on} className={on ? 'on' : ''} aria-label={`${label}: ${o.label}`}
            onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * "Ansly needs N details": asks for what's missing, in one form for every blocked answer, saves it to the
 * profile or Application Memory (only when the user ticks Remember), then the caller retries the answers.
 */
export function MissingForm({ items, busy, error, onSubmit, onSkip, question, company }: {
  items: MissingInfo[]
  busy: boolean
  error?: string | null
  onSubmit: (submit: MissingSubmit) => void
  /** "Skip for now": the answer stays blocked, Ansly asks again next time. */
  onSkip?: () => void
  /** The application's question, when the form is for one answer. */
  question?: string
  /** The company being applied to, for "Only this company". */
  company?: string | null
}) {
  const uid = useId()
  const [values, setValues] = useState<Record<string, Value>>({})
  const [scopes, setScopes] = useState<Record<string, MemoryScope>>({})
  const [remember, setRemember] = useState(true)
  const [reuse, setReuse] = useState(false)
  const set = (key: string, value: Value) => setValues((v) => ({ ...v, [key]: value }))
  const textItem = items.length === 1 && ['text', 'textarea'].includes(items[0]!.input) ? items[0]! : null
  const ready = items.every((i) => filled(i, values[i.key]))
  const n = items.length
  const groups = [...new Set(items.map((i) => i.group ?? 'Other'))]
  const scopeFor = (item: MissingInfo): MemoryScope => scopes[item.key] ?? item.scope ?? 'global'

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!ready || busy) return
    onSubmit({
      items: items.map((i) => {
        const raw = values[i.key]!
        const value = i.input === 'number' && typeof raw === 'string' ? raw.trim() : raw
        // Skills are facts about the person, always global; everything else carries the chosen scope.
        return { key: i.key, target: i.target, value, prompt: i.prompt, ...(i.target.type === 'skill' ? {} : { scope: scopeFor(i) }) }
      }),
      remember,
      reuse: reuse && textItem !== null,
      facts: items.map((i) => describe(i, values[i.key]!)),
      text: textItem ? String(values[textItem.key]).trim() : null,
    })
  }

  const scopeOptions = (Object.keys(SCOPE_LABELS) as MemoryScope[]).filter((s) => s !== 'company' || company)
  const action = !remember ? 'Continue' : n === 1 ? 'Save & continue' : `Save ${n} details & continue`

  return (
    <form className="missing" onSubmit={submit} aria-labelledby={`${uid}-title`}>
      <div className="missing-head">
        <strong id={`${uid}-title`}>Ansly needs {n === 1 ? 'one detail' : `${n} details`}</strong>
        {question && n === 1 && <span className="muted">This application asks: “{question}”</span>}
      </div>
      {groups.map((group) => (
        <fieldset key={group} className="missing-group">
          {groups.length > 1 && <legend>{group}</legend>}
          {items.filter((i) => (i.group ?? 'Other') === group).map((item, index) => {
            const value = values[item.key]
            const id = `${uid}-${item.key.replace(/[^a-z0-9]+/gi, '-')}`
            const label = n > 1 ? `${items.indexOf(item) + 1}. ${item.prompt}` : item.prompt
            return (
              <div key={item.key} className="missing-item" data-index={index}>
                <label id={`${id}-label`} htmlFor={id}>{label}</label>
                {item.input === 'textarea' && (
                  <textarea id={id} rows={3} value={(value as string) ?? ''} onChange={(e) => set(item.key, e.target.value)} />
                )}
                {item.input === 'text' && (
                  <input id={id} type="text" value={(value as string) ?? ''} onChange={(e) => set(item.key, e.target.value)} />
                )}
                {item.input === 'number' && (
                  <input id={id} type="number" inputMode="decimal" min={0} className="short" value={(value as string) ?? ''} onChange={(e) => set(item.key, e.target.value)} />
                )}
                {(item.input === 'boolean' || item.input === 'choice' || item.input === 'select') && (
                  <Segmented id={`${id}-label`} label={item.label ?? item.prompt} options={choices(item)} value={value as string | boolean | undefined}
                    equals={(a, b) => a === b} onChange={(v) => set(item.key, v)} />
                )}
                {item.input === 'skill' && (
                  <>
                    <Segmented id={`${id}-label`} label={item.label ?? item.prompt} options={SKILL_CHOICES} value={value as SkillAnswer | undefined}
                      equals={(a, b) => !!a && a.have === b.have && (a.level === 'beginner') === (b.level === 'beginner')}
                      onChange={(v) => set(item.key, v)} />
                    {typeof value === 'object' && value.have && (
                      <input aria-label={`Years of ${item.target.type === 'skill' ? item.target.name : 'experience'} (optional)`} type="number" min={0} max={60} step={0.5}
                        className="short" placeholder="Years (optional)" value={value.years ?? ''}
                        onChange={(e) => set(item.key, { ...value, years: e.target.value === '' ? null : Number(e.target.value) })} />
                    )}
                  </>
                )}
                {remember && item.target.type !== 'skill' && (
                  <label className="scope">
                    <span className="muted">Remember for</span>
                    <select aria-label={`Remember “${item.label ?? item.prompt}” for`} value={scopeFor(item)}
                      onChange={(e) => setScopes((s) => ({ ...s, [item.key]: e.target.value as MemoryScope }))}>
                      {scopeOptions.map((s) => <option key={s} value={s}>{SCOPE_LABELS[s]}</option>)}
                    </select>
                  </label>
                )}
              </div>
            )
          })}
        </fieldset>
      ))}
      <label className="check">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        Remember {n === 1 ? 'this' : 'these answers'} for future applications
      </label>
      {!remember && <span className="muted small">Used for this answer only. Nothing is saved.</span>}
      {textItem && (
        <label className="check">
          <input type="checkbox" checked={reuse} onChange={(e) => setReuse(e.target.checked)} />
          Also reuse this exact answer for similar questions
        </label>
      )}
      {error && <div className="notice error" role="alert">{error}</div>}
      <div className="style-row">
        {onSkip && <button type="button" className="link" onClick={onSkip}>Skip for now</button>}
        <span className="spacer" />
        <button type="submit" className="btn primary small" disabled={!ready || busy}>
          {busy ? 'Saving…' : action}
        </button>
      </div>
    </form>
  )
}
