'use client'

import type { ResumeRecord, StructuredResume } from '@ansly/types'
import { clsx } from 'clsx'
import { ArrowLeft, Check, FileText, FileUp, Loader2, Palette, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import toast from 'react-hot-toast'
import { ParsedEditor, cleanResume, editorErrors } from '@/components/resume/parsed-editor'
import { Alert, Badge, Button, Card, ErrorText, PageHeader, Skeleton, buttonStyles } from '@/components/ui'
import { KEYS, createResume, listResumes, updateResume } from '@/lib/api'
import { safeNext } from '@/lib/safe-next'
import { load } from '@/lib/cache'
import { errorMessage } from '@/lib/format'
import { DOCX_ACCEPT, PARSE_STATUS, resumeFileProblem, uploadResumeFile } from '@/lib/resume'
import { createClient } from '@/lib/supabase/client'

const PROMISES = [
  { icon: Palette, title: 'Your design stays', text: 'Fonts, colors, bullets, tables, headers and footers come from your own document.' },
  { icon: FileText, title: 'Word in, Word out', text: 'You download a .docx you can still edit, named after your original.' },
  { icon: ShieldCheck, title: 'Original untouched', text: 'Every tailoring edits a copy. Your upload stays the master for the next job.' },
]

export function UploadResume({ resumeId }: { resumeId: string | null }) {
  const router = useRouter()
  const [record, setRecord] = useState<ResumeRecord | null>(null)
  const [draft, setDraft] = useState<StructuredResume | null>(null)
  const [loading, setLoading] = useState(Boolean(resumeId))
  const [reading, setReading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!resumeId) return
    load(KEYS.resumes, listResumes, 30_000)
      .then(({ items }) => {
        const found = items.find((r) => r.id === resumeId)
        if (!found) throw new Error('Resume not found.')
        setRecord(found)
        setDraft(found.parsedContent)
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false))
  }, [resumeId])

  async function onFile(file: File | undefined) {
    if (!file) return
    setError(null)
    const problem = resumeFileProblem(file)
    if (problem) return setError(problem)
    setReading(true)
    try {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) throw new Error('Your session has expired. Sign in again.')
      const filePath = await uploadResumeFile(supabase, user.id, file)
      const created = await createResume({ name: file.name, filePath, fileType: 'docx' })
      setRecord(created)
      setDraft(created.parsedContent)
      if (created.parseStatus === 'failed') {
        setError(created.parseError ?? 'We couldn’t read this resume. Please upload it again as a Word (.docx) file.')
      } else {
        router.replace(`/resume/upload?id=${created.id}`, { scroll: false })
      }
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setReading(false)
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    void onFile(e.dataTransfer.files[0])
  }

  async function save() {
    if (!record || !draft) return
    const problems = editorErrors(draft)
    if (problems.length) return toast.error(problems[0]!)
    setSaving(true)
    try {
      await updateResume(record.id, { parsedContent: cleanResume(draft) })
      toast.success(record.parseStatus === 'needs_review' ? 'Resume confirmed' : 'Changes saved')
      // Started from setup: go back there to build the profile from the resume.
      router.push(safeNext(new URLSearchParams(window.location.search).get('next'), '/resume'))
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const status = record ? PARSE_STATUS[record.parseStatus] : null
  const reviewing = record && draft && record.parseStatus !== 'failed'

  return (
    <div className="animate-fade-up">
      <Link href="/resume" className={buttonStyles({ variant: 'ghost', size: 'sm', className: '-ml-2 mb-4' })}>
        <ArrowLeft className="h-4 w-4" />
        Resume
      </Link>
      <PageHeader
        eyebrow="Master resume"
        title={reviewing ? 'Check what Ansly read' : 'Upload your master resume'}
        description={
          reviewing
            ? 'This is your resume as Ansly understood it. Fix anything that’s wrong: tailoring only ever works from what’s here.'
            : 'Upload your resume as a Word (.docx) file. Ansly preserves your original resume’s design and formatting by tailoring the uploaded Word document directly.'
        }
        actions={
          reviewing && (
            <Button icon={Check} onClick={save} loading={saving}>
              {record.parseStatus === 'needs_review' ? 'Confirm resume' : 'Save changes'}
            </Button>
          )
        }
      />

      {loading && <EditorSkeleton />}

      {!loading && !reviewing && (
        <>
          <input
            ref={inputRef}
            id="resume-file"
            type="file"
            accept={DOCX_ACCEPT}
            className="sr-only"
            onChange={(e) => void onFile(e.target.files?.[0])}
            disabled={reading}
          />
          <label
            htmlFor="resume-file"
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={clsx(
              'flex cursor-pointer flex-col items-center rounded-xl border border-dashed px-6 py-14 text-center transition',
              dragging ? 'border-accent bg-accent-soft' : 'border-border-strong bg-surface/50 hover:border-accent/60',
              reading && 'pointer-events-none opacity-70',
            )}
          >
            {reading ? <Loader2 className="h-8 w-8 animate-spin text-accent" /> : <FileUp className="h-8 w-8 text-accent" />}
            <p className="mt-3 text-title">{reading ? 'Reading your resume…' : 'Upload your master resume'}</p>
            <p className="mt-1 font-medium text-fg">{reading ? 'This takes up to half a minute.' : 'Word documents (.docx) only'}</p>
            {!reading && (
              <p className="mt-1 max-w-md text-muted">
                Drop it here or click to choose. Your original formatting and design will be preserved while Ansly
                tailors the content. Up to 10 MB, stored privately.
              </p>
            )}
          </label>
          <div className="mt-4">
            <ErrorText>{error}</ErrorText>
          </div>
          <ul className="mt-6 grid gap-3 sm:grid-cols-3">
            {PROMISES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="rounded-xl border border-border bg-surface p-4">
                <Icon className="h-4 w-4 text-accent" aria-hidden />
                <p className="mt-2 font-medium">{title}</p>
                <p className="mt-1 text-caption text-muted">{text}</p>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-caption text-subtle">
            Have a PDF? Open it in Word or Google Docs and save it as a Word (.docx) document. PDFs can’t be tailored
            without losing their design.
          </p>
        </>
      )}

      {reviewing && status && (
        <div className="space-y-4">
          <Card className="flex flex-wrap items-center gap-3 py-3.5">
            <p className="font-medium">{record.name}</p>
            <Badge>v{record.version}</Badge>
            <Badge tone={status.tone} dot>
              {status.label}
            </Badge>
          </Card>
          {record.fileType === 'pdf' && (
            <Alert tone="warning" title="This version is a PDF">
              Tailoring now edits your Word document directly to keep its design. Upload this resume as a Word (.docx)
              file to tailor it.
            </Alert>
          )}
          <p className="text-caption text-subtle">
            Ansly plans changes from this text and then edits your Word document itself. Text you correct here is still
            matched against your document, and anything that no longer matches is left exactly as it is in the file.
          </p>
          {record.parseStatus === 'needs_review' && (
            <Alert tone="warning" title="Please check this carefully">
              {record.parseError || 'Some parts of your resume may not have been read correctly.'} Ansly won’t tailor
              until you confirm it.
            </Alert>
          )}
          <ParsedEditor value={draft} onChange={setDraft} />
          <div className="flex justify-end">
            <Button icon={Check} onClick={save} loading={saving}>
              {record.parseStatus === 'needs_review' ? 'Confirm resume' : 'Save changes'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function EditorSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading resume">
      <Card className="flex items-center gap-3 py-3.5">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-5 w-10 rounded-full" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </Card>
      {[0, 1, 2].map((i) => (
        <Card key={i} className="space-y-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
        </Card>
      ))}
    </div>
  )
}
