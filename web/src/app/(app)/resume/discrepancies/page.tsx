'use client'

import type { MasterResumeResponse, ResumeDiscrepancy, StructuredResume } from '@ansly/types'
import { ArrowLeft, CheckCircle2, Scale } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import toast from 'react-hot-toast'
import { Badge, Button, Card, EmptyState, ErrorText, PageHeader, SkeletonText, buttonStyles } from '@/components/ui'
import { getMasterResume, updateResume } from '@/lib/api'
import { errorMessage, plural } from '@/lib/format'
import { companyKey } from '@/lib/resume'
import { createClient } from '@/lib/supabase/client'

const FIELD_LABEL: Record<ResumeDiscrepancy['field'], string> = {
  title: 'Job title',
  company: 'Experience',
  dates: 'Dates',
  skill: 'Skill',
  education: 'Education',
  contact: 'Contact',
}

type Action = { label: string; run: () => Promise<void>; primary?: boolean } | { label: string; href: string }

export default function DiscrepanciesPage() {
  const [data, setData] = useState<MasterResumeResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setData(await getMasterResume())
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [])
  useEffect(() => void load(), [load])

  const resume = data?.resume
  const content = resume?.parsedContent

  async function dismiss(key: string) {
    if (!resume) return
    await updateResume(resume.id, { dismissedDiscrepancies: [...resume.dismissedDiscrepancies, key] })
  }

  async function saveResume(next: StructuredResume) {
    if (!resume) return
    await updateResume(resume.id, { parsedContent: next })
  }

  function actions(d: ResumeDiscrepancy): Action[] {
    const supabase = createClient()
    const ck = d.key.split(':').slice(1).join(':')
    const experience = content?.experience.find((e) => companyKey(e.company) === ck)
    const keep: Action = { label: 'Keep as is', run: () => dismiss(d.key) }
    const profileRow = async () => {
      const { data: rows, error: err } = await supabase.from('experiences').select('id, company')
      if (err) throw new Error(err.message)
      const row = (rows ?? []).find((r) => companyKey(r.company) === ck)
      if (!row) throw new Error('That job is no longer in your profile.')
      return row
    }

    switch (d.field) {
      case 'title':
        return [
          {
            label: 'Use resume title in profile',
            primary: true,
            run: async () => {
              const row = await profileRow()
              const { error: err } = await supabase.from('experiences').update({ title: d.resumeValue }).eq('id', row.id)
              if (err) throw new Error(err.message)
            },
          },
          {
            label: 'Use profile title on resume',
            run: async () => {
              if (!content || !experience || !d.profileValue) return
              await saveResume({
                ...content,
                experience: content.experience.map((e) => (e === experience ? { ...e, title: d.profileValue! } : e)),
              })
            },
          },
          keep,
        ]
      case 'company':
        if (d.resumeValue && experience)
          return [
            {
              label: 'Add to profile',
              primary: true,
              run: async () => {
                const { error: err } = await supabase.from('experiences').insert({
                  company: experience.company,
                  title: experience.title,
                  location: experience.location,
                  is_current: experience.isCurrent,
                  highlights: experience.bullets.map((b) => b.text),
                  technologies: experience.technologies,
                })
                if (err) throw new Error(err.message)
              },
            },
            keep,
          ]
        return [keep]
      case 'skill':
        if (d.profileValue)
          return [
            {
              label: 'Remove from resume',
              primary: true,
              run: async () => {
                if (!content || !d.resumeValue) return
                await saveResume({
                  ...content,
                  skills: content.skills
                    .map((g) => ({ ...g, items: g.items.filter((s) => s !== d.resumeValue) }))
                    .filter((g) => g.items.length > 0),
                })
              },
            },
            { label: 'Edit skills', href: '/profile/skills' },
          ]
        return [
          {
            label: 'Add to profile',
            primary: true,
            run: async () => {
              const { error: err } = await supabase.from('skills').insert({ name: d.resumeValue })
              if (err) throw new Error(err.message)
            },
          },
          keep,
        ]
      case 'education': {
        const edu = content?.education.find((e) => e.institution === d.resumeValue)
        return [
          {
            label: 'Add to profile',
            primary: true,
            run: async () => {
              const { error: err } = await supabase
                .from('education')
                .insert({ institution: d.resumeValue, degree: edu?.degree ?? null, field_of_study: edu?.fieldOfStudy ?? null })
              if (err) throw new Error(err.message)
            },
          },
          keep,
        ]
      }
      case 'contact': {
        const column = d.key === 'contact:email' ? 'email' : 'phone'
        return [
          {
            label: 'Use resume value in profile',
            primary: true,
            run: async () => {
              const {
                data: { user },
              } = await supabase.auth.getUser()
              if (!user) throw new Error('Your session has expired.')
              const { error: err } = await supabase.from('profiles').update({ [column]: d.resumeValue }).eq('id', user.id)
              if (err) throw new Error(err.message)
            },
          },
          keep,
        ]
      }
      case 'dates':
        return [{ label: 'Edit dates in profile', href: '/profile/experience' }, keep]
    }
  }

  async function run(d: ResumeDiscrepancy, action: Action) {
    if (!('run' in action)) return
    setBusy(`${d.key}:${action.label}`)
    try {
      await action.run()
      toast.success('Done')
      await load()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const items = data?.discrepancies ?? []

  return (
    <div className="animate-fade-up">
      <Link href="/resume" className={buttonStyles({ variant: 'ghost', size: 'sm', className: '-ml-2 mb-4' })}>
        <ArrowLeft className="h-4 w-4" />
        Resume
      </Link>
      <PageHeader
        eyebrow="Master resume"
        title="Profile and resume differences"
        description="Where your resume and your Ansly profile disagree. You pick what’s right; nothing is changed until you choose."
      />
      <ErrorText>{error}</ErrorText>
      {!data && !error && <SkeletonText lines={5} />}
      {data && items.length === 0 && (
        <EmptyState icon={CheckCircle2} title="No differences" description="Your resume and profile agree." />
      )}
      {items.length > 0 && (
        <>
          <p className="mb-3 text-muted">{plural(items.length, 'difference')}</p>
          <div className="space-y-3">
            {items.map((d) => (
              <Card key={d.key}>
                <div className="flex flex-wrap items-start gap-3">
                  <Scale className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{d.label}</p>
                      <Badge>{FIELD_LABEL[d.field]}</Badge>
                    </div>
                    <dl className="mt-2 grid gap-1 text-body-sm sm:grid-cols-2">
                      <Value label="Resume" value={d.resumeValue} />
                      <Value label="Profile" value={d.profileValue} />
                    </dl>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {actions(d).map((a) =>
                    'href' in a ? (
                      <Link key={a.label} href={a.href} className={buttonStyles({ variant: 'secondary', size: 'sm' })}>
                        {a.label}
                      </Link>
                    ) : (
                      <Button
                        key={a.label}
                        size="sm"
                        variant={a.primary ? 'primary' : 'secondary'}
                        loading={busy === `${d.key}:${a.label}`}
                        disabled={busy !== null}
                        onClick={() => run(d, a)}
                      >
                        {a.label}
                      </Button>
                    ),
                  )}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function Value({ label, value }: { label: string; value: string | null }): ReactNode {
  return (
    <div className="rounded-md bg-surface-muted/60 px-2.5 py-1.5">
      <dt className="text-caption text-subtle">{label}</dt>
      <dd className={value ? '' : 'italic text-subtle'}>{value ?? 'Not listed'}</dd>
    </div>
  )
}
