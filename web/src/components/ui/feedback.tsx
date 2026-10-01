import { clsx } from 'clsx'
import { AlertCircle, CheckCircle2, Info, TriangleAlert, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { IconTile } from './layout'
import { TONE_FILL, TONE_SURFACE, type Tone } from './tone'

export function Badge({ children, tone = 'neutral', dot, className }: { children: ReactNode; tone?: Tone; dot?: boolean; className?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-caption font-medium',
        TONE_SURFACE[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  )
}

/** Coloured status dot; `pulse` adds a ping ring for live "operational" states. */
export function StatusDot({ tone, pulse, className }: { tone: Tone; pulse?: boolean; className?: string }) {
  return (
    <span className={clsx('relative flex h-2 w-2 shrink-0', className)} aria-hidden>
      {pulse && <span className={clsx('absolute inline-flex h-full w-full animate-ping rounded-full opacity-60', TONE_FILL[tone])} />}
      <span className={clsx('relative inline-flex h-2 w-2 rounded-full', TONE_FILL[tone])} />
    </span>
  )
}

type AlertTone = 'accent' | 'success' | 'warning' | 'danger'
const ALERT_ICONS: Record<AlertTone, LucideIcon> = { danger: AlertCircle, warning: TriangleAlert, success: CheckCircle2, accent: Info }

export function Alert({ children, tone = 'accent', title, className }: { children?: ReactNode; tone?: AlertTone; title?: ReactNode; className?: string }) {
  const Icon = ALERT_ICONS[tone]
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={clsx('flex gap-2.5 rounded-lg border px-3.5 py-3', TONE_SURFACE[tone], className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 space-y-1 leading-relaxed">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={title ? 'text-fg/80' : ''}>{children}</div>}
      </div>
    </div>
  )
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null
  return <Alert tone="danger">{children}</Alert>
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-md bg-surface-muted', className)} aria-hidden />
}

/** Stack of skeleton lines, for text that is still loading. */
export function SkeletonText({ lines = 4 }: { lines?: number }) {
  const widths = ['w-full', 'w-11/12', 'w-4/5', 'w-2/3', 'w-3/4']
  return (
    <div className="space-y-3">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={clsx('h-4', widths[i % widths.length])} />
      ))}
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={clsx('flex flex-col items-center rounded-xl border border-dashed border-border-strong bg-surface/50 px-6 py-14 text-center', className)}>
      <div className="relative">
        <div className="absolute inset-0 -z-10 scale-150 rounded-full bg-accent/10 blur-xl" aria-hidden />
        <IconTile icon={icon} tone="accent" size="lg" />
      </div>
      <h3 className="mt-4 text-title">{title}</h3>
      {description && <p className="mt-1 max-w-sm leading-relaxed text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-surface-muted px-1 font-sans text-overline font-medium normal-case tracking-normal text-muted">
      {children}
    </kbd>
  )
}

/** A keyboard shortcut hint: keys followed by what they do. Hidden on small screens. */
export function KeyHint({ keys, children }: { keys: ReactNode[]; children?: ReactNode }) {
  return (
    <span className="hidden items-center gap-1 text-caption text-subtle sm:flex">
      {keys.map((k, i) => (
        <Kbd key={i}>{k}</Kbd>
      ))}
      {children && <span className="ml-0.5">{children}</span>}
    </span>
  )
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials =
    name
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join('') || '?'
  return (
    <span
      className={clsx(
        'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-brand text-body-sm font-semibold text-accent-fg',
        className,
      )}
      aria-hidden
    >
      {initials}
    </span>
  )
}

/** Circular progress indicator, 0–100. */
export function ProgressRing({ value, size = 120, stroke = 10, children }: { value: number; size?: number; stroke?: number; children?: ReactNode }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const tone = value >= 80 ? 'rgb(var(--success))' : value >= 50 ? 'rgb(var(--accent))' : 'rgb(var(--warning))'
  return (
    <div
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--surface-muted))" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={tone}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - value / 100)}
          className="transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  )
}
