/**
 * Ansly API client. Runs in the background service worker, which holds the
 * session and the host permission for the API (so no CORS is involved).
 */

import type { ExtensionSession } from '@ansly/types'
import { API_URL } from './config'
import type { ApiFailure, ErrorCode, Result } from './messages'

const TIMEOUT_MS = 60_000

export interface ApiDeps {
  getSession: (force?: boolean) => Promise<ExtensionSession | null>
  onUnauthorized: () => Promise<void>
  fetchImpl?: typeof fetch
}

const fail = (code: ErrorCode, message: string): { ok: false; error: ApiFailure } => ({ ok: false, error: { code, message } })

async function detail(response: Response): Promise<string | null> {
  try {
    const body = await response.json()
    if (typeof body?.detail === 'string') return body.detail
    if (Array.isArray(body?.detail)) return body.detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join('; ')
  } catch {
    // Not JSON.
  }
  return null
}

export async function apiRequest<T>(
  deps: ApiDeps,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<Result<T>> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const call = async (session: ExtensionSession) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      return await fetchImpl(`${API_URL}${path}`, {
        method,
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
  }

  let session: ExtensionSession | null
  try {
    session = await deps.getSession()
  } catch {
    return fail('network', "Can't reach Ansly. Check your internet connection and try again.")
  }
  if (!session) return fail('not_connected', 'Connect Ansly to your account to generate answers.')

  let response: Response
  try {
    response = await call(session)
    if (response.status === 401) {
      // The token may have been revoked or rotated elsewhere: refresh once and retry.
      session = await deps.getSession(true)
      if (!session) {
        await deps.onUnauthorized()
        return fail('not_connected', 'Your Ansly session ended. Reconnect the extension to continue.')
      }
      response = await call(session)
    }
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError'
    return fail('network', aborted ? 'Ansly took too long to respond. Please try again.' : "Can't reach Ansly. Check your internet connection and try again.")
  }

  if (response.ok) {
    const data = response.status === 204 ? null : await response.json()
    return { ok: true, data: data as T }
  }
  const message = await detail(response)
  if (response.status === 401) {
    await deps.onUnauthorized()
    return fail('not_connected', 'Your Ansly session ended. Reconnect the extension to continue.')
  }
  if (response.status === 429) return fail('rate_limited', message ?? 'Too many requests. Please wait a moment.')
  if (response.status === 503) return fail('unavailable', message ?? 'The AI providers are busy. Please try again in a minute.')
  if (response.status === 422 || response.status === 400) return fail('bad_request', message ?? 'Ansly could not read this question.')
  return fail('server', message ?? `Something went wrong (HTTP ${response.status}). Please try again.`)
}
