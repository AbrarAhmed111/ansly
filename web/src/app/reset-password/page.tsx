'use client'

import { ArrowLeft, ArrowRight, KeyRound } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, type FormEvent } from 'react'
import { Alert, Button, ErrorText, Field, GridPattern, IconTile, PasswordInput, Skeleton } from '@/components/ui'
import { errorMessage } from '@/lib/format'
import { createClient } from '@/lib/supabase/client'

const MIN_LENGTH = 8

/** The reset email's link signs the user in through /auth/callback, then lands here to choose a new password. */
export default function ResetPasswordPage() {
  const router = useRouter()
  const [email, setEmail] = useState<string | null | undefined>(undefined)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void createClient()
      .auth.getUser()
      .then(({ data }) => setEmail(data.user?.email ?? null))
  }, [])

  const mismatch = confirm.length > 0 && confirm !== password

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (password.length < MIN_LENGTH) return setError(`Use at least ${MIN_LENGTH} characters.`)
    if (password !== confirm) return setError('The two passwords don’t match.')
    setBusy(true)
    setError(null)
    try {
      const { error } = await createClient().auth.updateUser({ password })
      if (error) throw error
      router.replace('/dashboard')
      router.refresh()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <main className="relative flex min-h-dvh flex-col bg-bg px-4 py-4 sm:px-8">
      <GridPattern className="opacity-[0.45]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-accent-soft/70 to-transparent" aria-hidden />

      <Link
        href="/login"
        className="relative inline-flex w-fit items-center gap-1.5 rounded-lg px-2 py-1 text-muted transition hover:bg-surface-muted hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" />
        Sign in
      </Link>

      <div className="relative flex flex-1 items-center justify-center py-6">
        <section className="w-full max-w-[420px] rounded-2xl border border-border bg-surface/95 p-6 shadow-raised backdrop-blur">
          <IconTile icon={KeyRound} tone="accent" />
          <h1 className="mt-4 text-h2">Choose a new password</h1>

          {email === undefined ? (
            <div className="mt-6 space-y-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : email === null ? (
            <div className="mt-4 space-y-4">
              <Alert tone="warning" title="This reset link has expired or was already used">
                Request a new link and open it in this same browser.
              </Alert>
              <Link
                href="/login?mode=reset"
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 font-medium text-accent-fg hover:bg-accent/90"
              >
                Send a new reset link
              </Link>
            </div>
          ) : (
            <>
              <p className="mt-1 text-muted">
                For <span className="font-medium text-fg">{email}</span>
              </p>
              <form onSubmit={onSubmit} className="mt-5 space-y-3">
                <Field label="New password" htmlFor="new-password" help={`At least ${MIN_LENGTH} characters.`}>
                  <PasswordInput
                    id="new-password"
                    required
                    minLength={MIN_LENGTH}
                    autoFocus
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </Field>
                <Field label="Confirm new password" htmlFor="confirm-password">
                  <PasswordInput
                    id="confirm-password"
                    required
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(event) => setConfirm(event.target.value)}
                    aria-invalid={mismatch}
                  />
                </Field>
                {mismatch && <p className="text-caption text-danger">The passwords don’t match yet.</p>}
                <ErrorText>{error}</ErrorText>
                <Button type="submit" size="lg" loading={busy} className="w-full">
                  Update password
                  {!busy && <ArrowRight className="h-4 w-4" aria-hidden />}
                </Button>
              </form>
            </>
          )}
        </section>
      </div>
    </main>
  )
}
