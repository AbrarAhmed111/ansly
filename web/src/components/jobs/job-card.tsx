'use client'

import type { Job, JobMatch } from '@ansly/types'
import { Bookmark, BookmarkCheck, EyeOff, Wand2 } from 'lucide-react'
import Link from 'next/link'
import { Button, Card, IconButton, buttonStyles } from '@/components/ui'
import { jobFacts, timeAgo } from '@/lib/jobs'
import { SkillChips, TierBadge } from './match'

export function JobCard({
  job,
  match,
  onToggleSave,
  onDismiss,
  onPrepare,
  preparing,
}: {
  job: Job
  match: JobMatch | null
  onToggleSave?: () => void
  onDismiss?: () => void
  onPrepare?: () => void
  preparing?: boolean
}) {
  const facts = jobFacts(job)
  return (
    <Card className="group relative p-0 transition hover:border-border-strong">
      <div className="p-5">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <Link href={`/jobs/${job.id}`} className="text-title hover:text-accent">
              <span className="absolute inset-0 rounded-xl" aria-hidden />
              {job.title}
            </Link>
            <p className="mt-0.5 text-muted">
              {job.company}
              <span className="text-subtle"> · {timeAgo(job.posted_at ?? job.first_seen_at)}</span>
            </p>
          </div>
          {match && <TierBadge tier={match.tier} />}
        </div>

        {facts.length > 0 && <p className="mt-2 text-body-sm text-muted">{facts.join(' · ')}</p>}

        {match && (
          <>
            {match.reasons[0] && <p className="mt-3 text-body-sm text-fg/85">{match.reasons[0]}</p>}
            {(match.matched_skills.length > 0 || match.missing_skills.length > 0) && (
              <div className="mt-3">
                <SkillChips matched={match.matched_skills} missing={match.missing_skills} limit={6} />
              </div>
            )}
          </>
        )}

        <div className="relative mt-4 flex flex-wrap items-center gap-2">
          <Link href={`/jobs/${job.id}`} className={buttonStyles({ variant: 'secondary', size: 'sm' })}>
            View
          </Link>
          {onPrepare && (
            <Button size="sm" icon={Wand2} loading={preparing} onClick={onPrepare}>
              Prepare
            </Button>
          )}
          <div className="ml-auto flex gap-0.5">
            {onToggleSave && (
              <IconButton
                icon={match?.saved ? BookmarkCheck : Bookmark}
                label={match?.saved ? 'Remove from saved jobs' : 'Save job'}
                onClick={onToggleSave}
                className={match?.saved ? 'text-accent' : undefined}
              />
            )}
            {onDismiss && <IconButton icon={EyeOff} label="Not interested" onClick={onDismiss} />}
          </div>
        </div>
      </div>
    </Card>
  )
}
