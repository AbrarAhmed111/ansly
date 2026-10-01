import { clsx } from 'clsx'
import { Sparkles } from 'lucide-react'

export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={clsx(
        'relative inline-flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-accent via-[#8b5cf6] to-[#d946ef] text-white shadow-[0_1px_2px_rgb(0_0_0/0.2),inset_0_1px_0_rgb(255_255_255/0.25)]',
        className,
      )}
      aria-hidden
    >
      <Sparkles className="h-[15px] w-[15px]" strokeWidth={2.25} />
    </span>
  )
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-2 text-[17px] font-semibold tracking-tight', className)}>
      <LogoMark />
      Ansly
    </span>
  )
}
