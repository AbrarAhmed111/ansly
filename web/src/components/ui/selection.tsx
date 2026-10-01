import { clsx } from 'clsx'
import type { LucideIcon } from 'lucide-react'
import type { ButtonHTMLAttributes } from 'react'

/** A pill toggle group: theme picker, sign in / sign up switch. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  role = 'radiogroup',
  size = 'md',
  iconOnly,
  className,
}: {
  options: readonly { value: T; label: string; icon?: LucideIcon }[]
  value: T | null
  onChange: (value: T) => void
  label: string
  /** "tablist" when the control switches what the page shows. */
  role?: 'radiogroup' | 'tablist'
  size?: 'sm' | 'md'
  /** Show icons only; labels stay available to screen readers. */
  iconOnly?: boolean
  className?: string
}) {
  const itemRole = role === 'tablist' ? 'tab' : 'radio'
  return (
    <div role={role} aria-label={label} className={clsx('inline-flex rounded-lg border border-border bg-surface-muted p-0.5', className)}>
      {options.map(({ value: v, label: l, icon: Icon }) => {
        const selected = v === value
        return (
          <button
            key={v}
            type="button"
            role={itemRole}
            aria-checked={itemRole === 'radio' ? selected : undefined}
            aria-selected={itemRole === 'tab' ? selected : undefined}
            title={iconOnly ? l : undefined}
            onClick={() => onChange(v)}
            className={clsx(
              'inline-flex flex-1 items-center justify-center gap-1.5 rounded-md font-medium transition',
              size === 'sm' ? 'h-7 px-2 text-body-sm' : 'h-8 px-3 text-body-sm',
              selected ? 'bg-surface text-fg shadow-xs ring-1 ring-border' : 'text-muted hover:text-fg',
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5" aria-hidden />}
            {iconOnly ? <span className="sr-only">{l}</span> : l}
          </button>
        )
      })}
    </div>
  )
}

/** Rounded pill for suggestions and quick actions. */
export function chipStyles({ selected, className }: { selected?: boolean; className?: string } = {}) {
  return clsx(
    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-caption font-medium transition disabled:opacity-50',
    selected
      ? 'border-accent/40 bg-accent-soft text-accent'
      : 'border-border bg-surface text-muted hover:border-accent/40 hover:text-accent',
    className,
  )
}

export function Chip({ selected, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return <button type="button" aria-pressed={selected} className={chipStyles({ selected, className })} {...props} />
}
