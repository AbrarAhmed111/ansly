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
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 text-center">
      <div className="bg-grid pointer-events-none absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_center,black_10%,transparent_60%)]" aria-hidden />
      <Logo />
      <p className="text-gradient mt-10 text-7xl font-semibold tracking-tight">404</p>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-2 max-w-sm text-muted">The page you&apos;re looking for doesn&apos;t exist or has been moved.</p>
      <Link href="/" className={buttonStyles({ className: 'mt-8' })}>
        <ArrowLeft className="h-4 w-4" />
        Back to home
      </Link>
    </main>
  )
}
