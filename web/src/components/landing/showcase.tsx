'use client'

import { clsx } from 'clsx'
import { FileText, PenLine, Target, type LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { prefersReducedMotion, useInView, useSteps } from './motion'
import { FormScene, GmailScene, LeadsScene, ResumeScene } from './scenes'

const TOUR: {
  id: string
  icon: LucideIcon
  title: string
  body: string
  href: string
  link: string
  steps: number
  Scene: (props: { step: number }) => React.ReactNode
}[] = [
  {
    id: 'answers',
    icon: PenLine,
    title: 'Answers on application forms',
    body: 'The extension drafts each open-ended field from your profile and the job. You read it, change what you want, and submit yourself. Works on LinkedIn, Indeed, Greenhouse, Lever, Workday and company sites.',
    href: '/extension',
    link: 'Set up the extension',
    steps: 3,
    Scene: FormScene,
  },
  {
    id: 'resume',
    icon: FileText,
    title: 'A resume for each job',
    body: 'Paste a job and Ansly rewrites a copy of your Word resume toward its requirements, keeping your layout. Every change comes from experience you already have.',
    href: '/resume/tailor',
    link: 'Tailor a resume',
    steps: 3,
    Scene: ResumeScene,
  },
  {
    id: 'leads',
    icon: Target,
    title: 'Leads from LinkedIn posts',
    body: 'Collect hiring posts you’ve loaded in LinkedIn. Ansly keeps the ones that match your target roles and drafts an outreach email for each.',
    href: '/leads',
    link: 'Open Leads',
    steps: 2,
    Scene: LeadsScene,
  },
]

const STEP_MS = 1400

/** Three features, one stage: the scene plays while the section is on screen, then moves to the next feature. */
export function ProductTour() {
  const [ref, inView] = useInView<HTMLDivElement>(0.3)
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [step, setStep] = useState(0)
  const feature = TOUR[index]!

  // One timer drives everything: advance the scene, hold on its last frame, then go to the next feature
  // (or replay the same one once someone has picked a tab). Reduced motion shows each finished scene, still.
  useEffect(() => {
    if (!inView) return
    if (prefersReducedMotion()) {
      setStep(feature.steps)
      return
    }
    const id = window.setTimeout(() => {
      if (step < feature.steps) setStep(step + 1)
      else {
        if (!paused) setIndex((i) => (i + 1) % TOUR.length)
        setStep(0)
      }
    }, step === feature.steps ? STEP_MS * 2 : STEP_MS)
    return () => window.clearTimeout(id)
  }, [inView, step, feature.steps, paused])

  const choose = (i: number) => {
    setPaused(true)
    setIndex(i)
    setStep(0)
  }

  const Scene = feature.Scene
  return (
    <div ref={ref} className="grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-14">
      <div role="tablist" aria-label="Features" className="flex flex-col gap-2">
        {TOUR.map(({ id, icon: Icon, title, body, href, link }, i) => {
          const active = i === index
          return (
            <div
              key={id}
              className={clsx(
                'rounded-2xl border transition-colors duration-300',
                active ? 'border-border bg-surface shadow-card' : 'border-transparent hover:bg-surface-muted/60',
              )}
            >
              <button
                type="button"
                role="tab"
                id={`tour-tab-${id}`}
                aria-selected={active}
                aria-controls="tour-stage"
                onClick={() => choose(i)}
                className="flex w-full items-center gap-3 rounded-2xl px-5 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                <Icon className={clsx('h-5 w-5 shrink-0 transition-colors', active ? 'text-accent' : 'text-subtle')} aria-hidden />
                <span className={clsx('text-title', !active && 'text-muted')}>{title}</span>
              </button>
              {active && (
                <div className="animate-fade-up px-5 pb-5 pl-[3.25rem]">
                  <p className="max-w-[52ch] leading-relaxed text-muted">{body}</p>
                  <Link href={href} className="mt-3 inline-block text-body-sm font-medium text-accent underline-offset-4 hover:underline">
                    {link}
                  </Link>
                  {/* Progress through this scene */}
                  <div className="mt-4 h-0.5 overflow-hidden rounded-full bg-border" aria-hidden>
                    <div
                      className="h-full bg-accent transition-[width] duration-700 ease-out"
                      style={{ width: `${(Math.min(step, feature.steps) / feature.steps) * 100}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div id="tour-stage" role="tabpanel" aria-labelledby={`tour-tab-${feature.id}`} className="min-w-0 lg:pt-2">
        <div key={feature.id} className="animate-fade-in">
          <Scene step={step} />
        </div>
      </div>
    </div>
  )
}

/** The Gmail draft, played once the section scrolls into view and looped after that. */
export function GmailShowcase() {
  const [ref, inView] = useInView<HTMLDivElement>(0.4)
  const [step] = useSteps(6, 1300, inView)
  return (
    <div ref={ref}>
      <GmailScene step={step} />
    </div>
  )
}
