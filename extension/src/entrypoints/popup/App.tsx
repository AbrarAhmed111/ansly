import { useEffect, useState } from 'react'
import { send, type ConnectionState } from '@/lib/messages'
import type { ProfileSummary } from '@/lib/profile-summary'
import { getSettings, updateSettings, type Settings, type Theme } from '@/lib/settings'
import { getStatus, type ExtensionStatus, type StatusCheck } from '@/lib/status'

const LABELS: Record<StatusCheck['status'], string> = {
  ok: 'Connected',
  error: 'Unreachable',
  not_configured: 'Not configured',
}

const extensionShortcutsUrl = () => (/\bEdg\//.test(navigator.userAgent) ? 'edge://extensions/shortcuts' : 'chrome://extensions/shortcuts')

function Toggle({ label, help, checked, onChange, disabled }: {
  label: string
  help?: string
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className={`toggle ${disabled ? 'disabled' : ''}`}>
      <span>
        {label}
        {help && <small>{help}</small>}
      </span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

export default function App() {
  const [connection, setConnection] = useState<ConnectionState | null>(null)
  const [summary, setSummary] = useState<ProfileSummary | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [hostname, setHostname] = useState<string | null>(null)
  const [shortcut, setShortcut] = useState<string | null>(null)
  const [status, setStatus] = useState<ExtensionStatus | null>(null)
  const [showStatus, setShowStatus] = useState(false)

  useEffect(() => {
    void send('getConnection', null).then((r) => {
      if (!r.ok) return
      setConnection(r.data)
      if (r.data.connected) void send('getProfileSummary', null).then((s) => s.ok && setSummary(s.data))
    })
    void getSettings().then(setSettings)
    void browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      try {
        const url = tab?.url ? new URL(tab.url) : null
        if (url && /^https?:$/.test(url.protocol)) setHostname(url.hostname)
      } catch {
        // Not a web page.
      }
    })
    void browser.commands.getAll().then((commands) => {
      setShortcut(commands.find((c) => c.name === 'generate-answer')?.shortcut || null)
    })
  }, [])

  useEffect(() => {
    if (showStatus && !status) void getStatus().then(setStatus)
  }, [showStatus, status])

  const patch = async (p: Partial<Settings>) => setSettings(await updateSettings(p))
  const siteDisabled = Boolean(hostname && settings?.disabledSites.includes(hostname))

  return (
    <main>
      <header>
        <div className="brand">
          <img src="/icon/32.png" alt="" />
          <h1>Ansly</h1>
        </div>
        {connection && <span className="version">v{connection.version}</span>}
      </header>

      <section className="card">
        {!connection ? (
          <p className="muted">Loading…</p>
        ) : connection.connected ? (
          <>
            <p className="ready">Ansly is ready</p>
            <dl>
              <dt>Your profile</dt>
              <dd>{summary?.name ?? connection.email ?? '—'}</dd>
              <dt>Profile completeness</dt>
              <dd>{summary ? `${summary.completeness}%` : '…'}</dd>
            </dl>
            {summary && summary.completeness < 100 && (
              <button className="link" onClick={() => void send('openWebApp', { path: '/dashboard' })}>
                Improve your profile →
              </button>
            )}
          </>
        ) : (
          <>
            <p>Connect Ansly to your account to answer application questions from your profile.</p>
            <button className="btn primary" onClick={() => void send('openWebApp', { path: '/extension' })}>
              Connect Ansly
            </button>
          </>
        )}
      </section>

      {settings && (
        <section className="settings">
          <Toggle label="Show Ansly on application forms" checked={settings.enabled} onChange={(v) => void patch({ enabled: v })} />
          {hostname && (
            <Toggle
              label={`Turn off on ${hostname}`}
              checked={siteDisabled}
              disabled={!settings.enabled}
              onChange={(v) =>
                void patch({
                  disabledSites: v
                    ? [...settings.disabledSites, hostname]
                    : settings.disabledSites.filter((h) => h !== hostname),
                })
              }
            />
          )}
          <Toggle
            label="Use job descriptions"
            help="Send the job description with questions for more role-specific answers."
            checked={settings.useJobDescription}
            onChange={(v) => void patch({ useJobDescription: v })}
          />
          <Toggle
            label="Usage analytics"
            help="Count fills and saved-answer reuse (never the text)."
            checked={settings.analytics}
            onChange={(v) => void patch({ analytics: v })}
          />
          <label className="row">
            <span>Theme</span>
            <select value={settings.theme} onChange={(e) => void patch({ theme: e.target.value as Theme })}>
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <div className="row">
            <span>Keyboard shortcut</span>
            <button className="link" onClick={() => void browser.tabs.create({ url: extensionShortcutsUrl() })}>
              {shortcut ?? 'Not set'}
            </button>
          </div>
        </section>
      )}

      <footer>
        <button className="link" onClick={() => setShowStatus((s) => !s)}>
          {showStatus ? 'Hide' : 'System status'}
        </button>
        <button className="link" onClick={() => void send('openWebApp', { path: '/privacy' })}>Privacy</button>
        {connection?.connected && (
          <button className="link danger" onClick={() => void send('disconnect', null).then((r) => r.ok && setConnection(r.data))}>
            Disconnect
          </button>
        )}
      </footer>

      {showStatus && (
        <ul className="status">
          {!status ? (
            <li className="muted">Checking…</li>
          ) : (
            <>
              <li><span>Extension → Supabase</span><span className={`s-${status.supabase.status}`} title={status.supabase.detail}>{LABELS[status.supabase.status]}</span></li>
              <li><span>Extension → API</span><span className={`s-${status.api.status}`} title={status.api.detail}>{LABELS[status.api.status]}</span></li>
              {status.apiSupabase && (
                <li><span>API → Supabase</span><span className={`s-${status.apiSupabase.status}`}>{LABELS[status.apiSupabase.status]}</span></li>
              )}
            </>
          )}
        </ul>
      )}
    </main>
  )
}
