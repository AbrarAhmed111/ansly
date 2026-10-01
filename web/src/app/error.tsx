'use client'

import { RotateCcw, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { useEffect } from 'react'
import { Button, IconTile, buttonStyles } from '@/components/ui'

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <IconTile icon={TriangleAlert} tone="danger" size="lg" />
      <h1 className="mt-6 text-h2">Something went wrong</h1>
      <p className="mt-2 max-w-sm text-body-lg text-muted">An unexpected error occurred. Try again, or head back to the homepage.</p>
      <div className="mt-8 flex gap-2">
        <Button icon={RotateCcw} onClick={() => reset()}>
          Try again
        </Button>
        <Link href="/" className={buttonStyles({ variant: 'secondary' })}>
          Go home
        </Link>
      </div>
      {process.env.NODE_ENV === 'development' && (
        <pre className="mt-10 max-w-2xl overflow-auto rounded-lg border border-border bg-surface-muted p-4 text-left font-mono text-caption text-danger">
          {error.message}
        </pre>
      )}
    </main>
  )
}
