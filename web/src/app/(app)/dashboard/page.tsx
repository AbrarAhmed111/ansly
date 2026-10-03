import { completenessFromSignals } from '@ansly/types'
import { clsx } from 'clsx'
import { ArrowRight, BookmarkCheck, FileText, MousePointerClick, Puzzle, RefreshCcw, Sparkles, Wand2, type LucideIcon } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { SECTION_ICONS } from '@/components/section-icons'
import { TokenUsage } from '@/components/token-usage'
import {
  Card,
  CardHeader,
  ErrorText,
  Glow,
  IconTile,
  Overline,
  PageHeader,
  ProgressRing,
  Stat,
  StepMarker,
  buttonStyles,
} from '@/components/ui'
import { loadDashboard, type DashboardData } from '@/lib/dashboard'
import { errorMessage } from '@/lib/format'
import { SECTIONS } from '@/lib/sections'
import { createClient } from '@/lib/supabase/server'

export const metadata = { title: 'Dashboard' }
export const dynamic = 'force-dynamic'

/** Small side card: icon, title, one line, one action. */
function ActionCard({
  icon,
  title,
  body,
  href,
  cta,
  aside,
  primary,
}: {
  icon: LucideIcon
  title: string
  body: string
  href: string
  cta: string
  aside?: ReactNode
  primary?: boolean
}) {
  return (
    <Card className={clsx(primary && 'border-accent/25 bg-gradient-to-br from-accent-soft via-surface to-surface')}>
      <div className="flex items-start justify-between">
        <IconTile icon={icon} tone="accent" />
        {aside}
      </div>
      <h3 className="mt-3 text-title">{title}</h3>
      <p className="mt-0.5 text-muted">{body}</p>
      <Link href={href} className={buttonStyles({ variant: primary ? 'primary' : 'secondary', size: 'sm', className: 'mt-4 w-full' })}>
        {cta}
      </Link>
    </Card>
  )
}

export default async function DashboardPage() {
  const supabase = await createClient()
  let dashboard: DashboardData
  try {
    dashboard = await loadDashboard(supabase)
  } catch (e) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <ErrorText>
          Could not load your profile: {errorMessage(e)}. If this is a new project, apply the database migrations first (see
          the README).
        </ErrorText>
      </>
    )
  }
  const { signals, counts, savedCount, usage, tokens, hasMaster, readyCount: tailoredCount } = dashboard
  const { percent, items } = completenessFromSignals(signals)
  const name = signals.profile?.full_name?.split(' ')[0]
  const next = items.find((i) => !i.done)
  const doneCount = items.filter((i) => i.done).length

  return (
    <div className="animate-fade-up">
      <PageHeader
        eyebrow="Dashboard"
        title={name ? `Welcome back, ${name}` : 'Welcome to Ansly'}
        description="Ansly answers application questions only from what's in your profile. The more complete it is, the better your answers."
      />

      {/* Completeness */}
      <Card className="relative overflow-hidden p-0">
        <Glow className="-right-24 -top-24 h-64 w-64" />
        <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
          <div className="flex flex-col items-center gap-5 border-b border-border p-6 text-center sm:flex-row sm:text-left md:flex-col md:border-b-0 md:border-r md:text-center lg:flex-row lg:text-left">
            <ProgressRing value={percent} size={128} stroke={11}>
              <span className="text-h1 tabular-nums">{percent}%</span>
              <Overline as="span">complete</Overline>
            </ProgressRing>
            <div className="min-w-0">
              <h2 className="text-h3">{percent === 100 ? 'Your profile is complete' : 'Strengthen your profile'}</h2>
              <p className="mt-1 leading-relaxed text-muted">
                {percent === 100
                  ? 'Ansly has everything it needs to write specific, truthful answers.'
                  : `${doneCount} of ${items.length} steps done. Every step makes answers more specific.`}
              </p>
              {next && (
                <Link href={next.href} className={buttonStyles({ className: 'mt-4' })}>
                  {next.label}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              )}
            </div>
          </div>

          <ul className="divide-y divide-border p-2">
            {items.map((item) => (
              <li key={item.key}>
                <Link href={item.href} className="group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-surface-muted">
                  <StepMarker size="sm" state={item.done ? 'done' : 'idle'} />
                  <span className={clsx('flex-1', item.done ? 'text-muted' : 'font-medium')}>{item.label}</span>
                  <span className="text-caption tabular-nums text-subtle">+{item.weight}%</span>
                  <ArrowRight className="h-3.5 w-3.5 text-subtle opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </Card>

      {/* Usage */}
      <h2 className="mt-8 text-title">Last 7 days</h2>
      <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Answers generated" value={usage.generated} icon={Sparkles} hint="Drafted by ✨ on forms" />
        <Stat label="Fields filled" value={usage.filled} icon={MousePointerClick} hint="Answers you approved" />
        <Stat label="Saved answers reused" value={usage.reused} icon={RefreshCcw} hint="Instant, no generation" />
        <Stat label="Resumes tailored" value={usage.tailored} icon={FileText} hint="Truthful copies of your master" />
      </div>

      {/* Token use */}
      <h2 className="mt-8 text-title">AI usage</h2>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <TokenUsage events={tokens} />
      </div>

      {/* Profile sections + side cards */}
      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Your profile" description="What Ansly draws on when it writes an answer." />
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {[{ slug: 'personal', title: 'Personal' }, ...SECTIONS].map(({ slug, title }) => {
              const count = counts[slug]
              return (
                <Link
                  key={slug}
                  href={count === 0 ? `/profile/${slug}?new=1` : `/profile/${slug}`}
                  className="group flex items-center gap-3 rounded-lg border border-border p-3 transition hover:border-border-strong hover:bg-surface-muted/60"
                >
                  <IconTile icon={SECTION_ICONS[slug]} tone={count === 0 ? 'neutral' : 'accent'} size="sm" />
                  <span className="flex-1 font-medium">{title}</span>
                  {count !== undefined && (
                    <span className={clsx('rounded-md px-1.5 text-caption font-medium tabular-nums', count ? 'bg-surface-muted text-muted' : 'text-warning')}>
                      {count || 'Empty'}
                    </span>
                  )}
                  <ArrowRight className="h-3.5 w-3.5 text-subtle transition group-hover:translate-x-0.5 group-hover:text-fg" />
                </Link>
              )
            })}
          </div>
        </Card>

        <div className="space-y-4">
          {hasMaster ? (
            <ActionCard
              icon={FileText}
              title="Tailored resumes"
              body="Tailor your master resume to a job, using only your real experience."
              href="/resume/tailor"
              cta="Tailor for a job"
              aside={<span className="text-h1 tabular-nums">{tailoredCount ?? 0}</span>}
            />
          ) : (
            <ActionCard
              icon={FileText}
              title="Upload your master resume"
              body="Then tailor it to any job you open, in under a minute."
              href="/resume/upload"
              cta="Upload master resume"
              primary
            />
          )}
          <ActionCard
            icon={Wand2}
            title="Try a question"
            body="See what Ansly would answer from your profile, right here."
            href="/playground"
            cta="Open playground"
          />
          <ActionCard
            icon={BookmarkCheck}
            title="Saved answers"
            body="Reused when a similar question comes up."
            href="/saved-answers"
            cta="Manage answers"
            aside={<span className="text-h1 tabular-nums">{savedCount ?? 0}</span>}
          />
          <ActionCard
            icon={Puzzle}
            title="Browser extension"
            body="Connect it to use ✨ on any application form."
            href="/extension"
            cta="Set up extension"
            primary={hasMaster}
          />
        </div>
      </div>
    </div>
  )
}
