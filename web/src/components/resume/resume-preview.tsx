'use client'

import { clsx } from 'clsx'
import { Columns2, Download, FileText, Maximize2, Minus, Plus, RotateCcw, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, IconButton, Skeleton, Spinner } from '@/components/ui'
import { invalidate } from '@/lib/cache'
import { type PreviewDocuments, pageWidth, previewDocuments, renderDocx } from '@/lib/docx-preview'
import { errorMessage, plural } from '@/lib/format'

export type PreviewStatus = 'loading' | 'ready' | 'error'
type View = 'tailored' | 'original' | 'compare'
type Side = 'original' | 'tailored'

const ZOOM_MIN = 0.4
const ZOOM_MAX = 2
const ZOOM_STEP = 0.1
// Space around the page inside the scroll area (padding + scrollbar), in px.
const GUTTER = 40

export const PREVIEW_ERROR =
  'We couldn’t generate the preview right now, but your tailored Word document is available to download.'

/** Page-shaped placeholder while the document loads. */
export function PageSkeleton({ pages = 1 }: { pages?: number }) {
  return (
    <div className="flex flex-col items-center gap-8 py-6" data-testid="page-skeleton">
      {Array.from({ length: pages }, (_, n) => (
        <div
          key={n}
          className="aspect-[8.5/11] w-full max-w-[640px] rounded-sm bg-white p-[7%] shadow-lg shadow-black/10 ring-1 ring-black/5"
        >
          <Skeleton className="mx-auto h-5 w-2/5 bg-neutral-200" />
          <Skeleton className="mx-auto mt-3 h-2.5 w-3/5 bg-neutral-200" />
          {[0, 1, 2].map((block) => (
            <div key={block} className="mt-8 space-y-2.5">
              <Skeleton className="h-3 w-1/4 bg-neutral-200" />
              <Skeleton className="h-2.5 w-full bg-neutral-100" />
              <Skeleton className="h-2.5 w-11/12 bg-neutral-100" />
              <Skeleton className="h-2.5 w-4/5 bg-neutral-100" />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function DocumentPane({
  data,
  side,
  zoom,
  onRendered,
  onFailed,
}: {
  data: ArrayBuffer
  side: Side
  zoom: number
  onRendered: (side: Side, pages: number, width: number) => void
  onFailed: (side: Side, error: unknown) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'rendering' | 'ready' | 'error'>('rendering')
  const latest = useRef({ zoom, onRendered, onFailed })
  latest.current = { zoom, onRendered, onFailed }

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let cancelled = false
    setStatus('rendering')
    // Pages are measured at 100%; the zoom is applied after.
    el.style.zoom = '1'
    renderDocx(data, el, `docx-${side}`).then(
      (pages) => {
        if (cancelled) return
        const width = pageWidth(el)
        el.style.zoom = String(latest.current.zoom)
        setStatus('ready')
        latest.current.onRendered(side, pages, width)
      },
      (error) => {
        if (cancelled) return
        setStatus('error')
        latest.current.onFailed(side, error)
      },
    )
    return () => {
      cancelled = true
    }
  }, [data, side])

  useEffect(() => {
    if (status === 'ready' && ref.current) ref.current.style.zoom = String(zoom)
  }, [zoom, status])

  return (
    <div className="relative">
      {status === 'rendering' && <PageSkeleton />}
      <div
        ref={ref}
        data-testid={`pages-${side}`}
        className={clsx('ansly-doc', status !== 'ready' && 'pointer-events-none invisible absolute inset-x-0 top-0')}
      />
    </div>
  )
}

const PREVIEW_CSS = `
.ansly-preview .ansly-doc > div[class$='-wrapper'] { background: transparent !important; padding: 24px 12px 8px !important; }
.ansly-preview .ansly-doc section[data-page] {
  margin-bottom: 0 !important; box-shadow: 0 8px 28px rgba(15, 23, 42, .14), 0 0 0 1px rgba(15, 23, 42, .06) !important;
  border-radius: 2px;
}
.ansly-preview .ansly-page-label {
  margin: 10px 0 26px; font: 500 12px/1 ui-sans-serif, system-ui, sans-serif; letter-spacing: .02em;
  color: rgb(var(--subtle)); text-align: center;
}
`

export function ResumePreview({
  tailoringId,
  onStatus,
  onDownload,
  pageLimit,
}: {
  tailoringId: string
  /** The user's page limit (Settings): over it, the preview says so. */
  pageLimit?: number | null
  /** loading -> ready (or error), for the result card's progress stages. */
  onStatus?: (status: PreviewStatus) => void
  onDownload?: () => void
}) {
  const [docs, setDocs] = useState<PreviewDocuments | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [failed, setFailed] = useState<Partial<Record<Side, boolean>>>({})
  const [pages, setPages] = useState<Partial<Record<Side, number>>>({})
  const [view, setView] = useState<View>('tailored')
  const [zoom, setZoom] = useState(1)
  const [fit, setFit] = useState(true)
  const [width, setWidth] = useState(816)
  const scroller = useRef<HTMLDivElement>(null)
  const statusRef = useRef(onStatus)
  statusRef.current = onStatus

  const fetchDocs = useCallback(() => {
    setLoadError(null)
    setDocs(null)
    setFailed({})
    setPages({})
    previewDocuments(tailoringId).then(setDocs, (e) => setLoadError(errorMessage(e)))
  }, [tailoringId])

  useEffect(fetchDocs, [fetchDocs])

  const retry = () => {
    invalidate(`preview:${tailoringId}`)
    fetchDocs()
  }

  const tailoredFailed = Boolean(failed.tailored) || Boolean(loadError)
  const status: PreviewStatus = tailoredFailed ? 'error' : pages.tailored ? 'ready' : 'loading'
  useEffect(() => statusRef.current?.(status), [status])

  const onRendered = useCallback((side: Side, count: number, pageW: number) => {
    setPages((p) => ({ ...p, [side]: count }))
    if (side === 'tailored') setWidth(pageW)
  }, [])
  const onFailed = useCallback((side: Side) => setFailed((f) => ({ ...f, [side]: true })), [])

  // Fit to width until the user zooms: the page is never wider than the screen.
  const columns = view === 'compare' ? 2 : 1
  useEffect(() => {
    const el = scroller.current
    if (!el || !fit) return
    const apply = () => {
      if (!el.clientWidth) return // not laid out yet
      const available = (el.clientWidth - GUTTER * columns) / columns
      setZoom(Math.max(ZOOM_MIN, Math.min(1, Math.round((available / width) * 100) / 100)))
    }
    apply()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(apply)
    observer?.observe(el)
    return () => observer?.disconnect()
  }, [fit, width, columns, docs])

  const zoomBy = (delta: number) => {
    setFit(false)
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((z + delta) * 10) / 10)))
  }

  const layoutChange = useMemo(() => {
    if (!pages.original || !pages.tailored || pages.original === pages.tailored) return null
    const grew = pages.tailored > pages.original
    return `Your tailored content caused the resume to ${grew ? 'expand' : 'shrink'} from ${plural(pages.original, 'page')} to ${plural(pages.tailored, 'page')}.`
  }, [pages])

  const hasOriginal = Boolean(docs?.original) && !failed.original
  const shown = (side: Side) => view === 'compare' || view === side

  if (loadError || failed.tailored) {
    return (
      <div className="space-y-3" role="alert">
        <Alert tone="warning" title="Preview unavailable">
          {PREVIEW_ERROR}
        </Alert>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" icon={RotateCcw} onClick={retry}>
            Try again
          </Button>
          {onDownload && (
            <Button size="sm" icon={Download} onClick={onDownload}>
              Download DOCX
            </Button>
          )}
        </div>
      </div>
    )
  }

  if (docs?.format === 'pdf') {
    return <LegacyPdf data={docs.tailored} />
  }

  return (
    <div className="ansly-preview">
      <style>{PREVIEW_CSS}</style>
      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
        <div role="tablist" aria-label="Which resume" className="inline-flex rounded-lg border border-border bg-surface-muted/60 p-0.5">
          {(
            [
              ['original', 'Original', FileText],
              ['tailored', 'Tailored', FileText],
              ['compare', 'Side by side', Columns2],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              role="tab"
              type="button"
              aria-selected={view === value}
              disabled={value !== 'tailored' && !hasOriginal}
              onClick={() => setView(value)}
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-body-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40',
                value === 'compare' && 'hidden lg:inline-flex',
                view === value ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg',
              )}
            >
              {value === 'compare' && <Icon className="h-3.5 w-3.5" />}
              {label}
            </button>
          ))}
        </div>
        <span className="text-caption text-subtle" aria-live="polite">
          {status === 'loading' ? (
            <span className="inline-flex items-center gap-1.5">
              <Spinner className="h-3 w-3" /> Preparing your resume preview…
            </span>
          ) : view === 'original' && pages.original ? (
            plural(pages.original, 'page')
          ) : pages.tailored ? (
            plural(pages.tailored, 'page')
          ) : null}
        </span>
        <div className="ml-auto flex items-center gap-1" aria-label="Zoom">
          <IconButton icon={Minus} label="Zoom out" onClick={() => zoomBy(-ZOOM_STEP)} disabled={zoom <= ZOOM_MIN} />
          <span className="w-12 text-center text-caption tabular-nums" data-testid="zoom-level">
            {Math.round(zoom * 100)}%
          </span>
          <IconButton icon={Plus} label="Zoom in" onClick={() => zoomBy(ZOOM_STEP)} disabled={zoom >= ZOOM_MAX} />
          <IconButton icon={Maximize2} label="Fit to width" onClick={() => setFit(true)} />
        </div>
      </div>

      {!docs?.original && docs && (
        <p className="mt-3 text-caption text-subtle">
          The original version this was tailored from was deleted, so only the tailored resume can be shown.
        </p>
      )}
      {pageLimit && pages.tailored && pages.tailored > pageLimit && (
        <Alert tone="warning" className="mt-3" title="Over your page limit">
          The tailored resume is {plural(pages.tailored, 'page')}; your limit is {plural(pageLimit, 'page')}. You can still
          download it, or change the limit in Settings.
        </Alert>
      )}
      {layoutChange && (
        <Alert tone="warning" className="mt-3" title="Layout changed">
          {layoutChange} Check the page breaks before you download; you can still download it as it is.
        </Alert>
      )}

      <div
        ref={scroller}
        className="relative mt-3 max-h-[85vh] overflow-auto rounded-xl bg-surface-muted/70 ring-1 ring-inset ring-border"
      >
        {!docs && <PageSkeleton />}
        {docs && (
          <div className={clsx('grid', view === 'compare' ? 'lg:grid-cols-2' : 'grid-cols-1')}>
            {(['original', 'tailored'] as const).map((side) => {
              const data = side === 'original' ? docs.original : docs.tailored
              if (!data) return null
              return (
                <div
                  key={side}
                  aria-hidden={!shown(side)}
                  data-testid={`pane-${side}`}
                  className={clsx(
                    'min-w-0',
                    !shown(side) && 'pointer-events-none absolute inset-x-0 top-0 h-0 overflow-hidden opacity-0',
                  )}
                >
                  {view === 'compare' && (
                    <p className="sticky top-0 z-10 bg-surface-muted/90 py-2 text-center text-caption font-medium text-muted backdrop-blur">
                      {side === 'original' ? 'Original' : 'Tailored'}
                    </p>
                  )}
                  {side === 'original' && failed.original ? (
                    <p className="flex items-center justify-center gap-2 p-10 text-muted">
                      <TriangleAlert className="h-4 w-4" /> The original couldn’t be shown.
                    </p>
                  ) : (
                    <DocumentPane data={data} side={side} zoom={zoom} onRendered={onRendered} onFailed={onFailed} />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/** Tailorings made before Ansly kept the Word document were PDFs. */
function LegacyPdf({ data }: { data: ArrayBuffer }) {
  const url = useMemo(() => URL.createObjectURL(new Blob([data], { type: 'application/pdf' })), [data])
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  return (
    <div className="space-y-3">
      <p className="text-caption text-subtle">This resume was tailored by an earlier version of Ansly, as a PDF.</p>
      <iframe src={url} title="Tailored resume" className="h-[80vh] w-full rounded-xl ring-1 ring-border" />
    </div>
  )
}
