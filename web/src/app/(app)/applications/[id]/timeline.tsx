'use client'

import type { ApplicationEvent, ApplicationEventKind } from '@ansly/types'
import { CalendarClock, CircleDot, MessageSquareText, Plus, Sparkles, Wand2, type LucideIcon } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { Button, Field, IconTile, Input, SegmentedControl, Textarea } from '@/components/ui'
import { STATUS_META } from '@/lib/applications'
import { createClient } from '@/lib/supabase/client'

const ICONS: Record<ApplicationEventKind, LucideIcon> = {
  created: Plus,
  status_change: CircleDot,
  note: MessageSquareText,
  interview: CalendarClock,
  prepared: Wand2,
  answer: Sparkles,
}

const KINDS = [
  { value: 'note', label: 'Note' },
  { value: 'interview', label: 'Interview' },
] as const

function describe(e: ApplicationEvent): string {
  if (e.kind === 'status_change' && e.to_status) {
    return `${e.from_status ? STATUS_META[e.from_status].label : 'New'} → ${STATUS_META[e.to_status].label}`
  }
  return e.title ?? (e.kind === 'note' ? 'Note' : e.kind === 'interview' ? 'Interview' : 'Update')
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function Timeline({ applicationId, events, onAdded }: { applicationId: string; events: ApplicationEvent[]; onAdded: () => void }) {
  const [kind, setKind] = useState<'note' | 'interview'>('note')
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')
  const [when, setWhen] = useState('')
  const [busy, setBusy] = useState(false)

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!title.trim() && !details.trim()) return
    setBusy(true)
    const { error } = await createClient()
      .from('application_events')
      .insert({
        application_id: applicationId,
        kind,
        title: title.trim() || (kind === 'interview' ? 'Interview' : 'Note'),
        details: details.trim() || null,
        ...(when ? { occurs_at: new Date(when).toISOString() } : {}),
      })
    setBusy(false)
    if (error) return toast.error(error.message)
    setTitle('')
    setDetails('')
    setWhen('')
    onAdded()
  }

  const now = Date.now()
  const upcoming = events.filter((e) => e.kind === 'interview' && new Date(e.occurs_at).getTime() > now)

  return (
    <div className="space-y-6">
      {upcoming.length > 0 && (
        <div className="rounded-lg border border-warning/25 bg-warning-soft px-4 py-3">
          <p className="font-medium text-warning">Upcoming</p>
          {upcoming.map((e) => (
            <p key={e.id} className="mt-1 text-body-sm">
              {e.title} · {formatWhen(e.occurs_at)}
            </p>
          ))}
        </div>
      )}

      <form onSubmit={add} className="space-y-3 rounded-lg border border-border p-4">
        <SegmentedControl label="Add to timeline" options={KINDS} value={kind} onChange={setKind} size="sm" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={kind === 'interview' ? 'Interview' : 'Title'} htmlFor="ev-title">
            <Input
              id="ev-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={kind === 'interview' ? 'Technical interview with Sam' : 'Recruiter replied'}
            />
          </Field>
          {kind === 'interview' && (
            <Field label="When" htmlFor="ev-when">
              <Input id="ev-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </Field>
          )}
          <Field label="Details" htmlFor="ev-details" className="sm:col-span-2">
            <Textarea id="ev-details" rows={2} value={details} onChange={(e) => setDetails(e.target.value)} />
          </Field>
        </div>
        <Button type="submit" size="sm" loading={busy} disabled={!title.trim() && !details.trim()}>
          Add {kind}
        </Button>
      </form>

      <ol className="space-y-4">
        {events.map((e) => (
          <li key={e.id} className="flex gap-3">
            <IconTile icon={ICONS[e.kind]} size="sm" tone={e.kind === 'interview' ? 'warning' : e.kind === 'prepared' ? 'accent' : 'neutral'} />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{describe(e)}</p>
              {e.details && <p className="mt-0.5 whitespace-pre-line text-body-sm text-muted">{e.details}</p>}
              <p className="mt-0.5 text-caption text-subtle">{formatWhen(e.occurs_at)}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
