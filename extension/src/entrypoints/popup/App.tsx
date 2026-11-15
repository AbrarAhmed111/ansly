import type { AnswerLength, AnswerTone } from '@ansly/types'
import { useEffect, useState } from 'react'
import { collectInBatches, leadsPath, type CollectionProgress, type CollectionResult } from '@/lib/leads/collect'
import { isLinkedInPostSearchUrl, type LinkedInPostPreview } from '@/lib/leads/linkedin-posts'
import { send, type ConnectionState } from '@/lib/messages'
import type { ProfileSummary } from '@/lib/profile-summary'
import { getSettings, updateSettings, type Settings, type Theme } from '@/lib/settings'
import { LENGTHS, TONES } from '@/lib/style'
import { getStatus, type ExtensionStatus, type StatusCheck } from '@/lib/status'
import { buildLabel, diskBuild, isUnpacked, reloadExtension, RUNNING_BUILD } from '@/lib/update'
import { Brand, Icon, IconTile } from '@/components/brand'
import { Sites } from './Sites'

const LABELS: Record<StatusCheck['status'], string> = {
  ok: 'Connected',
  error: 'Unreachable',
  not_configured: 'Not configured',
}

/** Collects the sanitized detection report from every frame of the active tab and copies it. */
async function copyDiagnostics(): Promise<string> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  if (tab?.id == null) return 'No page'
  try {
    const results = await browser.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      // Runs in the content script's world, where it exposes the report.
      func: () => {
        const report = (window as unknown as Record<symbol, (() => unknown) | undefined>)[Symbol.for('ansly.diagnostics')]
        return report ? report() : null
      },
    })
    const frames = results.map((r) => r.result).filter(Boolean)
    if (!frames.length) return 'Not running here'
    await navigator.clipboard.writeText(JSON.stringify({ version: browser.runtime.getManifest().version, frames }, null, 2))
    return 'Copied'
  } catch {
    return "Can't read this page"
  }
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

/** Initials for the profile avatar: "Ada Lovelace" -> "AL", "ada@x.com" -> "A". */
function initials(name: string | null | undefined): string {
  const words = (name ?? '').replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean)
  return (words.length > 1 ? words[0]![0]! + words[words.length - 1]![0]! : words[0]?.[0] ?? 'A').toUpperCase()
}

export default function App() {
  const [connection, setConnection] = useState<ConnectionState | null>(null)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [summary, setSummary] = useState<ProfileSummary | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [shortcut, setShortcut] = useState<string | null>(null)
  const [status, setStatus] = useState<ExtensionStatus | null>(null)
  const [showStatus, setShowStatus] = useState(false)
  const [diagnosticsNote, setDiagnosticsNote] = useState<string | null>(null)
  const [activeTabUrl, setActiveTabUrl] = useState('')
  const [collection, setCollection] = useState<CollectionResult | null>(null)
  const [collecting, setCollecting] = useState<CollectionProgress | null>(null)
  const [collectionError, setCollectionError] = useState<string | null>(null)

  const loadConnection = () => {
    setConnectionError(null)
    void send('getConnection', null).then((r) => {
      if (!r.ok) return setConnectionError(r.error.message)
      setConnection(r.data)
      if (r.data.connected) void send('getProfileSummary', null).then((s) => s.ok && setSummary(s.data))
    })
  }

  useEffect(() => {
    loadConnection()
    void getSettings().then(setSettings)
    void browser.commands.getAll().then((commands) => {
      setShortcut(commands.find((c) => c.name === 'generate-answer')?.shortcut || null)
    })
    void browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => setActiveTabUrl(tab?.url ?? ''))
  }, [])

  // The popup follows the theme chosen in settings, like the in-page UI.
  useEffect(() => {
    if (settings) document.documentElement.dataset.theme = settings.theme
  }, [settings?.theme])

  useEffect(() => {
    if (showStatus && !status) void getStatus().then(setStatus)
  }, [showStatus, status])

  const patch = async (p: Partial<Settings>) => setSettings(await updateSettings(p))

  const collectLinkedInPosts = async () => {
    setCollectionError(null)
    setCollection(null)
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
      if (tab?.id == null || !tab.url || !isLinkedInPostSearchUrl(tab.url)) {
        throw new Error('Open a LinkedIn post-search results page first.')
      }
      if (!(await browser.permissions.contains({ origins: ['https://*.linkedin.com/*'] }))) {
        throw new Error('Enable LinkedIn under Sites, then reload the search page.')
      }
      const response = await browser.tabs.sendMessage(
        tab.id,
        { ansly: true, type: 'collectLinkedInPosts' },
        { frameId: 0 },
      )
      if (!response?.ok) throw new Error(response?.message ?? 'Could not read the loaded posts.')
      const preview = response.data as LinkedInPostPreview
      if (preview.candidates.length === 0) {
        throw new Error('No posts are loaded yet. Scroll the results, then try again.')
      }
      setCollection(await collectInBatches(preview.candidates, setCollecting))
    } catch (error) {
      setCollectionError(error instanceof Error ? error.message : 'Could not collect the loaded posts.')
    } finally {
      setCollecting(null)
    }
  }

  const onLinkedInPostSearch = isLinkedInPostSearchUrl(activeTabUrl)
  const connected = connection?.connected === true

  return (
    <main>
      <header className="top">
        <Brand size={22} />
        <span className="top-meta">
          {connection && (
            <span className={`badge ${connected ? 't-success' : 't-neutral'}`}>
              <span className="dot" />
              {connected ? 'Connected' : 'Signed out'}
            </span>
          )}
          {connection && <span className="version">v{connection.version}</span>}
        </span>
      </header>

      <UpdateCard />

      {connectionError ? (
        <section className="card account" role="alert">
          <div className="card-head">
            <IconTile icon="alert" tone="danger" />
            <div className="card-head-text">
              <h2>Ansly couldn’t start</h2>
              <p className="muted">{connectionError}</p>
            </div>
          </div>
          <button className="btn" onClick={loadConnection}>Try again</button>
        </section>
      ) : !connection ? (
        <section className="card account" aria-busy="true" aria-label="Loading">
          <div className="card-head">
            <span className="skeleton avatar" />
            <div className="card-head-text skeleton-lines">
              <span className="skeleton" />
              <span className="skeleton short" />
            </div>
          </div>
          <span className="sr-only">Loading…</span>
        </section>
      ) : connected ? (
        <section className="card account">
          <div className="card-head">
            <span className="avatar" aria-hidden="true">{initials(summary?.name ?? connection.email)}</span>
            <div className="card-head-text">
              <h2 className="truncate">{summary?.name ?? connection.email ?? 'Your profile'}</h2>
              <p className="muted truncate">{summary?.name && connection.email ? connection.email : 'Ansly is ready'}</p>
            </div>
          </div>
          <div className="meter-row">
            <span className="muted">Profile completeness</span>
            <strong>{summary ? `${summary.completeness}%` : '…'}</strong>
          </div>
          <div
            className="meter"
            role="progressbar"
            aria-label="Profile completeness"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={summary?.completeness ?? 0}
          >
            <span style={{ width: `${summary?.completeness ?? 0}%` }} />
          </div>
          {summary && summary.completeness < 100 && (
            <button className="link with-icon" onClick={() => void send('openWebApp', { path: '/dashboard' })}>
              Improve your profile
              <Icon name="arrowUpRight" size={14} />
            </button>
          )}
        </section>
      ) : (
        <section className="card account hero">
          <IconTile icon="plug" tone="accent" />
          <h2>Connect your Ansly account</h2>
          <p className="muted">
            Ansly answers application questions from your profile. Connect once and it works on every site you enable.
          </p>
          <button className="btn primary block-btn" onClick={() => void send('openWebApp', { path: '/extension' })}>
            Connect Ansly
          </button>
        </section>
      )}

      {onLinkedInPostSearch && (
        <section className="card leads" aria-label="LinkedIn leads">
          <div className="card-head">
            <IconTile icon="inbox" tone={collection ? 'success' : 'accent'} />
            <div className="card-head-text">
              <h2>{collection ? 'Leads collected' : 'LinkedIn post search'}</h2>
              <p className="muted">
                {collection
                  ? `${collection.detected} posts checked against your profile.`
                  : 'The Ansly panel on the page counts posts as you scroll. Collect from there or here.'}
              </p>
            </div>
          </div>

          {collecting && (
            <div className="progress" aria-live="polite">
              <div className="progress-head">
                <span className="spinner" aria-hidden="true" />
                <span>Matching… {collecting.done} of {collecting.total}</span>
                <span className="muted num">
                  {collecting.total ? Math.round((collecting.done / collecting.total) * 100) : 0}%
                </span>
              </div>
              <div className="meter" role="progressbar" aria-label="Collection progress" aria-valuemin={0} aria-valuemax={100}
                aria-valuenow={collecting.total ? Math.round((collecting.done / collecting.total) * 100) : 0}>
                <span style={{ width: `${Math.max(4, collecting.total ? (collecting.done / collecting.total) * 100 : 0)}%` }} />
              </div>
            </div>
          )}

          {collectionError && (
            <p role="alert" className="alert t-danger">
              <Icon name="alert" size={15} />
              <span>{collectionError}</span>
            </p>
          )}

          {collection && (
            <>
              <div className="stat-tiles">
                <div className="stat">
                  <b>{collection.detected}</b>
                  <span>posts detected</span>
                </div>
                <div className="stat t-success">
                  <b>{collection.saved}</b>
                  <span>new lead{collection.saved === 1 ? '' : 's'}</span>
                </div>
              </div>
              <dl className="stats">
                <dt>With email</dt>
                <dd>{collection.withEmail}</dd>
                <dt>With apply link</dt>
                <dd>{collection.withLink}</dd>
                <dt>Already in your leads</dt>
                <dd>{collection.duplicates}</dd>
                <dt>Filtered (profile/contact)</dt>
                <dd>{collection.filtered}</dd>
                {collection.unidentified > 0 && (
                  <>
                    <dt>Couldn’t identify post</dt>
                    <dd>{collection.unidentified}</dd>
                  </>
                )}
                {collection.failed > 0 && (
                  <>
                    <dt>Couldn’t process</dt>
                    <dd>{collection.failed}</dd>
                  </>
                )}
              </dl>
            </>
          )}

          <div className="actions">
            {collection && (
              <button className="btn primary" onClick={() => void send('openWebApp', { path: leadsPath(collection) })}>
                Open dashboard
              </button>
            )}
            <button
              className={`btn ${collection ? '' : 'primary'}`}
              disabled={Boolean(collecting)}
              onClick={() => void collectLinkedInPosts()}
            >
              {collecting ? 'Collecting…' : collection ? 'Collect again' : collectionError ? 'Try again' : 'Collect Info'}
            </button>
          </div>
        </section>
      )}

      <Sites />

      {settings && (
        <>
          <h3 className="overline">General</h3>
          <section className="settings">
            <Toggle
              label="Show Ansly on enabled sites"
              help="Pause Ansly everywhere without removing your sites."
              checked={settings.enabled}
              onChange={(v) => void patch({ enabled: v })}
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
              <button className="kbd" onClick={() => void browser.tabs.create({ url: extensionShortcutsUrl() })} title="Change the shortcut">
                {shortcut ?? 'Not set'}
              </button>
            </div>
          </section>

          <h3 className="overline">Answers</h3>
          <section className="settings">
            <label className="row">
              <span>Default length</span>
              <select value={settings.defaultLength} onChange={(e) => void patch({ defaultLength: e.target.value as AnswerLength })}>
                <option value="auto">Auto</option>
                {LENGTHS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </label>
            <label className="row">
              <span>Default tone</span>
              <select value={settings.defaultTone} onChange={(e) => void patch({ defaultTone: e.target.value as AnswerTone })}>
                {TONES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            <Toggle
              label="Use job descriptions"
              help="Send the job description with every question for more role-specific answers. Cover letters always use it."
              checked={settings.useJobDescription}
              onChange={(v) => void patch({ useJobDescription: v })}
            />
            <Toggle
              label="Review answers before filling"
              help="Fill all shows every answer in the panel first, with one confirm."
              checked={settings.reviewBeforeFill}
              onChange={(v) => void patch({ reviewBeforeFill: v })}
            />
            <Toggle
              label="Overwrite fields that already have text"
              help="Fill all skips fields you've already filled unless this is on."
              checked={settings.overwriteFilled}
              onChange={(v) => void patch({ overwriteFilled: v })}
            />
            <Toggle
              label="Offer resume tailoring on job pages"
              help="Show a small “Tailor resume” pill on job postings. The job is only read when you click it."
              checked={settings.offerTailoring}
              onChange={(v) => void patch({ offerTailoring: v })}
            />
          </section>

          <h3 className="overline">Advanced</h3>
          <section className="settings">
            <Toggle
              label="Usage analytics"
              help="Count fills and saved-answer reuse (never the text)."
              checked={settings.analytics}
              onChange={(v) => void patch({ analytics: v })}
            />
            <Toggle
              label="Detection debug"
              help="Outline every field: green = detected, grey = ignored (hover the label for why)."
              checked={settings.detectionDebug}
              onChange={(v) => void patch({ detectionDebug: v })}
            />
            {settings.detectionDebug && (
              <div className="row">
                <span>
                  Copy diagnostics
                  <small>Field structure only, never what you typed.</small>
                </span>
                <button className="link" onClick={() => void copyDiagnostics().then(setDiagnosticsNote)}>
                  {diagnosticsNote ?? 'Copy'}
                </button>
              </div>
            )}
          </section>
        </>
      )}

      <footer>
        <button className="link quiet" onClick={() => setShowStatus((s) => !s)} aria-expanded={showStatus}>
          {showStatus ? 'Hide status' : 'System status'}
        </button>
        <button className="link quiet" onClick={() => void send('openWebApp', { path: '/privacy' })}>Privacy</button>
        {connected && (
          <button className="link danger" onClick={() => void send('disconnect', null).then((r) => r.ok && setConnection(r.data))}>
            Disconnect
          </button>
        )}
      </footer>

      {showStatus && (
        <ul className="status">
          {!status ? (
            <li className="muted"><span className="spinner small" aria-hidden="true" /> Checking…</li>
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

/**
 * Unpacked installs only: after a new build lands in the extension folder, one click reloads it.
 * The extension ID stays the same, so settings, the Ansly sign-in and enabled sites are kept.
 */
function UpdateCard() {
  const [state, setState] = useState<{ unpacked: boolean; disk: string | null } | null>(null)

  useEffect(() => {
    void Promise.all([isUnpacked(), diskBuild()]).then(([unpacked, disk]) => setState({ unpacked, disk }))
  }, [])

  if (!state?.unpacked) return null
  const newer = state.disk !== null && RUNNING_BUILD !== 'dev' && state.disk !== RUNNING_BUILD

  if (!newer) {
    return (
      <p className="build-line">
        <span className="muted">Build {RUNNING_BUILD === 'dev' ? 'dev' : buildLabel(RUNNING_BUILD)}</span>
        <button className="link quiet with-icon" onClick={reloadExtension} title="Reload the extension from its folder">
          <Icon name="refresh" size={12} />
          Reload
        </button>
      </p>
    )
  }
  return (
    <section className="card update-card" role="status">
      <div className="card-head">
        <IconTile icon="refresh" tone="accent" />
        <div className="card-head-text">
          <h2>New build ready</h2>
          <p className="muted">
            Built {buildLabel(state.disk!)}. Reloading keeps your settings and sign-in. Refresh open pages afterwards.
          </p>
        </div>
      </div>
      <button className="btn primary block-btn" onClick={reloadExtension}>
        Reload to update
      </button>
    </section>
  )
}
