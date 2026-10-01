import { clsx } from 'clsx'
import Image from 'next/image'
import logoMark from '@/assets/img/logo-mark.png'
import logoTagline from '@/assets/img/logo-tagline.png'

export function LogoMark({ className }: { className?: string }) {
  return (
    <Image
      src={logoMark}
      alt=""
      width={90}
      height={108}
      className={clsx('h-6 w-6 shrink-0 rounded-lg object-cover shadow-[0_1px_2px_rgb(0_0_0/0.16)]', className)}
      aria-hidden
    />
  )
}

/** Mark + wordmark, for headers and nav. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-2 text-h3', className)}>
      <LogoMark />
      Ansly
    </span>
  )
}

/** Large logo with tagline, for the landing hero. */
export function LogoWithTagline({ className }: { className?: string }) {
  return <Image src={logoTagline} alt="Ansly" width={626} height={297} priority className={clsx('h-auto', className)} />
}
