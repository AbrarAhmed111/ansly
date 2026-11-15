import { ArrowLeft } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Logo } from '@/components/logo'
import { buttonStyles } from '@/components/ui'

export const metadata: Metadata = {
  title: 'Page not found',
  description: 'The page you are looking for does not exist.',
}

export default function NotFound() {
  return (
    <main className="flex min-h-screen animate-fade-up flex-col items-center justify-center px-4 text-center">
      <Logo />
      <p className="mt-10 font-mono text-body-sm text-subtle">404</p>
      <h1 className="mt-2 text-h1">Page not found</h1>
      <p className="mt-2 max-w-sm text-body-lg text-muted">The page you&apos;re looking for doesn&apos;t exist or has been moved.</p>
      <Link href="/" className={buttonStyles({ className: 'mt-8' })}>
        <ArrowLeft className="h-4 w-4" />
        Back to home
      </Link>
    </main>
  )
}
