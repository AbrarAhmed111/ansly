'use client'

import type { Profile, ProfileLinks } from '@ansly/types'
import { clsx } from 'clsx'
import { Github, Globe, Link2, Linkedin, MapPin, Palette, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import toast from 'react-hot-toast'
import { Avatar, Button, Card, ErrorText, Field, Input, KeyHint, PageHeader, Select, Skeleton, StatusDot, Textarea } from '@/components/ui'
import { createClient } from '@/lib/supabase/client'

type Form = {
  full_name: string
  headline: string
  email: string
  phone: string
  location: string
  summary: string
  additional_context: string
  links: Required<ProfileLinks>
  work_authorization: string
  requires_sponsorship: '' | 'yes' | 'no'
  notice_period: string
  salary_expectation: string
  willing_to_relocate: '' | 'yes' | 'no'
  preferred_work_mode: string
}

const EMPTY_LINKS: Required<ProfileLinks> = { linkedin: '', github: '', website: '', portfolio: '', other: '' }
const LINKS: { key: keyof ProfileLinks; label: string; icon: LucideIcon; placeholder: string }[] = [
  { key: 'linkedin', label: 'LinkedIn', icon: Linkedin, placeholder: 'https://linkedin.com/in/…' },
  { key: 'github', label: 'GitHub', icon: Github, placeholder: 'https://github.com/…' },
  { key: 'website', label: 'Website', icon: Globe, placeholder: 'https://…' },
  { key: 'portfolio', label: 'Portfolio', icon: Palette, placeholder: 'https://…' },
  { key: 'other', label: 'Other', icon: Link2, placeholder: 'https://…' },
]
const SUMMARY_MIN = 80
/** Same limit as the database column. */
const CONTEXT_MAX = 6000
const yesNo = (v: boolean | null | undefined): '' | 'yes' | 'no' => (v == null ? '' : v ? 'yes' : 'no')
const fromYesNo = (v: string) => (v === '' ? null : v === 'yes')
const orNull = (v: string) => (v.trim() ? v.trim() : null)

function toForm(p: Partial<Profile> | null, fallbackEmail: string): Form {
  return {
    full_name: p?.full_name ?? '',
    headline: p?.headline ?? '',
    email: p?.email ?? fallbackEmail,
    phone: p?.phone ?? '',
    location: p?.location ?? '',
    summary: p?.summary ?? '',
    additional_context: p?.additional_context ?? '',
    links: { ...EMPTY_LINKS, ...(p?.links ?? {}) },
    work_authorization: p?.work_authorization ?? '',
    requires_sponsorship: yesNo(p?.requires_sponsorship),
    notice_period: p?.notice_period ?? '',
    salary_expectation: p?.salary_expectation ?? '',
    willing_to_relocate: yesNo(p?.willing_to_relocate),
    preferred_work_mode: p?.preferred_work_mode ?? '',
  }
}

/** Settings-style row: explanation on the left, fields on the right. */
function Group({ title, description, children }: { title: string; description: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-border pt-8 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-10">
      <div>
        <h2 className="text-title">{title}</h2>
        <p className="mt-1 leading-relaxed text-muted">{description}</p>
      </div>
      <Card className="grid gap-5 sm:grid-cols-2">{children}</Card>
    </section>
  )
}

export default function PersonalPage() {
  const [userId, setUserId] = useState<string | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [saved, setSaved] = useState<Form | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const dirty = Boolean(form && saved && JSON.stringify(form) !== JSON.stringify(saved))

  useEffect(() => {
    const supabase = createClient()
    void (async () => {
      const { data: auth } = await supabase.auth.getUser()
      if (!auth.user) return
      setUserId(auth.user.id)
      const { data, error } = await supabase.from('profiles').select('*').eq('id', auth.user.id).maybeSingle()
      if (error) setError(error.message)
      const initial = toForm(data, auth.user.email ?? '')
      setForm(initial)
      setSaved(initial)
    })()
  }, [])

  // Warn before leaving with unsaved changes; Ctrl/Cmd+S saves.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (dirty) formRef.current?.requestSubmit()
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [dirty])

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => (f ? { ...f, [key]: value } : f))
  const setLink = (key: keyof ProfileLinks, value: string) =>
    setForm((f) => (f ? { ...f, links: { ...f.links, [key]: value } } : f))

  const onSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      if (!form || !userId) return
      setBusy(true)
      setError(null)
      const links = Object.fromEntries(
        Object.entries(form.links)
          .filter(([, v]) => v.trim())
          .map(([k, v]) => [k, v.trim()]),
      )
      const { error } = await createClient()
        .from('profiles')
        .upsert({
          id: userId,
          full_name: orNull(form.full_name),
          headline: orNull(form.headline),
          email: orNull(form.email),
          phone: orNull(form.phone),
          location: orNull(form.location),
          summary: orNull(form.summary),
          additional_context: orNull(form.additional_context),
          links,
          work_authorization: orNull(form.work_authorization),
          requires_sponsorship: fromYesNo(form.requires_sponsorship),
          notice_period: orNull(form.notice_period),
          salary_expectation: orNull(form.salary_expectation),
          willing_to_relocate: fromYesNo(form.willing_to_relocate),
          preferred_work_mode: form.preferred_work_mode || null,
        })
      setBusy(false)
      if (error) setError(error.message)
      else {
        setSaved(form)
        toast.success('Profile saved')
      }
    },
    [form, userId],
  )

  if (!form) {
    return (
      <>
        <PageHeader eyebrow="Profile" title="Personal" />
        <ErrorText>{error}</ErrorText>
        {!error && (
          <div className="space-y-4">
            <Skeleton className="h-28 w-full rounded-xl" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        )}
      </>
    )
  }

  const summaryLength = form.summary.trim().length
  const contextLength = form.additional_context.length

  return (
    <form ref={formRef} onSubmit={onSubmit} className="animate-fade-up">
      <PageHeader
        eyebrow="Profile"
        title="Personal"
        description="Who you are and how you'd describe yourself. Ansly never fills in your name, email or phone on applications — it answers the open-ended questions."
      />

      {/* Live preview */}
      <Card className="relative mb-8 overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-r from-accent/15 via-orchid-400/10 to-transparent" aria-hidden />
        <div className="relative flex flex-wrap items-center gap-4 pt-4">
          <Avatar name={form.full_name || form.email || '?'} className="h-14 w-14 text-h3 ring-4 ring-surface" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-h3">
              {form.full_name || <span className="text-subtle">Your name</span>}
            </p>
            <p className="truncate text-muted">{form.headline || 'Add a headline that sums up what you do'}</p>
          </div>
          {form.location && (
            <span className="inline-flex items-center gap-1.5 text-muted">
              <MapPin className="h-3.5 w-3.5" />
              {form.location}
            </span>
          )}
        </div>
      </Card>

      <ErrorText>{error}</ErrorText>

      <div className="space-y-8">
        <Group title="Basics" description="Your name and how you introduce yourself professionally.">
          <Field label="Full name" htmlFor="full_name">
            <Input id="full_name" value={form.full_name} onChange={(e) => set('full_name', e.target.value)} autoComplete="name" />
          </Field>
          <Field label="Location" htmlFor="location">
            <Input id="location" icon={MapPin} value={form.location} placeholder="City, Country" onChange={(e) => set('location', e.target.value)} />
          </Field>
          <Field label="Headline" htmlFor="headline" className="sm:col-span-2" help='e.g. "Full Stack Engineer building AI products"'>
            <Input id="headline" value={form.headline} onChange={(e) => set('headline', e.target.value)} />
          </Field>
          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} autoComplete="email" />
          </Field>
          <Field label="Phone" htmlFor="phone">
            <Input id="phone" type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} autoComplete="tel" />
          </Field>
        </Group>

        <Group
          title="Professional summary"
          description="Used for 'tell us about yourself' and motivation questions. A few specific sentences beat a long list."
        >
          <Field
            label="Summary"
            htmlFor="summary"
            className="sm:col-span-2"
            hint={
              <span className={clsx(summaryLength > 0 && summaryLength < SUMMARY_MIN && 'text-warning')}>
                {summaryLength < SUMMARY_MIN ? `${summaryLength}/${SUMMARY_MIN} min` : `${summaryLength} characters`}
              </span>
            }
            help="Your background, focus and what you're good at."
          >
            <Textarea id="summary" rows={6} value={form.summary} onChange={(e) => set('summary', e.target.value)} />
          </Field>
        </Group>

        <Group
          title="More about you"
          description={
            <>
              Anything else Ansly should know to answer accurately: what you’re looking for next, context behind your
              experience, domains you know well, how you like to work. Ansly treats it as true about you, in answers
              and in tailored resumes.
            </>
          }
        >
          <Field
            label="Additional context"
            htmlFor="additional_context"
            className="sm:col-span-2"
            hint={
              <span className={clsx('tabular-nums', contextLength > CONTEXT_MAX * 0.9 && 'text-warning')}>
                {contextLength}/{CONTEXT_MAX}
              </span>
            }
            help="Facts only, in your own words. Details about a specific job or project are best added there."
          >
            <Textarea
              id="additional_context"
              rows={7}
              maxLength={CONTEXT_MAX}
              value={form.additional_context}
              onChange={(e) => set('additional_context', e.target.value)}
              placeholder={
                'e.g. I’m moving into platform engineering and want roles with infrastructure ownership. ' +
                'At Acme I was the go-to person for our CI pipeline. I’ve mentored two junior developers. ' +
                'I’m comfortable presenting to non-technical stakeholders.'
              }
            />
          </Field>
        </Group>

        <Group title="Links" description="Ansly can reference these when a question asks for your portfolio or profiles.">
          {LINKS.map(({ key, label, icon, placeholder }) => (
            <Field key={key} label={label} htmlFor={`link-${key}`} className={key === 'other' ? 'sm:col-span-2' : ''}>
              <Input
                id={`link-${key}`}
                type="url"
                icon={icon}
                placeholder={placeholder}
                value={form.links[key]}
                onChange={(e) => setLink(key, e.target.value)}
              />
            </Field>
          ))}
        </Group>

        <Group
          title="Application preferences"
          description="Salary, notice period, sponsorship and relocation questions are answered only from these fields. Leave one blank and Ansly will ask you instead of guessing."
        >
          <Field label="Work authorization" htmlFor="work_authorization" help='e.g. "Authorized to work in the UK"'>
            <Input id="work_authorization" value={form.work_authorization} onChange={(e) => set('work_authorization', e.target.value)} />
          </Field>
          <Field label="Requires visa sponsorship" htmlFor="requires_sponsorship">
            <Select
              id="requires_sponsorship"
              value={form.requires_sponsorship}
              onChange={(e) => set('requires_sponsorship', e.target.value as Form['requires_sponsorship'])}
            >
              <option value="">Not specified</option>
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </Select>
          </Field>
          <Field label="Notice period / availability" htmlFor="notice_period">
            <Input id="notice_period" placeholder="e.g. 2 weeks" value={form.notice_period} onChange={(e) => set('notice_period', e.target.value)} />
          </Field>
          <Field label="Salary expectation" htmlFor="salary_expectation">
            <Input id="salary_expectation" value={form.salary_expectation} onChange={(e) => set('salary_expectation', e.target.value)} />
          </Field>
          <Field label="Willing to relocate" htmlFor="willing_to_relocate">
            <Select
              id="willing_to_relocate"
              value={form.willing_to_relocate}
              onChange={(e) => set('willing_to_relocate', e.target.value as Form['willing_to_relocate'])}
            >
              <option value="">Not specified</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </Select>
          </Field>
          <Field label="Preferred work mode" htmlFor="preferred_work_mode">
            <Select id="preferred_work_mode" value={form.preferred_work_mode} onChange={(e) => set('preferred_work_mode', e.target.value)}>
              <option value="">Not specified</option>
              <option value="remote">Remote</option>
              <option value="hybrid">Hybrid</option>
              <option value="onsite">On-site</option>
              <option value="flexible">Flexible</option>
            </Select>
          </Field>
        </Group>
      </div>

      {/* Floating save bar */}
      <div
        className={clsx(
          'fixed inset-x-0 bottom-5 z-20 flex justify-center px-4 transition-all duration-300 lg:pl-64',
          dirty ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0',
        )}
        aria-hidden={!dirty}
      >
        <div className="flex w-full max-w-lg items-center gap-3 rounded-2xl border border-border bg-surface/95 py-2.5 pl-4 pr-2.5 shadow-raised backdrop-blur">
          <StatusDot tone="warning" />
          <p className="flex-1 font-medium">Unsaved changes</p>
          <KeyHint keys={['Ctrl', 'S']} />
          <Button type="button" variant="ghost" size="sm" onClick={() => saved && setForm(saved)} tabIndex={dirty ? 0 : -1}>
            Discard
          </Button>
          <Button type="submit" size="sm" loading={busy} tabIndex={dirty ? 0 : -1}>
            Save changes
          </Button>
        </div>
      </div>
    </form>
  )
}
