'use client'

import { clsx } from 'clsx'
import { BriefcaseBusiness, FolderGit2, HelpCircle, Trophy, Wrench, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

interface Source {
  icon: LucideIcon
  kind: string
  title: string
  detail: string
}

/** One drafted sentence fragment and the profile entry it came from. */
const ANSWER: { text: string; source: number }[] = [
  { text: 'For the last three years I’ve owned products end to end at Northwind,', source: 0 },
  { text: ' including a billing rewrite that cut failed payments by 18%.', source: 1 },
  { text: ' Acme’s move to real-time collaboration is close to the sync engine I built for Tandem,', source: 2 },
  { text: ' and I want to keep working in TypeScript and Postgres.', source: 3 },
]

const SOURCES: Source[] = [
  { icon: BriefcaseBusiness, kind: 'Experience', title: 'Full-stack engineer, Northwind', detail: '2022 to now, sole owner of the web app' },
  { icon: Trophy, kind: 'Achievement', title: 'Billing retries rebuilt', detail: 'Failed payments down 18% in one quarter' },
  { icon: FolderGit2, kind: 'Project', title: 'Tandem', detail: 'Offline-first sync engine for shared notes' },
  { icon: Wrench, kind: 'Skills', title: 'TypeScript, PostgreSQL, Node.js', detail: 'Marked as used daily' },
]

/**
 * The landing page's one moving part: a drafted answer where every phrase points back to the profile entry it
 * came from. It plays through once on load (unless reduced motion is on), then follows hover and focus.
 */
export function ProvenanceDemo() {
  const [active, setActive] = useState<number | null>(null)
  const touched = useRef(false)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timers = [0, 1, 2, 3].map((i) => window.setTimeout(() => !touched.current && setActive(i), 900 + i * 1500))
    timers.push(window.setTimeout(() => !touched.current && setActive(null), 900 + 4 * 1500))
    return () => timers.forEach(clearTimeout)
  }, [])

  const point = (i: number | null) => {
    touched.current = true
    setActive(i)
  }

  return (
    <div className="grid overflow-hidden rounded-2xl border border-border bg-surface shadow-raised lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      {/* The application form */}
      <div className="p-5 sm:p-8">
        <div className="flex items-center justify-between gap-3 text-body-sm text-muted">
          <span className="truncate">Acme, Senior Software Engineer</span>
          <span className="shrink-0 tabular-nums text-subtle">Question 3 of 6</span>
        </div>
        <label htmlFor="demo-answer" className="mt-5 block text-title">
          Why are you interested in this role?
        </label>
        <div
          id="demo-answer"
          className="mt-3 rounded-xl border border-border-strong bg-bg px-4 py-3.5 text-body-lg leading-relaxed"
          onMouseLeave={() => point(null)}
        >
          {ANSWER.map(({ text, source }) => (
            <span
              key={source}
              tabIndex={0}
              onMouseEnter={() => point(source)}
              onFocus={() => point(source)}
              onBlur={() => point(null)}
              aria-describedby={`demo-source-${source}`}
              className={clsx(
                'cursor-default rounded-sm underline decoration-2 underline-offset-[5px] transition-colors duration-200 focus-visible:outline-none',
                active === source
                  ? 'bg-accent-soft text-fg decoration-accent'
                  : 'text-fg/80 decoration-border-strong hover:decoration-accent/60',
              )}
            >
              {text}
            </span>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="inline-flex h-8 items-center rounded-lg bg-accent px-3 text-body-sm font-medium text-accent-fg">Fill answer</span>
          <span className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-body-sm font-medium">Edit</span>
          <span className="ml-auto text-caption text-subtle">Nothing is filled until you click</span>
        </div>
      </div>

      {/* Where each phrase came from */}
      <div className="border-t border-border bg-surface-muted/60 p-5 sm:p-8 lg:border-l lg:border-t-0">
        <p className="text-body-sm font-medium text-muted">From your profile</p>
        <ul className="mt-3 space-y-2">
          {SOURCES.map(({ icon: Icon, kind, title, detail }, i) => (
            <li
              key={title}
              id={`demo-source-${i}`}
              onMouseEnter={() => point(i)}
              onMouseLeave={() => point(null)}
              className={clsx(
                'flex gap-3 rounded-xl border p-3 transition-colors duration-200',
                active === i ? 'border-accent/50 bg-surface' : 'border-transparent',
              )}
            >
              <Icon className={clsx('mt-0.5 h-4 w-4 shrink-0 transition-colors', active === i ? 'text-accent' : 'text-subtle')} aria-hidden />
              <div className="min-w-0">
                <p className="text-body-sm font-medium">
                  <span className="sr-only">{kind}: </span>
                  {title}
                </p>
                <p className="text-caption text-muted">{detail}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex gap-3 rounded-xl border border-dashed border-warning/40 p-3">
          <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          <div className="min-w-0">
            <p className="text-body-sm font-medium">Kubernetes, listed in the job</p>
            <p className="text-caption text-muted">Not in your profile, so it’s left out. Ansly asks you instead of guessing.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
