'use client'

import { clsx } from 'clsx'
import type { CSSProperties, ElementType, ReactNode } from 'react'
import { useInView } from '@/components/landing/motion'

/**
 * Fades its content up the first time it scrolls into view (the `.reveal` rule in globals.css).
 * `delay` staggers siblings. Without script the content is simply visible (see the <noscript> rule
 * in the root layout), and reduced motion shortens the transition to nothing.
 */
export function Reveal({
  children,
  as: Tag = 'div',
  delay = 0,
  className,
}: {
  children: ReactNode
  as?: ElementType
  delay?: number
  className?: string
}) {
  // A low threshold, so a block taller than the screen (the creator's letter on a phone) still reveals.
  const [ref, inView] = useInView<HTMLElement>(0.05)
  return (
    <Tag
      ref={ref}
      data-in={inView}
      className={clsx('reveal', className)}
      style={delay ? ({ '--reveal-delay': `${delay}ms` } as CSSProperties) : undefined}
    >
      {children}
    </Tag>
  )
}
