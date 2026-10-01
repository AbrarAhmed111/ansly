/**
 * The extension's own Supabase session: stored in extension-local storage,
 * refreshed shortly before it expires. Only the background uses this.
 */

import type { ExtensionSession } from '@ansly/types'
import { storage } from 'wxt/utils/storage'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config'

export const sessionItem = storage.defineItem<ExtensionSession | null>('local:session', { fallback: null })

const REFRESH_MARGIN_SECONDS = 60

export class SessionExpiredError extends Error {}

export function isValidSession(value: unknown): value is ExtensionSession {
  const s = value as ExtensionSession
  return (
    typeof s === 'object' && s !== null &&
    typeof s.access_token === 'string' && s.access_token.length > 20 &&
    typeof s.refresh_token === 'string' && s.refresh_token.length > 0 &&
    typeof s.expires_at === 'number' &&
    typeof s.user === 'object' && s.user !== null && typeof s.user.id === 'string'
  )
}

export function needsRefresh(session: ExtensionSession, nowSeconds = Date.now() / 1000): boolean {
  return session.expires_at - nowSeconds < REFRESH_MARGIN_SECONDS
}

/** Exchanges a refresh token for a new session (Supabase rotates refresh tokens). */
export async function refreshSession(
  session: ExtensionSession,
  fetchImpl: typeof fetch = fetch,
): Promise<ExtensionSession> {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) throw new SessionExpiredError('Supabase is not configured in the extension')
  let response: Response
  try {
    response = await fetchImpl(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    })
  } catch (e) {
    // Offline: keep the session; the caller reports a network error.
    throw new TypeError(`Network error refreshing session: ${e instanceof Error ? e.message : e}`)
  }
  if (!response.ok) throw new SessionExpiredError(`Session refresh failed (${response.status})`)
  const data = await response.json()
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at ?? Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600),
    user: { id: data.user?.id ?? session.user.id, email: data.user?.email ?? session.user.email },
  }
}

let inflight: Promise<ExtensionSession | null> | null = null

/** A usable session, refreshed if needed. Null when not connected or the session was revoked. */
export async function getValidSession(force = false): Promise<ExtensionSession | null> {
  const session = await sessionItem.getValue()
  if (!session) return null
  if (!force && !needsRefresh(session)) return session
  // Concurrent callers share one refresh: a rotated refresh token can only be used once.
  inflight ??= (async () => {
    try {
      const fresh = await refreshSession(session)
      await sessionItem.setValue(fresh)
      return fresh
    } catch (e) {
      if (e instanceof SessionExpiredError) {
        await sessionItem.setValue(null)
        return null
      }
      throw e
    } finally {
      inflight = null
    }
  })()
  return inflight
}
