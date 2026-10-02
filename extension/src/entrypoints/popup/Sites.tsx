import { useCallback, useEffect, useState } from 'react'
import { send } from '@/lib/messages'
import { sitesNoticeItem } from '@/lib/settings'
import {
  ATS_DOMAINS,
  canEnable,
  embeddedAtsDomains,
  enabledSites,
  injectIntoTab,
  removeSite,
  requestSite,
  siteDomain,
} from '@/lib/sites'

interface ActiveTab {
  id: number
  domain: string
}

async function getActiveTab(): Promise<ActiveTab | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  try {
    const url = tab?.url ? new URL(tab.url) : null
    if (tab?.id == null || !url || !/^https?:$/.test(url.protocol)) return null
    const domain = siteDomain(url.hostname)
    return domain ? { id: tab.id, domain } : null
  } catch {
    return null // Not a web page.
  }
}

/** iframe URLs in the tab's top frame (activeTab is granted while the popup is open). */
async function frameUrls(tabId: number): Promise<string[]> {
  try {
    const [result] = await browser.scripting.executeScript({
      target: { tabId },
      func: () => Array.from(document.querySelectorAll('iframe'), (f) => f.src),
    })
    return (result?.result as string[] | undefined) ?? []
  } catch {
    return []
  }
}

/** Per-site enablement: Ansly does nothing on a site until the user turns it on here. */
export function Sites() {
  const [tab, setTab] = useState<ActiveTab | null>(null)
  const [sites, setSites] = useState<string[] | null>(null)
  const [embedded, setEmbedded] = useState<string[]>([])
  const [notice, setNotice] = useState(false)
  const [scanned, setScanned] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => setSites(await enabledSites()), [])

  useEffect(() => {
    void refresh()
    void getActiveTab().then(setTab)
    void sitesNoticeItem.getValue().then((v) => setNotice(v === true))
  }, [refresh])

  useEffect(() => {
    if (tab && sites) void frameUrls(tab.id).then((urls) => setEmbedded(embeddedAtsDomains(urls, sites)))
  }, [tab, sites])

  // Must be called straight from a click: permissions.request needs the user gesture.
  const enable = async (domain: string) => {
    setError(null)
    try {
      if (!(await requestSite(domain))) return
      const r = await send('enableSite', { domain })
      if (!r.ok) setError(r.error.message)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    await refresh()
  }

  const remove = async (domain: string) => {
    setError(null)
    try {
      await removeSite(domain)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    await refresh()
  }

  const scan = async () => {
    if (!tab) return
    setError(null)
    try {
      await injectIntoTab(tab.id)
      setScanned(true)
    } catch (e) {
      setError(`Ansly can't run on this page. (${e instanceof Error ? e.message : e})`)
    }
  }

  const dismissNotice = () => {
    setNotice(false)
    void sitesNoticeItem.setValue(false)
  }

  if (!sites) return null
  const here = tab && canEnable(tab.domain) ? tab.domain : null
  const enabledHere = Boolean(here && sites.includes(here))
  const chips = ATS_DOMAINS.filter((d) => !sites.includes(d))

  return (
    <>
      {notice && (
        <section className="card notice">
          <p>
            <strong>Ansly now runs only on sites you choose.</strong> Turn it on for the job sites you use — or scan any
            page once.
          </p>
          <button className="link" onClick={dismissNotice}>Got it</button>
        </section>
      )}

      <section className="card sites">
        {here && (
          <div className="site-here">
            {enabledHere ? (
              <p className="ready">On for {here}</p>
            ) : (
              <>
                <p className="muted">Ansly is off on {here}.</p>
                <div className="actions">
                  <button className="btn" onClick={() => void scan()} disabled={scanned}>
                    {scanned ? 'Scanned' : 'Scan this page'}
                  </button>
                  <button className="btn primary" onClick={() => void enable(here)}>
                    Always run on {here}
                  </button>
                </div>
                {scanned && <small className="muted">Ansly is active until you leave this page.</small>}
              </>
            )}
          </div>
        )}

        {embedded.map((d) => (
          <div key={d} className="embedded">
            <span>This form is hosted by {d} — enable it too?</span>
            <button className="link" onClick={() => void enable(d)}>Enable</button>
          </div>
        ))}

        <h2>Enabled sites</h2>
        {sites.length === 0 ? (
          <p className="muted">None yet.</p>
        ) : (
          <ul className="site-list">
            {sites.map((d) => (
              <li key={d}>
                <span>{d}</span>
                <button className="remove" aria-label={`Remove ${d}`} title={`Remove ${d}`} onClick={() => void remove(d)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        {chips.length > 0 && (
          <div className="chips" aria-label="Quick enable">
            {chips.map((d) => (
              <button key={d} className="chip" onClick={() => void enable(d)}>
                + {d}
              </button>
            ))}
          </div>
        )}

        {error && <p className="error">{error}</p>}
      </section>
    </>
  )
}
