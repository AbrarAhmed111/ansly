'use client'

import { ArrowLeft, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { Alert, Button, Card, CharCount, ErrorText, Field, Input, PageHeader, Textarea, buttonStyles } from '@/components/ui'
import { ApiError, analyzeJob, startTailoring } from '@/lib/api'
import { errorMessage } from '@/lib/format'

/** Same minimum the API enforces. */
const MIN_DESCRIPTION = 200

export interface TailorPrefill {
  title?: string
  company?: string
  url?: string
}

/** `prefill` comes from the extension's "Paste description" fallback (the job it found, minus the description). */
export function TailorForm({ prefill }: { prefill: TailorPrefill }) {
  const router = useRouter()
  const [title, setTitle] = useState(prefill.title ?? '')
  const [company, setCompany] = useState(prefill.company ?? '')
  const [location, setLocation] = useState('')
  const [url, setUrl] = useState(prefill.url ?? '')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState<'analyzing' | 'starting' | null>(null)
  const [error, setError] = useState<{ message: string; noMaster?: boolean } | null>(null)

  const short = description.trim().length < MIN_DESCRIPTION

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim() || short) return
    setError(null)
    try {
      setBusy('analyzing')
      const job = await analyzeJob({
        job: {
          title: title.trim(),
          company: company.trim(),
          location: location.trim() || null,
          description: description.trim(),
          url: url.trim(),
          source: 'manual',
        },
      })
      setBusy('starting')
      const { id } = await startTailoring({ jobContextId: job.jobContextId })
      router.push(`/resume/${id}`)
    } catch (err) {
      setError({ message: errorMessage(err), noMaster: err instanceof ApiError && err.status === 409 })
      setBusy(null)
    }
  }

  return (
    <div className="animate-fade-up">
      <Link href="/resume" className={buttonStyles({ variant: 'ghost', size: 'sm', className: '-ml-2 mb-4' })}>
        <ArrowLeft className="h-4 w-4" />
        Resume
      </Link>
      <PageHeader
        eyebrow="Tailor"
        title="Tailor for a job description"
        description="Paste the job. Ansly matches its requirements against your real experience and builds a tailored copy of your master resume."
      />
      <Card>
        <form onSubmit={onSubmit} className="grid gap-5 sm:grid-cols-2">
          <Field label="Job title" htmlFor="job-title" required>
            <Input id="job-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Senior Full Stack Engineer" required />
          </Field>
          <Field label="Company" htmlFor="job-company">
            <Input id="job-company" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company X" />
          </Field>
          <Field label="Location" htmlFor="job-location">
            <Input id="job-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Remote" />
          </Field>
          <Field label="Job URL" htmlFor="job-url">
            <Input id="job-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
          </Field>
          <Field
            label="Job description"
            htmlFor="job-description"
            required
            className="sm:col-span-2"
            help={short && description ? `Paste the full description (at least ${MIN_DESCRIPTION} characters).` : undefined}
            hint={<CharCount count={description.length} />}
          >
            <Textarea
              id="job-description"
              rows={14}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Responsibilities, requirements, nice-to-haves…"
            />
          </Field>
          <div className="space-y-3 sm:col-span-2">
            {error && (
              <ErrorText>
                {error.message}
                {error.noMaster && (
                  <>
                    {' '}
                    <Link href="/resume/upload" className="font-medium underline">
                      Go to your master resume
                    </Link>
                  </>
                )}
              </ErrorText>
            )}
            <Alert tone="accent">
              Ansly never adds skills, metrics, titles or certifications you don’t have. Requirements your profile doesn’t
              support are listed for you instead.
            </Alert>
          </div>
          <div className="flex justify-end sm:col-span-2">
            <Button type="submit" icon={Sparkles} loading={busy !== null} disabled={!title.trim() || short}>
              {busy === 'analyzing' ? 'Analyzing job…' : busy === 'starting' ? 'Starting…' : 'Tailor resume'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
