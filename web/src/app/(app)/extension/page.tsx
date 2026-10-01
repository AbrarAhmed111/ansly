'use client'

import {
  BRIDGE_EXTENSION,
  BRIDGE_WEB,
  type ExtensionSession,
  type ExtensionStatusPayload,
  type ExtensionToWebMessage,
  type WebToExtensionMessage,
} from '@ansly/types'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { clsx } from 'clsx'
import { Check, CheckCircle2, CircleDashed, KeyRound, Lock, Mail, PlugZap, Puzzle, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import toast from 'react-hot-toast'
import { Alert, Badge, Button, Card, CardHeader, ErrorText, Field, IconTile, Input, PageHeader, Spinner } from '@/components/ui'
import { createClient } from '@/lib/supabase/client'
import { supabaseKey, supabaseUrl } from '@/lib/supabase/env'

function post(message: WebToExtensionMessage) {
  window.postMessage(message, window.location.origin)
}

/**
 * Signs in a second, independent Supabase session for the extension.
 * Sharing the web app's own session would break: Supabase rotates refresh
 * tokens, so whichever side refreshed second would be signed out.
 */
async function createExtensionSession(email: string, password: string): Promise<ExtensionSession> {
  const isolated = createSupabaseClient(supabaseUrl(), supabaseKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { data, error } = await isolated.auth.signInWithPassword({ email, password })
  if (error || !data.session) throw error ?? new Error('Sign-in failed')
  const s = data.session
  return {
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    expires_at: s.expires_at ?? Math.floor(Date.now() / 1000) + s.expires_in,
    user: { id: s.user.id, email: s.user.email ?? null },
  }
}

function Step({ n, title, done, active, children }: { n: number; title: string; done: boolean; active: boolean; children: ReactNode }) {
  return (
    <li className="relative flex gap-4 pb-8 last:pb-0">
      <span className="absolute left-[15px] top-9 h-[calc(100%-2.5rem)] w-px bg-border [li:last-child>&]:hidden" aria-hidden />
      <span
        className={clsx(
          'relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold',
          done
            ? 'border-success bg-success text-white'
            : active
              ? 'border-accent bg-accent-soft text-accent ring-4 ring-accent/10'
              : 'border-border bg-surface text-subtle',
        )}
      >
        {done ? <Check className="h-4 w-4" strokeWidth={3} /> : n}
      </span>
      <div className="min-w-0 flex-1 pt-1">
        <p className={clsx('font-semibold tracking-tight', !done && !active && 'text-muted')}>{title}</p>
        <div className="mt-1 text-sm leading-relaxed text-muted">{children}</div>
      </div>
    </li>
  )
}

export default function ExtensionPage() {
  const [status, setStatus] = useState<ExtensionStatusPayload | null>(null)
  const [checked, setChecked] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void createClient().auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ''))

    function onMessage(event: MessageEvent<ExtensionToWebMessage>) {
      if (event.source !== window || event.origin !== window.location.origin) return
      const msg = event.data
      if (msg?.source !== BRIDGE_EXTENSION) return
      if (msg.type === 'ANSLY_STATUS') {
        setStatus({ version: msg.version, connected: msg.connected, email: msg.email })
        setChecked(true)
      } else if (msg.type === 'ANSLY_CONNECTED') {
        setBusy(false)
        if (msg.ok) toast.success('Extension connected')
        else setError(msg.error ?? 'The extension could not save the session.')
      }
    }
    window.addEventListener('message', onMessage)
    post({ source: BRIDGE_WEB, type: 'ANSLY_PING' })
    const timer = setTimeout(() => setChecked(true), 1500)
    return () => {
      window.removeEventListener('message', onMessage)
      clearTimeout(timer)
    }
  }, [])

  async function onConnect(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const session = await createExtensionSession(email, password)
      setPassword('')
      post({ source: BRIDGE_WEB, type: 'ANSLY_CONNECT', session })
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const installed = Boolean(status)
  const connected = Boolean(status?.connected)

  const hero = !checked
    ? { icon: CircleDashed, tone: 'neutral' as const, title: 'Looking for the extension…', body: 'This only takes a moment.' }
    : !status
      ? {
          icon: Puzzle,
          tone: 'warning' as const,
          title: 'Extension not detected',
          body: 'Install the Ansly extension in this browser, then reload this page.',
        }
      : status.connected
        ? {
            icon: CheckCircle2,
            tone: 'success' as const,
            title: 'You’re all set',
            body: `Connected${status.email ? ` as ${status.email}` : ''}. Look for ✨ beside questions on application forms.`,
          }
        : {
            icon: PlugZap,
            tone: 'accent' as const,
            title: 'Almost there — connect your account',
            body: 'The extension is installed. Confirm your password below to connect it.',
          }

  return (
    <div className="animate-fade-up">
      <PageHeader
        eyebrow="Workspace"
        title="Browser extension"
        description="The Ansly extension adds ✨ beside open-ended questions on job application forms."
      />

      <Card className="relative mb-6 overflow-hidden">
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-accent/10 blur-3xl" aria-hidden />
        <div className="relative flex flex-wrap items-center gap-4">
          {!checked ? (
            <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-surface-muted">
              <Spinner className="h-5 w-5" />
            </span>
          ) : (
            <IconTile icon={hero.icon} tone={hero.tone} size="lg" />
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-tight">{hero.title}</h2>
            <p className="mt-0.5 text-sm text-muted">{hero.body}</p>
          </div>
          {status && <Badge>v{status.version}</Badge>}
          {checked && !status && (
            <Button variant="secondary" onClick={() => window.location.reload()}>
              <RefreshCw className="h-4 w-4" />
              Check again
            </Button>
          )}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <Card>
          <CardHeader title="Setup" description="Three steps, about a minute." />
          <ol className="mt-6">
            <Step n={1} title="Install the extension" done={installed} active={checked && !installed}>
              {installed ? (
                'Installed in this browser.'
              ) : (
                <>Load it in Chrome (see the extension README for loading it unpacked during development), then reload this page.</>
              )}
            </Step>
            <Step n={2} title="Connect your account" done={connected} active={installed && !connected}>
              {connected ? 'Signed in with its own secure session.' : 'Confirm your password to give the extension its own sign-in.'}
            </Step>
            <Step n={3} title="Open any application" done={false} active={connected}>
              Click <span className="font-medium text-fg">✨</span> beside a question, review the draft, then fill. Works on
              LinkedIn, Indeed, Greenhouse, Lever, Workday and company sites.
            </Step>
          </ol>
        </Card>

        {status ? (
          <Card>
            <CardHeader
              icon={KeyRound}
              title={status.connected ? 'Reconnect' : 'Connect the extension'}
              description="Your password is sent only to Supabase, never to the extension."
            />
            <form onSubmit={onConnect} className="mt-6 space-y-4">
              <Field label="Email" htmlFor="ext-email">
                <Input id="ext-email" type="email" icon={Mail} required value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <Field label="Password" htmlFor="ext-password">
                <Input
                  id="ext-password"
                  type="password"
                  icon={Lock}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              <ErrorText>{error}</ErrorText>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button type="submit" loading={busy}>
                  {busy ? 'Connecting…' : status.connected ? 'Reconnect' : 'Connect extension'}
                </Button>
                {status.connected && (
                  <Button type="button" variant="secondary" onClick={() => post({ source: BRIDGE_WEB, type: 'ANSLY_DISCONNECT' })}>
                    Disconnect
                  </Button>
                )}
              </div>
            </form>
          </Card>
        ) : (
          <div className="space-y-4">
            <Card>
              <CardHeader icon={Sparkles} title="Answers from your profile only" description="If your profile doesn't support an answer, Ansly says so instead of inventing one." />
            </Card>
            <Card>
              <CardHeader icon={ShieldCheck} title="You approve every fill" description="Nothing is typed into a form until you click Fill. Ansly never submits applications." />
            </Card>
            {checked && (
              <Alert tone="accent" title="Installed it already?">
                Pages opened before installing can&apos;t see the extension. Reload this page to detect it.
              </Alert>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
