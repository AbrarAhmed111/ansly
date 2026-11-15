'use client'

import { clsx } from 'clsx'
import { Check, CornerUpRight, FileText, Paperclip, SendHorizontal, Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'
import { GmailLogo } from '@/components/email-connection'

/** A quiet app window: a title bar and a body. The scenes below are drawn in code so they stay sharp and themed. */
export function Frame({ title, aside, children, className }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={clsx('overflow-hidden rounded-2xl border border-border bg-surface shadow-raised', className)}>
      <div className="flex h-11 items-center justify-between gap-3 border-b border-border bg-surface-muted/60 px-4">
        <span className="truncate text-body-sm font-medium text-muted">{title}</span>
        {aside}
      </div>
      {children}
    </div>
  )
}

const fade = 'transition-all duration-500 ease-out'

/* ---------------------------------------------------------------------------------------------------------------- */

const FIELDS: { label: string; value: string; long?: boolean }[] = [
  { label: 'Years of React experience', value: '4' },
  { label: 'Why do you want to work at Lumen?', value: 'Your design system work is close to the component library I led at Northwind, used by six product teams.', long: true },
  { label: 'Notice period', value: '2 weeks' },
]

/** Application form: Ansly drafts one field at a time; the person still submits. */
export function FormScene({ step }: { step: number }) {
  return (
    <Frame title="jobs.lever.co/lumen/frontend-engineer" aside={<span className="text-caption text-subtle">Step 2 of 3</span>}>
      <div className="space-y-4 p-5 sm:p-6">
        {FIELDS.map(({ label, value, long }, i) => {
          const filled = step > i
          return (
            <div key={label}>
              <p className="text-body-sm font-medium">{label}</p>
              <div
                className={clsx(
                  'relative mt-1.5 rounded-lg border bg-bg px-3 py-2 text-body-sm',
                  fade,
                  long ? 'min-h-[4.5rem]' : 'h-9',
                  filled ? 'border-accent/60 ring-4 ring-accent/10' : 'border-border',
                )}
              >
                <span className={clsx(fade, filled ? 'opacity-100' : 'opacity-0')}>{value}</span>
                <span
                  className={clsx(
                    'absolute -right-2 -top-2 inline-flex h-5 items-center gap-1 rounded-full bg-accent px-1.5 text-[0.65rem] font-semibold text-accent-fg',
                    fade,
                    step === i + 1 ? 'scale-100 opacity-100' : 'scale-75 opacity-0',
                  )}
                >
                  <Sparkles className="h-3 w-3" aria-hidden /> Drafted
                </span>
              </div>
            </div>
          )
        })}
        <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
          <span className={clsx('text-caption', fade, step >= FIELDS.length ? 'text-success' : 'text-subtle')}>
            {step >= FIELDS.length ? 'All drafted. Read them, then submit.' : 'Drafting from your profile…'}
          </span>
          <span className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-body-sm font-medium">Submit</span>
        </div>
      </div>
    </Frame>
  )
}

/* ---------------------------------------------------------------------------------------------------------------- */

const BULLETS: { before: string; after: string; requirement: string }[] = [
  {
    before: 'Built internal tools for the operations team.',
    after: 'Built event-driven internal tools that replaced three manual operations workflows.',
    requirement: 'Event-driven systems',
  },
  {
    before: 'Worked on database performance.',
    after: 'Cut p95 query time on a 40M-row Postgres table from 1.2s to 180ms.',
    requirement: 'Postgres at scale',
  },
  {
    before: 'Helped new hires get started.',
    after: 'Mentored two junior engineers through their first production releases.',
    requirement: 'Mentoring',
  },
]

/** A resume page: each bullet is rewritten toward one requirement, from facts already in the profile. */
export function ResumeScene({ step }: { step: number }) {
  return (
    <Frame title="Maya_Chen_Resume.docx, tailored for Lumen" aside={<FileText className="h-4 w-4 text-subtle" aria-hidden />}>
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap gap-1.5">
          {BULLETS.map(({ requirement }, i) => (
            <span
              key={requirement}
              className={clsx(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-caption font-medium',
                fade,
                step > i ? 'border-success/30 bg-success-soft text-success' : 'border-border text-muted',
              )}
            >
              {step > i && <Check className="h-3 w-3" aria-hidden />}
              {requirement}
            </span>
          ))}
        </div>
        <div className="mt-5 rounded-xl border border-border bg-bg p-5">
          <p className="text-title">Maya Chen</p>
          <p className="text-caption text-muted">Full-stack engineer, Northwind, 2022 to now</p>
          <ul className="mt-4 space-y-3">
            {BULLETS.map(({ before, after }, i) => {
              const done = step > i
              return (
                <li key={before} className="flex gap-2.5 text-body-sm">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-fg/60" aria-hidden />
                  <span className="grid">
                    <span className={clsx('col-start-1 row-start-1', fade, done ? 'opacity-0' : 'opacity-100')}>{before}</span>
                    <span
                      className={clsx(
                        'col-start-1 row-start-1 rounded-sm',
                        fade,
                        done ? 'bg-accent-soft/70 opacity-100' : 'translate-y-1 opacity-0',
                      )}
                    >
                      {after}
                    </span>
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
        <p className="mt-4 text-caption text-subtle">Same layout, same fonts. Your master file isn’t touched.</p>
      </div>
    </Frame>
  )
}

/* ---------------------------------------------------------------------------------------------------------------- */

const POSTS: { name: string; text: string; match?: string }[] = [
  { name: 'Sara Q., Engineering Manager', text: 'We’re hiring a React engineer, remote in EU time zones.', match: 'React, Remote' },
  { name: 'Daniel O., Founder', text: 'Looking for a growth marketer for our seed-stage team in Berlin.' },
  { name: 'Priya N., Tech Recruiter', text: 'Two frontend roles open, Next.js and TypeScript, hybrid in Dubai.', match: 'Next.js, TypeScript' },
  { name: 'Leo M., Head of Sales', text: 'Our sales team is growing. Account executives, DM me.' },
]

/** LinkedIn posts the person already loaded: off-target ones fade, matches get an email draft. */
export function LeadsScene({ step }: { step: number }) {
  const matches = POSTS.filter((p) => p.match).length
  return (
    <Frame
      title="Leads, Frontend Engineer profile"
      aside={
        <span className={clsx('text-caption tabular-nums', fade, step > 0 ? 'text-accent' : 'text-subtle')}>
          {step > 0 ? `${matches} of ${POSTS.length} match` : `${POSTS.length} posts collected`}
        </span>
      }
    >
      <ul className="divide-y divide-border">
        {POSTS.map(({ name, text, match }) => (
          <li key={name} className={clsx('flex items-start gap-3 px-5 py-4', fade, step > 0 && !match && 'opacity-35')}>
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-muted text-caption font-semibold text-muted">
              {name[0]}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-body-sm font-medium">{name}</p>
              <p className="mt-0.5 text-body-sm text-muted">{text}</p>
              {match && (
                <div className={clsx('mt-2 flex flex-wrap items-center gap-2', fade, step > 0 ? 'opacity-100' : 'h-0 opacity-0')}>
                  <span className="rounded-full bg-accent-soft px-2 py-0.5 text-caption font-medium text-accent">Matches {match}</span>
                  <span className={clsx('inline-flex items-center gap-1 text-caption text-success', fade, step > 1 ? 'opacity-100' : 'opacity-0')}>
                    <CornerUpRight className="h-3 w-3" aria-hidden /> Email drafted
                  </span>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Frame>
  )
}

/* ---------------------------------------------------------------------------------------------------------------- */

/** A Gmail draft: written by Ansly, the role resume attached, sent from the person's own account after review. */
export function GmailScene({ step }: { step: number }) {
  const sent = step >= 4
  return (
    <Frame
      title="New message"
      aside={
        <span className="inline-flex items-center gap-1.5 text-caption text-muted">
          <GmailLogo className="h-4 w-4" /> maya.chen@gmail.com
        </span>
      }
    >
      <div className="relative">
        <div className={clsx('divide-y divide-border text-body-sm', fade, sent && 'opacity-30 blur-[1px]')}>
          <p className="flex gap-3 px-5 py-2.5">
            <span className="w-14 shrink-0 text-subtle">To</span>
            <span className={clsx(fade, step >= 1 ? 'opacity-100' : 'opacity-0')}>priya@talentbridge.io</span>
          </p>
          <p className="flex gap-3 px-5 py-2.5">
            <span className="w-14 shrink-0 text-subtle">Subject</span>
            <span className={clsx('font-medium', fade, step >= 1 ? 'opacity-100' : 'opacity-0')}>Frontend roles, Next.js and TypeScript</span>
          </p>
          <div className="min-h-[9.5rem] space-y-2 px-5 py-4 leading-relaxed">
            <p className={clsx(fade, step >= 2 ? 'opacity-100' : 'translate-y-1 opacity-0')}>Hi Priya,</p>
            <p className={clsx(fade, step >= 2 ? 'opacity-100' : 'translate-y-1 opacity-0', 'delay-150')}>
              I saw your post about the two frontend roles. I’ve spent four years in React and TypeScript, most recently
              leading Northwind’s component library across six teams. My resume is attached.
            </p>
            <p className={clsx(fade, step >= 2 ? 'opacity-100' : 'translate-y-1 opacity-0', 'delay-300')}>Thanks, Maya</p>
          </div>
          <div className="flex items-center justify-between gap-3 px-5 py-3">
            <span
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-lg border border-border bg-bg px-2.5 py-1 text-caption',
                fade,
                step >= 3 ? 'opacity-100' : 'opacity-0',
              )}
            >
              <Paperclip className="h-3.5 w-3.5 text-subtle" aria-hidden /> Maya_Chen_Frontend.pdf
            </span>
            <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[#0b57d0] px-4 text-body-sm font-medium text-white">
              Send <SendHorizontal className="h-3.5 w-3.5" aria-hidden />
            </span>
          </div>
        </div>
        <div className={clsx('absolute inset-0 flex items-center justify-center', fade, sent ? 'opacity-100' : 'pointer-events-none opacity-0')}>
          <div className={clsx('flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-raised', fade, sent ? 'scale-100' : 'scale-95')}>
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-success-soft text-success">
              <Check className="h-4 w-4" aria-hidden />
            </span>
            <div>
              <p className="text-body-sm font-medium">Sent from your Gmail</p>
              <p className="text-caption text-muted">After you approved it in Review</p>
            </div>
          </div>
        </div>
      </div>
    </Frame>
  )
}
