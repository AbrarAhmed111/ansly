import { clsx } from 'clsx'
import {
  ArrowRight,
  BookmarkCheck,
  Check,
  FileText,
  Globe,
  Hand,
  MousePointerClick,
  Ruler,
  ShieldCheck,
  Sparkles,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import bigLogoWithTagline from '@/assets/img/big logo with tag line.png'
import { LogoMark } from '@/components/logo'
import { SiteFooter, SiteHeader } from '@/components/site'
import { IconTile, buttonStyles } from '@/components/ui'
import { checkApi, checkSupabase, type StatusCheck } from '@/lib/status'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const LABELS: Record<StatusCheck['status'], string> = {
  ok: 'Operational',
  error: 'Unreachable',
  not_configured: 'Not configured',
}

function StatusRow({ name, check }: { name: string; check: StatusCheck }) {
  const color = check.status === 'ok' ? 'bg-success' : check.status === 'error' ? 'bg-danger' : 'bg-warning'
  return (
    <li className="flex items-center justify-between gap-4 py-2.5">
      <span className="text-muted">{name}</span>
      <span className="inline-flex items-center gap-2 font-medium" title={check.detail}>
        <span className="relative flex h-2 w-2">
          {check.status === 'ok' && <span className={clsx('absolute inline-flex h-full w-full animate-ping rounded-full opacity-60', color)} />}
          <span className={clsx('relative inline-flex h-2 w-2 rounded-full', color)} />
        </span>
        {LABELS[check.status]}
      </span>
    </li>
  )
}

const STEPS: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: UserRound, title: 'Build your profile', body: 'Experience, projects and skills — once. Import from JSON to start fast.' },
  { icon: Globe, title: 'Open any application', body: 'LinkedIn, Indeed, Greenhouse, Lever, Workday and company career sites.' },
  { icon: Sparkles, title: 'Click ✨', body: 'Ansly drafts a first-person answer grounded only in your profile.' },
  { icon: MousePointerClick, title: 'Review, edit, fill', body: 'Nothing is entered until you approve it. You stay in control.' },
]

const FEATURES: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: ShieldCheck,
    title: 'Truthful by design',
    body: "If your profile doesn't support an answer, Ansly tells you what's missing instead of making something up.",
  },
  { icon: Hand, title: 'You approve every fill', body: 'Drafts appear beside the field. Edit, regenerate or discard — Ansly never submits for you.' },
  { icon: BookmarkCheck, title: 'Remembers your best answers', body: 'Save a preferred answer once and reuse it instantly the next time a similar question appears.' },
  { icon: Ruler, title: 'Respects character limits', body: 'Answers fit the field’s limit, so you never have to trim a paragraph by hand.' },
  { icon: FileText, title: 'Role-aware when you want it', body: 'Optionally include the job description for answers tailored to the company and role.' },
  { icon: Globe, title: 'Works where you apply', body: 'Detects open-ended questions on the major applicant tracking systems and company sites.' },
]

function ProductPreview() {
  return (
    <div className="relative mx-auto w-full max-w-xl">
      <div className="absolute -inset-8 -z-10 rounded-[2rem] bg-gradient-to-tr from-accent/25 via-[#b06cff]/15 to-[#ff7ab6]/20 blur-3xl" aria-hidden />
      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-raised">
        <div className="flex items-center gap-2 border-b border-border bg-surface-muted/60 px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          <span className="ml-3 truncate rounded-md bg-surface px-3 py-1 text-xs text-subtle">boards.greenhouse.io/acme/jobs/senior-engineer</span>
        </div>
        <div className="space-y-5 p-5 sm:p-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-subtle">Acme · Senior Software Engineer</p>
            <label className="mt-3 block text-sm font-medium">Why are you interested in this role? *</label>
            <div className="relative mt-2 rounded-lg border border-accent bg-surface px-3 py-2.5 text-sm leading-relaxed ring-4 ring-accent/15">
              <span className="text-fg/85">
                I&apos;ve spent the last three years shipping full-stack products end to end — most recently as the sole engineer
                at a startup, where I owned the architecture from API design to production deploys
              </span>
              <span className="ml-0.5 inline-block h-4 w-px animate-pulse bg-accent align-middle" />
              <span className="absolute -right-3 -top-3 flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-accent to-[#d946ef] text-white shadow-glow">
                <Sparkles className="h-3.5 w-3.5" />
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface-muted/50 p-4">
            <div className="flex items-center gap-2">
              <LogoMark className="h-5 w-5 rounded-md [&>svg]:h-3 [&>svg]:w-3" />
              <span className="text-xs font-semibold">Drafted from your profile</span>
              <span className="ml-auto text-xs tabular-nums text-subtle">412 / 1000</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {['Experience · Nizam LLC', 'Project · OnTask', 'Skills · Next.js, PostgreSQL'].map((s) => (
                <span key={s} className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-0.5 text-[11px] font-medium text-muted">
                  <Check className="h-3 w-3 text-success" />
                  {s}
                </span>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <span className={buttonStyles({ size: 'sm' })}>Fill answer</span>
              <span className={buttonStyles({ size: 'sm', variant: 'secondary' })}>Regenerate</span>
              <span className={buttonStyles({ size: 'sm', variant: 'ghost', className: 'ml-auto' })}>Save</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default async function Home() {
  const supabase = await createClient()
  const [{ data }, supabaseStatus, api] = await Promise.all([supabase.auth.getUser(), checkSupabase(), checkApi()])
  const apiSupabase = api.health?.supabase ?? { status: 'not_configured' as const }
  const signedIn = Boolean(data.user)

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader signedIn={signedIn} />

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="bg-grid pointer-events-none absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_top,black_20%,transparent_70%)]" aria-hidden />
          <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 pb-20 pt-16 sm:px-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:pb-28 lg:pt-24">
            <div className="animate-fade-up">
              <Image
                src={bigLogoWithTagline}
                alt="Ansly"
                width={626}
                height={297}
                priority
                className="mb-6 h-auto w-48 sm:w-56"
              />
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted shadow-xs">
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent-soft">
                  <Sparkles className="h-2.5 w-2.5 text-accent" />
                </span>
                Browser extension for job applications
              </span>
              <h1 className="mt-6 text-[2.6rem] font-semibold leading-[1.05] tracking-tight sm:text-6xl lg:text-[3.6rem]">
                Fill job applications in seconds — <span className="text-gradient">truthfully.</span>
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
                Ansly answers open-ended application questions from your own profile. If your profile doesn&apos;t support an
                answer, it says so instead of making one up.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href={signedIn ? '/dashboard' : '/login?mode=signup'} className={buttonStyles({ size: 'lg' })}>
                  {signedIn ? 'Open dashboard' : 'Get started — it’s free'}
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link href="#how-it-works" className={buttonStyles({ size: 'lg', variant: 'secondary' })}>
                  See how it works
                </Link>
              </div>
              <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
                {['No made-up experience', 'You approve every fill', 'Never auto-submits'].map((t) => (
                  <li key={t} className="inline-flex items-center gap-1.5">
                    <Check className="h-4 w-4 text-success" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <div className="animate-fade-up [animation-delay:120ms]">
              <ProductPreview />
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="scroll-mt-20 border-t border-border bg-surface/60">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-24">
            <div className="max-w-2xl">
              <p className="text-sm font-medium text-accent">How it works</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">From profile to filled form in four steps</h2>
            </div>
            <ol className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map(({ icon, title, body }, i) => (
                <li key={title} className="relative rounded-2xl border border-border bg-surface p-6 shadow-card">
                  <div className="flex items-center justify-between">
                    <IconTile icon={icon} tone="accent" />
                    <span className="font-mono text-xs text-subtle">0{i + 1}</span>
                  </div>
                  <p className="mt-5 font-semibold tracking-tight">{title}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Features */}
        <section className="border-t border-border">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-24">
            <div className="max-w-2xl">
              <p className="text-sm font-medium text-accent">Why Ansly</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">An assistant that won&apos;t embellish your résumé</h2>
              <p className="mt-4 text-lg leading-relaxed text-muted">
                Generic AI writers happily invent experience. Ansly is grounded in what you&apos;ve actually done — so every
                answer is one you can stand behind in an interview.
              </p>
            </div>
            <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, body }) => (
                <div key={title} className="bg-surface p-6 transition-colors hover:bg-surface-muted/40">
                  <Icon className="h-5 w-5 text-accent" aria-hidden />
                  <p className="mt-4 font-semibold tracking-tight">{title}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA + status */}
        <section className="border-t border-border">
          <div className="mx-auto grid max-w-6xl gap-6 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#4f46e5] via-[#7c3aed] to-[#c026d3] p-8 text-white shadow-raised sm:p-10">
              <div className="bg-grid pointer-events-none absolute inset-0 opacity-10" aria-hidden />
              <h2 className="relative text-2xl font-semibold tracking-tight sm:text-3xl">Spend your time on the interview, not the form.</h2>
              <p className="relative mt-3 max-w-md text-white/80">Build your profile once and let Ansly handle the repetitive questions.</p>
              <Link
                href={signedIn ? '/dashboard' : '/login?mode=signup'}
                className="relative mt-6 inline-flex h-11 items-center gap-2 rounded-xl bg-white px-5 text-[15px] font-medium text-[#3b2bb5] shadow-sm transition hover:bg-white/90"
              >
                {signedIn ? 'Open dashboard' : 'Create your profile'}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="rounded-2xl border border-border bg-surface p-6 shadow-card">
              <h2 className="text-sm font-semibold">System status</h2>
              <ul className="mt-2 divide-y divide-border text-sm">
                <StatusRow name="Web → Supabase" check={supabaseStatus} />
                <StatusRow name="Web → API" check={api} />
                {api.status === 'ok' && <StatusRow name="API → Supabase" check={apiSupabase} />}
              </ul>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}
