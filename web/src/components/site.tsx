import { clsx } from 'clsx'
import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Logo } from '@/components/logo'
import { Overline, buttonStyles } from '@/components/ui'

/** Centered marketing-page column. */
export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('mx-auto w-full max-w-6xl px-4 sm:px-6', className)}>{children}</div>
}

/** Overline + section title + optional lead paragraph. */
export function SectionIntro({ eyebrow, title, children }: { eyebrow: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="max-w-2xl">
      <Overline tone="accent">{eyebrow}</Overline>
      <h2 className="mt-2 text-h1">{title}</h2>
      {children && <p className="mt-4 text-lead text-muted">{children}</p>}
    </div>
  )
}

export function SiteHeader({ signedIn }: { signedIn?: boolean }) {
  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-bg/75 backdrop-blur-lg">
      <Container className="flex h-16 items-center justify-between">
        <Link href="/" aria-label="Ansly home">
          <Logo />
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2">
          <Link href="/#how-it-works" className={buttonStyles({ variant: 'ghost', className: 'hidden sm:inline-flex' })}>
            How it works
          </Link>
          <Link href="/privacy" className={buttonStyles({ variant: 'ghost', className: 'hidden sm:inline-flex' })}>
            Privacy
          </Link>
          {signedIn ? (
            <Link href="/dashboard" className={buttonStyles()}>
              Open dashboard
              <ArrowRight className="h-4 w-4" />
            </Link>
          ) : (
            <>
              <Link href="/login" className={buttonStyles({ variant: 'ghost' })}>
                Sign in
              </Link>
              <Link href="/login?mode=signup" className={buttonStyles()}>
                Get started
              </Link>
            </>
          )}
        </nav>
      </Container>
    </header>
  )
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <Container className="flex flex-col items-center justify-between gap-4 py-8 text-muted sm:flex-row">
        <div className="flex items-center gap-3">
          <Logo className="text-title" />
          <span className="text-subtle">Truthful answers for job applications.</span>
        </div>
        <nav className="flex gap-5">
          <Link href="/privacy" className="hover:text-fg">
            Privacy
          </Link>
          <Link href="/login" className="hover:text-fg">
            Sign in
          </Link>
        </nav>
      </Container>
    </footer>
  )
}
