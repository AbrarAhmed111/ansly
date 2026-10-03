'use client'

import {
  TAILORING_STEP_COUNT,
  tailoringProgress,
  type ResumeSection,
  type TailoringResponse,
  type TailoringStatus,
  type TextDiff,
} from '@ansly/types'
import { clsx } from 'clsx'
import {
  ArrowLeft,
  CheckCircle2,
  CircleDashed,
  CircleHelp,
  Download,
  FileDown,
  ListChecks,
  RotateCcw,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { useConfirm } from '@/components/dialog'
import { ResumePreview } from '@/components/resume/resume-preview'
import { type PreviewStage, TailoredReadyCard } from '@/components/resume/tailored-ready'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  ErrorText,
  Overline,
  PageHeader,
  Skeleton,
  Spinner,
  Stat,
  StepMarker,
  buttonStyles,
} from '@/components/ui'
import { KEYS, deleteTailoring, getTailoring, startTailoring, tailoringFileUrl } from '@/lib/api'
import { useCached } from '@/lib/cache'
import { createClient } from '@/lib/supabase/client'
import { prefetchPreview, previewDocuments, saveAsPdf } from '@/lib/docx-preview'
import { errorMessage, plural } from '@/lib/format'
import { TAILORING_STEPS, formatDate, isRunning, stepState, wordDiff } from '@/lib/resume'

const POLL_MS = 2000
const SECTION_TITLES: Record<ResumeSection, string> = {
  headline: 'Title',
  summary: 'Summary',
  experience: 'Experience',
  projects: 'Projects',
  skills: 'Skills',
  education: 'Education',
  achievements: 'Achievements',
  certifications: 'Certifications',
}
const SECTION_ORDER: ResumeSection[] = ['headline', 'experience', 'projects', 'skills', 'summary', 'education', 'achievements', 'certifications']

function Diff({ diff }: { diff: TextDiff }) {
  const added = !diff.before
  return (
    <div className="rounded-lg border border-border bg-surface-muted/40 p-3">
      <p className="flex items-center gap-2 text-caption text-subtle">
        {diff.itemLabel}
        {added && <Badge tone="success">New bullet</Badge>}
      </p>
      <p className="mt-1 leading-relaxed">
        {added ? (
          <span className="rounded-sm bg-success/15 text-success">{diff.after}</span>
        ) : (
          wordDiff(diff.before, diff.after).map((part, i) => (
            <span
              key={i}
              className={clsx(
                part.kind === 'added' && 'rounded-sm bg-success/15 text-success',
                part.kind === 'removed' && 'rounded-sm bg-danger/10 text-danger line-through',
              )}
            >
              {part.text}
            </span>
          ))
        )}
      </p>
      {diff.evidenceLabels.length > 0 && (
        <p className="mt-2 text-caption text-muted">Based on: {diff.evidenceLabels.join(' · ')}</p>
      )}
    </div>
  )
}

/** The running card's progress bar: it moves within the current step, and says what that step is doing. */
function useProgress(status: TailoringStatus | undefined) {
  const [since, setSince] = useState(() => ({ status, at: Date.now() }))
  const [now, setNow] = useState(() => Date.now())
  if (since.status !== status) setSince({ status, at: Date.now() })
  const running = status !== undefined && isRunning(status)
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [running])
  return status ? tailoringProgress(status, now - since.at) : null
}

async function fetchPageLimit(): Promise<number | null> {
  const { data } = await createClient().from('profiles').select('resume_page_limit').maybeSingle()
  return (data?.resume_page_limit as number | undefined) ?? null
}

/** The page's shape while the first response loads. */
function PageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading tailored resume">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-8 w-2/3 max-w-md" />
      <Skeleton className="mt-2 h-4 w-48" />
      <Card className="mt-8">
        <div className="flex flex-col gap-6 md:flex-row md:justify-between">
          <div className="flex-1 space-y-3">
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-4 w-full max-w-lg" />
            <div className="grid gap-2 pt-2 sm:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-4 w-40" />
              ))}
            </div>
          </div>
          <div className="flex gap-2 md:flex-col">
            <Skeleton className="h-11 w-40" />
            <Skeleton className="h-11 w-40" />
          </div>
        </div>
      </Card>
      <div className="mt-6 grid gap-4 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Card className="mt-6 space-y-3">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </Card>
    </div>
  )
}

export default function TailoringPage() {
  const { tailoringId } = useParams<{ tailoringId: string }>()
  const router = useRouter()
  const { data, error, refresh } = useCached<TailoringResponse>(
    `${KEYS.tailoring(tailoringId)}:detail`,
    () => getTailoring(tailoringId, true),
    errorMessage,
  )
  const { data: pageLimit } = useCached('profile:page-limit', fetchPageLimit, errorMessage)
  const [openDiffs, setOpenDiffs] = useState<Set<ResumeSection>>(new Set())
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewStage, setPreviewStage] = useState<PreviewStage>('loading')
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, confirmDialog] = useConfirm()
  const previewRef = useRef<HTMLDivElement>(null)

  // Poll while it runs.
  useEffect(() => {
    if (!data || !isRunning(data.status)) return
    const timer = setTimeout(() => void refresh(), POLL_MS)
    return () => clearTimeout(timer)
  }, [data, refresh])

  // As soon as it's ready, fetch the renderer and both documents in the background: the preview then opens at once.
  const ready = data?.status === 'ready'
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    prefetchPreview(tailoringId)
    previewDocuments(tailoringId).then(
      () => !cancelled && setPreviewStage((s) => (s === 'error' ? s : 'ready')),
      () => !cancelled && setPreviewStage('error'),
    )
    return () => {
      cancelled = true
    }
  }, [ready, tailoringId])

  const progress = useProgress(data?.status)

  const savePdf = useCallback(async () => {
    setBusy('pdf')
    try {
      await saveAsPdf(tailoringId)
    } catch (e) {
      toast.error(`Couldn’t prepare the PDF: ${errorMessage(e)}`)
    } finally {
      setBusy(null)
    }
  }, [tailoringId])

  // Opened from the extension's "Download PDF": save it as soon as it's ready, once.
  const pdfRequested = useRef(false)
  useEffect(() => {
    if (!ready || pdfRequested.current || !new URLSearchParams(window.location.search).has('pdf')) return
    pdfRequested.current = true
    router.replace(`/resume/${tailoringId}`, { scroll: false })
    void savePdf()
  }, [ready, router, savePdf, tailoringId])

  const download = useCallback(async () => {
    setBusy('download')
    try {
      window.location.assign((await tailoringFileUrl(tailoringId)).url)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }, [tailoringId])

  function togglePreview() {
    const next = !previewOpen
    setPreviewOpen(next)
    if (next) requestAnimationFrame(() => previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  async function retry() {
    if (!data) return
    setBusy('retry')
    try {
      const { id } = await startTailoring({ jobContextId: data.jobContextId })
      router.push(`/resume/${id}`)
    } catch (e) {
      toast.error(errorMessage(e))
      setBusy(null)
    }
  }

  async function remove() {
    const ok = await confirm({
      title: 'Delete tailored resume?',
      description: 'The tailored Word document is deleted. Your original resume isn’t affected.',
      confirmLabel: 'Delete',
    })
    if (!ok) return
    try {
      await deleteTailoring(tailoringId)
      toast.success('Deleted')
      router.push('/resume')
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const detail = data?.detail
  const flagged = detail?.issues.filter((i) => i.outcome === 'flagged') ?? []
  const leftOut = detail?.issues.filter((i) => i.check === 'document') ?? []
  const sections = SECTION_ORDER.filter((s) => data?.changes.some((c) => c.section === s))

  return (
    <div className="animate-fade-up">
      {confirmDialog}
      <Link href="/resume" className={buttonStyles({ variant: 'ghost', size: 'sm', className: '-ml-2 mb-4' })}>
        <ArrowLeft className="h-4 w-4" />
        Resume
      </Link>
      {!data && !error && <PageSkeleton />}
      <ErrorText>{!data ? error : null}</ErrorText>

      {data && (
        <PageHeader
          eyebrow={ready ? 'Resume tailored' : data.status === 'failed' ? 'Tailoring failed' : 'Tailoring'}
          title={data.jobTitle}
          description={[data.company, formatDate(data.createdAt)].filter(Boolean).join(' · ')}
        />
      )}

      {data && isRunning(data.status) && (
        <>
          <Card>
            <CardHeader
              title="Tailoring your resume"
              description="Usually under a minute. Ansly edits a copy of your Word document; the original is never changed."
            />
            {progress && (
              <div className="mt-5" aria-live="polite">
                <div className="flex items-center justify-between gap-3 text-body-sm">
                  <span className="flex items-center gap-2 font-medium">
                    <Spinner />
                    {progress.activity}
                  </span>
                  <span className="tabular-nums text-muted">{progress.percent}%</span>
                </div>
                <div
                  className="mt-2 h-2 overflow-hidden rounded-full bg-surface-muted ring-1 ring-inset ring-border"
                  role="progressbar"
                  aria-label="Tailoring progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progress.percent}
                >
                  <div className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out motion-reduce:transition-none" style={{ width: `${progress.percent}%` }} />
                </div>
                <p className="mt-1.5 text-caption text-subtle">
                  Step {progress.step} of {TAILORING_STEP_COUNT}
                </p>
              </div>
            )}
            <ol className="mt-5 space-y-3" aria-live="polite">
              {TAILORING_STEPS.map((step) => {
                const state = stepState(data.status, step.status)
                return (
                  <li key={step.status} className="flex items-center gap-3">
                    <StepMarker size="sm" state={state} />
                    <span className={clsx(state === 'idle' ? 'text-muted' : 'font-medium')}>{step.label}</span>
                    {state === 'active' && <Spinner />}
                  </li>
                )
              })}
            </ol>
          </Card>
          <div className="mt-6 grid gap-4 opacity-60 sm:grid-cols-4" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
        </>
      )}

      {data?.status === 'failed' && (
        <Card className="space-y-4">
          <Alert tone="danger" title="Resume tailoring failed">
            {data.error ?? 'Your original resume has not been changed.'}
          </Alert>
          <div className="flex flex-wrap gap-2">
            {data.error?.includes('.docx') ? (
              <Link href="/resume/upload" className={buttonStyles()}>
                Upload a Word resume
              </Link>
            ) : (
              <Button icon={RotateCcw} onClick={retry} loading={busy === 'retry'}>
                Retry
              </Button>
            )}
            <Button variant="ghost" icon={Trash2} onClick={remove}>
              Delete
            </Button>
          </div>
        </Card>
      )}

      {ready && (
        <div className="space-y-6">
          <TailoredReadyCard
            preview={previewStage}
            previewOpen={previewOpen}
            leftOut={leftOut.length}
            downloading={busy === 'download'}
            savingPdf={busy === 'pdf'}
            onPreview={togglePreview}
            onDownload={download}
            onPdf={savePdf}
          />

          <div ref={previewRef} className="scroll-mt-6">
            {previewOpen && (
              <Card>
                <CardHeader
                  title="Preview"
                  description="Exactly what you’ll download: your Word document, laid out page by page. Compare it with your original before you send it."
                />
                <div className="mt-4">
                  <ResumePreview
                    tailoringId={tailoringId}
                    onStatus={setPreviewStage}
                    onDownload={download}
                    pageLimit={pageLimit}
                  />
                </div>
              </Card>
            )}
          </div>

          {data.summary && (
            <div className="grid gap-4 sm:grid-cols-4">
              <Stat label="Requirements analyzed" value={data.summary.analyzed} icon={ListChecks} />
              <Stat label="Supported by your experience" value={data.summary.supported} icon={CheckCircle2} />
              <Stat label="Partially supported" value={data.summary.partial} icon={CircleDashed} />
              <Stat label="No supporting evidence" value={data.summary.unsupported} icon={CircleHelp} />
            </div>
          )}

          {data.warnings.length > 0 && (
            <Alert tone="warning" title="Review before downloading">
              <ul className="list-disc space-y-0.5 pl-4">
                {data.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
              {leftOut.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-caption">
                  {leftOut.map((issue, i) => (
                    <li key={i}>{issue.message}</li>
                  ))}
                </ul>
              )}
            </Alert>
          )}

          <Card>
            <CardHeader title="Changes" description="Everything Ansly changed in your document, by section. Every rewrite cites your own experience." />
            {sections.length === 0 && <p className="mt-4 text-muted">No changes were needed: your resume already fits this job.</p>}
            <div className="mt-4 divide-y divide-border">
              {sections.map((section) => {
                const diffs = detail?.diffs.filter((d) => d.section === section) ?? []
                const open = openDiffs.has(section)
                return (
                  <div key={section} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-start gap-x-6 gap-y-1">
                      <Overline className="w-28 shrink-0 pt-0.5">{SECTION_TITLES[section]}</Overline>
                      <ul className="min-w-0 flex-1 space-y-1">
                        {data.changes
                          .filter((c) => c.section === section)
                          .map((c) => (
                            <li key={c.label} className="flex items-center gap-2">
                              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
                              {c.label}
                            </li>
                          ))}
                      </ul>
                      {diffs.length > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-expanded={open}
                          onClick={() =>
                            setOpenDiffs((s) => {
                              const next = new Set(s)
                              if (open) next.delete(section)
                              else next.add(section)
                              return next
                            })
                          }
                        >
                          {open ? 'Hide diff' : 'Show diff'}
                        </Button>
                      )}
                    </div>
                    {open && (
                      <div className="mt-3 space-y-2">
                        {diffs.map((d, i) => (
                          <Diff key={i} diff={d} />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </Card>

          {data.unsupportedRequirements.length > 0 && (
            <Card>
              <CardHeader
                title="Unsupported requirements"
                description="Your profile and resume have no evidence for these. Required skills among them were added to your skills list for you to check; nothing else claims them. If you have this experience, add it to your profile and tailor again."
                actions={
                  <Link href="/profile/skills?new=1" className={buttonStyles({ variant: 'secondary', size: 'sm' })}>
                    Add to profile
                  </Link>
                }
              />
              <div className="mt-4 flex flex-wrap gap-2">
                {data.unsupportedRequirements.map((r) => (
                  <Badge key={r}>{r}</Badge>
                ))}
              </div>
            </Card>
          )}

          {flagged.length > 0 && (
            <Card>
              <CardHeader icon={TriangleAlert} title="Check these sentences" description="The final review couldn’t confirm these claims from your evidence. Edit or remove them if they’re not accurate." />
              <div className="mt-4 space-y-2">
                {flagged.map((issue, i) => (
                  <div key={i} className="rounded-lg border border-warning/30 bg-warning/5 p-3">
                    <p className="font-medium">{issue.message}</p>
                    {issue.attempted && <p className="mt-1 text-muted">{issue.attempted}</p>}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {detail && detail.requirements.length > 0 && (
            <Card>
              <CardHeader title="Requirements" description={`${plural(detail.requirements.length, 'requirement')} from the job, checked against your evidence.`} />
              <ul className="mt-4 divide-y divide-border">
                {detail.requirements.map((r) => (
                  <li key={r.requirementId} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="min-w-0 flex-1">{r.requirement}</span>
                    {r.priority === 'nice_to_have' && <Badge>Nice to have</Badge>}
                    <Badge tone={r.support === 'strong' ? 'success' : r.support === 'partial' ? 'warning' : 'neutral'} dot>
                      {r.support === 'strong' ? 'Supported' : r.support === 'partial' ? 'Partial' : 'No evidence'}
                    </Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-caption text-subtle">Pipeline {data.pipelineVersion}</p>
            <div className="flex gap-2">
              <Button variant="secondary" icon={Download} onClick={download} loading={busy === 'download'}>
                Download DOCX
              </Button>
              <Button variant="secondary" icon={FileDown} onClick={savePdf} loading={busy === 'pdf'}>
                Download PDF
              </Button>
              <Button variant="ghost" icon={Trash2} onClick={remove}>
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
