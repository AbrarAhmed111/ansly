import { clsx } from 'clsx'
import type { LucideIcon } from 'lucide-react'
import type { ElementType, ReactNode } from 'react'
import { TONE_SURFACE, type Tone } from './tone'

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('rounded-xl border border-border bg-surface p-5 shadow-card', className)}>{children}</div>
}

export function CardHeader({
  title,
  description,
  icon: Icon,
  actions,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  icon?: LucideIcon
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={clsx('flex flex-wrap items-start justify-between gap-4', className)}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {Icon && <IconTile icon={Icon} />}
        <div className="min-w-0">
          <h2 className="text-title">{title}</h2>
          {description && <p className="mt-0.5 leading-relaxed text-muted">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

export function IconTile({ icon: Icon, tone = 'neutral', size = 'md' }: { icon: LucideIcon; tone?: Tone; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = {
    sm: 'h-7 w-7 rounded-md [&>svg]:h-3.5 [&>svg]:w-3.5',
    md: 'h-9 w-9 rounded-lg [&>svg]:h-[18px] [&>svg]:w-[18px]',
    lg: 'h-12 w-12 rounded-xl [&>svg]:h-6 [&>svg]:w-6',
  }
  return (
    <span className={clsx('inline-flex shrink-0 items-center justify-center border', TONE_SURFACE[tone], sizes[size])}>
      <Icon aria-hidden />
    </span>
  )
}

/** Small uppercase label above a group: nav sections, list groups, "Grounded in". */
export function Overline({
  children,
  as: Tag = 'p',
  tone = 'subtle',
  className,
}: {
  children: ReactNode
  as?: ElementType
  tone?: 'subtle' | 'muted' | 'accent'
  className?: string
}) {
  const tones = { subtle: 'text-subtle', muted: 'text-muted', accent: 'text-accent' }
  return <Tag className={clsx('text-overline uppercase', tones[tone], className)}>{children}</Tag>
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  eyebrow?: ReactNode
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && (
          <Overline tone="accent" className="mb-1.5">
            {eyebrow}
          </Overline>
        )}
        <h1 className="text-h2">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-body-lg text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

/** Numeric metric tile. */
export function Stat({ label, value, icon, hint }: { label: string; value: number; icon: LucideIcon; hint?: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <p className="text-body-sm font-medium text-muted">{label}</p>
        <IconTile icon={icon} size="sm" />
      </div>
      <p className="mt-3 text-h1 tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-caption text-subtle">{hint}</p>}
    </Card>
  )
}
