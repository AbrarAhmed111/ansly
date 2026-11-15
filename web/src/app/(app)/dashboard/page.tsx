import { completenessFromSignals } from '@ansly/types'
import { clsx } from 'clsx'
import { ArrowRight, BookmarkCheck, Brain, FilePen, FileText, MousePointerClick, Puzzle, RefreshCcw, Rocket, Search, Sparkles, Wand2, type LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { Greeting, Today } from '@/components/greeting'
import { UserAvatar } from '@/components/identity'
import { SECTION_ICONS } from '@/components/section-icons'
import { AiUsage } from '@/components/token-usage'
import {
  Badge,
  Card,
  ErrorText,
  Glow,
  IconTile,
  Overline,
  PageHeader,
  ProgressRing,
  StepMarker,
  buttonStyles,
  focusRing,
} from '@/components/ui'
import { loadDashboard, type DashboardData } from '@/lib/dashboard'
import { errorMessage } from '@/lib/format'
import { SECTIONS } from '@/lib/sections'
import { createClient } from '@/lib/supabase/server'

export const metadata = { title: 'Dashboard' }
export const dynamic = 'force-dynamic'

/** Compact quick-action tile: icon, title, one line, optional count; the whole tile is the link. */
function QuickAction({
  icon,
  title,
  body,
  href,
  count,
  primary,
}: {
  icon: LucideIcon
  title: string
  body: string
  href: string
  count?: number
  primary?: boolean
}) {
  return (
    <Link
      href={href}
      className={clsx(
        'group relative flex flex-col rounded-xl border p-4 shadow-card transition hover:-translate-y-0.5 hover:border-border-strong',
        focusRing,
        primary ? 'border-accent/30 bg-gradient-to-br from-accent-soft via-surface to-surface' : 'border-border bg-surface',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <IconTile icon={icon} tone="accent" size="sm" />
        {count !== undefined && <span className="text-h3 tabular-nums leading-none">{count}</span>}
      </div>
      <p className="mt-3 flex items-center gap-1 font-medium">
        {title}
        <ArrowRight className="h-3.5 w-3.5 text-subtle transition group-hover:translate-x-0.5 group-hover:text-fg" aria-hidden />
      </p>
      <p className="mt-0.5 text-body-sm leading-snug text-muted">{body}</p>
    </Link>
  )
}

/** One cell of the weekly activity strip. */
function Activity({ label, value, icon: Icon, hint }: { label: string; value: number; icon: LucideIcon; hint: string }) {
  return (
    <div className="min-w-0 p-4 sm:p-5">
      <p className="flex items-center gap-1.5 text-body-sm font-medium text-muted">
        <Icon className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden />
        <span className="truncate">{label}</span>
      </p>
      <p className="mt-1.5 text-h2 tabular-nums">{value}</p>
      <p className="truncate text-caption text-subtle">{hint}</p>
    </div>
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
    <div className="animate-fade-up space-y-6">
      {/* Greeting */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <UserAvatar className="h-12 w-12 text-body ring-4 ring-accent-soft sm:h-14 sm:w-14 sm:text-title" />
          <div className="min-w-0">
            <Overline tone="accent">
              <Today />
            </Overline>
            <h1 className="mt-0.5 truncate text-h2">
              <Greeting firstName={name ?? null} fallback={name ? `Welcome back, ${name}` : 'Welcome to Ansly'} />
            </h1>
            <p className="mt-0.5 text-muted">Answers come only from your profile. Here’s where things stand.</p>
          </div>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Link href="/leads" className={buttonStyles({ variant: 'secondary', className: 'flex-1 sm:flex-none' })}>
            <Search className="h-4 w-4" /> Find leads
          </Link>
          <Link href="/playground" className={buttonStyles({ className: 'flex-1 sm:flex-none' })}>
            <Wand2 className="h-4 w-4" /> Try a question
          </Link>
        </div>
      </header>

      {/* Resume-first setup, until the core is in place */}
      {(!hasMaster || counts.experience === 0) && (
        <Card className="flex flex-wrap items-center gap-4 border-accent/30 bg-gradient-to-br from-accent-soft via-surface to-surface">
          <IconTile icon={Rocket} tone="accent" />
          <div className="min-w-0 flex-1">
            <h2 className="text-title">Get Ansly ready in about two minutes</h2>
            <p className="mt-0.5 text-muted">Upload your resume and Ansly builds your profile from it. Then a few quick preferences, and you’re set.</p>
          </div>
          <Link href="/setup" className={buttonStyles({ className: 'w-full sm:w-auto' })}>
            Continue setup <ArrowRight className="h-4 w-4" />
          </Link>
        </Card>
      )}

      {/* Quick actions */}
      <nav aria-label="Quick actions" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {hasMaster ? (
          <QuickAction icon={FilePen} title="Tailor a resume" body="Fit your master resume to a job." href="/resume/tailor" count={tailoredCount ?? 0} />
        ) : (
          <QuickAction icon={FileText} title="Upload resume" body="Your master, as a Word file." href="/resume/upload" primary />
        )}
        <QuickAction icon={BookmarkCheck} title="Saved answers" body="Reused on similar questions." href="/saved-answers" count={savedCount ?? 0} />
        <QuickAction icon={Brain} title="Memory" body="Facts Ansly learned from you." href="/memory" />
        <QuickAction icon={Puzzle} title="Extension" body="Use ✨ on any application form." href="/extension" primary={hasMaster && percent === 100} />
      </nav>

      {/* Completeness: the full checklist only while something is missing */}
      {percent < 100 && (
        <section className="relative overflow-hidden rounded-xl border border-border bg-surface shadow-card">
          <Glow className="-right-24 -top-24 h-64 w-64" />
          <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
            <div className="flex flex-col items-center gap-5 border-b border-border p-6 text-center sm:flex-row sm:text-left md:flex-col md:border-b-0 md:border-r md:text-center lg:flex-row lg:text-left">
              <ProgressRing value={percent} size={120} stroke={10}>
                <span className="text-h1 tabular-nums">{percent}%</span>
                <Overline as="span">complete</Overline>
              </ProgressRing>
              <div className="min-w-0">
                <h2 className="text-h3">Strengthen your profile</h2>
                <p className="mt-1 leading-relaxed text-muted">
                  {doneCount} of {items.length} steps done. Every step makes answers more specific.
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
                    <span className={clsx('flex-1', item.done ? 'text-muted line-through decoration-border-strong' : 'font-medium')}>{item.label}</span>
                    <span className="text-caption tabular-nums text-subtle">+{item.weight}%</span>
                    <ArrowRight className="h-3.5 w-3.5 text-subtle opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {/* Weekly activity */}
          <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
            <div className="flex items-center justify-between gap-3 px-5 pt-5">
              <h2 className="text-title">This week</h2>
              <Badge>Last 7 days</Badge>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-4 lg:grid-cols-2 [&>*]:bg-surface">
              <Activity label="Answers generated" value={usage.generated} icon={Sparkles} hint="Drafted by ✨ on forms" />
              <Activity label="Fields filled" value={usage.filled} icon={MousePointerClick} hint="Answers you approved" />
              <Activity label="Answers reused" value={usage.reused} icon={RefreshCcw} hint="Instant, no generation" />
              <Activity label="Resumes tailored" value={usage.tailored} icon={FileText} hint="From your master" />
            </div>
          </section>

          <AiUsage events={tokens} />
        </div>

        {/* Profile sections */}
        <Card className="h-fit">
          <div className="flex items-center gap-3">
            <ProgressRing value={percent} size={52} stroke={5}>
              <span className="text-caption font-semibold tabular-nums">{percent}%</span>
            </ProgressRing>
            <div className="min-w-0">
              <h2 className="text-title">Your profile</h2>
              <p className="text-body-sm text-muted">
                {percent === 100 ? 'Complete — answers can be specific.' : `${items.length - doneCount} steps to go.`}
              </p>
            </div>
          </div>
          <ul className="mt-4 space-y-1">
            {[{ slug: 'personal', title: 'Personal' }, ...SECTIONS].map(({ slug, title }) => {
              const count = counts[slug]
              return (
                <li key={slug}>
                  <Link
                    href={count === 0 ? `/profile/${slug}?new=1` : `/profile/${slug}`}
                    className="group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-surface-muted"
                  >
                    <IconTile icon={SECTION_ICONS[slug]} tone={count === 0 ? 'neutral' : 'accent'} size="sm" />
                    <span className="flex-1 font-medium">{title}</span>
                    {count !== undefined && (
                      <span
                        className={clsx(
                          'rounded-md px-1.5 text-caption font-medium tabular-nums',
                          count ? 'bg-surface-muted text-muted' : 'bg-warning-soft text-warning',
                        )}
                      >
                        {count ? count : count === 0 ? 'Add' : ''}
                      </span>
                    )}
                    <ArrowRight className="h-3.5 w-3.5 text-subtle transition group-hover:translate-x-0.5 group-hover:text-fg" />
                  </Link>
                </li>
              )
            })}
          </ul>
        </Card>
      </div>
    </div>
  )
}
