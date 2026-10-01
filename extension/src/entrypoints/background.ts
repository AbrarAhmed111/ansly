import type { ExtensionSession } from '@ansly/types'
import { apiRequest, type ApiDeps } from '@/lib/api'
import { WEB_URL } from '@/lib/config'
import {
  isRequest,
  type ConnectionState,
  type Request,
  type RequestMap,
  type RequestType,
  type Result,
  type TabMessage,
} from '@/lib/messages'
import { fetchProfileSummary } from '@/lib/profile-summary'
import { getValidSession, isValidSession, sessionItem } from '@/lib/session'
import { getSettings } from '@/lib/settings'

const deps: ApiDeps = {
  getSession: (force) => getValidSession(force),
  onUnauthorized: () => sessionItem.setValue(null),
}

async function connection(): Promise<ConnectionState> {
  const session = await sessionItem.getValue()
  return {
    connected: Boolean(session),
    email: session?.user.email ?? null,
    version: browser.runtime.getManifest().version,
  }
}

const ok = <T>(data: T): Result<T> => ({ ok: true, data })

type Handlers = { [K in RequestType]: (payload: RequestMap[K]['payload']) => Promise<Result<RequestMap[K]['response']>> }

const handlers: Handlers = {
  generate: (payload) => apiRequest(deps, 'POST', '/api/v1/answers/generate', payload),
  regenerate: (payload) => apiRequest(deps, 'POST', '/api/v1/answers/regenerate', payload),
  matchSaved: (payload) => apiRequest(deps, 'POST', '/api/v1/saved-answers/match', payload),
  saveAnswer: (payload) => apiRequest(deps, 'POST', '/api/v1/saved-answers', payload),
  useSaved: ({ id }) => apiRequest(deps, 'POST', `/api/v1/saved-answers/${encodeURIComponent(id)}/use`),
  async track(payload) {
    if (!(await getSettings()).analytics) return ok(null)
    return apiRequest(deps, 'POST', '/api/v1/events', payload)
  },
  getConnection: async () => ok(await connection()),
  async getProfileSummary() {
    let session
    try {
      session = await getValidSession()
    } catch {
      return { ok: false, error: { code: 'network', message: "Can't reach Ansly." } }
    }
    if (!session) return { ok: false, error: { code: 'not_connected', message: 'Not connected' } }
    try {
      return ok(await fetchProfileSummary(session.access_token))
    } catch (e) {
      return { ok: false, error: { code: 'server', message: e instanceof Error ? e.message : String(e) } }
    }
  },
  async connect(session: ExtensionSession) {
    if (!isValidSession(session)) {
      return { ok: false, error: { code: 'bad_request', message: 'The web app sent an invalid session.' } }
    }
    await sessionItem.setValue(session)
    return ok(await connection())
  },
  async disconnect() {
    await sessionItem.setValue(null)
    return ok(await connection())
  },
  async openWebApp({ path }) {
    const safePath = path.startsWith('/') && !path.startsWith('//') ? path : '/'
    await browser.tabs.create({ url: `${WEB_URL}${safePath}` })
    return ok(null)
  },
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    if (!isRequest(message)) return undefined
    // Only our own extension pages and content scripts can talk to the background.
    if (sender.id !== browser.runtime.id) return undefined
    const { type, payload } = message as Request
    const handler = handlers[type] as (p: unknown) => Promise<Result<unknown>>
    if (!handler) return undefined
    return handler(payload).catch((e: unknown) => ({
      ok: false,
      error: { code: 'server', message: e instanceof Error ? e.message : String(e) },
    }))
  })

  // Keyboard shortcut: ask the active tab to open Ansly for the focused field.
  browser.commands.onCommand.addListener(async (command) => {
    if (command !== 'generate-answer') return
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
    if (tab?.id == null) return
    try {
      await browser.tabs.sendMessage(tab.id, { ansly: true, type: 'shortcut' } satisfies TabMessage)
    } catch {
      // No content script on this page (e.g. chrome:// pages).
    }
  })

  browser.runtime.onInstalled.addListener(async ({ reason }) => {
    if (reason === 'install') await browser.tabs.create({ url: `${WEB_URL}/extension` })
  })
})
