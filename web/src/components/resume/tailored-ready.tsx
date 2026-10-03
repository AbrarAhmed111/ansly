'use client'

import { clsx } from 'clsx'
import { CheckCircle2, Download, Eye, EyeOff, TriangleAlert } from 'lucide-react'
import { Button, Card, Spinner, StepMarker } from '@/components/ui'
import { plural } from '@/lib/format'

/** Where the preview is: still downloading/rendering, ready, or unavailable. */
export type PreviewStage = 'loading' | 'ready' | 'error'

function Stage({ state, children }: { state: 'done' | 'active' | 'idle' | 'warning'; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2.5">
      {state === 'warning' ? (
        <TriangleAlert className="h-4 w-4 text-warning" aria-hidden />
      ) : (
        <StepMarker size="sm" state={state} />
      )}
      <span className={clsx(state === 'idle' ? 'text-muted' : 'font-medium')}>{children}</span>
      {state === 'active' && <Spinner className="h-3.5 w-3.5" />}
    </li>
  )
}

export function TailoredReadyCard({
  preview,
  previewOpen,
  leftOut,
  downloading,
  onPreview,
  onDownload,
}: {
  preview: PreviewStage
  previewOpen: boolean
  /** Changes left out to protect the document's formatting. */
  leftOut: number
  downloading: boolean
  onPreview: () => void
  onDownload: () => void
}) {
  return (
    <Card className="relative overflow-hidden">
      <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-success/10 blur-3xl" aria-hidden />
      <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="h-6 w-6 shrink-0 text-success" aria-hidden />
            <h2 className="text-title">Your tailored resume is ready</h2>
          </div>
          <p className="mt-2 max-w-xl text-muted">
            Your original formatting has been preserved: it’s your own Word document with only the tailored text changed.
            {leftOut > 0 && ` ${plural(leftOut, 'change was', 'changes were')} left out to protect your layout.`}
          </p>
          <ol className="mt-4 grid gap-2 sm:grid-cols-2" aria-label="Progress">
            <Stage state="done">Resume tailored</Stage>
            <Stage state="done">Formatting preserved</Stage>
            <Stage state={preview === 'ready' ? 'done' : preview === 'error' ? 'warning' : 'active'}>
              {preview === 'error' ? 'Preview unavailable' : preview === 'ready' ? 'Preview ready' : 'Preparing preview'}
            </Stage>
            <Stage state={preview === 'loading' ? 'idle' : 'done'}>Ready to download</Stage>
          </ol>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row md:flex-col">
          <Button size="lg" icon={previewOpen ? EyeOff : Eye} onClick={onPreview}>
            {previewOpen ? 'Hide preview' : 'Preview Resume'}
          </Button>
          <Button size="lg" variant="secondary" icon={Download} onClick={onDownload} loading={downloading}>
            Download DOCX
          </Button>
        </div>
      </div>
    </Card>
  )
}
