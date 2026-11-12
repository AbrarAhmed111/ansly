import {
  ArrowRight,
  Check,
  Compass,
  FileText,
  Hand,
  Search,
  Sparkles,
  Target,
  type LucideIcon,
} from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { LogoMark, LogoWithTagline } from '@/components/logo'
import { SignedInSwitch } from '@/components/signed-in'
import { Container, SectionIntro, SiteFooter, SiteHeader } from '@/components/site'
import { Badge, Card, GridPattern, IconTile, Overline, buttonStyles } from '@/components/ui'

// Static: the page is the same for everyone. The signed-in CTA and system status load in the browser.

interface WorkflowStep {
  title: string
  body: string
}

interface ProductWorkflow {
  id: string
  index: string
  icon: LucideIcon
  title: string
  description: string
  layout: 'cards' | 'timeline' | 'path' | 'list'
  steps: WorkflowStep[]
  href: string
  link: string
}

const WORKFLOWS: ProductWorkflow[] = [
  {
    id: 'application-answers',
    index: '01',
    icon: Hand,
    title: 'Application answers',
    description: 'Use your profile to prepare answers while filling out an application.',
    layout: 'cards',
    href: '/extension',
    link: 'Set up the extension',
    steps: [
      { title: 'Build your profile', body: 'Add your experience, projects, and skills once.' },
      { title: 'Open an application', body: 'Use Ansly on a supported job application form.' },
      { title: 'Draft an answer', body: 'Ansly grounds the response in your profile and the question.' },
      { title: 'Review and fill', body: 'Edit or approve the draft yourself. Ansly never submits the application.' },
    ],
  },
  {
    id: 'resume-tailoring',
    index: '02',
    icon: FileText,
    title: 'Resume tailoring',
    description: 'Create a role-specific version of your master resume without adding unsupported claims.',
    layout: 'timeline',
    href: '/resume/tailor',
    link: 'Tailor a resume',
    steps: [
      { title: 'Choose your master resume', body: 'Upload or select the resume you want to tailor.' },
      { title: 'Add the job details', body: 'Enter the role and paste its description so Ansly can analyze the requirements.' },
      { title: 'Review the tailored changes', body: 'See how the job requirements map to your real experience and profile.' },
      { title: 'Preview and download', body: 'Review the finished resume, then download it when it is ready.' },
    ],
  },
  {
    id: 'job-discovery',
    index: '03',
    icon: Compass,
    title: 'Job discovery',
    description: 'Guide your search with your preferences, then bring promising listings into Ansly for review.',
    layout: 'path',
    href: '/resume/tailor',
    link: 'Review a job with Ansly',
    steps: [
      { title: 'Set your target', body: 'Define the roles, skills, locations, and work preferences you care about.' },
      { title: 'Search trusted sources', body: 'Browse job boards and company career pages that fit your criteria.' },
      { title: 'Bring in a listing', body: 'Add the job URL and description to Ansly to analyze its requirements.' },
      { title: 'Decide what fits', body: 'Review the role in context and continue to resume tailoring if you choose.' },
    ],
  },
  {
    id: 'leads',
    index: '04',
    icon: Target,
    title: 'Leads',
    description: 'Search public web results for opportunities that match your targeting profile and organize promising leads.',
    layout: 'list',
    href: '/leads',
    link: 'Open Leads',
    steps: [
      { title: 'Define your target', body: 'Create a profile with roles, keywords, locations, and exclusions.' },
      { title: 'Search public results', body: 'Ansly queries a configured web-search provider; it does not crawl or scrape source pages.' },
      { title: 'Review matches', body: 'Inspect the result snippet, source link, and matched profile terms before relying on it.' },
      { title: 'Organize your leads', body: 'Save qualified results, filter the list, and track new versus contacted leads.' },
    ],
  },
]

function WorkflowSteps({ workflow }: { workflow: Pick<ProductWorkflow, 'layout' | 'steps'> }) {
  if (workflow.layout === 'timeline') {
    return (
      <ol className="mt-7 grid gap-x-8 gap-y-6 sm:grid-cols-2">
        {workflow.steps.map(({ title, body }, index) => (
          <li key={title} className="group relative flex gap-4">
            <span className="relative z-10 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-accent/20 bg-accent/10 font-mono text-body-sm font-semibold text-accent transition group-hover:border-accent/40 group-hover:bg-accent/15">
              0{index + 1}
            </span>
            <div className="min-w-0 border-b border-border pb-5">
              <p className="text-title">{title}</p>
              <p className="mt-2 leading-relaxed text-muted">{body}</p>
            </div>
          </li>
        ))}
      </ol>
    )
  }

  if (workflow.layout === 'path') {
    return (
      <ol className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {workflow.steps.map(({ title, body }, index) => (
          <li key={title}>
            <div className="group h-full rounded-2xl border border-border bg-surface p-5 transition duration-200 hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-card">
              <div className="flex items-center justify-between">
                <span className="font-mono text-caption font-semibold text-accent">STEP 0{index + 1}</span>
                {index < workflow.steps.length - 1 && <ArrowRight className="h-4 w-4 text-subtle" aria-hidden />}
              </div>
              <p className="mt-5 text-title">{title}</p>
              <p className="mt-2 leading-relaxed text-muted">{body}</p>
            </div>
          </li>
        ))}
      </ol>
    )
  }

  if (workflow.layout === 'list') {
    return (
      <ol className="mt-7 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
        {workflow.steps.map(({ title, body }, index) => (
          <li key={title} className="grid gap-2 p-4 transition-colors hover:bg-surface-muted/40 sm:grid-cols-[3rem_minmax(0,0.8fr)_minmax(0,1.2fr)] sm:items-center sm:gap-4 sm:px-5">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 font-mono text-body-sm font-semibold text-accent">0{index + 1}</span>
            <p className="text-title">{title}</p>
            <p className="leading-relaxed text-muted">{body}</p>
          </li>
        ))}
      </ol>
    )
  }

  return (
    <ol className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {workflow.steps.map(({ title, body }, index) => (
        <li key={title}>
          <Card className="group h-full rounded-2xl p-5 transition duration-200 hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-card">
            <div className="flex items-center justify-between">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 font-mono text-body-sm font-semibold text-accent">0{index + 1}</span>
              {index < workflow.steps.length - 1 && <ArrowRight className="h-4 w-4 text-subtle transition group-hover:translate-x-0.5 group-hover:text-accent" aria-hidden />}
            </div>
            <p className="mt-5 text-title">{title}</p>
            <p className="mt-2 leading-relaxed text-muted">{body}</p>
          </Card>
        </li>
      ))}
    </ol>
  )
}

const FEATURES: { icon: LucideIcon; title: string; body: string; href: string; link: string; label: string }[] = [
  {
    icon: Hand,
    title: 'Forms Filling',
    body: 'Prepare application answers from your profile, review or edit each response, and choose what to fill. Ansly never submits forms for you.',
    href: '/extension',
    link: 'Explore form filling',
    label: 'Stay in control',
  },
  {
    icon: Compass,
    title: 'Jobs Discovery',
    body: 'Set your role, skill, location, and work preferences to guide your search, then review job requirements in context.',
    href: '/leads',
    link: 'Find your next role',
    label: 'Search with focus',
  },
  {
    icon: Target,
    title: 'Leads',
    body: 'Search public results against your targeting profile, review why results match, and organize promising opportunities in one pipeline.',
    href: '/leads',
    link: 'Build your pipeline',
    label: 'Discover & organize',
  },
  {
    icon: FileText,
    title: 'One Click Resume Tailor',
    body: 'With your master resume ready, add a job description and start a tailored version in one click. Review the changes before downloading.',
    href: '/resume/tailor',
    link: 'Tailor your resume',
    label: 'Make every version count',
  },
]

const JOURNEY_STEPS = [
  { icon: Search, number: '01', title: 'Find an opportunity', body: 'Search broadly or bring a role you already have in mind.' },
  { icon: Target, number: '02', title: 'See how it fits', body: 'Review requirements against your actual skills and experience.' },
  { icon: Sparkles, number: '03', title: 'Apply with confidence', body: 'Tailor your resume and prepare answers you can stand behind.' },
]

const CTA_LINK =
  'relative mt-6 inline-flex h-11 items-center gap-2 rounded-xl bg-neutral-0 px-5 text-body-lg font-medium text-brand-700 shadow-xs transition hover:bg-neutral-0/90'

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

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="flex-1">
        {/* Hero */}
        <section className="relative isolate overflow-hidden">
          <GridPattern fade="top" className="-z-10 opacity-60" />
          <div className="pointer-events-none absolute -left-40 top-12 -z-10 h-96 w-96 rounded-full bg-accent/10 blur-3xl" aria-hidden />
          <div className="pointer-events-none absolute -right-36 bottom-0 -z-10 h-96 w-96 rounded-full bg-brand-500/10 blur-3xl" aria-hidden />
          <Container className="grid items-center gap-12 pb-20 pt-8 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)] lg:gap-16 lg:pb-28 lg:pt-14">
            <div className="animate-fade-up">
              <LogoWithTagline className="mb-6 w-48 rounded-lg sm:w-56" />
              <div className="flex flex-wrap items-center gap-2">

                <a
                  href="https://www.abrarahmed.pro"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface/80 px-3 py-1.5 text-caption font-semibold uppercase tracking-[0.12em] text-muted shadow-xs transition hover:border-accent/40 hover:text-fg"
                >
                  <span>Built by</span>
                  <Image
                    src="https://www.abrarahmed.pro/assets/devAbby-fulllogo-C9-MX7QK.png"
                    alt="DevAbby"
                    width={98}
                    height={20}
                    className="h-7 w-auto"
                  />
                </a>
              </div>
              <h1 className="mt-7 max-w-3xl text-display">
                Find the right role. Tailor your resume. Apply with <span className="text-gradient">confidence.</span>
              </h1>
              <p className="mt-6 max-w-xl text-lead leading-relaxed text-muted">
                Discover and organize opportunities, tailor your resume to the role, and answer application questions from
                your own experience. Ansly helps with the job search without making up a thing.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <SignedInSwitch
                  signedIn={
                    <Link href="/dashboard" className={buttonStyles({ size: 'lg' })}>
                      Open dashboard
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  }
                  signedOut={
                    <Link href="/login?mode=signup" className={buttonStyles({ size: 'lg' })}>
                      Get started — it’s free
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  }
                />
                <Link href="#how-it-works" className={buttonStyles({ size: 'lg', variant: 'secondary' })}>
                  See how it works
                </Link>
              </div>

              <ul className="mt-8 flex flex-wrap gap-x-5 gap-y-3 text-body-sm text-muted">
                {['No made-up experience', 'You approve every fill', 'Never auto-submits'].map((t) => (
                  <li key={t} className="inline-flex items-center gap-1.5">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-success/10">
                      <Check className="h-3 w-3 text-success" />
                    </span>
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

        {/* Job search workspace */}
        <section className="border-y border-border bg-surface/40">
          <Container className="py-20 lg:py-24">
            <SectionIntro eyebrow="One connected journey" title="From first search to ready-to-send">
              Keep momentum without losing your story. Each step builds on the same profile, and you stay in control of
              every decision.
            </SectionIntro>
            <div className="relative mt-12 grid gap-4 lg:grid-cols-3">
              <div className="absolute left-[16%] right-[16%] top-8 hidden border-t border-dashed border-accent/30 lg:block" aria-hidden />
              {JOURNEY_STEPS.map(({ icon: Icon, number, title, body }) => (
                <div key={number} className="relative rounded-2xl border border-border bg-bg/80 p-6 shadow-xs transition duration-200 hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-card">
                  <div className="flex items-center justify-between">
                    <IconTile icon={Icon} tone="accent" />
                    <span className="font-mono text-caption font-semibold tracking-wider text-subtle">{number}</span>
                  </div>
                  <h3 className="mt-6 text-title">{title}</h3>
                  <p className="mt-2 leading-relaxed text-muted">{body}</p>
                </div>
              ))}
            </div>
          </Container>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="scroll-mt-20 border-t border-border bg-surface/60">
          <Container className="py-20 lg:py-24">
            <SectionIntro eyebrow="How Ansly works" title="A clear workflow for every part of your job search">
              Explore each workflow separately, from application answers and resume tailoring to finding jobs and
              organizing leads.
            </SectionIntro>
            <div className="mt-12 space-y-5">
              {WORKFLOWS.map(({ icon: Icon, ...workflow }) => (
                <section
                  key={workflow.id}
                  aria-labelledby={`${workflow.id}-title`}
                  className="relative overflow-hidden rounded-3xl border border-border bg-bg p-5 shadow-xs sm:p-8 lg:p-9"
                >
                  <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-accent/5 blur-3xl" aria-hidden />
                  <div className="relative flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 items-start gap-4">
                      <div className="flex shrink-0 flex-col items-center gap-2">
                        <IconTile icon={Icon} tone="accent" size="lg" />
                        <span className="font-mono text-caption font-semibold tracking-wider text-subtle">{workflow.index}</span>
                      </div>
                      <div className="max-w-2xl">
                        <Overline tone="accent">{workflow.id.replace('-', ' ')}</Overline>
                        <h3 id={`${workflow.id}-title`} className="mt-1 text-h2">{workflow.title}</h3>
                        <p className="mt-2 leading-relaxed text-muted">{workflow.description}</p>
                      </div>
                    </div>
                    <Link href={workflow.href} className="inline-flex shrink-0 items-center gap-2 self-start rounded-lg border border-accent/20 bg-accent/5 px-3.5 py-2 text-body-sm font-semibold text-accent transition hover:border-accent/40 hover:bg-accent/10 sm:mt-1">
                      {workflow.link}
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>
                  <div className="relative">
                    <WorkflowSteps workflow={workflow} />
                  </div>
                </section>
              ))}
            </div>
          </Container>
        </section>

        {/* Features */}
        <section className="border-t border-border">
          <Container className="py-20 lg:py-24">
            <SectionIntro eyebrow="Features" title="One workspace for your job search">
              Discover opportunities, organize leads, tailor your resume, and prepare applications with tools grounded in
              your experience and under your control.
            </SectionIntro>
            <div className="mt-12 grid gap-4 sm:grid-cols-2">
              {FEATURES.map(({ icon: Icon, title, body, href, link, label }, index) => (
                <Card key={title} className="group relative flex h-full flex-col overflow-hidden rounded-2xl p-6 transition duration-200 hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-raised sm:p-7">
                  <div className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-accent/5 blur-3xl transition group-hover:bg-accent/10" aria-hidden />
                  <div className="relative flex items-center justify-between gap-4">
                    <IconTile icon={Icon} tone="accent" size="lg" />
                    <span className="rounded-full border border-border bg-surface-muted/50 px-3 py-1 text-caption font-medium text-muted">{label}</span>
                  </div>
                  <h3 className="relative mt-6 text-h3">{title}</h3>
                  <p className="relative mt-2 flex-1 leading-relaxed text-muted">{body}</p>
                  <Link href={href} className="relative mt-6 inline-flex w-fit items-center gap-2 text-body-sm font-semibold text-accent hover:underline">
                    {link}
                    <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                  </Link>
                  <span className="pointer-events-none absolute bottom-4 right-5 font-mono text-caption text-subtle/60" aria-hidden>0{index + 1}</span>
                </Card>
              ))}
            </div>
          </Container>
        </section>

        {/* CTA + status */}
        <section className="border-t border-border">
          <Container className="py-20 lg:py-24">
            <div className="grid overflow-hidden rounded-3xl bg-gradient-vivid text-accent-fg shadow-raised lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
              <div className="relative p-8 sm:p-10 lg:p-12">
              <GridPattern className="opacity-10" />
              <h2 className="relative text-h1">Your next opportunity, supported at every step.</h2>
              <p className="relative mt-3 max-w-md text-body-lg opacity-80">
                Discover roles, organize promising leads, tailor your resume, and prepare truthful applications — all from
                one profile you control.
              </p>
              <SignedInSwitch
                signedIn={
                  <Link href="/dashboard" className={CTA_LINK}>
                    Open dashboard
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                }
                signedOut={
                  <Link href="/login?mode=signup" className={CTA_LINK}>
                    Create your profile
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                }
              />
              </div>
              <div className="border-t border-white/15 bg-black/5 p-7 sm:p-9 lg:border-l lg:border-t-0">
                <p className="text-caption font-semibold uppercase tracking-[0.14em] opacity-75">Built around your choices</p>
                <h3 className="mt-2 text-h3">You stay in control</h3>
                <p className="mt-2 leading-relaxed opacity-80">Ansly supports your process. You decide what to save, edit, fill, and send.</p>
                <ul className="mt-5 space-y-2.5 text-body-sm">
                  {['Grounded in your profile', 'Review before you use', 'Never auto-submits'].map((value) => (
                    <li key={value} className="flex items-center gap-2">
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/15">
                        <Check className="h-3 w-3" />
                      </span>
                      {value}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Container>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}
