import { clsx } from 'clsx'
import { Loader2, type LucideIcon } from 'lucide-react'
import type { ButtonHTMLAttributes } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-soft'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm'

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-accent-fg shadow-xs hover:bg-accent/90 active:bg-accent/95 [background-image:linear-gradient(to_bottom,rgb(255_255_255/0.12),transparent)]',
  secondary: 'border border-border bg-surface text-fg shadow-xs hover:border-border-strong hover:bg-surface-muted',
  ghost: 'text-muted hover:bg-surface-muted hover:text-fg',
  danger: 'bg-danger text-accent-fg shadow-xs hover:bg-danger/90',
  'danger-soft': 'text-danger hover:bg-danger/10',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 rounded-lg px-2.5 text-body-sm',
  md: 'h-9 gap-2 rounded-lg px-3.5 text-body',
  lg: 'h-11 gap-2 rounded-xl px-5 text-body-lg',
  icon: 'h-9 w-9 rounded-lg',
  'icon-sm': 'h-8 w-8 rounded-lg',
}

/** Shared focus ring for custom interactive elements. */
export const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg'

/** Class names for a button, for use on links styled as buttons. */
export function buttonStyles({
  variant = 'primary',
  size = 'md',
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return clsx(
    'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium transition-[background-color,border-color,color,box-shadow,opacity] duration-150',
    focusRing,
    'disabled:pointer-events-none disabled:opacity-50',
    VARIANTS[variant],
    SIZES[size],
    className,
  )
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  /** Leading icon; replaced by a spinner while loading. */
  icon?: LucideIcon
}

export function Button({ variant = 'primary', size = 'md', loading, icon: Icon, className, children, disabled, ...props }: ButtonProps) {
  return (
    <button className={buttonStyles({ variant, size, className })} disabled={disabled || loading} {...props}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : Icon && <Icon className="h-4 w-4" aria-hidden />}
      {children}
    </button>
  )
}

/** Square icon-only button. `label` becomes the accessible name and tooltip. */
export function IconButton({
  icon: Icon,
  label,
  tone = 'neutral',
  size = 'icon-sm',
  className,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: LucideIcon
  label: string
  tone?: 'neutral' | 'danger'
  size?: 'icon' | 'icon-sm'
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={buttonStyles({
        variant: 'ghost',
        size,
        className: clsx(tone === 'danger' && 'hover:bg-danger/10 hover:text-danger', className),
      })}
      {...props}
    >
      <Icon className={size === 'icon' ? 'h-5 w-5' : 'h-4 w-4'} aria-hidden />
    </button>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('h-4 w-4 animate-spin text-muted', className)} aria-label="Loading" />
}
