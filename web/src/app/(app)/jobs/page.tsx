'use client'

import type { Job, JobMatch, Workplace } from '@ansly/types'
import { BellRing, Briefcase, RefreshCw, Search, SlidersHorizontal } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { JobCard } from '@/components/jobs/job-card'
import { useJobActions } from '@/components/jobs/use-job-actions'
import {
  Alert,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorText,
  PageHeader,
  SearchInput,
  SegmentedControl,
  SkeletonText,
  buttonStyles,
} from '@/components/ui'
import { refreshMatches } from '@/lib/api'
import { errorMessage } from '@/lib/format'
import { TIERS, WORKPLACE_LABELS, markMatchesRefreshed, matchesAreStale } from '@/lib/jobs'
import { createClient } from '@/lib/supabase/client'

type Tab = 'for-you' | 'saved' | 'recent'
type Row = { job: Job; match: JobMatch | null }

const TABS = [
  { value: 'for-you', label: 'For you' },
  { value: 'saved', label: 'Saved' },
  { value: 'recent', label: 'Recent' },
] as const

const LIMIT = 100

async function loadRows(tab: Tab): Promise<Row[]> {
  const supabase = createClient()
  if (tab === 'recent') {
    const { data, error } = await supabase
      .from('jobs')
      .select('*, job_matches(*)')
      .eq('is_active', true)
      .order('first_seen_at', { ascending: false })
      .limit(LIMIT)
    if (error) throw new Error(error.message)
    return (data ?? []).map(({ job_matches, ...job }) => ({
      job: job as Job,
      match: ((job_matches as JobMatch[]) ?? [])[0] ?? null,
    }))
  }
  let query = supabase.from('job_matches').select('*, job:jobs!inner(*)').eq('job.is_active', true).eq('dismissed', false)
  query =
    tab === 'saved'
      ? query.eq('saved', true).order('computed_at', { ascending: false })
      : query.in('tier', ['strong', 'good', 'potential']).order('score', { ascending: false })
  const { data, error } = await query.limit(LIMIT)
  if (error) throw new Error(error.message)
  return (data ?? []).map(({ job, ...match }) => ({ job: job as Job, match: match as JobMatch }))
}

export default function JobsPage() {
  const [tab, setTab] = useState<Tab>('for-you')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [workplace, setWorkplace] = useState<Workplace | null>(null)
  const [unseenAlerts, setUnseenAlerts] = useState(0)
  const [totalJobs, setTotalJobs] = useState<number | null>(null)
  const { busyId, prepareJob } = useJobActions()

  const load = useCallback(async (which: Tab) => {
    setError(null)
    try {
      setRows(await loadRows(which))
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [])

  const refresh = useCallback(
    async (quiet = false) => {
      setRefreshing(true)
      setRefreshError(null)
      try {
        const result = await refreshMatches()
        markMatchesRefreshed()
        if (!quiet) toast.success(`Scored ${result.matched} jobs`)
        await load(tab)
      } catch (err) {
        setRefreshError(errorMessage(err))
      } finally {
        setRefreshing(false)
      }
    },
    [load, tab],
  )

  useEffect(() => {
    setRows(null)
    void load(tab)
  }, [load, tab])

  // Rescore at most hourly, and alerts/job counts on first visit.
  useEffect(() => {
    if (matchesAreStale()) void refresh(true)
    const supabase = createClient()
    void supabase
      .from('job_alerts')
      .select('id', { count: 'exact', head: true })
      .is('seen_at', null)
      .then(({ count }) => setUnseenAlerts(count ?? 0))
    void supabase
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
      .then(({ count }) => setTotalJobs(count ?? 0))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function updateMatch(row: Row, values: Partial<Pick<JobMatch, 'saved' | 'dismissed'>>) {
    if (!row.match) return
    const { error } = await createClient().from('job_matches').update(values).eq('job_id', row.job.id)
    if (error) return toast.error(error.message)
    setRows((current) =>
      (current ?? [])
        .map((r) => (r.job.id === row.job.id && r.match ? { ...r, match: { ...r.match, ...values } } : r))
        .filter((r) => !(r.match?.dismissed && tab !== 'recent') && !(tab === 'saved' && !r.match?.saved)),
    )
    if (values.dismissed) toast.success('Hidden from your feed')
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (rows ?? []).filter(
      ({ job }) =>
        (!workplace || job.workplace === workplace) &&
        (!q || `${job.title} ${job.company} ${job.location ?? ''} ${job.skills.join(' ')}`.toLowerCase().includes(q)),
    )
  }, [rows, query, workplace])

  const noJobsYet = totalJobs === 0

  return (
    <div className="animate-fade-up">
      <PageHeader
        eyebrow="Jobs"
        title="Jobs for you"
        description="Jobs from public company job boards, matched to your profile. Every match shows why it fits and where the gaps are."
        actions={
          <>
            <Link href="/jobs/searches" className={buttonStyles({ variant: 'secondary' })}>
              <SlidersHorizontal className="h-4 w-4" />
              Saved searches
            </Link>
            <Button variant="secondary" icon={RefreshCw} loading={refreshing} onClick={() => void refresh()}>
              Refresh matches
            </Button>
          </>
        }
      />

      {unseenAlerts > 0 && (
        <Link href="/jobs/alerts" className="mb-5 block">
          <Alert tone="accent" title={`${unseenAlerts} new job${unseenAlerts === 1 ? '' : 's'} match your saved searches`}>
            Open alerts to see them grouped by alignment.
          </Alert>
        </Link>
      )}

      {refreshError && (
        <Alert tone="warning" title="Couldn't refresh matches" className="mb-5">
          {refreshError}
        </Alert>
      )}

      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center">
        <SegmentedControl role="tablist" label="Feed" options={TABS} value={tab} onChange={setTab} />
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(WORKPLACE_LABELS) as Workplace[]).map((w) => (
            <Chip key={w} selected={workplace === w} onClick={() => setWorkplace(workplace === w ? null : w)}>
              {WORKPLACE_LABELS[w]}
            </Chip>
          ))}
        </div>
        <SearchInput
          icon={Search}
          value={query}
          onChange={setQuery}
          placeholder="Filter by title, company, skill…"
          aria-label="Filter jobs"
          className="lg:ml-auto lg:w-72"
        />
      </div>

      <ErrorText>{error}</ErrorText>

      {rows === null && !error && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Card key={i}>
              <SkeletonText lines={3} />
            </Card>
          ))}
        </div>
      )}

      {rows && filtered.length === 0 && (
        noJobsYet ? (
          <EmptyState
            icon={Briefcase}
            title="No jobs collected yet"
            description="Jobs arrive from the ingestion worker (llm/scripts/ingest_jobs.py), which runs hourly once Supabase secrets are configured. Run it once to fill the feed."
          />
        ) : tab === 'saved' ? (
          <EmptyState icon={Briefcase} title="No saved jobs" description="Use the bookmark on any job to keep it here." />
        ) : (
          <EmptyState
            icon={BellRing}
            title={rows.length ? 'Nothing matches these filters' : 'No matches yet'}
            description={
              rows.length
                ? 'Clear the filters to see every match.'
                : 'Refresh matches to score the latest jobs against your profile. A more complete profile finds more.'
            }
            action={
              rows.length ? (
                <Button variant="secondary" onClick={() => { setQuery(''); setWorkplace(null) }}>
                  Clear filters
                </Button>
              ) : (
                <Button icon={RefreshCw} loading={refreshing} onClick={() => void refresh()}>
                  Refresh matches
                </Button>
              )
            }
          />
        )
      )}

      {tab === 'for-you' && filtered.length > 0 && (
        <p className="mb-3 text-caption text-subtle">
          Sorted by alignment. {TIERS.strong.label}: {filtered.filter((r) => r.match?.tier === 'strong').length} ·{' '}
          {TIERS.good.label}: {filtered.filter((r) => r.match?.tier === 'good').length} · {TIERS.potential.label}:{' '}
          {filtered.filter((r) => r.match?.tier === 'potential').length}
        </p>
      )}

      <div className="space-y-3">
        {filtered.map((row) => (
          <JobCard
            key={row.job.id}
            job={row.job}
            match={row.match}
            preparing={busyId === row.job.id}
            onPrepare={() => void prepareJob(row.job)}
            onToggleSave={row.match ? () => void updateMatch(row, { saved: !row.match!.saved }) : undefined}
            onDismiss={row.match && !row.match.dismissed ? () => void updateMatch(row, { dismissed: true }) : undefined}
          />
        ))}
      </div>
    </div>
  )
}
