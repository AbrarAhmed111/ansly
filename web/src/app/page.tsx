import { ArrowUpRight, Github, Lock, MailCheck, Plus, UserCheck } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import type { ReactNode } from 'react'
import founderPhoto from '@/assets/img/founder.png'
import { GmailLogo } from '@/components/email-connection'
import { ProvenanceDemo } from '@/components/landing/provenance-demo'
import { GmailShowcase, ProductTour } from '@/components/landing/showcase'
import { LogoMark } from '@/components/logo'
import { Reveal } from '@/components/reveal'
import { SignedInSwitch } from '@/components/signed-in'
import { Container, SiteFooter, SiteHeader } from '@/components/site'
import { buttonStyles } from '@/components/ui'

// Static: the page is the same for everyone. The signed-in CTA loads in the browser.

const BUILDER_URL = 'https://www.abrarahmed.pro'
const REPO_URL = 'https://github.com/AbrarAhmed111/ansly'

const ROLES = [
  'Frontend Engineer, Remote',
  'Data Analyst, Dubai',
  'Product Designer, Berlin',
  'Backend Engineer, London',
  'DevOps Engineer, Remote',
  'Full-stack Developer, Lahore',
  'Mobile Engineer, Toronto',
  'Machine Learning Engineer, Remote',
  'QA Engineer, Riyadh',
  'Engineering Manager, Amsterdam',
]

const TAILOR_STEPS: { title: string; body: string }[] = [
  { title: 'Upload your master resume', body: 'Your own .docx file. Ansly reads it and fills in your profile.' },
  { title: 'Paste the job', body: 'Title, company and description. Ansly pulls out what the role asks for.' },
  { title: 'Review the changes', body: 'Each edit shows the requirement it answers and the experience behind it.' },
  { title: 'Download', body: 'A Word file in your original layout, within your page limit.' },
]

// The creator's review is real. The others are SAMPLE CONTENT from fictional people, shown with a visible notice:
// replace them with real, permissioned reviews before launch, and remove the notice then.
const REVIEWS: { name: string; role: string; quote: string; tone: string; founder?: boolean; photo?: string }[] = [
  {
    name: 'Abrar Ahmed',
    role: 'Creator of Ansly',
    quote:
      'I built Ansly for my own job search. It drafted my answers from work I’d actually done, tailored my resume for every role, and found hiring posts I’d have missed. It helped me land the job and the opportunities I was after.',
    tone: 'bg-accent-fg/20 text-accent-fg',
    founder: true,
    photo: 'https://www.abrarahmed.pro/assets/myprofile-Bvbi06Pv.png',
  },
  {
    name: 'Ayesha Khan',
    role: 'Frontend developer',
    quote:
      'I stopped rewriting the same “why this company” answer for every application. The drafts sounded like me, because they were built from my own projects.',
    tone: 'bg-accent-soft text-accent',
  },
  {
    name: 'Marcus Tran',
    role: 'Data analyst',
    quote: 'The tailored resume kept my layout. I checked every changed line against what I’d done and didn’t have to delete anything.',
    tone: 'bg-success-soft text-success',
  },
  {
    name: 'Fatima Raza',
    role: 'Computer science graduate',
    quote: 'Three interviews in my first two weeks of using it.',
    tone: 'bg-warning-soft text-warning',
  },
  {
    name: 'Daniel Park',
    role: 'Backend engineer',
    quote:
      'Leads found two hiring posts I’d never have spotted in my feed. The email draft was short and specific, and it went out from my own Gmail after I edited one line.',
    tone: 'bg-surface-muted text-fg',
  },
  {
    name: 'Sofia Lindqvist',
    role: 'Product designer',
    quote: 'What sold me is that it asks when it doesn’t know something, instead of guessing a salary or a skill I don’t have.',
    tone: 'bg-accent-soft text-accent',
  },
  {
    name: 'Omar Haddad',
    role: 'DevOps engineer',
    quote: 'Application Memory means I answer the visa and notice period questions once. After that they just fill in.',
    tone: 'bg-success-soft text-success',
  },
]

const REFUSALS: { title: string; body: string }[] = [
  { title: 'Invent experience', body: 'If it isn’t in your profile or resume, it doesn’t go in an answer or a resume.' },
  { title: 'Submit an application form', body: 'The extension only fills a field when you click Fill. You submit the application yourself.' },
  { title: 'Browse LinkedIn for you', body: 'It reads only the posts already on your screen. No scrolling, no automation.' },
  { title: 'Send email without your authorization', body: 'Job Outreach only sends after you choose Analyze and Send, or review the draft and click Send Email.' },
]

const FAQ: { q: string; a: string }[] = [
  { q: 'Is Ansly free?', a: 'Yes, Ansly is free while it’s in early access.' },
  {
    q: 'Will Ansly make things up about me?',
    a: 'No. Answers and resumes use only what’s in your profile and resume. When a job asks for something you haven’t listed, Ansly leaves it out and asks you instead.',
  },
  {
    q: 'Does it submit applications for me?',
    a: 'The extension never submits application forms: it drafts answers for you to review and fill. For email applications, paste the job ad into Job Outreach and choose Analyze to review before sending, or Analyze and Send to authorize sending when recipient, instructions, email, and resume checks are confident.',
  },
  {
    q: 'Which job sites does the extension work on?',
    a: 'LinkedIn, Indeed, Greenhouse, Lever, Workday and most company career pages. You choose which sites it’s allowed to run on.',
  },
  {
    q: 'What can Ansly do with my Gmail?',
    a: 'Ansly asks Google for send-only permission and cannot read your inbox. With Job Outreach, you can review a generated email before sending, or explicitly choose Analyze and Send for a confident application.',
  },
  {
    q: 'Who can see my profile and resumes?',
    a: 'Only you. Your data is stored in your own Ansly account, and you can export it from Settings at any time.',
  },
  {
    q: 'Is Ansly open source?',
    a: 'Yes. The full source code is on GitHub under the MIT license. You can read it, run it yourself, or contribute.',
  },
  {
    q: 'How do I get the browser extension?',
    a: 'Create your account, then contact Abrar Ahmed to enable extension access for it. Setup takes a couple of minutes after that.',
  },
]

const CONTACT: { title: string; body: string; href: string; external: boolean }[] = [
  { title: 'Request extension access', body: 'Share the email you signed up with.', href: BUILDER_URL, external: true },
  { title: 'Report a bug or suggest a feature', body: 'Say what happened and on which site.', href: BUILDER_URL, external: true },
  { title: 'Contribute on GitHub', body: 'Open an issue or a pull request.', href: REPO_URL, external: true },
  { title: 'Read the privacy policy', body: 'What Ansly stores and why.', href: '/privacy', external: false },
]

function StartButton({ signedOutLabel = 'Create your profile' }: { signedOutLabel?: string }) {
  return (
    <SignedInSwitch
      signedIn={
        <Link href="/dashboard" className={buttonStyles({ size: 'lg' })}>
          Open dashboard
        </Link>
      }
      signedOut={
        <Link href="/login?mode=signup" className={buttonStyles({ size: 'lg' })}>
          {signedOutLabel}
        </Link>
      }
    />
  )
}

/** Heading in the left column, content in the right, from lg up. */
function Section({ id, title, intro, children }: { id?: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-border">
      <Container className="grid gap-10 py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-16 lg:py-28">
        <Reveal className="lg:sticky lg:top-24 lg:self-start">
          <h2 className="text-h1 tracking-tight">{title}</h2>
          {intro && <div className="mt-4 max-w-sm text-body-lg leading-relaxed text-muted">{intro}</div>}
        </Reveal>
        <Reveal delay={80} className="min-w-0">
          {children}
        </Reveal>
      </Container>
    </section>
  )
}

function OpenSourceLink() {
  return (
    <>
      <a href={REPO_URL} target="_blank" rel="noreferrer" className={buttonStyles({ variant: 'secondary', className: 'mt-8' })}>
        <Github className="h-4 w-4" aria-hidden /> View the code on GitHub
      </a>
      <p className="mt-3 text-caption text-subtle">Open source under the MIT license.</p>
    </>
  )
}

function Initials({ name, tone }: { name: string; tone: string }) {
  const initials = name
    .split(' ')
    .map((p) => p[0])
    .join('')
  return (
    <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-body-sm font-semibold ${tone}`} aria-hidden>
      {initials}
    </span>
  )
}

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="flex-1">
        {/* 1. Hero: the claim, then the proof */}
        <section>
          <Container className="pb-20 pt-14 sm:pt-20 lg:pb-24 lg:pt-24">
            <div className="grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-end lg:gap-16">
              <h1 className="max-w-[19ch] animate-fade-up text-[clamp(2.5rem,5.6vw,4.75rem)] font-semibold leading-[0.98] tracking-[-0.035em]">
                Job applications, written from your own record.
              </h1>
              <div className="max-w-md animate-fade-up [animation-delay:90ms] lg:pb-2">
                <p className="text-body-lg leading-relaxed text-muted">
                  Paste a complete job ad from anywhere. Ansly finds the application details, writes an email from your
                  profile and matches a role resume. Review it first, or choose Analyze and Send to email directly when
                  every check is confident.
                </p>
                <div className="mt-7 flex flex-wrap items-center gap-3">
                  <StartButton />
                  <Link href="#features" className={buttonStyles({ size: 'lg', variant: 'ghost' })}>
                    See it work
                  </Link>
                </div>
              </div>
            </div>

            <div className="mt-14 animate-fade-up [animation-delay:180ms] lg:mt-20">
              <ProvenanceDemo />
              <p className="mt-4 text-body-sm text-subtle">Hover a phrase in the answer to see where it came from.</p>
            </div>
          </Container>
        </section>

        {/* 2. Hiring band: inverted colors, one big line over a moving list of roles */}
        <section className="overflow-hidden bg-fg text-bg">
          <Container className="py-16 lg:py-20">
            <Reveal>
              <p className="max-w-[22ch] text-[clamp(2rem,4.6vw,3.75rem)] font-semibold leading-[1.02] tracking-[-0.03em]">
                Your next job is closer than you think.
              </p>
              <p className="mt-4 max-w-lg text-body-lg opacity-70">
                Spend your time on the applications that fit, and send each one with a resume and answers made for that job.
              </p>
            </Reveal>
          </Container>
          <div className="relative pb-14 lg:pb-16" aria-hidden>
            <div className="flex w-max animate-marquee gap-3 motion-reduce:animate-none">
              {[...ROLES, ...ROLES].map((role, i) => (
                <span key={i} className="whitespace-nowrap rounded-full border border-bg/20 px-4 py-2 text-body-sm opacity-80">
                  {role}
                </span>
              ))}
            </div>
            <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-fg" />
            <div className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-fg" />
          </div>
        </section>

        {/* 3. Product tour: tabs on the left, a live scene on the right */}
        <section id="features" className="scroll-mt-20">
          <Container className="py-20 lg:py-28">
            <Reveal className="flex flex-wrap items-end justify-between gap-6">
              <h2 className="max-w-[20ch] text-h1 tracking-tight">One profile behind every part of your search.</h2>
              <p className="max-w-sm text-body-lg leading-relaxed text-muted">
                Upload your resume once. Ansly turns it into a profile and uses it everywhere.
              </p>
            </Reveal>
            <Reveal delay={80} className="mt-12">
              <ProductTour />
            </Reveal>
          </Container>
        </section>

        {/* 4. Gmail: scene first, explanation second */}
        <section className="border-t border-border bg-surface-muted/40">
          <Container className="py-20 lg:py-28">
            <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-16">
              <Reveal delay={80} className="order-2 min-w-0 lg:order-1">
                <GmailShowcase />
              </Reveal>
              <Reveal className="order-1 lg:order-2">
                <div className="flex items-center gap-3" aria-label="Gmail and Ansly">
                  <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-surface shadow-card">
                    <GmailLogo className="h-8 w-8" />
                  </span>
                  <Plus className="h-4 w-4 text-subtle" aria-hidden />
                  <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-surface shadow-card">
                    <LogoMark className="h-8 w-8 rounded-lg" />
                  </span>
                </div>
                <h2 className="mt-8 text-h1 tracking-tight">Reach hiring managers from your own Gmail.</h2>
                <p className="mt-4 max-w-md text-body-lg leading-relaxed text-muted">
                  Connect Gmail once. For a LinkedIn lead or a complete job ad you paste, Ansly writes a specific email
                  and matches a role resume. Review and edit it before sending, or choose Analyze and Send when the
                  application details and resume match are confident. Replies come straight to your inbox.
                </p>
                <ul className="mt-8 space-y-4">
                  {[
                    { icon: Lock, title: 'Send-only permission', body: 'Ansly can’t read your inbox or your contacts.' },
                    { icon: UserCheck, title: 'You choose how to send', body: 'Review and send yourself, or authorize Analyze and Send for confident matches.' },
                    { icon: MailCheck, title: 'Sent as you', body: 'Recipients see your name and your address.' },
                  ].map(({ icon: Icon, title, body }) => (
                    <li key={title} className="flex gap-3">
                      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
                      <div>
                        <p className="font-medium">{title}</p>
                        <p className="text-muted">{body}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </Reveal>
            </div>
          </Container>
        </section>

        {/* 5. A real sequence, so it's numbered */}
        <Section title="How a tailored resume is made" intro="About a minute per job, and your master resume is never changed.">
          <ol className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2">
            {TAILOR_STEPS.map(({ title, body }, i) => (
              <li key={title} className="bg-bg p-6 sm:p-7">
                <span className="text-h2 font-semibold tabular-nums text-accent" aria-hidden>
                  {i + 1}
                </span>
                <p className="mt-4 text-title">{title}</p>
                <p className="mt-1.5 max-w-[40ch] leading-relaxed text-muted">{body}</p>
              </li>
            ))}
          </ol>
        </Section>

        {/* 6. Reviews: uneven columns, like a wall of notes */}
        <section className="border-t border-border">
          <Container className="py-20 lg:py-28">
            <Reveal className="flex flex-wrap items-end justify-between gap-6">
              <h2 className="max-w-[18ch] text-h1 tracking-tight">From people back in interviews.</h2>
              <p className="rounded-full border border-dashed border-border-strong px-3 py-1 text-caption text-muted">
                Reviews other than the creator’s are samples during early access
              </p>
            </Reveal>
            <div className="mt-12 gap-4 sm:columns-2 lg:columns-3">
              {REVIEWS.map(({ name, role, quote, tone, founder, photo }, i) => {
                const featured = Boolean(founder)
                return (
                  <Reveal
                    as="figure"
                    key={name}
                    delay={(i % 3) * 70}
                    className={`mb-4 break-inside-avoid rounded-2xl border p-6 ${featured ? 'border-accent bg-accent text-accent-fg' : 'border-border bg-surface'}`}
                  >
                    <blockquote className={featured ? 'text-h3 leading-snug tracking-tight' : 'leading-relaxed'}>“{quote}”</blockquote>
                    <figcaption className="mt-5 flex items-center gap-3">
                      {photo ? (
                        <Image
                          src={photo}
                          alt={name}
                          width={40}
                          height={40}
                          className="h-10 w-10 shrink-0 rounded-full bg-accent-fg/20 object-cover ring-2 ring-accent-fg/30"
                        />
                      ) : (
                        <Initials name={name} tone={tone} />
                      )}
                      <div>
                        <p className="flex items-center gap-2 text-body-sm font-medium">
                          {name}
                          {founder && <span className="rounded-full bg-accent-fg/20 px-2 py-0.5 text-caption">Creator</span>}
                        </p>
                        <p className={`text-caption ${featured ? 'opacity-80' : 'text-muted'}`}>{role}</p>
                      </div>
                    </figcaption>
                  </Reveal>
                )
              })}
            </div>
          </Container>
        </section>

        {/* 7. Creator's letter: a narrow reading column beside a signature card */}
        <section id="founder" className="scroll-mt-20 border-t border-border bg-surface-muted/40">
          <Container className="grid gap-12 py-20 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] lg:gap-20 lg:py-28">
            <Reveal as="aside" className="lg:sticky lg:top-24 lg:self-start">
              {/* The photo has its own black studio backdrop, so the frame is black too and it reads the same in both themes. */}
              <figure className="w-full max-w-[18rem] sm:max-w-xs lg:max-w-sm">
                <div className="relative aspect-[800/933] overflow-hidden rounded-3xl bg-black shadow-raised ring-1 ring-border">
                  <Image
                    src={founderPhoto}
                    alt="Abrar Ahmed, creator of Ansly"
                    fill
                    sizes="(min-width: 1024px) 24rem, 18rem"
                    placeholder="blur"
                    className="object-cover"
                  />
                </div>
                <figcaption className="mt-4">
                  <p className="text-title">Abrar Ahmed</p>
                  <p className="text-muted">Creator of Ansly</p>
                </figcaption>
              </figure>
              <div className="hidden lg:block">
                <blockquote className="mt-8 border-l-2 border-accent pl-5 text-h3 leading-snug tracking-tight">
                  I built it to solve my own problem. Now I want it to solve yours.
                </blockquote>
                <OpenSourceLink />
              </div>
            </Reveal>

            <Reveal as="article" delay={80} className="max-w-[64ch]">
              <h2 className="text-h1 tracking-tight">A note from the creator</h2>
              <div className="mt-8 space-y-5 text-body-lg leading-[1.75] text-fg/85">
                <p>
                  Not long ago I was where a lot of you are right now. Applying every day, rewriting the same answers,
                  adjusting my resume for each role, and hearing nothing back from most of them.
                </p>
                <p>
                  The hard part wasn’t a lack of experience. It was the hours. Every application asked the same questions
                  in slightly different words. Every job wanted a resume that spoke to it. And some of the best openings
                  were a single LinkedIn post that slipped out of my feed before I ever saw it. I’d finish a long day of
                  applications tired, unsure whether any of it had landed.
                </p>
                <p>
                  So I built Ansly for myself. One profile holding everything I had actually done, and tools that used it:
                  answers drafted from my own projects, a resume tailored to each job without inventing a single line, and
                  a way to find the people who were hiring and write to them from my own Gmail.
                </p>
                <p>
                  It worked. I spent less time on repetitive forms and more on the roles that truly fit me, and Ansly
                  helped me land the job and the opportunities I was going after.
                </p>
                <p>
                  But I kept thinking about everyone still stuck in that loop. The late nights. The silence after you hit
                  apply. The feeling that you’re good at what you do, but can’t get anyone to notice. I know those hurdles
                  and that pain well, and nobody should have to face them alone.
                </p>
                <p>
                  That’s why I decided Ansly should be for everyone, and why I made it open source. You can read every line
                  of code, see exactly what it does with your data, run it yourself, or help make it better for the next
                  person searching.
                </p>
                <p>
                  If you’re in the middle of a job search right now, I hope Ansly gives you back some of your time and
                  your confidence. Your next job is closer than you think, and I’d love to hear when you get it.
                </p>
              </div>
              <p className="mt-10 text-title">Abrar Ahmed</p>
              <p className="text-muted">Creator, Ansly</p>
              <div className="lg:hidden">
                <OpenSourceLink />
              </div>
            </Reveal>
          </Container>
        </section>

        {/* 8. Limits, stated plainly */}
        <Section title="What Ansly won’t do" intro="An assistant that writes for you should be clear about its limits. These are built in, not settings.">
          <ul className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
            {REFUSALS.map(({ title, body }) => (
              <li key={title} className="border-l-2 border-fg pl-5">
                <p className="text-h3 tracking-tight">{title}</p>
                <p className="mt-2 max-w-[40ch] leading-relaxed text-muted">{body}</p>
              </li>
            ))}
          </ul>
        </Section>

        {/* 9. FAQ: native disclosure widgets, keyboard accessible without script */}
        <Section id="faq" title="Questions" intro="Something not covered here? Ask below.">
          <div className="divide-y divide-border border-y border-border">
            {FAQ.map(({ q, a }) => (
              <details key={q} className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-lg py-5 text-title transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 [&::-webkit-details-marker]:hidden">
                  {q}
                  <Plus className="h-5 w-5 shrink-0 text-subtle transition-transform duration-200 group-open:rotate-45" aria-hidden />
                </summary>
                <p className="max-w-[62ch] animate-fade-up pb-6 leading-relaxed text-muted">{a}</p>
              </details>
            ))}
          </div>
        </Section>

        {/* 10. Contact: the builder on one side, ways to reach him on the other */}
        <section id="contact" className="scroll-mt-20 border-t border-border">
          <Container className="py-20 lg:py-28">
            <Reveal className="grid overflow-hidden rounded-3xl border border-border bg-surface lg:grid-cols-2">
              <div className="p-8 sm:p-10 lg:p-12">
                <h2 className="text-h1 tracking-tight">Talk to the person who builds it.</h2>
                <p className="mt-4 max-w-md text-body-lg leading-relaxed text-muted">
                  Ansly is built by Abrar Ahmed. Get in touch for extension access, a bug, a feature you need, or help
                  setting up your profile.
                </p>
                <a href={BUILDER_URL} target="_blank" rel="noreferrer" className="mt-8 inline-flex items-center gap-2 text-body-sm text-muted transition-colors hover:text-fg">
                  Built by
                  <Image src="https://www.abrarahmed.pro/assets/devAbby-fulllogo-C9-MX7QK.png" alt="DevAbby" width={98} height={20} className="h-6 w-auto" />
                </a>
              </div>
              <ul className="divide-y divide-border border-t border-border lg:border-l lg:border-t-0">
                {CONTACT.map(({ title, body, href, external }) => (
                  <li key={title}>
                    <a
                      href={href}
                      {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
                      className="group flex items-center justify-between gap-4 px-8 py-6 transition-colors hover:bg-surface-muted/60 focus-visible:bg-surface-muted/60 focus-visible:outline-none sm:px-10"
                    >
                      <span>
                        <span className="block text-title">{title}</span>
                        <span className="mt-0.5 block text-muted">{body}</span>
                      </span>
                      <ArrowUpRight
                        className="h-5 w-5 shrink-0 text-subtle transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-fg"
                        aria-hidden
                      />
                    </a>
                  </li>
                ))}
              </ul>
            </Reveal>
          </Container>
        </section>

        {/* 11. Closing */}
        <section className="border-t border-border">
          <Container className="flex flex-col gap-8 py-20 lg:flex-row lg:items-end lg:justify-between lg:py-28">
            <Reveal>
              <h2 className="max-w-[18ch] text-[clamp(2rem,4.4vw,3.5rem)] font-semibold leading-[1.02] tracking-[-0.03em]">
                Get hired with applications you can stand behind.
              </h2>
              <p className="mt-4 max-w-md text-body-lg text-muted">
                Start with the resume you already have. Your first tailored answer is a few minutes away.
              </p>
            </Reveal>
            <StartButton signedOutLabel="Start for free" />
          </Container>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}
