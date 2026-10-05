import type { AnswerResponse, ExtensionSession, MatchSavedAnswerResponse, ResolveAnswerResponse, TailoringDownloadResponse } from '@ansly/types'
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
import { fetchProfileValues } from '@/lib/profile-values'
import { getValidSession, isValidSession, sessionItem } from '@/lib/session'
import { getSettings, migrateFromV1, sitesNoticeItem } from '@/lib/settings'
import {
  enabledSites,
  injectIntoOpenTabs,
  injectIntoTab,
  reconcileSites,
  registerSite,
  removeSite,
  sitesIn,
  unregisterSite,
} from '@/lib/sites'

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

/** Runs `fn` with a fresh access token, mapping "not connected" / network failures to Results. */
async function withSession<T>(fn: (token: string) => Promise<T>): Promise<Result<T>> {
  let session
  try {
    session = await getValidSession()
  } catch {
    return { ok: false, error: { code: 'network', message: "Can't reach Ansly." } }
  }
  if (!session) return { ok: false, error: { code: 'not_connected', message: 'Not connected' } }
  try {
    return ok(await fn(session.access_token))
  } catch (e) {
    return { ok: false, error: { code: 'server', message: e instanceof Error ? e.message : String(e) } }
  }
}

const CONTEXT_MENU_ID = 'ansly-answer'

/**
 * Sends a message to a tab's content script. On a site that isn't enabled there is
 * none yet, so it is injected once (the shortcut / context menu click grants activeTab).
 */
async function sendToTab(tabId: number, message: TabMessage, frameId?: number): Promise<void> {
  const options = frameId == null ? undefined : { frameId }
  try {
    await browser.tabs.sendMessage(tabId, message, options)
    return
  } catch {
    // No content script yet.
  }
  try {
    await injectIntoTab(tabId)
  } catch {
    return // chrome:// pages, the web store, etc.
  }
  // The freshly injected script needs a moment to mount its listener.
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise((r) => setTimeout(r, 150))
    try {
      await browser.tabs.sendMessage(tabId, message, options)
      return
    } catch {
      // Not listening yet.
    }
  }
}

type Handlers = { [K in RequestType]: (payload: RequestMap[K]['payload']) => Promise<Result<RequestMap[K]['response']>> }

const handlers: Handlers = {
  generate: (payload) => apiRequest(deps, 'POST', '/api/v1/answers/generate', payload),
  async resolve(payload) {
    const resolved = await apiRequest<ResolveAnswerResponse>(deps, 'POST', '/api/v1/answers/resolve', payload)
    // An API deployed before /resolve existed: match, then generate, as two requests.
    if (resolved.ok || resolved.error.code !== 'server' || resolved.error.message !== 'Not Found') return resolved
    const matched = await apiRequest<MatchSavedAnswerResponse>(deps, 'POST', '/api/v1/saved-answers/match', { question: payload.question })
    if (matched.ok && matched.data.match) return ok({ savedMatch: matched.data.match, score: matched.data.score, answer: null })
    const generated = await apiRequest<AnswerResponse>(deps, 'POST', '/api/v1/answers/generate', payload)
    return generated.ok ? ok({ savedMatch: null, score: 0, answer: generated.data }) : generated
  },
  regenerate: (payload) => apiRequest(deps, 'POST', '/api/v1/answers/regenerate', payload),
  matchSaved: (payload) => apiRequest(deps, 'POST', '/api/v1/saved-answers/match', payload),
  saveAnswer: (payload) => apiRequest(deps, 'POST', '/api/v1/saved-answers', payload),
  useSaved: ({ id }) => apiRequest(deps, 'POST', `/api/v1/saved-answers/${encodeURIComponent(id)}/use`),
  async track(payload) {
    if (!(await getSettings()).analytics) return ok(null)
    return apiRequest(deps, 'POST', '/api/v1/events', payload)
  },
  generateBatch: (payload) => apiRequest(deps, 'POST', '/api/v1/answers/generate-batch', payload),
  matchSavedBatch: (payload) => apiRequest(deps, 'POST', '/api/v1/saved-answers/match-batch', payload),
  saveMissing: (payload) => apiRequest(deps, 'POST', '/api/v1/profile/missing', payload),
  rewrite: (payload) => apiRequest(deps, 'POST', '/api/v1/answers/rewrite', payload),
  updateMemory: ({ id, changes }) => apiRequest(deps, 'PATCH', `/api/v1/memory/${encodeURIComponent(id)}`, changes),
  getProfileValues: () => withSession(fetchProfileValues),
  getConnection: async () => ok(await connection()),
  getProfileSummary: () => withSession(fetchProfileSummary),
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
  getSites: async () => ok(await enabledSites()),
  async removeSite({ domain }) {
    await removeSite(domain)
    return ok(await enabledSites())
  },
  getMasterResume: () => apiRequest(deps, 'GET', '/api/v1/resumes/master'),
  analyzeJob: (payload) => apiRequest(deps, 'POST', '/api/v1/jobs/analyze', payload),
  startTailoring: (payload) => apiRequest(deps, 'POST', '/api/v1/tailorings', payload),
  getTailoring: ({ id }) => apiRequest(deps, 'GET', `/api/v1/tailorings/${encodeURIComponent(id)}`),
  async downloadTailoring({ id }) {
    const result = await apiRequest<TailoringDownloadResponse>(
      deps,
      'GET',
      `/api/v1/tailorings/${encodeURIComponent(id)}/download`,
    )
    if (!result.ok) return result
    // Signed Supabase Storage URL that downloads the tailored .docx (the preview lives in the web app).
    await browser.tabs.create({ url: result.data.url })
    return ok(null)
  },
  async enableSite({ domain }) {
    if (!(await enabledSites()).includes(domain)) {
      return { ok: false, error: { code: 'bad_request', message: `Ansly doesn't have access to ${domain}.` } }
    }
    await registerSite(domain)
    await injectIntoOpenTabs(domain)
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
  // On a site that isn't enabled, the shortcut is a one-time "Scan this page" (activeTab).
  browser.commands.onCommand.addListener(async (command) => {
    if (command !== 'generate-answer') return
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
    if (tab?.id != null) await sendToTab(tab.id, { ansly: true, type: 'shortcut' })
  })

  // Right-click → "Answer with Ansly": works on any editable field, detected or not.
  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== CONTEXT_MENU_ID || tab?.id == null) return
    await sendToTab(tab.id, { ansly: true, type: 'contextAnswer' }, info.frameId)
  })

  // Enabling a site = granting its host permission (from the popup). Doing the
  // registration here keeps working even if the permission prompt closes the popup.
  browser.permissions.onAdded.addListener(async ({ origins }) => {
    for (const domain of sitesIn(origins)) {
      await registerSite(domain)
      await injectIntoOpenTabs(domain)
    }
  })
  browser.permissions.onRemoved.addListener(async ({ origins }) => {
    for (const domain of sitesIn(origins)) await unregisterSite(domain)
  })

  browser.runtime.onStartup.addListener(() => void reconcileSites())

  browser.runtime.onInstalled.addListener(async ({ reason }) => {
    await browser.contextMenus.removeAll()
    browser.contextMenus.create({ id: CONTEXT_MENU_ID, title: 'Answer with Ansly', contexts: ['editable'] })
    if (reason === 'install') {
      await sitesNoticeItem.setValue(false)
      await browser.tabs.create({ url: `${WEB_URL}/extension` })
    } else if (reason === 'update') {
      await migrateFromV1()
    }
    await reconcileSites()
  })
})
