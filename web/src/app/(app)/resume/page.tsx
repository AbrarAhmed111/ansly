'use client'

import type { TailoringListItem } from '@ansly/types'
import { ArrowRight, Download, Eye, FileText, Plus, RefreshCcw, Trash2, TriangleAlert, Upload } from 'lucide-react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { useConfirm } from '@/components/dialog'
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorText,
  IconButton,
  PageHeader,
  Skeleton,
  buttonStyles,
} from '@/components/ui'
import { KEYS, deleteTailoring, getMasterResume, getTailoring, listTailorings, tailoringFileUrl } from '@/lib/api'
import { load, useCached } from '@/lib/cache'
import { errorMessage, plural } from '@/lib/format'
import { PARSE_STATUS, formatDate, isRunning } from '@/lib/resume'

const STATUS_LABEL: Record<string, string> = { ready: 'Ready', failed: 'Failed' }

function MasterSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-5 w-10 rounded-full" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-24" />
      </div>
    </div>
  )
}

function ListSkeleton() {
  return (
    <Card className="divide-y divide-border p-0" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 px-5 py-4">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-8" />
        </div>
      ))}
    </Card>
  )
}

/** Warms a tailoring's detail on hover/focus, so opening it shows data at once. */
const warm = (id: string) => void load(`${KEYS.tailoring(id)}:detail`, () => getTailoring(id, true), 15_000).catch(() => undefined)

export default function ResumePage() {
  // Both reads start together; revisits show the last data at once and refresh in the background.
  const masterQuery = useCached(KEYS.master, getMasterResume, errorMessage)
  const listQuery = useCached(KEYS.tailorings, listTailorings, errorMessage)
  const master = masterQuery.data ?? null
  const items = listQuery.data?.items ?? null
  const error = masterQuery.error ?? listQuery.error
  const [confirm, confirmDialog] = useConfirm()

  async function download(id: string) {
    try {
      const { url } = await tailoringFileUrl(id)
      window.location.assign(url)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  async function remove(item: TailoringListItem) {
    const ok = await confirm({
      title: 'Delete tailored resume?',
      description: `The tailored resume for ${item.jobTitle}${item.company ? ` at ${item.company}` : ''} and its Word document are deleted. Your master resume isn’t affected.`,
      confirmLabel: 'Delete',
    })
    if (!ok) return
    try {
      await deleteTailoring(item.id)
      toast.success('Deleted')
      void listQuery.refresh()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const resume = master?.resume
  const status = resume ? PARSE_STATUS[resume.parseStatus] : null

  return (
    <div className="animate-fade-up">
      {confirmDialog}
      <PageHeader
        eyebrow="Resume"
        title="Resume tailoring"
        description="Ansly tailors your own Word resume to a job, keeping its design, using only your real experience. Your master is never changed."
        actions={
          resume && (
            <Link href="/resume/tailor" className={buttonStyles()}>
              <Plus className="h-4 w-4" />
              Tailor for a job
            </Link>
          )
        }
      />
      <ErrorText>{error}</ErrorText>

      <Card>
        <CardHeader icon={FileText} title="Master resume" description="The resume every tailoring starts from." />
        <div className="mt-4">
          {!master && !error && <MasterSkeleton />}
          {master && !resume && (
            <EmptyState
              icon={Upload}
              title="Upload your master resume"
              description="Your resume as a Word (.docx) file. Ansly keeps its design and tailors the content for each job."
              action={
                <Link href="/resume/upload" className={buttonStyles()}>
                  <Upload className="h-4 w-4" />
                  Upload resume
                </Link>
              }
            />
          )}
          {resume && status && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <p className="font-medium">{resume.name}</p>
                <Badge>v{resume.version}</Badge>
                <Badge tone={status.tone} dot>
                  {status.label}
                </Badge>
                <span className="text-caption text-subtle">Updated {formatDate(resume.updatedAt)}</span>
              </div>
              {resume.fileType === 'pdf' && (
                <Alert tone="warning" title="Upload your resume as a Word (.docx) file to tailor it">
                  Tailoring now edits your own Word document so its design is kept, and this master is a PDF. Save it as
                  .docx in Word or Google Docs and upload it again.
                </Alert>
              )}
              {resume.parseStatus === 'needs_review' && (
                <Alert tone="warning" title="Check what Ansly read before tailoring">
                  {resume.parseError || 'Some parts of your resume may not have been read correctly.'}
                </Alert>
              )}
              <div className="flex flex-wrap gap-2">
                <Link href={`/resume/upload?id=${resume.id}`} className={buttonStyles({ variant: resume.parseStatus === 'needs_review' ? 'primary' : 'secondary', size: 'sm' })}>
                  <Eye className="h-4 w-4" />
                  {resume.parseStatus === 'needs_review' ? 'Review and confirm' : 'View parsed'}
                </Link>
                <Link href="/resume/upload" className={buttonStyles({ variant: 'secondary', size: 'sm' })}>
                  <RefreshCcw className="h-4 w-4" />
                  Replace
                </Link>
              </div>
              {master.discrepancies.length > 0 && (
                <Link
                  href="/resume/discrepancies"
                  className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3.5 py-2.5 text-body-sm transition hover:border-warning/50"
                >
                  <TriangleAlert className="h-4 w-4 text-warning" />
                  <span className="flex-1">{plural(master.discrepancies.length, 'difference')} from your profile</span>
                  <span className="font-medium text-accent">Review</span>
                  <ArrowRight className="h-3.5 w-3.5 text-accent" />
                </Link>
              )}
            </div>
          )}
        </div>
      </Card>

      <h2 className="mt-8 text-title">Tailored resumes</h2>
      <div className="mt-3">
        {items === null && !error && <ListSkeleton />}
        {items?.length === 0 && (
          <EmptyState
            icon={FileText}
            title="No tailored resumes yet"
            description={
              resume
                ? 'Open a job on LinkedIn, Indeed or a career page with the extension, or paste a job description here.'
                : 'Upload your master resume first.'
            }
            action={
              resume && (
                <Link href="/resume/tailor" className={buttonStyles({ variant: 'secondary' })}>
                  <Plus className="h-4 w-4" />
                  Tailor for a job description
                </Link>
              )
            }
          />
        )}
        {items && items.length > 0 && (
          <Card className="divide-y divide-border p-0">
            {items.map((item) => (
              <div key={item.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/resume/${item.id}`}
                    className="font-medium hover:text-accent"
                    onMouseEnter={() => warm(item.id)}
                    onFocus={() => warm(item.id)}
                  >
                    {item.jobTitle}
                    {item.company && <span className="text-muted"> · {item.company}</span>}
                  </Link>
                  <p className="text-caption text-subtle">{formatDate(item.createdAt)}</p>
                </div>
                {isRunning(item.status) ? (
                  <Badge tone="accent" dot>
                    Working…
                  </Badge>
                ) : (
                  item.status === 'failed' && <Badge tone="danger">{STATUS_LABEL.failed}</Badge>
                )}
                <div className="flex items-center gap-1">
                  <Link href={`/resume/${item.id}`} className={buttonStyles({ variant: 'ghost', size: 'sm' })}>
                    Review
                  </Link>
                  {item.hasFile && <IconButton icon={Download} label="Download DOCX" onClick={() => download(item.id)} />}
                  <IconButton icon={Trash2} label="Delete" tone="danger" onClick={() => remove(item)} />
                </div>
              </div>
            ))}
          </Card>
        )}
        {resume && items && items.length > 0 && (
          <Link href="/resume/tailor" className={buttonStyles({ variant: 'ghost', size: 'sm', className: 'mt-3' })}>
            <Plus className="h-4 w-4" />
            Tailor for a job description
          </Link>
        )}
      </div>
    </div>
  )
}
