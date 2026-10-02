'use client'

import { BRIDGE_EXTENSION, BRIDGE_WEB, type ExtensionToWebMessage, type WebToExtensionMessage } from '@ansly/types'
import { Globe, X } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Alert, Card, CardHeader, IconButton } from '@/components/ui'

function post(message: WebToExtensionMessage) {
  window.postMessage(message, window.location.origin)
}

/**
 * The sites the extension runs on, read through the web bridge. Sites are added
 * from the extension popup (the browser's permission prompt needs a click there);
 * they can be removed here.
 */
export function EnabledSites() {
  const [sites, setSites] = useState<string[] | null>(null)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    function onMessage(event: MessageEvent<ExtensionToWebMessage>) {
      if (event.source !== window || event.origin !== window.location.origin) return
      const msg = event.data
      if (msg?.source !== BRIDGE_EXTENSION || msg.type !== 'ANSLY_SITES') return
      setSites(Array.isArray(msg.sites) ? msg.sites : [])
      setChecked(true)
    }
    window.addEventListener('message', onMessage)
    post({ source: BRIDGE_WEB, type: 'ANSLY_GET_SITES' })
    const timer = setTimeout(() => setChecked(true), 1500)
    return () => {
      window.removeEventListener('message', onMessage)
      clearTimeout(timer)
    }
  }, [])

  return (
    <Card>
      <CardHeader
        icon={Globe}
        title="Enabled sites"
        description="Ansly only runs on sites you turn on. Add a site from the extension popup while you're on it."
      />
      <div className="mt-5">
        {!checked ? (
          <p className="text-caption text-muted">Checking the extension…</p>
        ) : sites === null ? (
          <Alert tone="accent">
            The Ansly extension isn&apos;t installed in this browser, or is an older version.{' '}
            <Link href="/extension" className="font-medium text-accent underline underline-offset-2">Set up the extension</Link>
          </Alert>
        ) : sites.length === 0 ? (
          <p className="text-caption text-muted">No sites yet. Open a job application and choose “Always run on …” in the Ansly popup.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {sites.map((site) => (
              <li key={site} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="font-medium">{site}</span>
                <IconButton icon={X} label={`Turn off Ansly on ${site}`} onClick={() => post({ source: BRIDGE_WEB, type: 'ANSLY_REMOVE_SITE', domain: site })} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}
