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
import { Check, CheckCircle2, CircleDashed, KeyRound, Mail, PlugZap, Puzzle, RefreshCw, ShieldCheck, type LucideIcon } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { LogoMark } from '@/components/logo'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  ErrorText,
  Field,
  Glow,
  IconTile,
  Input,
  PageHeader,
  PasswordInput,
  Spinner,
  Step,
  Steps,
  type StepState,
} from '@/components/ui'
import { trackEvent } from '@/lib/api'
import { errorMessage } from '@/lib/format'
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

const stepState = (done: boolean, active: boolean): StepState => (done ? 'done' : active ? 'active' : 'idle')

function ProductMarkTile({ className = 'h-12 w-12' }: { className?: string }) {
  return (
    <span className={`${className} inline-flex shrink-0 items-center justify-center rounded-xl border border-accent/25 bg-accent-soft`}>
      <LogoMark className="h-7 w-7 rounded-lg shadow-none" />
    </span>
  )
}

function FeatureCard({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <Card className="h-full">
      <div className="flex items-start gap-3">
        <IconTile icon={Icon} tone="accent" size="sm" />
        <div>
          <h3 className="font-semibold">{title}</h3>
          <p className="mt-1 text-body-sm leading-relaxed text-muted">{body}</p>
        </div>
      </div>
    </Card>
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
        if (msg.ok) {
          toast.success('Extension connected')
          void trackEvent({ kind: 'extension_connected', category: null })
        }
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
      setError(errorMessage(err))
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
            body: `Connected${status.email ? ` as ${status.email}` : ''}. Look for the Ansly mark beside questions on application forms.`,
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
        description="Connect the browser extension so Ansly can draft answers beside open-ended questions on job application forms."
      />

      <Card className="relative mb-6 overflow-hidden p-0">
        <Glow className="-right-24 -top-24 h-64 w-64" />
        <div className="relative grid lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <div className="border-b border-border p-6 lg:border-b-0 lg:border-r">
            <div className="flex flex-wrap items-start gap-4">
              {!checked ? (
                <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-surface-muted">
                  <Spinner className="h-5 w-5" />
                </span>
              ) : status?.connected ? (
                <ProductMarkTile />
              ) : (
                <IconTile icon={hero.icon} tone={hero.tone} size="lg" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-h3">{hero.title}</h2>
                  {status && <Badge>v{status.version}</Badge>}
                </div>
                <p className="mt-1 max-w-2xl leading-relaxed text-muted">{hero.body}</p>
              </div>
              {checked && !status && (
                <Button variant="secondary" icon={RefreshCw} onClick={() => window.location.reload()}>
                  Check again
                </Button>
              )}
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {[
                { label: 'Detection', value: installed ? 'Installed' : checked ? 'Missing' : 'Checking' },
                { label: 'Session', value: connected ? 'Connected' : 'Not connected' },
                { label: 'Control', value: 'Review first' },
              ].map((item) => (
                <div key={item.label} className="rounded-lg border border-border bg-surface/70 p-3">
                  <p className="text-caption text-subtle">{item.label}</p>
                  <p className="mt-1 font-medium">{item.value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-surface-muted/40 p-6">
            <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
              <div className="flex items-center gap-2 border-b border-border pb-3">
                <span className="h-2.5 w-2.5 rounded-full bg-border-strong" />
                <span className="h-2.5 w-2.5 rounded-full bg-border-strong" />
                <span className="h-2.5 w-2.5 rounded-full bg-border-strong" />
                <span className="ml-2 truncate text-caption text-subtle">careers.example.com/apply</span>
              </div>
              <div className="mt-4 rounded-lg border border-accent bg-surface px-3 py-3 ring-4 ring-accent/10">
                <p className="text-caption text-subtle">Why are you interested in this role?</p>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="text-body-sm text-muted">Draft answer from your profile</span>
                  <ProductMarkTile className="h-9 w-9" />
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge>
                  <Check className="h-3 w-3 text-success" />
                  You approve
                </Badge>
                <Badge>
                  <Check className="h-3 w-3 text-success" />
                  Profile grounded
                </Badge>
              </div>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <Card>
          <CardHeader title="Setup" description="Three steps, about a minute." />
          <Steps className="mt-6">
            <Step n={1} title="Install the extension" state={stepState(installed, checked && !installed)}>
              {installed ? (
                'Installed in this browser.'
              ) : (
                <>Load it in Chrome (see the extension README for loading it unpacked during development), then reload this page.</>
              )}
            </Step>
            <Step n={2} title="Connect your account" state={stepState(connected, installed && !connected)}>
              {connected ? 'Signed in with its own secure session.' : 'Confirm your password to give the extension its own sign-in.'}
            </Step>
            <Step n={3} title="Open any application" state={stepState(false, connected)}>
              Click the <LogoMark className="mx-0.5 inline h-4 w-4 rounded-sm shadow-none" /> mark beside a question, review the draft, then fill. Works on
              LinkedIn, Indeed, Greenhouse, Lever, Workday and company sites.
            </Step>
          </Steps>
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
                <PasswordInput
                  id="ext-password"
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
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            <FeatureCard
              icon={ShieldCheck}
              title="Answers from your profile only"
              body="If your profile doesn't support an answer, Ansly says so instead of inventing one."
            />
            <FeatureCard
              icon={CheckCircle2}
              title="You approve every fill"
              body="Nothing is typed into a form until you click Fill. Ansly never submits applications."
            />
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
