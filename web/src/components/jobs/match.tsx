import type { JobMatch, MatchTier } from '@ansly/types'
import { clsx } from 'clsx'
import { Briefcase, Check, Clock, MapPin, Monitor, Plus, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge, Overline } from '@/components/ui'
import { TIERS, experienceLine } from '@/lib/jobs'

export function TierBadge({ tier }: { tier: MatchTier }) {
  return (
    <Badge tone={TIERS[tier].tone} dot>
      {TIERS[tier].label}
    </Badge>
  )
}

/** Matched skills with a check, missing ones as gaps. */
export function SkillChips({ matched, missing, limit = 8 }: { matched: string[]; missing: string[]; limit?: number }) {
  const shownMatched = matched.slice(0, limit)
  const shownMissing = missing.slice(0, Math.max(0, limit - shownMatched.length))
  const hidden = matched.length + missing.length - shownMatched.length - shownMissing.length
  return (
    <div className="flex flex-wrap gap-1.5">
      {shownMatched.map((s) => (
        <Badge key={s} tone="success">
          <Check className="h-3 w-3" aria-hidden />
          {s}
        </Badge>
      ))}
      {shownMissing.map((s) => (
        <Badge key={s} className="border-dashed">
          <Plus className="h-3 w-3 rotate-45" aria-hidden />
          <span className="sr-only">Not in profile:</span>
          {s}
        </Badge>
      ))}
      {hidden > 0 && <span className="self-center text-caption text-subtle">+{hidden} more</span>}
    </div>
  )
}

const FIT_TEXT: Record<string, { text: string; good: boolean | null }> = {
  match: { text: 'Fits your preference', good: true },
  mismatch: { text: 'Differs from your preference', good: false },
  remote: { text: 'Remote: location doesn’t matter', good: true },
  relocate: { text: 'Different city; you’re open to relocating', good: null },
  unknown: { text: 'Not stated', good: null },
  related: { text: 'Related to roles you’ve held', good: null },
  unrelated: { text: 'Different from your experience', good: false },
  meets: { text: '', good: true },
  close: { text: '', good: null },
  below: { text: '', good: false },
}

function Row({ icon: Icon, label, value, good }: { icon: LucideIcon; label: string; value: ReactNode; good: boolean | null }) {
  return (
    <li className="flex items-start gap-3 py-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-subtle" aria-hidden />
      <span className="w-24 shrink-0 text-muted">{label}</span>
      <span className={clsx('min-w-0 flex-1', good === true && 'text-success', good === false && 'text-warning')}>{value}</span>
    </li>
  )
}

/** "Profile alignment": every factor behind a match, in plain words. */
export function MatchBreakdown({ match }: { match: JobMatch }) {
  const experience = experienceLine(match)
  const expFit = match.experience?.fit ?? 'unknown'
  return (
    <div className="space-y-5">
      <div>
        <Overline className="mb-2">Skills</Overline>
        {match.matched_skills.length + match.missing_skills.length > 0 ? (
          <SkillChips matched={match.matched_skills} missing={match.missing_skills} limit={30} />
        ) : (
          <p className="text-muted">The posting doesn’t name specific skills.</p>
        )}
      </div>
      <ul className="divide-y divide-border">
        <Row
          icon={Briefcase}
          label="Role"
          value={match.role_fit === 'match' ? 'Same kind of role as your experience' : FIT_TEXT[match.role_fit ?? 'unknown'].text}
          good={match.role_fit === 'match' ? true : FIT_TEXT[match.role_fit ?? 'unknown'].good}
        />
        <Row
          icon={Clock}
          label="Experience"
          value={experience ?? 'Not stated'}
          good={expFit === 'unknown' ? null : FIT_TEXT[expFit].good}
        />
        <Row icon={Monitor} label="Workplace" value={FIT_TEXT[match.workplace_fit ?? 'unknown'].text} good={FIT_TEXT[match.workplace_fit ?? 'unknown'].good} />
        <Row icon={MapPin} label="Location" value={FIT_TEXT[match.location_fit ?? 'unknown'].text} good={FIT_TEXT[match.location_fit ?? 'unknown'].good} />
      </ul>
      {match.missing_skills.length > 0 && (
        <p className="text-caption leading-relaxed text-muted">
          Gaps are skills the posting mentions that aren’t anywhere in your profile. If you have them, add them, and Ansly
          will count them next time.
        </p>
      )}
    </div>
  )
}
