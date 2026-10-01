import { profileCompleteness } from '@ansly/types'
import { clsx } from 'clsx'
import {
  ArrowRight,
  BookmarkCheck,
  Check,
  MousePointerClick,
  Puzzle,
  RefreshCcw,
  Sparkles,
  Wand2,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import { SECTION_ICONS } from '@/components/section-icons'
import { Card, CardHeader, ErrorText, IconTile, PageHeader, ProgressRing, buttonStyles } from '@/components/ui'
import { loadFullProfile } from '@/lib/profile'
import { SECTIONS } from '@/lib/sections'
import { createClient } from '@/lib/supabase/server'

export const metadata = { title: 'Dashboard' }
export const dynamic = 'force-dynamic'

async function weeklyUsage(supabase: Awaited<ReturnType<typeof createClient>>) {
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
  const { data } = await supabase.from('usage_events').select('kind').gte('created_at', since)
  const count = (kinds: string[]) => (data ?? []).filter((e) => kinds.includes(e.kind)).length
  return { generated: count(['generate', 'regenerate']), filled: count(['fill']), reused: count(['use_saved_answer']) }
}

function Stat({ label, value, icon, hint }: { label: string; value: number; icon: LucideIcon; hint: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-medium text-muted">{label}</p>
        <IconTile icon={icon} size="sm" />
      </div>
      <p className="mt-3 text-3xl font-semibold tabular-nums tracking-tight">{value}</p>
      <p className="mt-0.5 text-xs text-subtle">{hint}</p>
    </Card>
  )
}

export default async function DashboardPage() {
  const supabase = await createClient()
  let profile
  try {
    profile = await loadFullProfile(supabase)
  } catch (e) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <ErrorText>
          Could not load your profile: {e instanceof Error ? e.message : String(e)}. If this is a new project, apply the
          database migrations first (see the README).
        </ErrorText>
      </>
    )
  }
  const { percent, items } = profileCompleteness(profile)
  const [{ count: savedCount }, usage] = await Promise.all([
    supabase.from('saved_answers').select('id', { count: 'exact', head: true }),
    weeklyUsage(supabase),
  ])
  const name = profile.profile?.full_name?.split(' ')[0]
  const next = items.find((i) => !i.done)
  const doneCount = items.filter((i) => i.done).length

  const counts: Record<string, number> = {
    experience: profile.experiences.length,
    projects: profile.projects.length,
    skills: profile.skills.length,
    education: profile.education.length,
    achievements: profile.achievements.length,
  }

  return (
    <div className="animate-fade-up">
      <PageHeader
        eyebrow="Dashboard"
        title={name ? `Welcome back, ${name}` : 'Welcome to Ansly'}
        description="Ansly answers application questions only from what's in your profile. The more complete it is, the better your answers."
      />

      {/* Completeness ------------------------------------------------------- */}
      <Card className="relative overflow-hidden p-0">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-accent/10 blur-3xl"
          aria-hidden
        />
        <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
          <div className="flex flex-col items-center gap-5 border-b border-border p-6 text-center sm:flex-row sm:text-left md:flex-col md:border-b-0 md:border-r md:text-center lg:flex-row lg:text-left">
            <ProgressRing value={percent} size={128} stroke={11}>
              <span className="text-3xl font-semibold tabular-nums tracking-tight">{percent}%</span>
              <span className="text-[11px] font-medium uppercase tracking-wider text-subtle">complete</span>
            </ProgressRing>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold tracking-tight">
                {percent === 100 ? 'Your profile is complete' : 'Strengthen your profile'}
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-muted">
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
                <Link
                  href={item.href}
                  className="group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-surface-muted"
                >
                  <span
                    className={clsx(
                      'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                      item.done ? 'border-success bg-success text-white' : 'border-border-strong',
                    )}
                  >
                    {item.done && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                  <span className={clsx('flex-1 text-sm', item.done ? 'text-muted' : 'font-medium')}>{item.label}</span>
                  <span className="text-xs tabular-nums text-subtle">+{item.weight}%</span>
                  <ArrowRight className="h-3.5 w-3.5 text-subtle opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </Card>

      {/* Usage ------------------------------------------------------------- */}
      <div className="mt-8 flex items-baseline justify-between">
        <h2 className="text-[15px] font-semibold tracking-tight">Last 7 days</h2>
      </div>
      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        <Stat label="Answers generated" value={usage.generated} icon={Sparkles} hint="Drafted by ✨ on forms" />
        <Stat label="Fields filled" value={usage.filled} icon={MousePointerClick} hint="Answers you approved" />
        <Stat label="Saved answers reused" value={usage.reused} icon={RefreshCcw} hint="Instant, no generation" />
      </div>

      {/* Profile sections + side cards --------------------------------------- */}
      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Your profile" description="What Ansly draws on when it writes an answer." />
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {[{ slug: 'personal', title: 'Personal' }, ...SECTIONS].map(({ slug, title }) => {
              const Icon = SECTION_ICONS[slug]
              const count = counts[slug]
              return (
                <Link
                  key={slug}
                  href={count === 0 ? `/profile/${slug}?new=1` : `/profile/${slug}`}
                  className="group flex items-center gap-3 rounded-lg border border-border p-3 transition hover:border-border-strong hover:bg-surface-muted/60"
                >
                  <IconTile icon={Icon} tone={count === 0 ? 'neutral' : 'accent'} size="sm" />
                  <span className="flex-1 text-sm font-medium">{title}</span>
                  {count !== undefined && (
                    <span
                      className={clsx(
                        'rounded-md px-1.5 text-xs font-medium tabular-nums',
                        count ? 'bg-surface-muted text-muted' : 'text-warning',
                      )}
                    >
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
          <Card>
            <IconTile icon={Wand2} tone="accent" />
            <h3 className="mt-3 text-sm font-semibold">Try a question</h3>
            <p className="mt-0.5 text-sm text-muted">See what Ansly would answer from your profile, right here.</p>
            <Link href="/playground" className={buttonStyles({ variant: 'secondary', size: 'sm', className: 'mt-4 w-full' })}>
              Open playground
            </Link>
          </Card>
          <Card>
            <div className="flex items-start justify-between">
              <IconTile icon={BookmarkCheck} tone="accent" />
              <span className="text-3xl font-semibold tabular-nums tracking-tight">{savedCount ?? 0}</span>
            </div>
            <h3 className="mt-3 text-sm font-semibold">Saved answers</h3>
            <p className="mt-0.5 text-sm text-muted">Reused when a similar question comes up.</p>
            <Link href="/saved-answers" className={buttonStyles({ variant: 'secondary', size: 'sm', className: 'mt-4 w-full' })}>
              Manage answers
            </Link>
          </Card>
          <Card className="relative overflow-hidden border-accent/25 bg-gradient-to-br from-accent-soft via-surface to-surface">
            <IconTile icon={Puzzle} tone="accent" />
            <h3 className="mt-3 text-sm font-semibold">Browser extension</h3>
            <p className="mt-0.5 text-sm text-muted">Connect it to use ✨ on any application form.</p>
            <Link href="/extension" className={buttonStyles({ size: 'sm', className: 'mt-4 w-full' })}>
              Set up extension
            </Link>
          </Card>
        </div>
      </div>
    </div>
  )
}
