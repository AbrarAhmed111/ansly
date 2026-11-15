'use client'

import { ArrowLeft, ArrowRight, Check, Mail, UserRound } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState, type FormEvent } from 'react'
import { Logo } from '@/components/logo'
import { Alert, Button, ErrorText, Field, Input, PasswordInput, SegmentedControl } from '@/components/ui'
import { errorMessage } from '@/lib/format'
import { safeNext } from '@/lib/safe-next'
import { createClient } from '@/lib/supabase/client'

type Mode = 'signin' | 'signup' | 'reset'

const MODES = [
  { value: 'signin', label: 'Sign in' },
  { value: 'signup', label: 'Sign up' },
] as const

const POINTS = [
  'Answers grounded only in your own profile',
  'Review and edit before anything is filled',
  'Saved answers reused for similar questions',
]

const COPY = {
  signin: {
    title: 'Welcome back',
    body: 'Sign in to manage your profile, saved answers and extension settings.',
    submit: 'Sign in',
  },
  signup: {
    title: 'Create your account',
    body: 'Build your profile once and answer applications faster, with every draft grounded in your real experience.',
    submit: 'Create account',
  },
  reset: {
    title: 'Reset your password',
    body: 'Enter the email you signed up with. We’ll send you a link to choose a new password.',
    submit: 'Send reset link',
  },
} as const

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const next = safeNext(params.get('next'))
  const initialMode = params.get('mode')
  const [mode, setMode] = useState<Mode>(initialMode === 'signup' || initialMode === 'reset' ? initialMode : 'signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(params.get('error'))
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    const supabase = createClient()
    try {
      if (mode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent('/reset-password')}`,
        })
        if (error) throw error
        // Same message whether or not the address has an account, so the form can't be used to find accounts.
        setNotice(`If ${email.trim()} has an Ansly account, a reset link is on its way. Open it in this browser.`)
        setMode('signin')
      } else if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        router.replace(next)
        router.refresh()
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName.trim() || null },
            emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
          },
        })
        if (error) throw error
        if (data.session) {
          router.replace('/profile/personal')
          router.refresh()
        } else {
          setNotice('Check your email for a confirmation link, then sign in.')
          setMode('signin')
        }
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const switchMode = (m: Mode) => {
    setMode(m)
    setError(null)
  }

  return (
    <section className="w-full max-w-[400px] animate-fade-up">
      {/* Keyed by mode so the heading settles in again when the form changes. */}
      <div key={mode} className="animate-fade-in space-y-2">
        <h1 className="text-h2">{COPY[mode].title}</h1>
        <p className="text-body-lg text-muted">{COPY[mode].body}</p>
      </div>

      {mode !== 'reset' && (
        <SegmentedControl role="tablist" label="Account" options={MODES} value={mode} onChange={switchMode} className="mt-5 flex w-full" />
      )}

      <form onSubmit={onSubmit} className="mt-5 space-y-4">
        {mode === 'signup' && (
          <Field label="Full name" htmlFor="full_name" className="animate-fade-up">
            <Input id="full_name" icon={UserRound} value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" placeholder="Jane Doe" />
          </Field>
        )}
        <Field label="Email" htmlFor="email">
          <Input
            id="email"
            type="email"
            icon={Mail}
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            placeholder="you@example.com"
          />
        </Field>
        {mode !== 'reset' && (
          <Field
            label="Password"
            htmlFor="password"
            help={mode === 'signup' ? 'At least 8 characters.' : undefined}
            hint={
              mode === 'signin' && (
                <button type="button" className="font-medium text-accent hover:underline" onClick={() => switchMode('reset')}>
                  Forgot password?
                </button>
              )
            }
          >
            <PasswordInput
              id="password"
              required
              minLength={mode === 'signup' ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            />
          </Field>
        )}
        <ErrorText>{error}</ErrorText>
        {notice && <Alert tone="accent">{notice}</Alert>}
        <Button type="submit" size="lg" loading={busy} className="w-full">
          {COPY[mode].submit}
          {!busy && <ArrowRight className="h-4 w-4" aria-hidden />}
        </Button>
      </form>

      <p className="mt-5 text-center text-muted">
        {mode === 'reset' ? 'Remembered it? ' : mode === 'signin' ? 'New to Ansly? ' : 'Already have an account? '}
        <button type="button" className="font-medium text-accent hover:underline" onClick={() => switchMode(mode === 'signin' ? 'signup' : 'signin')}>
          {mode === 'signin' ? 'Create an account' : 'Sign in'}
        </button>
      </p>
    </section>
  )
}

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh bg-bg lg:h-dvh lg:grid-cols-[minmax(0,1.05fr)_minmax(480px,0.95fr)]">
      {/* The same claim as the landing page, and the three rules behind it. */}
      <aside className="hidden border-r border-border bg-surface-muted/50 p-8 lg:flex lg:flex-col xl:p-12">
        <Link href="/" aria-label="Ansly home" className="w-fit">
          <Logo />
        </Link>

        <div className="my-auto max-w-xl animate-fade-up">
          <h2 className="text-display text-balance">Job applications, written from your own record.</h2>
          <ul className="stagger mt-10 divide-y divide-border border-y border-border text-body-lg">
            {POINTS.map((p) => (
              <li key={p} className="flex items-center gap-3 py-3.5">
                <Check className="h-4 w-4 shrink-0 text-accent" strokeWidth={2.5} aria-hidden />
                {p}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-body-sm text-muted">Nothing is invented, and nothing is filled or sent until you approve it.</p>
      </aside>

      <div className="flex min-h-dvh flex-col px-4 py-3 sm:px-8 sm:py-4 lg:min-h-0 lg:py-5">
        <div className="flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-muted transition-colors hover:bg-surface-muted hover:text-fg">
            <ArrowLeft className="h-4 w-4" />
            Home
          </Link>
          <Link href="/" className="lg:hidden" aria-label="Ansly home">
            <Logo />
          </Link>
        </div>

        <div className="flex flex-1 items-center justify-center py-4 sm:py-5 lg:min-h-0">
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>

        <footer className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-caption text-subtle">
          <p className="text-center">
            By continuing you agree to our{' '}
            <Link href="/privacy" className="underline underline-offset-2 hover:text-fg">
              privacy policy
            </Link>
            .
          </p>
          <a
            href="https://www.abrarahmed.pro"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md transition hover:text-fg"
            aria-label="Built by DevAbby"
          >
            <span className="text-[10px] font-semibold uppercase tracking-wider">Built by</span>
            <Image
              src="https://www.abrarahmed.pro/assets/devAbby-fulllogo-C9-MX7QK.png"
              alt="DevAbby"
              width={146}
              height={44}
              unoptimized
              className="h-10 w-auto"
            />
          </a>
        </footer>
      </div>
    </main>
  )
}
