'use client'

import type { Lead, TargetingProfile } from '@ansly/types'
import { CheckCheck, Inbox, Link2, ListFilter, Mail, Plus, RotateCcw, Search, Sparkles, Target, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Sheet, useConfirm } from '@/components/dialog'
import { LeadProfileJsonImport } from '@/components/lead-profile-json-import'
import { LeadCard } from '@/components/leads/lead-card'
import { ProfileCard, type SaveState } from '@/components/leads/profile-card'
import { ProfileEditor } from '@/components/leads/profile-editor'
import {
  Alert,
  Button,
  Card,
  EmptyState,
  PageHeader,
  SearchInput,
  SegmentedControl,
  Select,
  Skeleton,
  Stat,
} from '@/components/ui'
import { listLeads } from '@/lib/api'
import {
  activateTargetingProfile,
  createTargetingProfile,
  deleteLeads,
  deleteTargetingProfile,
  leadTier,
  listTargetingProfiles,
  setLeadStatus,
  updateTargetingProfile,
  type TargetingProfileValues,
} from '@/lib/leads'

type StatusFilter = 'all' | Lead['status']
type ContactFilter = 'all' | 'email' | 'link'
type SortOrder = 'best' | 'newest'

const STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
] as const
const CONTACT_OPTIONS = [
  { value: 'all', label: 'Any contact' },
  { value: 'email', label: 'Email', icon: Mail },
  { value: 'link', label: 'Apply link', icon: Link2 },
] as const

const TIER_RANK = { email: 0, link: 1, other: 2 } as const

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [profiles, setProfiles] = useState<TargetingProfile[]>([])
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('new')
  const [contactFilter, setContactFilter] = useState<ContactFilter>('all')
  const [sort, setSort] = useState<SortOrder>('best')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  const [sessionIds, setSessionIds] = useState<Set<string>>(new Set())

  const [editorOpen, setEditorOpen] = useState(false)
  const [editingProfile, setEditingProfile] = useState<TargetingProfile | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [confirm, confirmElement] = useConfirm()

  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0] ?? null,
    [activeProfileId, profiles],
  )

  // The extension's "Open Leads" link passes the collection it just ran, so its leads can be highlighted.
  useEffect(() => {
    const ids = (new URLSearchParams(window.location.search).get('session') ?? '')
      .split(',')
      .filter((id) => /^[0-9a-f-]{36}$/i.test(id))
    if (ids.length) setSessionIds(new Set(ids))
  }, [])

  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([listLeads(), listTargetingProfiles()])
      .then(([{ leads: rows }, loadedProfiles]) => {
        if (!active) return
        setLeads(rows)
        setProfiles(loadedProfiles)
        setActiveProfileId((loadedProfiles.find((profile) => profile.is_active) ?? loadedProfiles[0])?.id ?? null)
        setLoadError(null)
      })
      .catch((reason: unknown) => {
        if (active) setLoadError(reason instanceof Error ? reason.message : 'Unable to load leads.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [reloadKey])

  // ---------------------------------------------------------------- profiles

  const markSaved = (state: SaveState) => {
    setSaveState(state)
    clearTimeout(saveTimer.current)
    if (state === 'saved') saveTimer.current = setTimeout(() => setSaveState('idle'), 2000)
  }

  const replaceProfile = (profile: TargetingProfile) =>
    setProfiles((current) => current.map((item) => (item.id === profile.id ? profile : item)))

  const activate = async (id: string) => {
    const previous = activeProfileId
    setActiveProfileId(id)
    setProfiles((current) => current.map((profile) => ({ ...profile, is_active: profile.id === id })))
    try {
      await activateTargetingProfile(id)
    } catch (reason) {
      setActiveProfileId(previous)
      toast.error(reason instanceof Error ? reason.message : 'Could not switch profile.')
    }
  }

  /** Inline chip edits: applied at once, saved in the background, rolled back if the save fails. */
  const patchActiveProfile = async (patch: Partial<TargetingProfileValues>) => {
    if (!activeProfile) return
    const before = activeProfile
    replaceProfile({ ...activeProfile, ...patch })
    markSaved('saving')
    try {
      replaceProfile(await updateTargetingProfile(before.id, patch))
      markSaved('saved')
    } catch (reason) {
      replaceProfile(before)
      markSaved('error')
      toast.error(reason instanceof Error ? reason.message : 'Could not save the profile.')
    }
  }

  const openEditor = (profile: TargetingProfile | null) => {
    setEditingProfile(profile)
    setEditorOpen(true)
  }

  const saveProfile = async (values: TargetingProfileValues) => {
    if (editingProfile) {
      replaceProfile(await updateTargetingProfile(editingProfile.id, values))
      toast.success('Profile saved')
    } else {
      const created = await createTargetingProfile(values)
      setProfiles((current) => [created, ...current])
      await activate(created.id)
      toast.success(`“${created.name}” is now your active profile`)
    }
    setEditorOpen(false)
  }

  const removeProfile = async (profile: TargetingProfile) => {
    const ok = await confirm({
      title: `Delete “${profile.name}”?`,
      description: 'The profile is removed permanently. Leads already collected with it stay in your list.',
      confirmLabel: 'Delete profile',
    })
    if (!ok) return
    try {
      await deleteTargetingProfile(profile.id)
      const remaining = profiles.filter((item) => item.id !== profile.id)
      setProfiles(remaining)
      setEditorOpen(false)
      if (profile.id === activeProfile?.id && remaining[0]) await activate(remaining[0].id)
      toast.success('Profile deleted')
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : 'Could not delete the profile.')
    }
  }

  // ---------------------------------------------------------------- leads

  const withBusy = async (ids: string[], work: () => Promise<void>) => {
    setBusyIds((current) => new Set([...current, ...ids]))
    try {
      await work()
    } finally {
      setBusyIds((current) => {
        const next = new Set(current)
        ids.forEach((id) => next.delete(id))
        return next
      })
    }
  }

  const changeStatus = (ids: string[], status: Lead['status']) =>
    withBusy(ids, async () => {
      try {
        await setLeadStatus(ids, status)
        setLeads((current) => current.map((lead) => (ids.includes(lead.id) ? { ...lead, status } : lead)))
        setSelected(new Set())
        const noun = ids.length === 1 ? 'Lead' : `${ids.length} leads`
        toast.success(status === 'contacted' ? `${noun} marked contacted` : `${noun} moved back to new`)
      } catch (reason) {
        toast.error(reason instanceof Error ? reason.message : 'Could not update the lead.')
      }
    })

  const removeLeads = async (ids: string[]) => {
    const ok = await confirm({
      title: ids.length === 1 ? 'Delete this lead?' : `Delete ${ids.length} leads?`,
      description: 'Deleted leads are removed permanently. Collecting the same post again will save it again.',
      confirmLabel: 'Delete',
    })
    if (!ok) return
    await withBusy(ids, async () => {
      try {
        await deleteLeads(ids)
        setLeads((current) => current.filter((lead) => !ids.includes(lead.id)))
        setSelected(new Set())
        toast.success(ids.length === 1 ? 'Lead deleted' : `${ids.length} leads deleted`)
      } catch (reason) {
        toast.error(reason instanceof Error ? reason.message : 'Could not delete.')
      }
    })
  }

  const isFresh = useCallback(
    (lead: Lead) => Boolean(lead.collection_session_id && sessionIds.has(lead.collection_session_id)),
    [sessionIds],
  )

  const visibleLeads = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return leads
      .filter((lead) => statusFilter === 'all' || lead.status === statusFilter)
      .filter((lead) => contactFilter === 'all' || leadTier(lead) === contactFilter)
      .filter(
        (lead) =>
          !needle ||
          [lead.title, lead.description, lead.author_name, lead.contact_info?.email ?? '', ...lead.tags]
            .join(' ')
            .toLowerCase()
            .includes(needle),
      )
      .sort((a, b) => {
        if (sessionIds.size) {
          const fresh = Number(isFresh(b)) - Number(isFresh(a))
          if (fresh) return fresh
        }
        if (sort === 'best') {
          const tier = TIER_RANK[leadTier(a)] - TIER_RANK[leadTier(b)]
          if (tier) return tier
        }
        return (b.collected_at ?? '').localeCompare(a.collected_at ?? '')
      })
  }, [leads, query, statusFilter, contactFilter, sort, sessionIds, isFresh])

  const stats = useMemo(
    () => ({
      total: leads.length,
      new: leads.filter((lead) => lead.status === 'new').length,
      email: leads.filter((lead) => leadTier(lead) === 'email').length,
      link: leads.filter((lead) => leadTier(lead) === 'link').length,
    }),
    [leads],
  )
  const sessionCount = leads.filter(isFresh).length
  const filtersActive = Boolean(query) || statusFilter !== 'all' || contactFilter !== 'all'
  const selectedIds = [...selected].filter((id) => visibleLeads.some((lead) => lead.id === id))
  const allVisibleSelected = visibleLeads.length > 0 && selectedIds.length === visibleLeads.length

  const resetFilters = useCallback(() => {
    setQuery('')
    setStatusFilter('all')
    setContactFilter('all')
  }, [])

  const toggle = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  // ---------------------------------------------------------------- render

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Workspace"
        title="Leads"
        description="Opportunities from LinkedIn posts you collected with the extension, matched to your targeting profile."
      />

      {sessionIds.size > 0 && !loading && (
        <Alert tone="success" title={sessionCount ? `${sessionCount} new lead${sessionCount === 1 ? '' : 's'} from your last collection` : 'Collection finished'}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {sessionCount
                ? 'They are marked “Just collected” and shown first.'
                : 'No new leads this time. Posts without an email or apply link, excluded words, or duplicates are skipped.'}
            </span>
            <Button variant="ghost" size="sm" icon={X} onClick={() => setSessionIds(new Set())}>
              Dismiss
            </Button>
          </div>
        </Alert>
      )}

      {loading ? (
        <Skeleton className="h-44 w-full rounded-xl" />
      ) : activeProfile ? (
        <ProfileCard
          profiles={profiles}
          profile={activeProfile}
          saveState={saveState}
          onActivate={(id) => void activate(id)}
          onPatch={(patch) => void patchActiveProfile(patch)}
          onEdit={() => openEditor(activeProfile)}
          onCreate={() => openEditor(null)}
          onImport={() => setImportOpen(true)}
        />
      ) : (
        !loadError && (
          <EmptyState
            icon={Target}
            title="Create your targeting profile"
            description="Tell Ansly which roles and keywords you want, and which words to skip. The extension uses it to keep only relevant LinkedIn posts."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button icon={Plus} onClick={() => openEditor(null)}>
                  Create profile
                </Button>
                <Button variant="secondary" onClick={() => setImportOpen(true)}>
                  Import JSON
                </Button>
              </div>
            }
          />
        )
      )}

      {!loading && !loadError && leads.length > 0 && (
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <Stat label="All leads" value={stats.total} icon={Inbox} />
          <Stat label="New" value={stats.new} icon={Sparkles} hint="Not contacted yet" />
          <Stat label="With email" value={stats.email} icon={Mail} hint="Best: write directly" />
          <Stat label="Apply link only" value={stats.link} icon={Link2} hint="Apply on their site" />
        </div>
      )}

      {loadError ? (
        <EmptyState
          icon={RotateCcw}
          title="Couldn’t load your leads"
          description={loadError}
          action={
            <Button variant="secondary" icon={RotateCcw} onClick={() => setReloadKey((key) => key + 1)}>
              Try again
            </Button>
          }
        />
      ) : loading ? (
        <div className="space-y-4">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-48 w-full rounded-xl" />
          ))}
        </div>
      ) : leads.length === 0 ? (
        activeProfile && <GettingStarted />
      ) : (
        <section className="space-y-4" aria-label="Leads">
          <Card className="space-y-3 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="min-w-0 flex-1">
                <SearchInput value={query} onChange={setQuery} icon={Search} placeholder="Search title, post text, author, email" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <SegmentedControl label="Status" size="sm" options={STATUS_OPTIONS} value={statusFilter} onChange={setStatusFilter} />
                <SegmentedControl label="Contact" size="sm" options={CONTACT_OPTIONS} value={contactFilter} onChange={setContactFilter} />
                <Select
                  aria-label="Sort"
                  value={sort}
                  onChange={(event) => setSort(event.target.value as SortOrder)}
                  className="h-8 w-auto text-body-sm"
                >
                  <option value="best">Email first</option>
                  <option value="newest">Newest first</option>
                </Select>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-body-sm text-muted">
              <label className="inline-flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  disabled={!visibleLeads.length}
                  onChange={(event) => setSelected(event.target.checked ? new Set(visibleLeads.map((lead) => lead.id)) : new Set())}
                  className="h-4 w-4 cursor-pointer rounded border-border accent-[rgb(var(--accent))]"
                />
                Select all shown
              </label>
              <span className="tabular-nums">
                {visibleLeads.length} of {leads.length} shown
              </span>
              {filtersActive && (
                <button type="button" onClick={resetFilters} className="inline-flex items-center gap-1 text-accent hover:underline">
                  <ListFilter className="h-3.5 w-3.5" aria-hidden />
                  Show all
                </button>
              )}
            </div>
          </Card>

          {selectedIds.length > 0 && (
            <div
              role="toolbar"
              aria-label="Selected leads"
              className="sticky top-4 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-accent/30 bg-surface px-4 py-3 shadow-lg"
            >
              <span className="mr-auto text-body-sm font-medium">{selectedIds.length} selected</span>
              <Button size="sm" icon={CheckCheck} onClick={() => void changeStatus(selectedIds, 'contacted')}>
                Mark contacted
              </Button>
              <Button size="sm" variant="secondary" icon={RotateCcw} onClick={() => void changeStatus(selectedIds, 'new')}>
                Mark new
              </Button>
              <Button size="sm" variant="danger-soft" icon={Trash2} onClick={() => void removeLeads(selectedIds)}>
                Delete
              </Button>
              <Button size="sm" variant="ghost" icon={X} onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </div>
          )}

          {visibleLeads.length === 0 ? (
            <EmptyState
              icon={Search}
              title="No leads in this view"
              description={statusFilter === 'new' ? 'Everything here has been contacted. Nice work.' : 'Try a different search or filter.'}
              action={
                <Button variant="secondary" onClick={resetFilters}>
                  Show all leads
                </Button>
              }
            />
          ) : (
            <div className="space-y-3">
              {visibleLeads.map((lead) => (
                <LeadCard
                  key={lead.id}
                  lead={lead}
                  selected={selected.has(lead.id)}
                  highlighted={isFresh(lead)}
                  busy={busyIds.has(lead.id)}
                  onSelect={(on) => toggle(lead.id, on)}
                  onStatus={(status) => void changeStatus([lead.id], status)}
                  onDelete={() => void removeLeads([lead.id])}
                />
              ))}
            </div>
          )}
        </section>
      )}

      <ProfileEditor
        open={editorOpen}
        profile={editingProfile}
        onClose={() => setEditorOpen(false)}
        onSave={saveProfile}
        onDelete={removeProfile}
      />

      <Sheet
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import targeting profiles"
        description="Upload a .json file or paste JSON. A profile with the same name as one you have updates it."
      >
        <LeadProfileJsonImport
          existingProfiles={profiles}
          onClose={() => setImportOpen(false)}
          onImported={(imported) => {
            setProfiles((current) => [...imported, ...current.filter((profile) => !imported.some((item) => item.id === profile.id))])
            if (!activeProfile && imported[0]) void activate(imported[0].id)
            toast.success(imported.length === 1 ? `Imported “${imported[0].name}”` : `Imported ${imported.length} profiles`)
          }}
        />
      </Sheet>

      {confirmElement}
    </div>
  )
}

function GettingStarted() {
  const steps = [
    { title: 'Search LinkedIn', body: 'Search for something like “hiring full stack developer” and choose the Posts filter.' },
    { title: 'Scroll to load posts', body: 'The Ansly panel at the bottom right counts posts as you scroll. It reads only posts already on the page.' },
    { title: 'Click Collect', body: 'Posts with an email or apply link that match your profile land here. Nothing is sent before you click.' },
  ]
  return (
    <Card className="p-6">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-accent" aria-hidden />
        <h2 className="text-title">Collect your first leads</h2>
      </div>
      <ol className="mt-5 grid gap-4 md:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step.title} className="rounded-xl border border-border bg-surface-muted/40 p-4">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-soft text-body-sm font-semibold text-accent">
              {index + 1}
            </span>
            <h3 className="mt-3 text-body font-medium">{step.title}</h3>
            <p className="mt-1 text-body-sm leading-relaxed text-muted">{step.body}</p>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-caption text-muted">
        Matches are based on your profile’s words, not a check of the author or the offer. Posts that only say “comment” or “DM me” are skipped.
      </p>
    </Card>
  )
}
