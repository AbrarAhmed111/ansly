import { clsx } from 'clsx'
import { AlertCircle, CheckCircle2, Info, Loader2, TriangleAlert, type LucideIcon } from 'lucide-react'
import type {
  ButtonHTMLAttributes,
  ComponentProps,
  ReactNode,
  SelectHTMLAttributes,
} from 'react'

/* Buttons ------------------------------------------------------------------- */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-soft'
type Size = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm'

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent text-accent-fg shadow-xs hover:bg-accent/90 active:bg-accent/95 [background-image:linear-gradient(to_bottom,rgb(255_255_255/0.12),transparent)]',
  secondary: 'border border-border bg-surface text-fg shadow-xs hover:border-border-strong hover:bg-surface-muted',
  ghost: 'text-muted hover:bg-surface-muted hover:text-fg',
  danger: 'bg-danger text-white shadow-xs hover:bg-danger/90',
  'danger-soft': 'text-danger hover:bg-danger/10',
}

const SIZES: Record<Size, string> = {
  sm: 'h-8 gap-1.5 rounded-lg px-2.5 text-[13px]',
  md: 'h-9 gap-2 rounded-lg px-3.5 text-sm',
  lg: 'h-11 gap-2 rounded-xl px-5 text-[15px]',
  icon: 'h-9 w-9 rounded-lg',
  'icon-sm': 'h-8 w-8 rounded-lg',
}

/** Class names for a button, for use on links styled as buttons. */
export function buttonStyles({
  variant = 'primary',
  size = 'md',
  className,
}: { variant?: Variant; size?: Size; className?: string } = {}) {
  return clsx(
    'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium transition-[background-color,border-color,color,box-shadow,opacity] duration-150',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
    'disabled:pointer-events-none disabled:opacity-50',
    VARIANTS[variant],
    SIZES[size],
    className,
  )
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }) {
  return (
    <button className={buttonStyles({ variant, size, className })} disabled={disabled || loading} {...props}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('h-4 w-4 animate-spin text-muted', className)} aria-label="Loading" />
}

/* Form controls ------------------------------------------------------------- */

const control = clsx(
  'w-full rounded-lg border border-border bg-surface px-3 text-sm text-fg shadow-xs transition-[border-color,box-shadow]',
  'placeholder:text-subtle hover:border-border-strong',
  'focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15',
  'disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted',
)

export function Input({
  className,
  icon: Icon,
  ...props
}: ComponentProps<'input'> & { icon?: LucideIcon }) {
  if (!Icon) return <input className={clsx(control, 'h-9', className)} {...props} />
  return (
    <div className={clsx('relative', className)}>
      <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
      <input className={clsx(control, 'h-9 pl-9')} {...props} />
    </div>
  )
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={clsx(control, 'min-h-[96px] resize-y py-2 leading-relaxed', className)} {...props} />
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={clsx(
        control,
        'h-9 cursor-pointer appearance-none bg-[length:16px] bg-[right_0.6rem_center] bg-no-repeat pr-9',
        "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m7 15 5 5 5-5'/%3E%3Cpath d='m7 9 5-5 5 5'/%3E%3C/svg%3E\")]",
        className,
      )}
      {...props}
    />
  )
}

export function Field({
  label,
  htmlFor,
  help,
  required,
  hint,
  children,
  className,
}: {
  label: string
  htmlFor?: string
  help?: ReactNode
  required?: boolean
  /** Shown at the right of the label, e.g. a character count. */
  hint?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={clsx('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="block text-[13px] font-medium text-fg">
          {label}
          {required && <span className="ml-0.5 text-danger">*</span>}
        </label>
        {hint && <span className="text-xs tabular-nums text-subtle">{hint}</span>}
      </div>
      {children}
      {help && <p className="text-xs leading-relaxed text-muted">{help}</p>}
    </div>
  )
}

export function Switch({
  checked,
  onChange,
  id,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  id?: string
  label?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-accent' : 'bg-border-strong',
      )}
    >
      <span
        className={clsx(
          'inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}

/* Layout -------------------------------------------------------------------- */

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
    <div className={clsx('flex items-start justify-between gap-4', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {Icon && <IconTile icon={Icon} />}
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
          {description && <p className="mt-0.5 text-sm leading-relaxed text-muted">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

export function IconTile({
  icon: Icon,
  tone = 'neutral',
  size = 'md',
}: {
  icon: LucideIcon
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'
  size?: 'sm' | 'md' | 'lg'
}) {
  const tones = {
    neutral: 'border-border bg-surface-muted text-muted',
    accent: 'border-accent/20 bg-accent-soft text-accent',
    success: 'border-success/20 bg-success/10 text-success',
    warning: 'border-warning/20 bg-warning/10 text-warning',
    danger: 'border-danger/20 bg-danger/10 text-danger',
  }
  const sizes = { sm: 'h-7 w-7 rounded-md [&>svg]:h-3.5 [&>svg]:w-3.5', md: 'h-9 w-9 rounded-lg [&>svg]:h-[18px] [&>svg]:w-[18px]', lg: 'h-12 w-12 rounded-xl [&>svg]:h-6 [&>svg]:w-6' }
  return (
    <span className={clsx('inline-flex shrink-0 items-center justify-center border', tones[tone], sizes[size])}>
      <Icon aria-hidden />
    </span>
  )
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
        {eyebrow && <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-accent">{eyebrow}</p>}
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-[15px] leading-relaxed text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

/* Feedback ------------------------------------------------------------------ */

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

export function Badge({
  children,
  tone = 'neutral',
  dot,
  className,
}: {
  children: ReactNode
  tone?: Tone
  dot?: boolean
  className?: string
}) {
  const tones: Record<Tone, string> = {
    neutral: 'border-border bg-surface-muted text-muted',
    accent: 'border-accent/20 bg-accent-soft text-accent',
    success: 'border-success/20 bg-success/10 text-success',
    warning: 'border-warning/25 bg-warning/10 text-warning',
    danger: 'border-danger/20 bg-danger/10 text-danger',
  }
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  )
}

const ALERT_ICONS = { danger: AlertCircle, warning: TriangleAlert, success: CheckCircle2, accent: Info }

export function Alert({
  children,
  tone = 'accent',
  title,
  className,
}: {
  children?: ReactNode
  tone?: keyof typeof ALERT_ICONS
  title?: ReactNode
  className?: string
}) {
  const Icon = ALERT_ICONS[tone]
  const tones = {
    danger: 'border-danger/25 bg-danger/[0.06] text-danger',
    warning: 'border-warning/25 bg-warning/[0.07] text-warning',
    success: 'border-success/25 bg-success/[0.07] text-success',
    accent: 'border-accent/20 bg-accent-soft text-accent',
  }
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={clsx('flex gap-2.5 rounded-lg border px-3.5 py-3 text-sm', tones[tone], className)}
    >
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

export function EmptyState({
  icon: Icon,
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
    <div
      className={clsx(
        'flex flex-col items-center rounded-xl border border-dashed border-border-strong bg-surface/50 px-6 py-14 text-center',
        className,
      )}
    >
      <div className="relative">
        <div className="absolute inset-0 -z-10 scale-150 rounded-full bg-accent/10 blur-xl" aria-hidden />
        <IconTile icon={Icon} tone="accent" size="lg" />
      </div>
      <h3 className="mt-4 text-[15px] font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-surface-muted px-1 font-sans text-[11px] font-medium text-muted">
      {children}
    </kbd>
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
        'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-[#b06cff] text-[13px] font-semibold text-white',
        className,
      )}
      aria-hidden
    >
      {initials}
    </span>
  )
}

/** Circular progress indicator, 0–100. */
export function ProgressRing({
  value,
  size = 120,
  stroke = 10,
  children,
}: {
  value: number
  size?: number
  stroke?: number
  children?: ReactNode
}) {
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
