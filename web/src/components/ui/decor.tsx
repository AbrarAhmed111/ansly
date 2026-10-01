import { clsx } from 'clsx'

/** Soft blurred accent light behind a card corner. Parent needs `relative overflow-hidden`. */
export function Glow({ className }: { className?: string }) {
  return (
    <div
      className={clsx('pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-accent/10 blur-3xl', className)}
      aria-hidden
    />
  )
}

/** Faint grid background. `fade` masks it out from the top or the centre. */
export function GridPattern({ fade = 'none', className }: { fade?: 'top' | 'center' | 'none'; className?: string }) {
  const masks = {
    top: '[mask-image:radial-gradient(ellipse_at_top,black_20%,transparent_70%)]',
    center: '[mask-image:radial-gradient(ellipse_at_center,black_10%,transparent_60%)]',
    none: '',
  }
  return <div className={clsx('bg-grid pointer-events-none absolute inset-0', masks[fade], className)} aria-hidden />
}
