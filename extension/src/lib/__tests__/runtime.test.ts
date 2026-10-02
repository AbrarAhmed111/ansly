import type { ExtensionSession } from '@ansly/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { apiRequest, type ApiDeps } from '../api'
import { API_URL } from '../config'
import { isOnScreen, popoverPosition, sparklePosition } from '../geometry'
import { getValidSession, isValidSession, needsRefresh, sessionItem } from '../session'
import { DEFAULT_SETTINGS, getSettings, migrateFromV1, settingsItem, sitesNoticeItem, updateSettings } from '../settings'
import { domainFromPattern, embeddedAtsDomains, siteDomain, sitePattern } from '../sites'

const session = (overrides: Partial<ExtensionSession> = {}): ExtensionSession => ({
  access_token: 'a'.repeat(40),
  refresh_token: 'refresh-1',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: 'u1', email: 'sam@example.com' },
  ...overrides,
})

const json = (status: number, body: unknown) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  fakeBrowser.reset()
  vi.unstubAllGlobals()
})

describe('apiRequest', () => {
  const deps = (fetchImpl: typeof fetch, current: ExtensionSession | null = session()): ApiDeps & { cleared: boolean } => {
    const d = {
      cleared: false,
      fetchImpl,
      getSession: vi.fn(async (force?: boolean) => (force ? (current ? session({ access_token: 'b'.repeat(40) }) : null) : current)),
      onUnauthorized: vi.fn(async () => {
        d.cleared = true
      }),
    }
    return d
  }

  it('sends the bearer token and returns data', async () => {
    const fetchImpl = vi.fn(async () => json(200, { status: 'answered' }))
    const result = await apiRequest(deps(fetchImpl), 'POST', '/api/v1/answers/generate', { question: 'Why?' })
    expect(result).toEqual({ ok: true, data: { status: 'answered' } })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${API_URL}/api/v1/answers/generate`)
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${'a'.repeat(40)}`)
    expect(init.body).toBe('{"question":"Why?"}')
  })

  it('refreshes once on 401 and retries', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(401, { detail: 'expired' })).mockResolvedValueOnce(json(200, { ok: 1 }))
    const d = deps(fetchImpl)
    expect(await apiRequest(d, 'GET', '/x')).toEqual({ ok: true, data: { ok: 1 } })
    expect(d.getSession).toHaveBeenLastCalledWith(true)
    const retried = fetchImpl.mock.calls[1] as unknown as [string, RequestInit]
    expect((retried[1].headers as Record<string, string>).Authorization).toBe(`Bearer ${'b'.repeat(40)}`)
  })

  it('reports not_connected without a session', async () => {
    const fetchImpl = vi.fn()
    const result = await apiRequest(deps(fetchImpl, null), 'GET', '/x')
    expect(result).toMatchObject({ ok: false, error: { code: 'not_connected' } })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('clears the session when the server keeps rejecting it', async () => {
    const d = deps(vi.fn(async () => json(401, {})))
    const result = await apiRequest(d, 'GET', '/x')
    expect(result).toMatchObject({ ok: false, error: { code: 'not_connected' } })
    expect(d.cleared).toBe(true)
  })

  it.each([
    [429, { detail: 'Daily limit reached' }, 'rate_limited', 'Daily limit reached'],
    [503, { detail: 'busy' }, 'unavailable', 'busy'],
    [422, { detail: [{ msg: 'question too short' }] }, 'bad_request', 'question too short'],
    [500, 'oops', 'server', 'Something went wrong (HTTP 500). Please try again.'],
  ])('maps HTTP %i to %s', async (status, body, code, message) => {
    const result = await apiRequest(deps(vi.fn(async () => json(status, body))), 'GET', '/x')
    expect(result).toEqual({ ok: false, error: { code, message } })
  })

  it('maps network failures', async () => {
    const result = await apiRequest(deps(vi.fn(async () => { throw new TypeError('Failed to fetch') })), 'GET', '/x')
    expect(result).toMatchObject({ ok: false, error: { code: 'network' } })
  })

  it('handles 204 No Content', async () => {
    expect(await apiRequest(deps(vi.fn(async () => json(204, null))), 'POST', '/api/v1/events', {})).toEqual({ ok: true, data: null })
  })
})

describe('session', () => {
  it('validates session shape', () => {
    expect(isValidSession(session())).toBe(true)
    expect(isValidSession({ ...session(), access_token: 'short' })).toBe(false)
    expect(isValidSession({ access_token: 'a'.repeat(40) })).toBe(false)
    expect(isValidSession(null)).toBe(false)
  })

  it('refreshes a minute before expiry', () => {
    const now = 1_000_000
    expect(needsRefresh(session({ expires_at: now + 30 }), now)).toBe(true)
    expect(needsRefresh(session({ expires_at: now + 3600 }), now)).toBe(false)
  })

  it('returns a fresh stored session without refreshing', async () => {
    await sessionItem.setValue(session())
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    expect((await getValidSession())?.refresh_token).toBe('refresh-1')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns null when not connected', async () => {
    expect(await getValidSession()).toBeNull()
  })
})

describe('settings', () => {
  it('defaults and updates', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS)
    const s = await updateSettings({ useJobDescription: true })
    expect(s.useJobDescription).toBe(true)
    expect(await getSettings()).toEqual({ ...DEFAULT_SETTINGS, useJobDescription: true })
  })

  it('migrates V1 settings once: drops disabledSites and shows the notice', async () => {
    await settingsItem.setValue({ ...DEFAULT_SETTINGS, analytics: false, disabledSites: ['example.com'] } as never)
    await migrateFromV1()
    expect(await settingsItem.getValue()).toEqual({ ...DEFAULT_SETTINGS, analytics: false })
    expect(await sitesNoticeItem.getValue()).toBe(true)
    // Dismissed notices stay dismissed on later updates.
    await sitesNoticeItem.setValue(false)
    await migrateFromV1()
    expect(await sitesNoticeItem.getValue()).toBe(false)
  })
})

describe('sites', () => {
  it('maps hostnames to registrable domains', () => {
    expect(siteDomain('jobs.lever.co')).toBe('lever.co')
    expect(siteDomain('www.linkedin.com')).toBe('linkedin.com')
    expect(siteDomain('careers.acme.co.uk')).toBe('acme.co.uk')
    expect(siteDomain('acme.wd5.myworkdayjobs.com')).toBe('myworkdayjobs.com')
    expect(siteDomain('localhost')).toBeNull()
    expect(siteDomain('127.0.0.1')).toBeNull()
  })

  it('round-trips site patterns and ignores other origins', () => {
    expect(sitePattern('lever.co')).toBe('https://*.lever.co/*')
    expect(domainFromPattern(sitePattern('lever.co'))).toBe('lever.co')
    expect(domainFromPattern('https://*/*')).toBeNull()
    expect(domainFromPattern('http://localhost/*')).toBeNull()
    expect(domainFromPattern('https://api.ansly.app/*')).toBeNull()
  })

  it('finds embedded ATS forms that are not enabled yet', () => {
    const frames = ['https://boards.greenhouse.io/embed/job_app?token=1', 'https://www.youtube.com/embed/x', 'about:blank', 'https://jobs.lever.co/acme']
    expect(embeddedAtsDomains(frames, ['lever.co'])).toEqual(['greenhouse.io'])
  })
})

describe('geometry', () => {
  const viewport = { width: 1000, height: 800 }

  it('places the popover below the field, or above when there is no room', () => {
    const field = { top: 100, left: 50, width: 400, height: 80 }
    expect(popoverPosition(field, { width: 420, height: 300 }, viewport)).toMatchObject({ placement: 'below', top: 186, left: 50 })
    const low = { top: 650, left: 50, width: 400, height: 80 }
    expect(popoverPosition(low, { width: 420, height: 300 }, viewport)).toMatchObject({ placement: 'above', top: 344 })
  })

  it('keeps the popover inside the viewport horizontally', () => {
    const field = { top: 100, left: 900, width: 90, height: 30 }
    expect(popoverPosition(field, { width: 420, height: 200 }, viewport).left).toBe(1000 - 420 - 8)
  })

  it('sparkle sits in the top-right corner of multi-line fields', () => {
    expect(sparklePosition({ top: 100, left: 50, width: 400, height: 80 }, true)).toEqual({ top: 104, left: 422 })
    expect(sparklePosition({ top: 100, left: 50, width: 400, height: 40 }, false)).toEqual({ top: 108, left: 422 })
  })

  it('detects off-screen fields', () => {
    expect(isOnScreen({ top: -100, left: 0, width: 100, height: 50 }, viewport)).toBe(false)
    expect(isOnScreen({ top: 10, left: 0, width: 0, height: 0 }, viewport)).toBe(false)
    expect(isOnScreen({ top: 10, left: 10, width: 100, height: 50 }, viewport)).toBe(true)
  })
})
