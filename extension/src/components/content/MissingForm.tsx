import type { MissingInfo, SaveMissingRequest, SkillAnswer } from '@ansly/types'
import { useState } from 'react'
import { send } from '@/lib/messages'

type Value = string | boolean | SkillAnswer

export interface MissingSubmit {
  /** What to write with POST /profile/missing (when saving to the profile). */
  items: SaveMissingRequest['items']
  saveToProfile: boolean
  /** Also store the typed answer verbatim as a saved answer. */
  reuse: boolean
  /** The answers as plain sentences, for answering once without saving. */
  facts: string[]
  /** The single typed value, when there is exactly one text answer. */
  text: string | null
}

/**
 * Saves what the user gave (profile field / skill / fact) and, if asked, a saved answer.
 * Returns the facts to send with the next generation when the user chose not to save.
 */
export async function applyMissing(
  submit: MissingSubmit,
  question: string,
): Promise<{ ok: true; facts: string[] | null } | { ok: false; error: string }> {
  if (submit.saveToProfile) {
    const result = await send('saveMissing', { items: submit.items })
    if (!result.ok) return { ok: false, error: result.error.message }
  }
  if (submit.reuse && submit.text) void send('saveAnswer', { question, answer: submit.text })
  return { ok: true, facts: submit.saveToProfile ? null : submit.facts }
}

/** A profile preference typed in the form, as the text to put in the field ("Yes", "1 month"). */
export function directAnswer(submit: MissingSubmit): string | null {
  if (!submit.items.every((i) => i.target.type === 'profile_field') || submit.items.length !== 1) return null
  const value = submit.items[0]!.value
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return typeof value === 'string' ? (WORK_MODE_LABELS[value] ?? value) : null
}

const WORK_MODE_LABELS: Record<string, string> = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'On-site', flexible: 'Flexible' }

function describe(item: MissingInfo, value: Value): string {
  if (item.target.type === 'skill') {
    const v = value as SkillAnswer
    if (!v.have) return `I have not used ${item.target.name}.`
    const detail = [v.years != null ? `${v.years} years` : null, v.level].filter(Boolean).join(', ')
    return `I have used ${item.target.name}${detail ? ` (${detail})` : ''}.`
  }
  if (typeof value === 'boolean') return `${item.prompt} ${value ? 'Yes' : 'No'}.`
  return `${item.prompt} ${String(value).trim()}`
}

const filled = (item: MissingInfo, value: Value | undefined) =>
  value !== undefined && (typeof value !== 'string' || value.trim() !== '') &&
  !(item.input === 'skill' && typeof value === 'object' && value.have && value.years != null && Number.isNaN(value.years))

/** "Ansly doesn't have this yet": asks for what's missing, saves it to the profile, then answers. */
export function MissingForm({ items, busy, error, onSubmit }: {
  items: MissingInfo[]
  busy: boolean
  error?: string | null
  onSubmit: (submit: MissingSubmit) => void
}) {
  const [values, setValues] = useState<Record<string, Value>>({})
  const [saveToProfile, setSaveToProfile] = useState(true)
  const [reuse, setReuse] = useState(false)
  const set = (key: string, value: Value) => setValues((v) => ({ ...v, [key]: value }))
  const textItem = items.length === 1 && ['text', 'textarea'].includes(items[0]!.input) ? items[0]! : null
  const ready = items.every((i) => filled(i, values[i.key]))

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!ready || busy) return
    onSubmit({
      items: items.map((i) => ({ key: i.key, target: i.target, value: values[i.key]!, prompt: i.prompt })),
      saveToProfile,
      reuse: reuse && textItem !== null,
      facts: items.map((i) => describe(i, values[i.key]!)),
      text: textItem ? String(values[textItem.key]).trim() : null,
    })
  }

  return (
    <form className="missing" onSubmit={submit}>
      <strong>Ansly doesn&apos;t have this yet</strong>
      {items.map((item) => {
        const value = values[item.key]
        const id = `ansly-missing-${item.key.replace(/[^a-z0-9]+/gi, '-')}`
        return (
          <div key={item.key} className="missing-item">
            <label htmlFor={id}>{item.prompt}</label>
            {item.input === 'textarea' && (
              <textarea id={id} rows={3} value={(value as string) ?? ''} onChange={(e) => set(item.key, e.target.value)} />
            )}
            {(item.input === 'text' || item.input === 'number') && (
              <input id={id} type={item.input === 'number' ? 'number' : 'text'} value={(value as string) ?? ''} onChange={(e) => set(item.key, e.target.value)} />
            )}
            {item.input === 'select' && (
              <select id={id} value={(value as string) ?? ''} onChange={(e) => set(item.key, e.target.value)}>
                <option value="" disabled>Choose…</option>
                {(item.options ?? []).map((o) => <option key={o} value={o}>{WORK_MODE_LABELS[o] ?? o}</option>)}
              </select>
            )}
            {item.input === 'boolean' && (
              <div className="segmented" role="radiogroup" aria-labelledby={id} id={id}>
                {[true, false].map((b) => (
                  <button key={String(b)} type="button" role="radio" aria-checked={value === b} className={value === b ? 'on' : ''} onClick={() => set(item.key, b)}>
                    {b ? 'Yes' : 'No'}
                  </button>
                ))}
              </div>
            )}
            {item.input === 'skill' && (
              <>
                <div className="segmented" role="radiogroup" id={id}>
                  {[true, false].map((have) => {
                    const on = typeof value === 'object' && value.have === have
                    return (
                      <button key={String(have)} type="button" role="radio" aria-checked={on} className={on ? 'on' : ''}
                        onClick={() => set(item.key, { have, years: null, level: null })}>
                        {have ? "Yes, I've used it" : "I don't have this"}
                      </button>
                    )
                  })}
                </div>
                {typeof value === 'object' && value.have && (
                  <div className="style-row">
                    <input aria-label="Years" type="number" min={0} max={60} step={0.5} placeholder="Years (optional)"
                      value={value.years ?? ''} onChange={(e) => set(item.key, { ...value, years: e.target.value === '' ? null : Number(e.target.value) })} />
                    <select aria-label="Level" value={value.level ?? ''} onChange={(e) => set(item.key, { ...value, level: (e.target.value || null) as SkillAnswer['level'] })}>
                      <option value="">Level (optional)</option>
                      <option value="beginner">Beginner</option>
                      <option value="intermediate">Intermediate</option>
                      <option value="advanced">Advanced</option>
                      <option value="expert">Expert</option>
                    </select>
                  </div>
                )}
              </>
            )}
          </div>
        )
      })}
      <label className="check">
        <input type="checkbox" checked={saveToProfile} onChange={(e) => setSaveToProfile(e.target.checked)} />
        Save to my profile
      </label>
      {textItem && (
        <label className="check">
          <input type="checkbox" checked={reuse} onChange={(e) => setReuse(e.target.checked)} />
          Also reuse this exact answer for similar questions
        </label>
      )}
      {error && <div className="notice error">{error}</div>}
      <div className="style-row">
        <span className="spacer" />
        <button type="submit" className="btn primary small" disabled={!ready || busy}>
          {busy ? 'Saving…' : saveToProfile ? 'Save & answer' : 'Answer'}
        </button>
      </div>
    </form>
  )
}
