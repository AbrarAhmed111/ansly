'use client'

import { BRIDGE_EXTENSION, BRIDGE_WEB, type ExtensionToWebMessage, type FullProfile, type MissingTarget, type ResumeRecord, type SaveMissingRequest } from '@ansly/types'
import { clsx } from 'clsx'
import { ArrowRight, Check, FileText, Puzzle, ShieldCheck, Sparkles, UserRound } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Alert, Button, Card, Chip, ErrorText, Input, PageHeader, Skeleton, StepMarker, buttonStyles } from '@/components/ui'
import { getMasterResume, saveMissing, trackEvent } from '@/lib/api'
import { errorMessage, plural } from '@/lib/format'
import { loadFullProfile } from '@/lib/profile'
import { applyResumeImport, countPlan, planResumeImport } from '@/lib/resume-profile'
import { createClient } from '@/lib/supabase/client'

type StepKey = 'account' | 'resume' | 'profile' | 'preferences' | 'extension' | 'first_answer'

const SKIP_KEY = 'ansly:setup-skipped'
const FIRST_QUESTION = 'Why are you interested in this role?'

function loadSkipped(): StepKey[] {
  try {
    return JSON.parse(localStorage.getItem(SKIP_KEY) ?? '[]') as StepKey[]
  } catch {
    return []
  }
}

/** The six preferences a resume never contains, asked with quick choices. */
const PREFERENCES: {
  key: string
  field: Extract<MissingTarget, { type: 'profile_field' }>['field']
  label: string
  choices?: string[]
  placeholder?: string
}[] = [
  { key: 'work_authorization', field: 'work_authorization', label: 'Work authorization', placeholder: 'e.g. Citizen, permanent resident, H-1B' },
  { key: 'requires_sponsorship', field: 'requires_sponsorship', label: 'Will you need visa sponsorship?', choices: ['Yes', 'No'] },
  { key: 'notice_period', field: 'notice_period', label: 'Notice period', choices: ['Immediately', '2 weeks', '1 month', '2 months'], placeholder: 'Or type it' },
  { key: 'willing_to_relocate', field: 'willing_to_relocate', label: 'Open to relocating?', choices: ['Yes', 'No', 'Depends on the role'] },
  { key: 'preferred_work_mode', field: 'preferred_work_mode', label: 'Preferred work arrangement', choices: ['Remote', 'Hybrid', 'On-site', 'Flexible'] },
  { key: 'salary_expectation', field: 'salary_expectation', label: 'Salary expectation (optional)', placeholder: 'e.g. $120k–140k' },
]

const MODE_LABELS: Record<string, string> = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'On-site', flexible: 'Flexible' }

function currentPreference(profile: FullProfile['profile'], field: string): string {
  const value = profile ? (profile as unknown as Record<string, unknown>)[field] : null
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (field === 'preferred_work_mode' && typeof value === 'string') return MODE_LABELS[value] ?? value
  return typeof value === 'string' ? value : ''
}

function StepCard({ n, title, state, icon: Icon, children, onSkip }: {
  n: number
  title: string
  state: 'done' | 'active' | 'idle'
  icon: typeof FileText
  children?: React.ReactNode
  onSkip?: () => void
}) {
  return (
    <Card className={clsx('transition', state === 'active' && 'border-accent/40 ring-4 ring-accent/10', state === 'idle' && 'opacity-80')}>
      <div className="flex items-start gap-4">
        <StepMarker state={state}>{n}</StepMarker>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className={clsx('flex items-center gap-2 text-title', state === 'idle' && 'text-muted')}>
              <Icon className="h-4 w-4 text-subtle" aria-hidden />
              {title}
            </h2>
            {onSkip && state !== 'done' && <button className="text-body-sm text-muted underline-offset-2 hover:underline" onClick={onSkip}>Skip for now</button>}
          </div>
          {children && <div className="mt-2 leading-relaxed text-muted">{children}</div>}
        </div>
      </div>
    </Card>
  )
}

export default function SetupPage() {
  const [profile, setProfile] = useState<FullProfile | null>(null)
  const [resume, setResume] = useState<ResumeRecord | null | undefined>(undefined)
  const [events, setEvents] = useState<Record<string, number>>({})
  const [userId, setUserId] = useState<string | null>(null)
  const [skipped, setSkipped] = useState<StepKey[]>([])
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [prefs, setPrefs] = useState<Record<string, string>>({})
  const [savingPrefs, setSavingPrefs] = useState(false)
  // The extension's bridge answers on this page when it's installed: connected is known without any event.
  const [extensionConnected, setExtensionConnected] = useState(false)

  useEffect(() => {
    function onMessage(event: MessageEvent<ExtensionToWebMessage>) {
      if (event.source !== window || event.origin !== window.location.origin) return
      const msg = event.data
      if (msg?.source === BRIDGE_EXTENSION && msg.type === 'ANSLY_STATUS') setExtensionConnected(msg.connected)
    }
    window.addEventListener('message', onMessage)
    window.postMessage({ source: BRIDGE_WEB, type: 'ANSLY_PING' }, window.location.origin)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const load = useCallback(async () => {
    const supabase = createClient()
    try {
      const [full, user, master, seen] = await Promise.all([
        loadFullProfile(supabase),
        supabase.auth.getUser(),
        getMasterResume().then((r) => r.resume, () => null),
        supabase.from('usage_events').select('kind').in('kind', ['extension_connected', 'generate', 'fill', 'fill_all', 'first_answer']).limit(500),
      ])
      setProfile(full)
      setUserId(user.data.user?.id ?? null)
      setResume(master)
      const counts: Record<string, number> = {}
      for (const { kind } of seen.data ?? []) counts[kind] = (counts[kind] ?? 0) + 1
      setEvents(counts)
      setPrefs((p) => Object.keys(p).length ? p : Object.fromEntries(PREFERENCES.map((q) => [q.key, currentPreference(full.profile, q.field)])))
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [])
  useEffect(() => {
    setSkipped(loadSkipped())
    void load()
  }, [load])

  function skip(step: StepKey) {
    const next = [...new Set([...skipped, step])]
    setSkipped(next)
    try {
      localStorage.setItem(SKIP_KEY, JSON.stringify(next))
    } catch {
      // Skips are a convenience.
    }
    void trackEvent({ kind: 'onboarding_step', category: `${step}_skipped` })
  }

  const plan = useMemo(() => (resume?.parsedContent && profile ? planResumeImport(resume.parsedContent, profile) : null), [resume, profile])
  const found = plan ? countPlan(plan) : null
  const parsed = resume?.parsedContent

  const done: Record<StepKey, boolean> = {
    account: true,
    resume: Boolean(resume) || (profile?.experiences.length ?? 0) > 0,
    profile: (profile?.experiences.length ?? 0) > 0 && (profile?.skills.length ?? 0) > 0,
    preferences: PREFERENCES.filter((q) => currentPreference(profile?.profile ?? null, q.field)).length >= 4,
    extension: extensionConnected || (events.extension_connected ?? 0) > 0,
    first_answer: (events.generate ?? 0) + (events.fill ?? 0) + (events.first_answer ?? 0) > 0,
  }
  const order: StepKey[] = ['account', 'resume', 'profile', 'preferences', 'extension', 'first_answer']
  const finished = (k: StepKey) => done[k] || skipped.includes(k)
  const active = order.find((k) => !finished(k))
  const state = (k: StepKey) => (done[k] ? 'done' : k === active ? 'active' : 'idle') as 'done' | 'active' | 'idle'
  const percent = Math.round((order.filter((k) => done[k]).length / order.length) * 100)

  async function importResume() {
    if (!plan || !userId) return
    setImporting(true)
    try {
      await applyResumeImport(createClient(), userId, plan)
      void trackEvent({ kind: 'onboarding_step', category: 'profile' })
      toast.success('Your profile is ready. Review anything you like.')
      await load()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setImporting(false)
    }
  }

  async function savePreferences() {
    const items: SaveMissingRequest['items'] = PREFERENCES
      .filter((q) => prefs[q.key]?.trim() && prefs[q.key] !== currentPreference(profile?.profile ?? null, q.field))
      .map((q) => ({ key: q.key, target: { type: 'profile_field', field: q.field }, value: prefs[q.key]!.trim(), scope: 'global' }))
    if (!items.length) return skip('preferences')
    setSavingPrefs(true)
    try {
      await saveMissing({ items, source: 'onboarding' })
      toast.success(`Saved ${plural(items.length, 'preference')}`)
      await load()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSavingPrefs(false)
    }
  }

  return (
    <div className="animate-fade-up">
      <PageHeader eyebrow="Setup" title="Get Ansly ready" description="About two minutes. Your resume does most of the work; skip anything and Ansly will ask when an application needs it." />

      {error && <ErrorText>{error}</ErrorText>}

      <Card className="mb-6">
        <div className="flex items-center justify-between gap-4">
          <p className="font-medium">{percent === 100 ? 'All set' : `${percent}% ready`}</p>
          <p className="text-caption text-muted">{order.filter((k) => done[k]).length} of {order.length} done</p>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Setup progress">
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${percent}%` }} />
        </div>
        <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-body-sm">
          {(['Account', 'Resume', 'Profile', 'Preferences', 'Connect extension', 'Try your first answer'] as const).map((label, i) => (
            <li key={label} className={clsx('flex items-center gap-1.5', done[order[i]!] ? 'text-fg' : 'text-muted')}>
              {done[order[i]!] ? <Check className="h-3.5 w-3.5 text-success" aria-hidden /> : <span aria-hidden>○</span>}
              {label}
            </li>
          ))}
        </ul>
      </Card>

      {!profile && !error ? (
        <div className="space-y-4" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : profile && (
        <div className="space-y-4">
          <StepCard n={1} title="Let’s build your profile" state={state('resume')} icon={FileText} onSkip={() => skip('resume')}>
            {done.resume ? (
              <p>{resume ? `Using ${resume.name}.` : 'Your profile already has your experience.'}</p>
            ) : (
              <>
                <p>Upload your resume and Ansly extracts your experience, skills, projects, education and contact details.</p>
                <Link href="/resume/upload?next=/setup" className={buttonStyles({ className: 'mt-3' })}>
                  Upload resume <ArrowRight className="h-4 w-4" />
                </Link>
              </>
            )}
          </StepCard>

          <StepCard n={2} title="Review what Ansly found" state={state('profile')} icon={UserRound} onSkip={() => skip('profile')}>
            {parsed && found && (found.experiences + found.skills + found.projects + found.education + found.achievements + found.profileFields) > 0 ? (
              <>
                <p className="text-fg">
                  We found {[
                    found.experiences && plural(found.experiences, 'experience'),
                    found.skills && plural(found.skills, 'skill'),
                    found.projects && plural(found.projects, 'project'),
                    found.education && plural(found.education, 'degree'),
                    found.achievements && plural(found.achievements, 'achievement'),
                  ].filter(Boolean).join(', ') || 'your contact details'} on your resume that your profile doesn’t have yet.
                </p>
                <p className="mt-1 text-body-sm">Nothing already on your profile is changed.</p>
                <Button className="mt-3" loading={importing} onClick={() => void importResume()}>Add them to my profile</Button>
              </>
            ) : done.profile ? (
              <div className="mt-1 grid gap-2 sm:grid-cols-3">
                {([['experience', 'Experience', profile.experiences.length], ['skills', 'Skills', profile.skills.length], ['projects', 'Projects', profile.projects.length],
                  ['education', 'Education', profile.education.length], ['achievements', 'Achievements', profile.achievements.length]] as const).map(([slug, label, n]) => (
                  <Link key={slug} href={`/profile/${slug}`} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-fg transition hover:border-border-strong">
                    <span>{label}</span><span className="tabular-nums text-muted">{n}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <p>Once your resume is uploaded, Ansly shows what it found here, as section cards to check. No giant form.</p>
            )}
          </StepCard>

          <StepCard n={3} title="Answer what a resume doesn’t say" state={state('preferences')} icon={ShieldCheck} onSkip={() => skip('preferences')}>
            <p>Applications ask these all the time. Answer once; Ansly fills them instantly from then on.</p>
            <div className="mt-4 space-y-4">
              {PREFERENCES.map((q) => (
                <div key={q.key}>
                  <p className="mb-1.5 text-body-sm font-medium text-fg" id={`pref-${q.key}`}>{q.label}</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {q.choices?.map((c) => (
                      <Chip key={c} role="radio" aria-checked={prefs[q.key] === c} selected={prefs[q.key] === c}
                        onClick={() => setPrefs((p) => ({ ...p, [q.key]: c }))}>{c}</Chip>
                    ))}
                    {q.placeholder && (
                      <Input aria-labelledby={`pref-${q.key}`} className="max-w-xs" placeholder={q.placeholder}
                        value={q.choices?.includes(prefs[q.key] ?? '') ? '' : (prefs[q.key] ?? '')}
                        onChange={(e) => setPrefs((p) => ({ ...p, [q.key]: e.target.value }))} />
                    )}
                  </div>
                </div>
              ))}
            </div>
            <Button className="mt-4" loading={savingPrefs} onClick={() => void savePreferences()}>Save preferences</Button>
          </StepCard>

          <StepCard n={4} title="Connect the extension" state={state('extension')} icon={Puzzle} onSkip={() => skip('extension')}>
            <p>The extension answers questions right on application pages. It never submits anything.</p>
            {!done.extension && <Link href="/extension" className={buttonStyles({ variant: 'secondary', className: 'mt-3' })}>Install and connect</Link>}
          </StepCard>

          <StepCard n={5} title="Try your first answer" state={state('first_answer')} icon={Sparkles} onSkip={() => skip('first_answer')}>
            <p>Question: “{FIRST_QUESTION}”</p>
            {!done.first_answer && (
              <Link href={`/playground?q=${encodeURIComponent(FIRST_QUESTION)}`} className={buttonStyles({ variant: 'secondary', className: 'mt-3' })}
                onClick={() => void trackEvent({ kind: 'onboarding_step', category: 'first_answer' })}>
                Generate a sample answer
              </Link>
            )}
          </StepCard>

          <Alert tone="accent" title="How Ansly works">
            Uses your profile only · Never submits automatically · You review every answer before it’s filled.
          </Alert>
        </div>
      )}
    </div>
  )
}
