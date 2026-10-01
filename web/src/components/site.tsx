import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { Logo } from '@/components/logo'
import { buttonStyles } from '@/components/ui'

export function SiteHeader({ signedIn }: { signedIn?: boolean }) {
  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-bg/75 backdrop-blur-lg">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
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
      </div>
    </header>
  )
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-muted sm:flex-row sm:px-6">
        <div className="flex items-center gap-3">
          <Logo className="text-[15px]" />
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
      </div>
    </footer>
  )
}
