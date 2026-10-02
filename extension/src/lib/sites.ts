/**
 * Per-site enablement. Ansly runs nowhere by default: the user grants an
 * optional host permission for a site, and the background registers the
 * content script for it. Granted permissions + registered scripts are the
 * source of truth; there is no separate stored list to drift out of sync.
 */

import { getDomain } from 'tldts'
import { WEB_URL } from './config'

/** Bundle path of entrypoints/content (registration: 'runtime'). */
export const CONTENT_SCRIPT = '/content-scripts/content.js'

const SCRIPT_PREFIX = 'ansly-'

/** Common ATS domains offered as quick-enable chips (never enabled by default). */
export const ATS_DOMAINS = [
  'linkedin.com',
  'indeed.com',
  'greenhouse.io',
  'lever.co',
  'ashbyhq.com',
  'myworkdayjobs.com',
  'smartrecruiters.com',
  'workable.com',
]

/** "jobs.lever.co" -> "lever.co". Null for IPs, localhost and non-web URLs. */
export function siteDomain(hostname: string): string | null {
  return getDomain(hostname, { allowPrivateDomains: false }) || null
}

/** Matches the domain and all of its subdomains. */
export const sitePattern = (domain: string) => `https://*.${domain}/*`

/** Inverse of sitePattern; null for any other pattern (e.g. the required API hosts). */
export function domainFromPattern(pattern: string): string | null {
  const m = /^https:\/\/\*\.([^/*]+)\/\*$/.exec(pattern)
  return m?.[1] ?? null
}

const scriptId = (domain: string) => `${SCRIPT_PREFIX}${domain}`

const WEB_DOMAIN = (() => {
  try {
    return siteDomain(new URL(WEB_URL).hostname)
  } catch {
    return null
  }
})()

/** The Ansly web app is never a target: its own forms are the profile. */
export const canEnable = (domain: string) => domain !== WEB_DOMAIN

/** Host permissions the manifest always holds (API, Supabase); not user sites. */
function requiredOrigins(): Set<string> {
  const manifest = browser.runtime.getManifest()
  // MV2 (Firefox) lists required hosts under `permissions`.
  return new Set<string>([...(manifest.host_permissions ?? []), ...((manifest.permissions ?? []) as string[])])
}

/** Domains the user has enabled, sorted. */
export async function enabledSites(): Promise<string[]> {
  const required = requiredOrigins()
  const { origins = [] } = await browser.permissions.getAll()
  const domains = origins.filter((o) => !required.has(o)).map(domainFromPattern)
  return [...new Set(domains.filter((d): d is string => d !== null))].sort()
}

/** Asks for the site's host permission. Must run inside a user gesture (popup click). */
export async function requestSite(domain: string): Promise<boolean> {
  if (!canEnable(domain)) return false
  return browser.permissions.request({ origins: [sitePattern(domain)] })
}

/** Registers the content script for a domain. Idempotent. */
export async function registerSite(domain: string): Promise<void> {
  const id = scriptId(domain)
  const existing = await browser.scripting.getRegisteredContentScripts({ ids: [id] })
  if (existing.length) return
  try {
    await browser.scripting.registerContentScripts([
      {
        id,
        matches: [sitePattern(domain)],
        js: [CONTENT_SCRIPT],
        allFrames: true,
        matchOriginAsFallback: true,
        runAt: 'document_idle',
        persistAcrossSessions: true,
      },
    ])
  } catch (e) {
    // A concurrent call (permission listener + popup) registered it first.
    if (!(await browser.scripting.getRegisteredContentScripts({ ids: [id] })).length) throw e
  }
}

export async function unregisterSite(domain: string): Promise<void> {
  const id = scriptId(domain)
  if ((await browser.scripting.getRegisteredContentScripts({ ids: [id] })).length) {
    await browser.scripting.unregisterContentScripts({ ids: [id] })
  }
}

/** Unregisters the script and gives the permission back. */
export async function removeSite(domain: string): Promise<void> {
  await unregisterSite(domain)
  await browser.permissions.remove({ origins: [sitePattern(domain)] })
}

/** Runs the content script in a tab now (one-time scan, or right after enabling). */
export async function injectIntoTab(tabId: number): Promise<void> {
  await browser.scripting.executeScript({ target: { tabId, allFrames: true }, files: [CONTENT_SCRIPT] })
}

/** Injects into already-open tabs of a newly enabled site so no reload is needed. */
export async function injectIntoOpenTabs(domain: string): Promise<void> {
  const tabs = await browser.tabs.query({ url: sitePattern(domain) })
  await Promise.all(tabs.map((t) => (t.id == null ? undefined : injectIntoTab(t.id).catch(() => undefined))))
}

/** Makes registered scripts match granted permissions (startup, update, revoked in chrome://extensions). */
export async function reconcileSites(): Promise<void> {
  const enabled = new Set(await enabledSites())
  const registered = await browser.scripting.getRegisteredContentScripts()
  for (const script of registered) {
    if (!script.id.startsWith(SCRIPT_PREFIX)) continue
    const domain = script.id.slice(SCRIPT_PREFIX.length)
    if (!enabled.has(domain)) await browser.scripting.unregisterContentScripts({ ids: [script.id] })
  }
  for (const domain of enabled) await registerSite(domain)
}

/** Domains in a permission change event that are user sites. */
export function sitesIn(origins: string[] | undefined): string[] {
  const required = requiredOrigins()
  return (origins ?? []).filter((o) => !required.has(o)).map(domainFromPattern).filter((d): d is string => d !== null)
}

/** Known ATS domains embedded as iframes in the given frame URLs that aren't enabled yet. */
export function embeddedAtsDomains(frameUrls: string[], enabled: string[]): string[] {
  const found = new Set<string>()
  for (const url of frameUrls) {
    try {
      const domain = siteDomain(new URL(url).hostname)
      if (domain && ATS_DOMAINS.includes(domain) && !enabled.includes(domain)) found.add(domain)
    } catch {
      // about:blank, javascript:, etc.
    }
  }
  return [...found]
}
