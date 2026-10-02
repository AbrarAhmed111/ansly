'use client'

import { ArrowLeft, ArrowRight, Check, LockKeyhole, Mail, ShieldCheck, Sparkles, UserRound } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState, type FormEvent } from 'react'
import fullLogo from '@/assets/img/full logo.png'
import { Alert, Button, ErrorText, Field, GridPattern, Input, PasswordInput, SegmentedControl } from '@/components/ui'
import { errorMessage } from '@/lib/format'
import { safeNext } from '@/lib/safe-next'
import { createClient } from '@/lib/supabase/client'

type Mode = 'signin' | 'signup'

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
    eyebrow: 'Secure workspace',
    title: 'Welcome back',
    body: 'Sign in to manage your profile, saved answers and extension settings.',
    submit: 'Sign in',
  },
  signup: {
    eyebrow: 'Start with your profile',
    title: 'Create your account',
    body: 'Build your profile once and answer applications faster, with every draft grounded in your real experience.',
    submit: 'Create account',
  },
} as const

function FullLogo({ className }: { className?: string }) {
  return <Image src={fullLogo} alt="Ansly" width={311} height={130} priority className={className} />
}

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const next = safeNext(params.get('next'))
  const [mode, setMode] = useState<Mode>(params.get('mode') === 'signup' ? 'signup' : 'signin')
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
      if (mode === 'signin') {
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
    <section className="w-full max-w-[440px] rounded-2xl border border-border bg-surface/95 p-6 shadow-raised backdrop-blur sm:p-8">
      <div className="mb-7 flex justify-center lg:hidden">
        <FullLogo className="h-auto w-36" />
      </div>

      <div className="space-y-2">
        <p className="text-overline text-accent">{COPY[mode].eyebrow}</p>
        <h1 className="text-h2">{COPY[mode].title}</h1>
        <p className="text-body-lg text-muted">{COPY[mode].body}</p>
      </div>

      <SegmentedControl role="tablist" label="Account" options={MODES} value={mode} onChange={switchMode} className="mt-7 flex w-full" />

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        {mode === 'signup' && (
          <Field label="Full name" htmlFor="full_name">
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
        <Field label="Password" htmlFor="password" help={mode === 'signup' ? 'At least 8 characters.' : undefined}>
          <PasswordInput
            id="password"
            required
            minLength={mode === 'signup' ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          />
        </Field>
        <ErrorText>{error}</ErrorText>
        {notice && <Alert tone="accent">{notice}</Alert>}
        <Button type="submit" size="lg" loading={busy} className="w-full">
          {COPY[mode].submit}
          {!busy && <ArrowRight className="h-4 w-4" aria-hidden />}
        </Button>
      </form>

      <p className="mt-6 text-center text-muted">
        {mode === 'signin' ? 'New to Ansly? ' : 'Already have an account? '}
        <button type="button" className="font-medium text-accent hover:underline" onClick={() => switchMode(mode === 'signin' ? 'signup' : 'signin')}>
          {mode === 'signin' ? 'Create an account' : 'Sign in'}
        </button>
      </p>
    </section>
  )
}

export default function LoginPage() {
  return (
    <main className="grid min-h-screen bg-bg lg:grid-cols-[minmax(0,1.05fr)_minmax(480px,0.95fr)]">
      <aside className="relative hidden overflow-hidden bg-gradient-deep p-12 text-accent-fg lg:flex lg:flex-col">
        <GridPattern className="opacity-[0.1]" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-neutral-950/40 to-transparent" aria-hidden />

        <Link href="/" className="relative inline-flex w-fit rounded-xl bg-neutral-0/95 px-4 py-2 shadow-raised ring-1 ring-neutral-0/25">
          <FullLogo className="h-auto w-40" />
        </Link>

        <div className="relative my-auto max-w-xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-neutral-0/15 bg-neutral-0/10 px-3 py-1 text-body-sm backdrop-blur">
            <Sparkles className="h-4 w-4" />
            Professional application answers, grounded in your profile
          </div>
          <h2 className="mt-7 text-display text-balance">A calm, focused workspace for every application.</h2>
          <p className="mt-5 max-w-lg text-body-lg leading-relaxed text-neutral-0/78">
            Keep your profile, saved responses and extension connected so each answer is fast to review and easy to trust.
          </p>

          <ul className="mt-9 grid gap-3 text-body-lg">
            {POINTS.map((p) => (
              <li key={p} className="flex items-center gap-3 rounded-xl border border-neutral-0/12 bg-neutral-0/8 px-4 py-3 text-neutral-0/88 backdrop-blur">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neutral-0/15">
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
                {p}
              </li>
            ))}
          </ul>

          <div className="mt-8 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-neutral-0/12 bg-neutral-0/8 p-4 backdrop-blur">
              <ShieldCheck className="h-5 w-5 text-neutral-0/80" aria-hidden />
              <p className="mt-3 text-title">Truth-first</p>
              <p className="mt-1 text-body-sm text-neutral-0/65">No invented experience.</p>
            </div>
            <div className="rounded-xl border border-neutral-0/12 bg-neutral-0/8 p-4 backdrop-blur">
              <LockKeyhole className="h-5 w-5 text-neutral-0/80" aria-hidden />
              <p className="mt-3 text-title">You approve</p>
              <p className="mt-1 text-body-sm text-neutral-0/65">Nothing fills without review.</p>
            </div>
          </div>
        </div>
      </aside>

      <div className="relative flex min-h-screen flex-col overflow-hidden px-4 py-6 sm:px-8">
        <GridPattern className="opacity-[0.45]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-accent-soft/70 to-transparent" aria-hidden />

        <div className="relative flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-muted transition hover:bg-surface-muted hover:text-fg">
            <ArrowLeft className="h-4 w-4" />
            Home
          </Link>
          <Link href="/" className="lg:hidden" aria-label="Ansly home">
            <FullLogo className="h-auto w-28" />
          </Link>
        </div>

        <div className="relative flex flex-1 items-center justify-center py-10">
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>

        <p className="relative text-center text-caption text-subtle">
          By continuing you agree to our{' '}
          <Link href="/privacy" className="underline underline-offset-2 hover:text-fg">
            privacy policy
          </Link>
          .
        </p>
      </div>
    </main>
  )
}
