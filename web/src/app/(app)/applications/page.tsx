'use client'

import type { Application, ApplicationStatus } from '@ansly/types'
import { KanbanSquare, List, Plus } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { Sheet } from '@/components/dialog'
import { OnSearchParam } from '@/components/search-param'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorText,
  Field,
  Input,
  Overline,
  PageHeader,
  SegmentedControl,
  Select,
  Skeleton,
  Textarea,
  buttonStyles,
} from '@/components/ui'
import { PIPELINE, STATUS_META, STATUS_OPTIONS, countByStatus } from '@/lib/applications'
import { timeAgo } from '@/lib/jobs'
import { createClient } from '@/lib/supabase/client'

type View = 'board' | 'list'
const VIEWS = [
  { value: 'board', label: 'Board', icon: KanbanSquare },
  { value: 'list', label: 'List', icon: List },
] as const

function StatusSelect({ app, onChange }: { app: Application; onChange: (status: ApplicationStatus) => void }) {
  return (
    <Select
      value={app.status}
      onChange={(e) => onChange(e.target.value as ApplicationStatus)}
      aria-label={`Status of ${app.role} at ${app.company}`}
      className="relative h-8 w-36 text-body-sm"
    >
      {STATUS_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  )
}

function AppCard({ app, onStatus }: { app: Application; onStatus: (s: ApplicationStatus) => void }) {
  return (
    <Card className="relative p-4 transition hover:border-border-strong">
      <Link href={`/applications/${app.id}`} className="block text-title hover:text-accent">
        <span className="absolute inset-0 rounded-xl" aria-hidden />
        {app.role}
      </Link>
      <p className="text-body-sm text-muted">{app.company}</p>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-caption text-subtle">{timeAgo(app.updated_at)}</span>
        {app.prep && <Badge tone="accent">Prepared</Badge>}
      </div>
      <div className="mt-3">
        <StatusSelect app={app} onChange={onStatus} />
      </div>
    </Card>
  )
}

function NewApplicationSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [form, setForm] = useState({ company: '', role: '', job_url: '', location: '', status: 'interested', notes: '' })
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const row = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim() || null]))
    const { data, error } = await createClient().from('applications').insert(row).select('id').single()
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success('Application added')
    setForm({ company: '', role: '', job_url: '', location: '', status: 'interested', notes: '' })
    onCreated(data.id)
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Track an application"
      description="For jobs you found elsewhere. Jobs from your feed can be tracked from their page."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="new-application" loading={busy} disabled={!form.company.trim() || !form.role.trim()}>
            Add application
          </Button>
        </div>
      }
    >
      <form id="new-application" onSubmit={onSubmit} className="grid gap-5 px-6 py-6 sm:grid-cols-2">
        <Field label="Company" htmlFor="app-company" required>
          <Input id="app-company" required value={form.company} onChange={(e) => set('company', e.target.value)} />
        </Field>
        <Field label="Role" htmlFor="app-role" required>
          <Input id="app-role" required value={form.role} onChange={(e) => set('role', e.target.value)} />
        </Field>
        <Field label="Posting URL" htmlFor="app-url" help="The extension recognizes this page when you apply." className="sm:col-span-2">
          <Input id="app-url" type="url" value={form.job_url} onChange={(e) => set('job_url', e.target.value)} placeholder="https://…" />
        </Field>
        <Field label="Location" htmlFor="app-location">
          <Input id="app-location" value={form.location} onChange={(e) => set('location', e.target.value)} />
        </Field>
        <Field label="Status" htmlFor="app-status">
          <Select id="app-status" value={form.status} onChange={(e) => set('status', e.target.value)}>
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notes" htmlFor="app-notes" className="sm:col-span-2">
          <Textarea id="app-notes" rows={4} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </form>
    </Sheet>
  )
}

export default function ApplicationsPage() {
  const [apps, setApps] = useState<Application[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<View>('board')
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await createClient().from('applications').select('*').order('updated_at', { ascending: false })
    if (error) setError(error.message)
    else setApps(data as Application[])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function setStatus(app: Application, status: ApplicationStatus) {
    setApps((list) => list?.map((a) => (a.id === app.id ? { ...a, status } : a)) ?? null)
    const { error } = await createClient().from('applications').update({ status }).eq('id', app.id)
    if (error) {
      toast.error(error.message)
      void load()
    } else toast.success(`Moved to ${STATUS_META[status].label}`)
  }

  const counts = useMemo(() => countByStatus(apps ?? []), [apps])

  return (
    <div className="animate-fade-up">
      <PageHeader
        eyebrow="Jobs"
        title="Applications"
        description="Every application from interest to outcome. Status changes, notes and interviews are kept on each application's timeline."
        actions={
          <Button icon={Plus} onClick={() => setAdding(true)}>
            Track application
          </Button>
        }
      />
      <ErrorText>{error}</ErrorText>

      {apps === null && !error && <Skeleton className="h-64 w-full rounded-xl" />}

      {apps?.length === 0 && (
        <EmptyState
          icon={KanbanSquare}
          title="No applications yet"
          description="Track a job from your feed, or add one you found elsewhere."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Link href="/jobs" className={buttonStyles()}>
                Browse jobs
              </Link>
              <Button variant="secondary" icon={Plus} onClick={() => setAdding(true)}>
                Track one
              </Button>
            </div>
          }
        />
      )}

      {apps && apps.length > 0 && (
        <>
          <div className="mb-5 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {PIPELINE.map((col) => (
              <div key={col.key} className="rounded-lg border border-border bg-surface px-3 py-2">
                <Overline>{col.label}</Overline>
                <p className="text-h3 tabular-nums">{col.statuses.reduce((n, s) => n + counts[s], 0)}</p>
              </div>
            ))}
          </div>

          <SegmentedControl label="View" options={VIEWS} value={view} onChange={setView} className="mb-4" />

          {view === 'board' ? (
            <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
              <div className="grid min-w-[1080px] grid-cols-6 gap-3">
                {PIPELINE.map((col) => {
                  const items = apps.filter((a) => col.statuses.includes(a.status))
                  return (
                    <section key={col.key} aria-label={col.label} className="rounded-xl bg-surface-muted/60 p-2">
                      <div className="flex items-center justify-between px-1.5 py-1">
                        <Overline as="h2" tone="muted">
                          {col.label}
                        </Overline>
                        <span className="text-caption tabular-nums text-subtle">{items.length}</span>
                      </div>
                      <div className="mt-1 space-y-2">
                        {items.map((a) => (
                          <AppCard key={a.id} app={a} onStatus={(s) => void setStatus(a, s)} />
                        ))}
                      </div>
                    </section>
                  )
                })}
              </div>
            </div>
          ) : (
            <Card className="p-0">
              <ul className="divide-y divide-border">
                {apps.map((a) => (
                  <li key={a.id} className="relative flex flex-wrap items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <Link href={`/applications/${a.id}`} className="font-medium hover:text-accent">
                        {a.role}
                      </Link>
                      <p className="text-body-sm text-muted">{a.company}</p>
                    </div>
                    <span className="hidden text-caption text-subtle sm:block">
                      {a.applied_at ? `Applied ${timeAgo(a.applied_at)}` : `Updated ${timeAgo(a.updated_at)}`}
                    </span>
                    <StatusSelect app={a} onChange={(s) => void setStatus(a, s)} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      <OnSearchParam name="new" onMatch={() => setAdding(true)} />
      <NewApplicationSheet
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={() => {
          setAdding(false)
          void load()
        }}
      />
    </div>
  )
}
