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
import { LogoMark, LogoWithTagline } from '@/components/logo'
import { Container, SectionIntro, SiteFooter, SiteHeader } from '@/components/site'
import { Badge, Card, GridPattern, IconTile, Overline, StatusDot, buttonStyles, type Tone } from '@/components/ui'
import { checkApi, checkSupabase, type StatusCheck } from '@/lib/status'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const STATUS: Record<StatusCheck['status'], { label: string; tone: Tone }> = {
  ok: { label: 'Operational', tone: 'success' },
  error: { label: 'Unreachable', tone: 'danger' },
  not_configured: { label: 'Not configured', tone: 'warning' },
}

function StatusRow({ name, check }: { name: string; check: StatusCheck }) {
  const { label, tone } = STATUS[check.status]
  return (
    <li className="flex items-center justify-between gap-4 py-2.5">
      <span className="text-muted">{name}</span>
      <span className="inline-flex items-center gap-2 font-medium" title={check.detail}>
        <StatusDot tone={tone} pulse={check.status === 'ok'} />
        {label}
      </span>
    </li>
  )
}

const STEPS: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: UserRound, title: 'Build your profile', body: 'Experience, projects and skills — once. Import from JSON to start fast.' },
  { icon: Globe, title: 'Open any application', body: 'LinkedIn, Indeed, Greenhouse, Lever, Workday and company career sites.' },
  { icon: Sparkles, title: 'Click', body: 'Ansly drafts a first-person answer grounded only in your profile.' },
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

const PREVIEW_SOURCES = ['Experience · Nizam LLC', 'Project · OnTask', 'Skills · Next.js, PostgreSQL']

function ProductPreview() {
  return (
    <div className="relative mx-auto w-full max-w-xl">
      <div className="absolute -inset-8 -z-10 rounded-[2rem] bg-gradient-brand opacity-25 blur-3xl" aria-hidden />
      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-raised">
        <div className="flex items-center gap-2 border-b border-border bg-surface-muted/60 px-4 py-3">
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-2.5 w-2.5 rounded-full bg-border-strong" />
          ))}
          <span className="ml-3 truncate rounded-md bg-surface px-3 py-1 text-caption text-subtle">
            boards.greenhouse.io/acme/jobs/senior-engineer
          </span>
        </div>
        <div className="space-y-5 p-5 sm:p-6">
          <div>
            <Overline>Acme · Senior Software Engineer</Overline>
            <p className="mt-3 font-medium">Why are you interested in this role? *</p>
            <div className="relative mt-2 rounded-lg border border-accent bg-surface px-3 py-2.5 leading-relaxed ring-4 ring-accent/15">
              <span className="text-fg/85">
                I&apos;ve spent the last three years shipping full-stack products end to end — most recently as the sole engineer
                at a startup, where I owned the architecture from API design to production deploys
              </span>
              <span className="ml-0.5 inline-block h-4 w-px animate-pulse bg-accent align-middle" />
              <LogoMark className="absolute -right-3 -top-3 h-7 w-7 rounded-full shadow-glow" />
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface-muted/50 p-4">
            <div className="flex items-center gap-2">
              <LogoMark className="h-5 w-5 rounded-md" />
              <span className="text-caption font-semibold">Drafted from your profile</span>
              <span className="ml-auto text-caption tabular-nums text-subtle">412 / 1000</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {PREVIEW_SOURCES.map((s) => (
                <Badge key={s} className="bg-surface">
                  <Check className="h-3 w-3 text-success" />
                  {s}
                </Badge>
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
  const primaryHref = signedIn ? '/dashboard' : '/login?mode=signup'

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader signedIn={signedIn} />

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <GridPattern fade="top" className="-z-10" />
          <Container className="grid items-center gap-14 pb-20 pt-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:pb-28 lg:pt-16">
            <div className="animate-fade-up">

              <LogoWithTagline className="mb-6 w-48 sm:w-56 rounded-lg" />
              <div className="flex flex-col items-start gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-caption font-medium text-muted shadow-xs">
                  <LogoMark className="h-4 w-4 rounded-full shadow-none" />
                  Browser extension for job applications
                </span>
                <a
                  href="https://www.abrarahmed.pro"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg mt-2 border border-border bg-surface px-3 py-1.5 text-caption font-semibold uppercase tracking-[0.14em] text-muted shadow-xs transition hover:border-accent/40 hover:text-fg"
                >
                  <span>Built by</span>
                  <Image
                    src="https://www.abrarahmed.pro/assets/devAbby-fulllogo-C9-MX7QK.png"
                    alt="DevAbby"
                    width={98}
                    height={20}
                    className="h-8 w-auto"
                  />
                </a>
              </div>
              <h1 className="mt-6 text-display">
                Fill job applications in seconds — <span className="text-gradient">truthfully.</span>
              </h1>
              <p className="mt-6 max-w-xl text-lead text-muted">
                Ansly answers open-ended application questions from your own profile. If your profile doesn&apos;t support an
                answer, it says so instead of making one up.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href={primaryHref} className={buttonStyles({ size: 'lg' })}>
                  {signedIn ? 'Open dashboard' : 'Get started — it’s free'}
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link href="#how-it-works" className={buttonStyles({ size: 'lg', variant: 'secondary' })}>
                  See how it works
                </Link>
              </div>
              <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-muted">
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
          </Container>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="scroll-mt-20 border-t border-border bg-surface/60">
          <Container className="py-20 lg:py-24">
            <SectionIntro eyebrow="How it works" title="From profile to filled form in four steps" />
            <ol className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map(({ icon, title, body }, i) => (
                <li key={title}>
                  <Card className="h-full rounded-2xl p-6">
                    <div className="flex items-center justify-between">
                      <IconTile icon={icon} tone="accent" />
                      <span className="font-mono text-caption text-subtle">0{i + 1}</span>
                    </div>
                    <p className="mt-5 text-title">{title}</p>
                    <p className="mt-1.5 leading-relaxed text-muted">{body}</p>
                  </Card>
                </li>
              ))}
            </ol>
          </Container>
        </section>

        {/* Features */}
        <section className="border-t border-border">
          <Container className="py-20 lg:py-24">
            <SectionIntro eyebrow="Why Ansly" title="An assistant that won’t embellish your résumé">
              Generic AI writers happily invent experience. Ansly is grounded in what you&apos;ve actually done — so every answer
              is one you can stand behind in an interview.
            </SectionIntro>
            <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, body }) => (
                <div key={title} className="bg-surface p-6 transition-colors hover:bg-surface-muted/40">
                  <Icon className="h-5 w-5 text-accent" aria-hidden />
                  <p className="mt-4 text-title">{title}</p>
                  <p className="mt-1.5 leading-relaxed text-muted">{body}</p>
                </div>
              ))}
            </div>
          </Container>
        </section>

        {/* CTA + status */}
        <section className="border-t border-border">
          <Container className="grid gap-6 py-20 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <div className="relative overflow-hidden rounded-2xl bg-gradient-vivid p-8 text-accent-fg shadow-raised sm:p-10">
              <GridPattern className="opacity-10" />
              <h2 className="relative text-h1">Spend your time on the interview, not the form.</h2>
              <p className="relative mt-3 max-w-md text-body-lg opacity-80">
                Build your profile once and let Ansly handle the repetitive questions.
              </p>
              <Link
                href={primaryHref}
                className="relative mt-6 inline-flex h-11 items-center gap-2 rounded-xl bg-neutral-0 px-5 text-body-lg font-medium text-brand-700 shadow-xs transition hover:bg-neutral-0/90"
              >
                {signedIn ? 'Open dashboard' : 'Create your profile'}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <Card className="rounded-2xl p-6">
              <h2 className="text-title">System status</h2>
              <ul className="mt-2 divide-y divide-border">
                <StatusRow name="Web → Supabase" check={supabaseStatus} />
                <StatusRow name="Web → API" check={api} />
                {api.status === 'ok' && <StatusRow name="API → Supabase" check={apiSupabase} />}
              </ul>
            </Card>
          </Container>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}
