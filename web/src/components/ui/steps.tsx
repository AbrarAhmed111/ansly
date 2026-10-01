import { clsx } from 'clsx'
import { Check } from 'lucide-react'
import type { ReactNode } from 'react'

export type StepState = 'done' | 'active' | 'idle'

/** Round marker showing a step's number, or a check once done. */
export function StepMarker({ state, children, size = 'md' }: { state: StepState; children?: ReactNode; size?: 'sm' | 'md' }) {
  return (
    <span
      className={clsx(
        'relative z-10 flex shrink-0 items-center justify-center rounded-full border font-semibold',
        size === 'sm' ? 'h-5 w-5 text-caption' : 'h-8 w-8 text-body',
        state === 'done' && 'border-success bg-success text-accent-fg',
        state === 'active' && 'border-accent bg-accent-soft text-accent ring-4 ring-accent/10',
        state === 'idle' && (size === 'sm' ? 'border-border-strong' : 'border-border bg-surface text-subtle'),
      )}
    >
      {state === 'done' ? <Check className={size === 'sm' ? 'h-3 w-3' : 'h-4 w-4'} strokeWidth={3} /> : children}
    </span>
  )
}

/** Vertical numbered steps connected by a line. */
export function Steps({ children, className }: { children: ReactNode; className?: string }) {
  return <ol className={className}>{children}</ol>
}

export function Step({ n, title, state, children }: { n: number; title: string; state: StepState; children: ReactNode }) {
  return (
    <li className="relative flex gap-4 pb-8 last:pb-0">
      <span className="absolute left-[15px] top-9 h-[calc(100%-2.5rem)] w-px bg-border [li:last-child>&]:hidden" aria-hidden />
      <StepMarker state={state}>{n}</StepMarker>
      <div className="min-w-0 flex-1 pt-1">
        <p className={clsx('text-title', state === 'idle' && 'text-muted')}>{title}</p>
        <div className="mt-1 leading-relaxed text-muted">{children}</div>
      </div>
    </li>
  )
}
