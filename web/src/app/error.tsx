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
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="mt-2 max-w-sm text-muted">An unexpected error occurred. Try again, or head back to the homepage.</p>
      <div className="mt-8 flex gap-2">
        <Button onClick={() => reset()}>
          <RotateCcw className="h-4 w-4" />
          Try again
        </Button>
        <Link href="/" className={buttonStyles({ variant: 'secondary' })}>
          Go home
        </Link>
      </div>
      {process.env.NODE_ENV === 'development' && (
        <pre className="mt-10 max-w-2xl overflow-auto rounded-lg border border-border bg-surface-muted p-4 text-left font-mono text-xs text-danger">
          {error.message}
        </pre>
      )}
    </main>
  )
}
