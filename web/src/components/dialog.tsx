'use client'

import { clsx } from 'clsx'
import { TriangleAlert, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, IconButton, IconTile } from '@/components/ui'

/**
 * Native modal <dialog>: focus trapping, Escape and top-layer stacking come
 * from the browser. `onClose` fires for Escape and backdrop clicks; the
 * parent decides whether to actually close by flipping `open`.
 */
function useModal(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])
  return ref
}

/** How long a closing dialog stays on screen; matches the `dialog` exit transition in globals.css. */
const EXIT_MS = 200

/**
 * Keeps a closing dialog's content on screen while it fades out: `open` stays true for EXIT_MS after it
 * turns false, and the children shown are the last ones rendered while open (a parent often clears them
 * in the same update that closes the dialog).
 */
export function useLingering<T>(open: boolean, children: T): { present: boolean; shown: T } {
  const [lingering, setLingering] = useState(false)
  const last = useRef(children)
  useEffect(() => {
    if (open) last.current = children
  }, [open, children])
  useEffect(() => {
    if (open) {
      setLingering(true)
      return
    }
    const id = window.setTimeout(() => setLingering(false), EXIT_MS)
    return () => window.clearTimeout(id)
  }, [open])
  return { present: open || lingering, shown: open ? children : last.current }
}

export function Dialog({
  open,
  onClose,
  children,
  className,
  labelledBy,
  wide = false,
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  className?: string
  labelledBy?: string
  wide?: boolean
}) {
  const ref = useModal(open)
  const { present, shown } = useLingering(open, children)
  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => e.target === ref.current && onClose()}
      className={clsx(
        'm-auto max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] overflow-y-auto overscroll-contain bg-transparent open:animate-dialog-in [&:not([open])]:translate-y-1 [&:not([open])]:scale-[0.98] sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100%-2rem)]',
        wide ? 'max-w-2xl' : 'max-w-md',
      )}
    >
      {present && (
        <div className={clsx('rounded-2xl border border-border bg-surface p-4 shadow-raised sm:p-6', className)}>{shown}</div>
      )}
    </dialog>
  )
}

export function Sheet({
  open,
  onClose,
  title,
  description,
  footer,
  children,
  side = 'right',
  className,
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  description?: ReactNode
  footer?: ReactNode
  children: ReactNode
  side?: 'right' | 'left'
  className?: string
}) {
  const ref = useModal(open)
  const { present, shown } = useLingering(open, children)
  return (
    <dialog
      ref={ref}
      aria-label={typeof title === 'string' ? title : undefined}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => e.target === ref.current && onClose()}
      className={clsx(
        'fixed inset-y-0 m-0 h-dvh max-h-none w-full',
        side === 'right'
          ? 'left-auto right-0 max-w-xl open:animate-sheet-in [&:not([open])]:translate-x-full'
          : 'left-0 right-auto max-w-[300px] open:animate-sheet-in-left [&:not([open])]:-translate-x-full',
        className,
      )}
    >
      {present && (
        <div
          className={clsx(
            'flex h-full flex-col bg-surface shadow-raised',
            side === 'right' ? 'border-l border-border' : 'border-r border-border',
          )}
        >
          {title && (
            <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
              <div className="min-w-0">
                <h2 className="text-h3">{title}</h2>
                {description && <p className="mt-0.5 text-muted">{description}</p>}
              </div>
              <IconButton icon={X} label="Close" onClick={onClose} className="-mr-2 -mt-1" />
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">{shown}</div>
          {footer && <div className="border-t border-border bg-surface px-6 py-4">{footer}</div>}
        </div>
      )}
    </dialog>
  )
}

export interface ConfirmOptions {
  title: string
  description?: ReactNode
  confirmLabel?: string
  tone?: 'danger' | 'neutral'
}

/** Promise-based confirm dialog: `if (await confirm({...})) …`. Render the returned element once. */
export function useConfirm() {
  const [state, setState] = useState<{ options: ConfirmOptions; resolve: (ok: boolean) => void } | null>(null)
  const [last, setLast] = useState<ConfirmOptions | null>(null)

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setLast(options)
        setState({ options, resolve })
      }),
    [],
  )

  const settle = (ok: boolean) => {
    state?.resolve(ok)
    setState(null)
  }

  const options = state?.options ?? last
  const danger = options?.tone !== 'neutral'
  const element = (
    <Dialog open={Boolean(state)} onClose={() => settle(false)} labelledBy="confirm-title">
      {options && (
        <>
          <div className="flex gap-4">
            {danger && <IconTile icon={TriangleAlert} tone="danger" />}
            <div className="min-w-0 pt-0.5">
              <h2 id="confirm-title" className="text-title">
                {options.title}
              </h2>
              {options.description && <div className="mt-1.5 leading-relaxed text-muted">{options.description}</div>}
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => settle(false)}>
              Cancel
            </Button>
            <Button variant={danger ? 'danger' : 'primary'} onClick={() => settle(true)} autoFocus>
              {options.confirmLabel ?? 'Confirm'}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  )

  return [confirm, element] as const
}
