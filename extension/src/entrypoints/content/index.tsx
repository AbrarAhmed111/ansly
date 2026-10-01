import { createRoot } from 'react-dom/client'
import { App } from '@/components/content/App'
import { CONTENT_CSS } from '@/components/content/styles'
import { getSettings, settingsItem, type Settings } from '@/lib/settings'

const WEB_ORIGIN = (import.meta.env.WXT_WEB_URL || 'http://localhost:3000').replace(/\/+$/, '')

export default defineContentScript({
  matches: ['<all_urls>'],
  // Not on the Ansly web app itself (its own forms are the profile).
  excludeMatches: [`${WEB_ORIGIN}/*`],
  // Application forms are often embedded in iframes (e.g. Greenhouse on company sites).
  allFrames: true,
  runAt: 'document_idle',
  async main(ctx) {
    // Pages without any text fields never get UI.
    if (!document.querySelector('textarea, input, [contenteditable]')) {
      // ...unless fields arrive later (single-page apps).
      await new Promise<void>((resolve) => {
        const observer = new MutationObserver(() => {
          if (document.querySelector('textarea, input, [contenteditable]')) {
            observer.disconnect()
            resolve()
          }
        })
        observer.observe(document.documentElement, { childList: true, subtree: true })
        ctx.onInvalidated(() => observer.disconnect())
      })
    }
    if (ctx.isInvalid) return

    // Our own element + shadow root: page CSS can't style our UI, and ours can't leak into the page.
    const host = document.createElement('ansly-root')
    host.style.cssText = 'position: static !important; display: block !important;'
    const shadow = host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = CONTENT_CSS
    shadow.appendChild(style)
    const mount = document.createElement('div')
    shadow.appendChild(mount)
    document.documentElement.appendChild(host)

    const subscribe = (onChange: (s: Settings) => void) =>
      settingsItem.watch(async () => onChange(await getSettings()))

    const root = createRoot(mount)
    root.render(<App host={host} initialSettings={await getSettings()} subscribe={subscribe} />)

    ctx.onInvalidated(() => {
      root.unmount()
      host.remove()
    })
  },
})
