'use client'

import { clsx } from 'clsx'
import { ArrowLeft, Check, Eye, EyeOff, Lock, Mail, Sparkles, UserRound } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState, type FormEvent } from 'react'
import { Logo } from '@/components/logo'
import { Alert, Button, ErrorText, Field, Input } from '@/components/ui'
import { safeNext } from '@/lib/safe-next'
import { createClient } from '@/lib/supabase/client'

const POINTS = [
  'Answers grounded only in your own profile',
  'Review and edit before anything is filled',
  'Saved answers reused for similar questions',
]

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const next = safeNext(params.get('next'))
  const [mode, setMode] = useState<'signin' | 'signup'>(params.get('mode') === 'signup' ? 'signup' : 'signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
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
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const switchMode = (m: 'signin' | 'signup') => {
    setMode(m)
    setError(null)
  }

  return (
    <div className="w-full max-w-[380px]">
      <h1 className="text-2xl font-semibold tracking-tight">{mode === 'signin' ? 'Welcome back' : 'Create your account'}</h1>
      <p className="mt-1.5 text-[15px] text-muted">
        {mode === 'signin' ? 'Sign in to manage your profile and answers.' : 'Build your profile once, answer applications faster.'}
      </p>

      <div role="tablist" className="mt-7 grid grid-cols-2 rounded-lg border border-border bg-surface-muted p-1">
        {(['signin', 'signup'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => switchMode(m)}
            className={clsx(
              'h-8 rounded-md text-sm font-medium transition',
              mode === m ? 'bg-surface text-fg shadow-xs ring-1 ring-border' : 'text-muted hover:text-fg',
            )}
          >
            {m === 'signin' ? 'Sign in' : 'Sign up'}
          </button>
        ))}
      </div>

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
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              icon={Lock}
              required
              minLength={mode === 'signup' ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              className="[&_input]:pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-subtle hover:text-fg"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>
        <ErrorText>{error}</ErrorText>
        {notice && <Alert tone="accent">{notice}</Alert>}
        <Button type="submit" size="lg" loading={busy} className="w-full">
          {mode === 'signin' ? 'Sign in' : 'Create account'}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        {mode === 'signin' ? 'New to Ansly? ' : 'Already have an account? '}
        <button type="button" className="font-medium text-accent hover:underline" onClick={() => switchMode(mode === 'signin' ? 'signup' : 'signin')}>
          {mode === 'signin' ? 'Create an account' : 'Sign in'}
        </button>
      </p>
    </div>
  )
}

export default function LoginPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-[#1e1b4b] via-[#3b2bb5] to-[#86198f] p-12 text-white lg:flex lg:flex-col">
        <div className="bg-grid pointer-events-none absolute inset-0 opacity-[0.08]" aria-hidden />
        <div className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-[#ff7ab6]/30 blur-3xl" aria-hidden />
        <Link href="/" className="relative">
          <Logo />
        </Link>
        <div className="relative mt-auto max-w-md">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
            <Sparkles className="h-5 w-5" />
          </span>
          <h2 className="mt-6 text-3xl font-semibold leading-tight tracking-tight">
            Truthful answers for every job application.
          </h2>
          <ul className="mt-8 space-y-3">
            {POINTS.map((p) => (
              <li key={p} className="flex items-center gap-3 text-white/85">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/15">
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
                {p}
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* Form */}
      <div className="flex flex-col px-4 py-6 sm:px-8">
        <div className="flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
            <ArrowLeft className="h-4 w-4" />
            Home
          </Link>
          <Link href="/" className="lg:hidden" aria-label="Ansly home">
            <Logo />
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center py-12">
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
        <p className="text-center text-xs text-subtle">
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
