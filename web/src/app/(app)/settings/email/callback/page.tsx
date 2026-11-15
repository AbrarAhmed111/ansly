'use client'

import { Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Alert, Card, buttonStyles } from '@/components/ui'
import { finishGmailConnect } from '@/lib/api'
import { errorMessage } from '@/lib/format'
import { safeNext } from '@/lib/safe-next'

function Callback() {
  const params = useSearchParams()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    const code = params.get('code')
    const state = params.get('state')
    const denied = params.get('error')
    if (denied || !code || !state) {
      setError(denied === 'access_denied' ? 'Gmail wasn’t connected: permission was declined.' : 'Gmail sign-in didn’t finish.')
      return
    }
    let next = '/settings'
    try {
      next = safeNext(sessionStorage.getItem('ansly:gmail-return'), '/settings')
      sessionStorage.removeItem('ansly:gmail-return')
    } catch {
      // Storage blocked.
    }
    finishGmailConnect(code, state)
      .then((connection) => {
        toast.success(`Gmail connected: ${connection.email_address}`)
        router.replace(next)
      })
      .catch((e) => setError(errorMessage(e)))
  }, [params, router])

  return (
    <Card className="mx-auto mt-10 max-w-lg">
      {error ? (
        <div className="space-y-4">
          <Alert tone="danger" title="Couldn’t connect Gmail">
            {error}
          </Alert>
          <Link href="/settings" className={buttonStyles({ variant: 'secondary' })}>
            Back to Settings
          </Link>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Connecting Gmail…
        </p>
      )}
    </Card>
  )
}

export default function GmailCallbackPage() {
  return (
    <Suspense>
      <Callback />
    </Suspense>
  )
}
