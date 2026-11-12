'use client'

import type { Lead, TargetingProfile } from '@ansly/types'
import { ArrowUpRight, BriefcaseBusiness, Building2, CheckCheck, Clock3, Copy, FileJson, Mail, Plus, Search, Sparkles, Target, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Sheet } from '@/components/dialog'
import { LeadProfileJsonImport } from '@/components/lead-profile-json-import'
import { Badge, Button, Card, ErrorText, Field, PageHeader, SearchInput, Stat } from '@/components/ui'
import { collectLeads, listLeads } from '@/lib/api'
import { createClient } from '@/lib/supabase/client'

function parseCsv(value: string) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function ProfileTagGroup({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null
  const visibleValues = values.slice(0, 4)
  const remainingCount = values.length - visibleValues.length

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5" title={values.join(', ')}>
      <span className="mr-0.5 text-caption font-medium text-subtle">{label}</span>
      {visibleValues.map((value, index) => (
        <Badge key={`${value}-${index}`} className="max-w-full">
          <span className="max-w-[200px] truncate">{value}</span>
        </Badge>
      ))}
      {remainingCount > 0 && <Badge>+{remainingCount} more</Badge>}
    </div>
  )
}

function getStatusTone(status: Lead['status']) {
  switch (status) {
    case 'new':
      return 'accent'
    case 'contacted':
      return 'success'
    default:
      return 'neutral'
  }
}

function getContactabilityTone(contactability: Lead['contactability']) {
  switch (contactability) {
    case 'email_available':
      return 'accent'
    case 'application_link_available':
      return 'success'
    case 'dm_only':
      return 'warning'
    default:
      return 'neutral'
  }
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [profiles, setProfiles] = useState<TargetingProfile[]>([])
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | Lead['status']>('all')
  const [profileSheetOpen, setProfileSheetOpen] = useState(false)
  const [profileImportSheetOpen, setProfileImportSheetOpen] = useState(false)
  const [creatingProfile, setCreatingProfile] = useState(false)
  const [startingSearch, setStartingSearch] = useState(false)
  const [collectionSummary, setCollectionSummary] = useState<string | null>(null)
  const [profileForm, setProfileForm] = useState({
    name: '',
    description: '',
    target_roles: 'Product Engineer, Full-stack Engineer',
    keywords: 'typescript, react, product',
    excluded_keywords: 'agency, contractor',
    locations: 'remote, us',
    remote_preferences: 'remote',
    opportunity_types: 'job, contract',
  })

  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0] ?? null,
    [activeProfileId, profiles],
  )

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const [{ leads: rows }, { data: profileRows, error: profileError }] = await Promise.all([
          listLeads(),
          createClient().from('targeting_profiles').select('*').order('updated_at', { ascending: false }),
        ])
        if (!active) return
        if (profileError) throw profileError
        setLeads(rows)
        setProfiles((profileRows ?? []) as TargetingProfile[])
        setActiveProfileId((profileRows && profileRows[0]?.id) ?? null)
        setLoadError(null)
      } catch (err) {
        if (!active) return
        setLoadError(err instanceof Error ? err.message : 'Unable to load leads.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [])

  const handleCreateProfile = async () => {
    if (!profileForm.name.trim()) return
    setCreatingProfile(true)
    try {
      const { data, error } = await createClient()
        .from('targeting_profiles')
        .insert({
          name: profileForm.name.trim(),
          description: profileForm.description.trim() || null,
          is_active: true,
          target_roles: parseCsv(profileForm.target_roles),
          keywords: parseCsv(profileForm.keywords),
          excluded_keywords: parseCsv(profileForm.excluded_keywords),
          locations: parseCsv(profileForm.locations),
          remote_preferences: profileForm.remote_preferences,
          opportunity_types: parseCsv(profileForm.opportunity_types),
        })
        .select('*')
        .single()
      if (error) throw error
      setProfiles((current) => {
        const next = [data as TargetingProfile, ...current.filter((p) => p.id !== data.id)]
        return next
      })
      setActiveProfileId(data.id)
      setProfileSheetOpen(false)
      setProfileForm({
        name: '',
        description: '',
        target_roles: 'Product Engineer, Full-stack Engineer',
        keywords: 'typescript, react, product',
        excluded_keywords: 'agency, contractor',
        locations: 'remote, us',
        remote_preferences: 'remote',
        opportunity_types: 'job, contract',
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save targeting profile.')
    } finally {
      setCreatingProfile(false)
    }
  }

  const handleStartSearch = async () => {
    if (!activeProfileId) return
    setStartingSearch(true)
    setError(null)
    setCollectionSummary(null)
    try {
      const result = await collectLeads(activeProfileId)
      setLeads((current) => [...result.leads, ...current])
      setCollectionSummary(
        `Reviewed ${result.total_candidates_reviewed} public results · saved ${result.new_leads_saved} new leads · skipped ${result.duplicates_skipped} duplicates.`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start a new lead search.')
    } finally {
      setStartingSearch(false)
    }
  }

  const filteredLeads = useMemo(() => {
    return leads.filter((lead) => {
      const matchesQuery =
        !query ||
        [lead.company_name, lead.title, lead.description, lead.author_name, ...lead.tags]
          .join(' ')
          .toLowerCase()
          .includes(query.toLowerCase())
      const matchesStatus = statusFilter === 'all' || lead.status === statusFilter
      return matchesQuery && matchesStatus
    })
  }, [leads, query, statusFilter])

  const stats = useMemo(
    () => ({
      total: leads.length,
      new: leads.filter((lead) => lead.status === 'new').length,
      contacted: leads.filter((lead) => lead.status === 'contacted').length,
      email: leads.filter((lead) => Boolean(lead.contact_info?.email)).length,
    }),
    [leads],
  )

  return (
    <div className="space-y-6">
      <ErrorText>{error}</ErrorText>
      <PageHeader
        eyebrow="Workspace"
        title="Leads"
        description="Discover, qualify, and prepare outreach for opportunities that match your targeting profile."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={Plus} onClick={() => setProfileSheetOpen(true)}>
              New profile
            </Button>
            <Button variant="secondary" icon={FileJson} onClick={() => setProfileImportSheetOpen(true)}>
              Import JSON
            </Button>
            <Button icon={Search} onClick={handleStartSearch} loading={startingSearch} disabled={!activeProfileId}>
              New lead search
            </Button>
          </div>
        }
      />

      {activeProfile && (
        <Card className="p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-caption uppercase tracking-[0.12em] text-subtle">Active targeting profile</p>
              <h2 className="mt-2 text-title">{activeProfile.name}</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {profiles.map((profile) => (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => setActiveProfileId(profile.id)}
                  className={`rounded-full border px-3 py-1.5 text-body-sm transition ${
                    profile.id === activeProfile.id
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border bg-surface text-muted hover:border-border-strong'
                  }`}
                >
                  {profile.name}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4 grid min-w-0 gap-2">
            <ProfileTagGroup label="Roles" values={activeProfile.target_roles} />
            <ProfileTagGroup label="Keywords" values={activeProfile.keywords} />
            <ProfileTagGroup label="Locations" values={activeProfile.locations} />
          </div>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Stat label="Total leads" value={stats.total} icon={BriefcaseBusiness} hint="Across all active profiles" />
        <Stat label="New" value={stats.new} icon={Target} hint="Needs review or outreach" />
        <Stat label="Contacted" value={stats.contacted} icon={CheckCheck} hint="Explicitly marked contacted" />
        <Stat label="With email" value={stats.email} icon={Mail} hint="Public contact routes found" />
      </div>

      <Card>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex w-full max-w-xl items-center gap-3">
            <div className="flex-1">
              <SearchInput
                value={query}
                onChange={(value) => setQuery(value)}
                icon={Search}
                placeholder="Search leads, companies, or keywords"
              />
            </div>
            <div className="w-44">
              <Field label="Status">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as 'all' | Lead['status'])}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-body-sm text-fg focus:border-accent focus:outline-none"
                >
                  <option value="all">All</option>
                  <option value="new">New</option>
                  <option value="contacted">Contacted</option>
                </select>
              </Field>
            </div>
          </div>
          <div className="flex items-center gap-2 text-body-sm text-muted">
            <Sparkles className="h-4 w-4 text-accent" />
            {filteredLeads.length} visible leads
          </div>
        </div>
      </Card>

      {collectionSummary && (
        <p role="status" className="rounded-lg border border-border bg-surface px-4 py-3 text-body-sm text-muted">
          {collectionSummary}
        </p>
      )}

      <div className="space-y-4">
        {loading ? (
          <Card className="p-6 text-muted">Loading leads...</Card>
        ) : loadError ? (
          <Card className="p-6 text-center">
            <h2 className="text-h3">Unable to load leads</h2>
            <p className="mt-2 text-muted">{loadError}</p>
          </Card>
        ) : filteredLeads.length === 0 ? (
          <Card className="p-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface-muted">
              <Search className="h-5 w-5 text-muted" />
            </div>
            <h2 className="mt-4 text-h3">No leads match this view</h2>
            <p className="mt-2 text-muted">Try a different keyword or reset the filter to see more opportunities.</p>
          </Card>
        ) : (
          filteredLeads.map((lead) => (
            <Card key={lead.id} className="p-0 transition hover:border-border-strong">
              <div className="p-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-title">{lead.title}</h2>
                      <Badge tone={getStatusTone(lead.status)}>{lead.status === 'new' ? 'New' : 'Contacted'}</Badge>
                      <Badge tone={getContactabilityTone(lead.contactability)}>{lead.contactability.replace(/_/g, ' ')}</Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-body-sm text-muted">
                      <span className="inline-flex items-center gap-1.5">
                        <Building2 className="h-4 w-4" />
                        {lead.company_name}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Clock3 className="h-4 w-4" />
                        {(lead.publication_date || lead.collected_at || new Date().toISOString()).slice(0, 10)}
                      </span>
                      <span>{lead.source_name}</span>
                    </div>
                    <p className="mt-3 max-w-3xl leading-relaxed text-fg/85">{lead.description}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(lead.tags ?? []).map((tag) => (
                        <Badge key={tag}>{tag}</Badge>
                      ))}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2 xl:justify-end">
                    {lead.contact_info?.email && <Button variant="secondary" icon={Copy}>Copy email</Button>}
                    <Button variant="secondary" icon={ArrowUpRight}>Open source</Button>
                    <Button>Generate email</Button>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 border-t border-border pt-4 md:grid-cols-[1.2fr_0.8fr]">
                  <div>
                    <p className="text-caption uppercase tracking-[0.12em] text-subtle">Qualification</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge>{lead.opportunity_type}</Badge>
                      <Badge>{lead.author_name}</Badge>
                      {lead.contact_info?.email && <Badge>email: {lead.contact_info.email}</Badge>}
                      {lead.contact_info?.application_url && <Badge>application page</Badge>}
                    </div>
                  </div>

                  <div>
                    <p className="text-caption uppercase tracking-[0.12em] text-subtle">Contact route</p>
                    <div className="mt-2 space-y-1 text-body-sm text-muted">
                      {lead.contact_info?.email ? (
                        <div className="flex items-center gap-2">
                          <Mail className="h-4 w-4 text-accent" />
                          <span>{lead.contact_info.email}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <X className="h-4 w-4 text-subtle" />
                          <span>No explicit email found</span>
                        </div>
                      )}
                      {lead.contact_info?.application_url && (
                        <div className="flex items-center gap-2">
                          <ArrowUpRight className="h-4 w-4 text-accent" />
                          <span>{lead.contact_info.application_url}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>

      <Sheet
        open={profileSheetOpen}
        onClose={() => setProfileSheetOpen(false)}
        title="Create targeting profile"
        description="Define the roles, keywords, and filters that should drive the next lead search."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setProfileSheetOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateProfile} loading={creatingProfile} disabled={!profileForm.name.trim()}>
              Save profile
            </Button>
          </div>
        }
      >
        <div className="space-y-4 px-6 py-6">
          <Field label="Profile name" htmlFor="profile-name" required>
            <input
              id="profile-name"
              value={profileForm.name}
              onChange={(e) => setProfileForm((current) => ({ ...current, name: e.target.value }))}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-body-sm text-fg focus:border-accent focus:outline-none"
              placeholder="e.g. Senior product roles"
            />
          </Field>

          <Field label="Description" htmlFor="profile-description">
            <textarea
              id="profile-description"
              value={profileForm.description}
              onChange={(e) => setProfileForm((current) => ({ ...current, description: e.target.value }))}
              rows={3}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-body-sm text-fg focus:border-accent focus:outline-none"
              placeholder="What this targeting profile is trying to capture"
            />
          </Field>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Target roles" htmlFor="profile-roles">
              <input
                id="profile-roles"
                value={profileForm.target_roles}
                onChange={(e) => setProfileForm((current) => ({ ...current, target_roles: e.target.value }))}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-body-sm text-fg focus:border-accent focus:outline-none"
                placeholder="Product Engineer, Full-stack Engineer"
              />
            </Field>
            <Field label="Opportunity types" htmlFor="profile-types">
              <input
                id="profile-types"
                value={profileForm.opportunity_types}
                onChange={(e) => setProfileForm((current) => ({ ...current, opportunity_types: e.target.value }))}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-body-sm text-fg focus:border-accent focus:outline-none"
                placeholder="job, contract"
              />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Keywords" htmlFor="profile-keywords">
              <input
                id="profile-keywords"
                value={profileForm.keywords}
                onChange={(e) => setProfileForm((current) => ({ ...current, keywords: e.target.value }))}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-body-sm text-fg focus:border-accent focus:outline-none"
                placeholder="typescript, product, ai"
              />
            </Field>
            <Field label="Excluded keywords" htmlFor="profile-excluded">
              <input
                id="profile-excluded"
                value={profileForm.excluded_keywords}
                onChange={(e) => setProfileForm((current) => ({ ...current, excluded_keywords: e.target.value }))}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-body-sm text-fg focus:border-accent focus:outline-none"
                placeholder="agency, contractor"
              />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Locations" htmlFor="profile-locations">
              <input
                id="profile-locations"
                value={profileForm.locations}
                onChange={(e) => setProfileForm((current) => ({ ...current, locations: e.target.value }))}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-body-sm text-fg focus:border-accent focus:outline-none"
                placeholder="remote, us"
              />
            </Field>
            <Field label="Remote preference" htmlFor="profile-remote">
              <select
                id="profile-remote"
                value={profileForm.remote_preferences}
                onChange={(e) =>
                  setProfileForm((current) => ({ ...current, remote_preferences: e.target.value as typeof current.remote_preferences }))
                }
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-body-sm text-fg focus:border-accent focus:outline-none"
              >
                <option value="any">Any</option>
                <option value="remote">Remote</option>
                <option value="hybrid">Hybrid</option>
                <option value="onsite">Onsite</option>
              </select>
            </Field>
          </div>
        </div>
      </Sheet>

      <Sheet
        open={profileImportSheetOpen}
        onClose={() => setProfileImportSheetOpen(false)}
        title="Import targeting profiles"
        description="Upload a .json file or paste JSON. Review the accepted fields and preview before saving."
      >
        <LeadProfileJsonImport
          existingProfiles={profiles}
          onClose={() => setProfileImportSheetOpen(false)}
          onImported={(imported) => {
            setProfiles((current) => [...imported, ...current])
            if (imported[0]) setActiveProfileId(imported[0].id)
            setError(null)
          }}
        />
      </Sheet>
    </div>
  )
}
