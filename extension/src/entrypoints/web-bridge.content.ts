import {
  BRIDGE_EXTENSION,
  BRIDGE_WEB,
  type ExtensionToWebMessage,
  type WebToExtensionMessage,
} from '@ansly/types'
import { send } from '@/lib/messages'

// Runs only on the Ansly web app, so the web app can hand the extension its
// session. Matches are fixed at build time from WXT_WEB_URL.
const WEB_ORIGIN = (import.meta.env.WXT_WEB_URL || 'http://localhost:3000').replace(/\/+$/, '')

export default defineContentScript({
  matches: [`${WEB_ORIGIN}/*`],
  runAt: 'document_start',
  main() {
    const reply = (message: ExtensionToWebMessage) => window.postMessage(message, window.location.origin)

    async function postStatus() {
      const result = await send('getConnection', null)
      if (result.ok) reply({ source: BRIDGE_EXTENSION, type: 'ANSLY_STATUS', ...result.data })
    }

    window.addEventListener('message', async (event: MessageEvent<WebToExtensionMessage>) => {
      // Only this page's own scripts, on the web app's origin.
      if (event.source !== window || event.origin !== window.location.origin) return
      const msg = event.data
      if (!msg || msg.source !== BRIDGE_WEB) return

      if (msg.type === 'ANSLY_PING') {
        await postStatus()
      } else if (msg.type === 'ANSLY_CONNECT') {
        const result = await send('connect', msg.session)
        reply({
          source: BRIDGE_EXTENSION,
          type: 'ANSLY_CONNECTED',
          ok: result.ok,
          error: result.ok ? undefined : result.error.message,
        })
        await postStatus()
      } else if (msg.type === 'ANSLY_DISCONNECT') {
        await send('disconnect', null)
        await postStatus()
      } else if (msg.type === 'ANSLY_GET_SITES' || msg.type === 'ANSLY_REMOVE_SITE') {
        const result = msg.type === 'ANSLY_REMOVE_SITE' && typeof msg.domain === 'string'
          ? await send('removeSite', { domain: msg.domain })
          : await send('getSites', null)
        if (result.ok) reply({ source: BRIDGE_EXTENSION, type: 'ANSLY_SITES', sites: result.data })
      }
    })

    void postStatus()
  },
})
