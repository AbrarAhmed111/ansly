'use client'

import type { SavedSearch, SearchFilters } from '@ansly/types'
import { ArrowLeft, BellRing, Plus, SearchCheck, Sparkles, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { Sheet, useConfirm } from '@/components/dialog'
import { OnSearchParam } from '@/components/search-param'
import { SearchFiltersEditor, SearchFiltersSummary } from '@/components/jobs/search-filters'
import {
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorText,
  Field,
  IconButton,
  Input,
  PageHeader,
  Skeleton,
  Switch,
  Textarea,
} from '@/components/ui'
import { createSavedSearch, parseSearch, refreshMatches } from '@/lib/api'
import { errorMessage } from '@/lib/format'
import { timeAgo } from '@/lib/jobs'
import { createClient } from '@/lib/supabase/client'

const EXAMPLES = [
  'Remote Full Stack/Product Engineering roles involving AI, Next.js and TypeScript',
  'Senior backend engineer in Berlin, Python, 5+ years',
  'Hybrid frontend developer roles with React in Europe',
]

function NewSearchSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [query, setQuery] = useState('')
  const [name, setName] = useState('')
  const [filters, setFilters] = useState<SearchFilters | null>(null)
  const [alerts, setAlerts] = useState(true)
  const [busy, setBusy] = useState<'parse' | 'save' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function preview(e?: FormEvent) {
    e?.preventDefault()
    if (query.trim().length < 2) return
    setBusy('parse')
    setError(null)
    try {
      const parsed = await parseSearch(query.trim())
      setFilters(parsed.filters)
      setName(parsed.name)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  async function save() {
    if (!filters) return
    setBusy('save')
    setError(null)
    try {
      await createSavedSearch({ query: query.trim(), name: name.trim() || null, filters, alerts_enabled: alerts })
      // Score now so the first alerts appear right away; failure here isn't fatal.
      await refreshMatches().catch(() => undefined)
      toast.success('Search saved')
      setQuery('')
      setFilters(null)
      setName('')
      onCreated()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="New saved search"
      description="Describe the jobs you want in your own words. Ansly turns it into filters you can check and adjust."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {filters ? (
            <Button onClick={() => void save()} loading={busy === 'save'}>
              Save search
            </Button>
          ) : (
            <Button icon={Sparkles} onClick={() => void preview()} loading={busy === 'parse'} disabled={query.trim().length < 2}>
              Preview filters
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-6 px-6 py-6">
        <form onSubmit={preview} className="space-y-3">
          <Field label="What are you looking for?" htmlFor="search-query">
            <Textarea
              id="search-query"
              rows={3}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setFilters(null)
              }}
              placeholder={EXAMPLES[0]}
            />
          </Field>
          {!filters && (
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => (
                <Chip key={ex} onClick={() => setQuery(ex)}>
                  {ex}
                </Chip>
              ))}
            </div>
          )}
        </form>
        <ErrorText>{error}</ErrorText>
        {filters && (
          <>
            <Field label="Name" htmlFor="search-name">
              <Input id="search-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <SearchFiltersEditor value={filters} onChange={setFilters} />
            <label className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
              <span>
                <span className="block font-medium">Alert me about new jobs</span>
                <span className="text-caption text-muted">New jobs that pass these filters show up in Alerts.</span>
              </span>
              <Switch checked={alerts} onChange={setAlerts} label="Alerts" />
            </label>
          </>
        )}
      </div>
    </Sheet>
  )
}

export default function SavedSearchesPage() {
  const [searches, setSearches] = useState<SavedSearch[] | null>(null)
  const [unseen, setUnseen] = useState<Record<string, number>>({})
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [confirm, confirmDialog] = useConfirm()

  const load = useCallback(async () => {
    const supabase = createClient()
    const [{ data, error }, alerts] = await Promise.all([
      supabase.from('saved_searches').select('*').order('created_at', { ascending: false }),
      supabase.from('job_alerts').select('saved_search_id').is('seen_at', null),
    ])
    if (error) return setError(error.message)
    setSearches(data as SavedSearch[])
    const counts: Record<string, number> = {}
    for (const a of alerts.data ?? []) counts[a.saved_search_id] = (counts[a.saved_search_id] ?? 0) + 1
    setUnseen(counts)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function setAlerts(search: SavedSearch, enabled: boolean) {
    const { error } = await createClient().from('saved_searches').update({ alerts_enabled: enabled }).eq('id', search.id)
    if (error) return toast.error(error.message)
    setSearches((s) => s?.map((x) => (x.id === search.id ? { ...x, alerts_enabled: enabled } : x)) ?? null)
  }

  async function remove(search: SavedSearch) {
    if (!(await confirm({ title: 'Delete saved search?', description: 'Its alerts are deleted too.', confirmLabel: 'Delete' }))) return
    const { error } = await createClient().from('saved_searches').delete().eq('id', search.id)
    if (error) return toast.error(error.message)
    toast.success('Deleted')
    void load()
  }

  return (
    <div className="animate-fade-up">
      <Link href="/jobs" className="mb-6 inline-flex items-center gap-1.5 text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" />
        Jobs
      </Link>
      <PageHeader
        eyebrow="Jobs"
        title="Saved searches"
        description="Tell Ansly what you're looking for once. New jobs that match are flagged automatically, grouped by how well they fit your profile."
        actions={
          <Button icon={Plus} onClick={() => setAdding(true)}>
            New search
          </Button>
        }
      />
      <ErrorText>{error}</ErrorText>

      {searches === null && !error && <Skeleton className="h-32 w-full rounded-xl" />}

      {searches?.length === 0 && (
        <EmptyState
          icon={SearchCheck}
          title="No saved searches"
          description="Try “remote Full Stack roles with Next.js and TypeScript”."
          action={
            <Button icon={Plus} onClick={() => setAdding(true)}>
              New search
            </Button>
          }
        />
      )}

      <div className="space-y-3">
        {searches?.map((s) => (
          <Card key={s.id}>
            <div className="flex flex-wrap items-start gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-title">{s.name}</h2>
                  {unseen[s.id] ? (
                    <Link href={`/jobs/alerts?search=${s.id}`}>
                      <Badge tone="accent">
                        <BellRing className="h-3 w-3" />
                        {unseen[s.id]} new
                      </Badge>
                    </Link>
                  ) : null}
                </div>
                <p className="mt-0.5 text-body-sm text-muted">“{s.query}”</p>
                <div className="mt-3">
                  <SearchFiltersSummary filters={s.filters} />
                </div>
                <p className="mt-3 text-caption text-subtle">
                  {s.last_checked_at ? `Checked ${timeAgo(s.last_checked_at)}` : 'Not checked yet'}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-body-sm text-muted">
                  Alerts
                  <Switch checked={s.alerts_enabled} onChange={(v) => void setAlerts(s, v)} label={`Alerts for ${s.name}`} />
                </label>
                <IconButton icon={Trash2} label="Delete search" tone="danger" onClick={() => void remove(s)} />
              </div>
            </div>
          </Card>
        ))}
      </div>

      <OnSearchParam name="new" onMatch={() => setAdding(true)} />
      <NewSearchSheet
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={() => {
          setAdding(false)
          void load()
        }}
      />
      {confirmDialog}
    </div>
  )
}
