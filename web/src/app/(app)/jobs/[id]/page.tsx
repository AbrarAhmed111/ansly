import type { Job, JobMatch, JobSource } from '@ansly/types'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { MatchBreakdown, TierBadge } from '@/components/jobs/match'
import { Alert, Badge, Card, CardHeader, Overline } from '@/components/ui'
import { jobFacts, timeAgo, TIERS } from '@/lib/jobs'
import { createClient } from '@/lib/supabase/server'
import { JobActions } from './job-actions'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data } = await supabase.from('jobs').select('title, company').eq('id', id).maybeSingle()
  return { title: data ? `${data.title} · ${data.company}` : 'Job' }
}

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: job } = await supabase.from('jobs').select('*').eq('id', id).maybeSingle<Job>()
  if (!job) notFound()

  const [{ data: match }, { data: source }, { data: application }] = await Promise.all([
    supabase.from('job_matches').select('*').eq('job_id', id).maybeSingle<JobMatch>(),
    supabase.from('job_sources').select('*').eq('id', job.source_id).maybeSingle<JobSource>(),
    supabase.from('applications').select('id').eq('job_id', id).maybeSingle<{ id: string }>(),
  ])
  const facts = jobFacts(job)

  return (
    <div className="animate-fade-up">
      <Link href="/jobs" className="mb-6 inline-flex items-center gap-1.5 text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" />
        Jobs
      </Link>

      <div className="mb-8">
        <Overline tone="accent">{job.company}</Overline>
        <h1 className="mt-1.5 text-h2">{job.title}</h1>
        <p className="mt-2 text-body-lg text-muted">
          {[...facts, `posted ${timeAgo(job.posted_at ?? job.first_seen_at)}`].join(' · ')}
        </p>
        {!job.is_active && (
          <Alert tone="warning" className="mt-4">
            This posting is no longer listed on its source. It may be closed.
          </Alert>
        )}
        <div className="mt-5">
          <JobActions job={job} match={match ?? null} applicationId={application?.id ?? null} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card className="order-2 lg:order-1">
          <CardHeader title="About the job" description={job.department ?? undefined} />
          {job.description ? (
            <div className="mt-4 whitespace-pre-line leading-relaxed text-fg/85">{job.description}</div>
          ) : (
            <p className="mt-4 text-muted">The source didn’t include a description. Open the posting for details.</p>
          )}
          <p className="mt-6 border-t border-border pt-4 text-caption text-subtle">
            From {source?.name ?? 'a public job board'}
            {source?.attribution ? ` (${source.attribution})` : ''}. Apply on the employer’s site.
            {job.also_listed_on.length > 0 && ` Also listed on ${job.also_listed_on.length} other source${job.also_listed_on.length === 1 ? '' : 's'}.`}
          </p>
        </Card>

        <div className="order-1 space-y-4 lg:order-2">
          <Card>
            <div className="mb-4 flex items-start justify-between gap-3">
              <h2 className="text-title">Profile alignment</h2>
              {match && <TierBadge tier={match.tier} />}
            </div>
            {match ? (
              <>
                <p className="mb-4 text-muted">{TIERS[match.tier].description}</p>
                <MatchBreakdown match={match} />
              </>
            ) : (
              <p className="text-muted">
                Not scored yet. Open <Link href="/jobs" className="text-accent hover:underline">Jobs</Link> and refresh matches.
              </p>
            )}
          </Card>
          {job.skills.length > 0 && !match && (
            <Card>
              <Overline className="mb-2">Skills in the posting</Overline>
              <div className="flex flex-wrap gap-1.5">
                {job.skills.map((s) => (
                  <Badge key={s}>{s}</Badge>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
