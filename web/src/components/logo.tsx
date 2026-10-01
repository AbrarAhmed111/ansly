import { clsx } from 'clsx'
import Image from 'next/image'
import smallLogoLight from '@/assets/img/small logo.png'

export function LogoMark({ className }: { className?: string }) {
  return (
    <Image
      src={smallLogoLight}
      alt=""
      width={90}
      height={108}
      className={clsx(
        'h-6 w-6 shrink-0 rounded-lg object-cover shadow-[0_1px_2px_rgb(0_0_0/0.16)]',
        className,
      )}
      aria-hidden
    />
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
