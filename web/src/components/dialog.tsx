'use client'

import { clsx } from 'clsx'
import { TriangleAlert, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, IconTile } from '@/components/ui'

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

export function Dialog({
  open,
  onClose,
  children,
  className,
  labelledBy,
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  className?: string
  labelledBy?: string
}) {
  const ref = useModal(open)
  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[calc(100%-2rem)] max-w-md bg-transparent open:animate-dialog-in"
    >
      {open && (
        <div className={clsx('rounded-2xl border border-border bg-surface p-6 shadow-raised', className)}>{children}</div>
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
        side === 'right' ? 'left-auto right-0 max-w-xl open:animate-sheet-in' : 'left-0 right-auto max-w-[300px] open:animate-sheet-in-left',
        className,
      )}
    >
      {open && (
        <div
          className={clsx(
            'flex h-full flex-col bg-surface shadow-raised',
            side === 'right' ? 'border-l border-border' : 'border-r border-border',
          )}
        >
          {title && (
            <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
                {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
              </div>
              <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close" className="-mr-2 -mt-1">
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
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
              <h2 id="confirm-title" className="text-base font-semibold tracking-tight">
                {options.title}
              </h2>
              {options.description && <div className="mt-1.5 text-sm leading-relaxed text-muted">{options.description}</div>}
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
