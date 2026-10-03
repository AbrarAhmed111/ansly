import { createRoot } from 'react-dom/client'
import { App } from '@/components/content/App'
import { CONTENT_CSS } from '@/components/content/styles'
import { peekJob } from '@/lib/job/detect'
import { getSettings, settingsItem, type Settings } from '@/lib/settings'

const WEB_ORIGIN = (import.meta.env.WXT_WEB_URL || 'http://localhost:3000').replace(/\/+$/, '')

// Set while a live copy of this script is running in this frame.
const LOADED = Symbol.for('ansly.content')

// Not declared in the manifest: the background registers it per enabled site,
// and the popup / shortcut inject it once for "Scan this page" (see lib/sites.ts).
export default defineContentScript({
  registration: 'runtime',
  async main(ctx) {
    // Not on the Ansly web app itself (its own forms are the profile).
    if (window.location.origin === WEB_ORIGIN) return
    // A one-time scan on an enabled site, or a second scan, must not mount twice.
    const w = window as unknown as Record<symbol, boolean>
    if (w[LOADED]) return
    w[LOADED] = true
    ctx.onInvalidated(() => delete w[LOADED])

    // Pages without text fields or a job posting never get UI.
    const hasFields = () => Boolean(document.querySelector('textarea, input, [contenteditable]'))
    const hasJob = () => Boolean(peekJob(document))
    if (!hasFields() && !hasJob()) {
      // ...unless they arrive later (single-page apps). The job check is throttled: it reads more of the page.
      await new Promise<void>((resolve) => {
        let lastJobCheck = 0
        const observer = new MutationObserver(() => {
          const now = Date.now()
          const jobReady = now - lastJobCheck > 1000 && ((lastJobCheck = now), hasJob())
          if (hasFields() || jobReady) {
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
