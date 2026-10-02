'use client'

import type { Job, JobAlert, MatchTier } from '@ansly/types'
import { ArrowLeft, BellRing } from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { TierBadge } from '@/components/jobs/match'
import { Badge, Card, EmptyState, ErrorText, Overline, PageHeader, SkeletonText } from '@/components/ui'
import { TIERS, TIER_ORDER, jobFacts, timeAgo } from '@/lib/jobs'
import { createClient } from '@/lib/supabase/client'

type AlertRow = JobAlert & { job: Job; search: { name: string } | null }

function Alerts() {
  const searchId = useSearchParams().get('search')
  const [alerts, setAlerts] = useState<AlertRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    void (async () => {
      let query = supabase
        .from('job_alerts')
        .select('*, job:jobs!inner(*), search:saved_searches(name)')
        .order('created_at', { ascending: false })
        .limit(200)
      if (searchId) query = query.eq('saved_search_id', searchId)
      const { data, error } = await query
      if (error) return setError(error.message)
      setAlerts(data as AlertRow[])
      // Viewing marks them seen; this visit still shows which were new.
      const unseen = (data ?? []).filter((a) => !a.seen_at).map((a) => a.id)
      if (unseen.length) await supabase.from('job_alerts').update({ seen_at: new Date().toISOString() }).in('id', unseen)
    })()
  }, [searchId])

  const groups = useMemo(() => {
    const byTier = new Map<MatchTier, AlertRow[]>()
    for (const a of alerts ?? []) byTier.set(a.tier, [...(byTier.get(a.tier) ?? []), a])
    return TIER_ORDER.filter((t) => byTier.has(t)).map((tier) => ({ tier, rows: byTier.get(tier)! }))
  }, [alerts])

  const newCount = (alerts ?? []).filter((a) => !a.seen_at).length

  return (
    <div className="animate-fade-up">
      <Link href="/jobs" className="mb-6 inline-flex items-center gap-1.5 text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" />
        Jobs
      </Link>
      <PageHeader
        eyebrow="Jobs"
        title="Alerts"
        description={
          alerts && alerts.length > 0
            ? `${newCount ? `${newCount} new. ` : ''}${groups.map((g) => `${g.rows.length} ${TIERS[g.tier].label.toLowerCase()}`).join(' · ')}`
            : 'New jobs that match your saved searches.'
        }
      />
      <ErrorText>{error}</ErrorText>
      {alerts === null && !error && (
        <Card>
          <SkeletonText lines={3} />
        </Card>
      )}
      {alerts?.length === 0 && (
        <EmptyState
          icon={BellRing}
          title="No alerts yet"
          description="Save a search and Ansly will flag new jobs that match it."
          action={
            <Link href="/jobs/searches?new=1" className="font-medium text-accent hover:underline">
              Create a saved search
            </Link>
          }
        />
      )}
      <div className="space-y-8">
        {groups.map(({ tier, rows }) => (
          <section key={tier}>
            <div className="mb-3 flex items-center gap-2">
              <Overline as="h2">{TIERS[tier].label}</Overline>
              <span className="text-caption tabular-nums text-subtle">{rows.length}</span>
            </div>
            <div className="space-y-2">
              {rows.map((a) => (
                <Card key={a.id} className="relative flex flex-wrap items-center gap-3 p-4 transition hover:border-border-strong">
                  <div className="min-w-0 flex-1">
                    <Link href={`/jobs/${a.job.id}`} className="text-title hover:text-accent">
                      <span className="absolute inset-0 rounded-xl" aria-hidden />
                      {a.job.title}
                    </Link>
                    <p className="text-body-sm text-muted">
                      {[a.job.company, ...jobFacts(a.job)].join(' · ')}
                    </p>
                    <p className="mt-1 text-caption text-subtle">
                      {a.search?.name ? `From “${a.search.name}” · ` : ''}
                      {timeAgo(a.created_at)}
                    </p>
                  </div>
                  {!a.seen_at && <Badge tone="accent">New</Badge>}
                  <TierBadge tier={a.tier} />
                </Card>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

export default function AlertsPage() {
  return (
    <Suspense>
      <Alerts />
    </Suspense>
  )
}
