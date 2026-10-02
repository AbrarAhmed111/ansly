import { clsx } from 'clsx'
import { X, type LucideIcon } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'

export const controlStyles = clsx(
  'w-full rounded-lg border border-border bg-surface px-3 text-body text-fg shadow-xs transition-[border-color,box-shadow]',
  'placeholder:text-subtle hover:border-border-strong',
  'focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15',
  'disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted',
)

export function Input({
  className,
  icon: Icon,
  trailing,
  ...props
}: ComponentProps<'input'> & {
  icon?: LucideIcon
  /** Element pinned to the right edge inside the input, e.g. a clear or reveal button. */
  trailing?: ReactNode
}) {
  if (!Icon && !trailing) return <input className={clsx(controlStyles, 'h-9', className)} {...props} />
  return (
    <div className={clsx('relative', className)}>
      {Icon && <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />}
      <input className={clsx(controlStyles, 'h-9', Icon && 'pl-9', trailing && 'pr-10')} {...props} />
      {trailing && <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center">{trailing}</div>}
    </div>
  )
}

/** Small button for use as an Input's `trailing` element. */
export function InputAction({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="rounded-md p-1.5 text-subtle hover:text-fg">
      <Icon className="h-4 w-4" aria-hidden />
    </button>
  )
}

/** Search box with a leading icon and a clear button. */
export function SearchInput({
  value,
  onChange,
  icon,
  ...props
}: Omit<ComponentProps<'input'>, 'onChange' | 'value'> & { value: string; onChange: (value: string) => void; icon: LucideIcon }) {
  return (
    <Input
      type="search"
      icon={icon}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      trailing={value ? <InputAction icon={X} label="Clear search" onClick={() => onChange('')} /> : undefined}
      {...props}
    />
  )
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={clsx(controlStyles, 'min-h-[96px] resize-y py-2 leading-relaxed', className)} {...props} />
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={clsx(
        controlStyles,
        'h-9 cursor-pointer appearance-none bg-[length:16px] bg-[right_0.6rem_center] bg-no-repeat pr-9',
        "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m7 15 5 5 5-5'/%3E%3Cpath d='m7 9 5-5 5 5'/%3E%3C/svg%3E\")]",
        className,
      )}
      {...props}
    />
  )
}

/** Checkbox in a bordered row, label to the right. */
export function Checkbox({
  label,
  checked,
  onChange,
  id,
  disabled,
}: {
  label: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
  id?: string
  disabled?: boolean
}) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-surface-muted/50 px-3 py-2.5 text-body font-medium transition hover:border-border-strong"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 cursor-pointer rounded border-border accent-[rgb(var(--accent))]"
      />
      {label}
    </label>
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
        <label htmlFor={htmlFor} className="block text-body-sm font-medium text-fg">
          {label}
          {required && <span className="ml-0.5 text-danger">*</span>}
        </label>
        {hint && <span className="text-caption tabular-nums text-subtle">{hint}</span>}
      </div>
      {children}
      {help && <p className="text-caption leading-relaxed text-muted">{help}</p>}
    </div>
  )
}

/** Character counter: "412 / 1000", or "412 characters" without a limit. Turns red past the limit. */
export function CharCount({ count, limit, className }: { count: number; limit?: number | null; className?: string }) {
  const over = limit != null && count > limit
  return (
    <span className={clsx('text-caption tabular-nums', over ? 'font-medium text-danger' : 'text-subtle', className)}>
      {count}
      {limit != null ? ` / ${limit}` : ' characters'}
    </span>
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
          'inline-block h-4 w-4 rounded-full bg-surface shadow-xs transition-transform',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}
