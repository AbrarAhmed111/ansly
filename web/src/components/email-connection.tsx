'use client'

import type { EmailConnection } from '@ansly/types'
import { CheckCircle2, Mail, ShieldCheck, Unplug } from 'lucide-react'
import clsx from 'clsx'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useConfirm } from '@/components/dialog'
import { Alert, Badge, Button, Card, CardHeader, ErrorText, Skeleton } from '@/components/ui'
import { disconnectEmail, getEmailConnection, startGmailConnect } from '@/lib/api'
import { errorMessage } from '@/lib/format'

export function useEmailConnection() {
  const [connection, setConnection] = useState<EmailConnection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    try {
      setConnection(await getEmailConnection())
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [])
  useEffect(() => void refresh(), [refresh])
  return { connection, error, refresh }
}

/** Sends the browser to Google; it comes back to /settings/email/callback. */
export async function connectGmail(returnTo?: string) {
  try {
    if (returnTo) sessionStorage.setItem('ansly:gmail-return', returnTo)
  } catch {
    // Storage blocked: the callback falls back to Settings.
  }
  try {
    const { authorization_url } = await startGmailConnect()
    window.location.assign(authorization_url)
  } catch (e) {
    toast.error(errorMessage(e))
  }
}

/** The Gmail "M" mark, to show which account sends the emails. */
export function GmailLogo({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={clsx('shrink-0', className)} aria-hidden>
      <path fill="#4caf50" d="M45 16.2l-5 2.75-5 4.75V40h7c1.657 0 3-1.343 3-3V16.2z" />
      <path fill="#1e88e5" d="M3 16.2l3.614 1.71L13 23.7V40H6c-1.657 0-3-1.343-3-3V16.2z" />
      <path fill="#e53935" d="M35 11.2l-11 8.25-11-8.25-1 5.8 1 6.7 11 8.25 11-8.25 1-6.7z" />
      <path fill="#c62828" d="M3 12.298V16.2l10 7.5V11.2L9.876 8.859A4.298 4.298 0 0 0 7.298 8C4.924 8 3 9.924 3 12.298z" />
      <path fill="#fbc02d" d="M45 12.298V16.2l-10 7.5V11.2l3.124-2.341A4.298 4.298 0 0 1 40.702 8C43.076 8 45 9.924 45 12.298z" />
    </svg>
  )
}

/** Compact Gmail status for page headers: connected account, or a button to connect / reconnect. */
export function GmailStatus({ returnTo, connection }: { returnTo: string; connection?: EmailConnection | null }) {
  const own = useEmailConnection()
  const value = connection === undefined ? own.connection : connection
  if (!value || !value.configured) return null
  if (value.connected && value.status === 'connected') {
    return (
      <Link
        href="/settings"
        title={`Emails are sent from ${value.email_address}. Manage in Settings.`}
        className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-1.5 text-body-sm text-fg transition hover:border-success/50"
      >
        <GmailLogo />
        <span className="font-medium">Gmail account connected</span>
        <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden />
        <span className="hidden truncate text-muted sm:inline">{value.email_address}</span>
      </Link>
    )
  }
  return (
    <Button size="sm" variant={value.connected ? 'primary' : 'secondary'} onClick={() => void connectGmail(returnTo)}>
      <GmailLogo />
      {value.connected ? 'Reconnect Gmail' : 'Connect Gmail'}
    </Button>
  )
}

export function EmailConnectionCard() {
  const { connection, error, refresh } = useEmailConnection()
  const [busy, setBusy] = useState(false)
  const [confirm, confirmDialog] = useConfirm()

  async function disconnect() {
    const ok = await confirm({
      title: 'Disconnect Gmail?',
      description: 'Ansly loses permission to send email from this account. Your drafts and sent history stay.',
      confirmLabel: 'Disconnect',
    })
    if (!ok) return
    setBusy(true)
    try {
      await disconnectEmail()
      toast.success('Gmail disconnected')
      await refresh()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      {confirmDialog}
      <CardHeader
        icon={Mail}
        title="Email sending"
        description="Send your Leads emails from your own Gmail account, only when you click Send."
      />
      <ErrorText>{error}</ErrorText>
      <div className="mt-5">
        {!connection && !error && <Skeleton className="h-16 w-full" />}
        {connection && !connection.configured && (
          <Alert tone="warning" title="Gmail sending isn’t set up on this Ansly server">
            The API needs GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and EMAIL_TOKEN_ENCRYPTION_KEY. You can
            still copy drafts and send them yourself.
          </Alert>
        )}
        {connection?.configured && !connection.connected && (
          <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-surface-muted/50 p-4">
            <div className="min-w-0 flex-1 space-y-1 text-body-sm">
              <p className="font-medium text-fg">Gmail isn’t connected</p>
              <p className="flex items-start gap-1.5 text-muted">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                Ansly asks only for permission to send email. It can’t read your inbox.
              </p>
            </div>
            <Button icon={Mail} onClick={() => void connectGmail()}>
              Connect Gmail
            </Button>
          </div>
        )}
        {connection?.connected && (
          <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-surface-muted/50 p-4">
            <GmailLogo className="h-8 w-8" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate font-medium">{connection.email_address}</p>
                {connection.status === 'connected' ? (
                  <Badge tone="success" dot>
                    Gmail account connected
                  </Badge>
                ) : (
                  <Badge tone="warning" dot>
                    Reconnect needed
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 text-caption text-muted">Permission: send email only. Ansly can’t read your inbox.</p>
            </div>
            <div className="flex gap-2">
              {connection.status === 'needs_reauth' && (
                <Button icon={Mail} onClick={() => void connectGmail()}>
                  Reconnect
                </Button>
              )}
              <Button variant="secondary" icon={Unplug} onClick={() => void disconnect()} loading={busy}>
                Disconnect
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
