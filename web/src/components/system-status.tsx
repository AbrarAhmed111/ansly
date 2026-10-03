'use client'

import { useEffect, useState } from 'react'
import { StatusDot, type Tone } from '@/components/ui'
import type { StatusCheck } from '@/lib/status'

interface StatusResponse {
  supabase: StatusCheck
  api: StatusCheck
  apiSupabase: StatusCheck | null
}

const STATUS: Record<StatusCheck['status'], { label: string; tone: Tone }> = {
  ok: { label: 'Operational', tone: 'success' },
  error: { label: 'Unreachable', tone: 'danger' },
  not_configured: { label: 'Not configured', tone: 'warning' },
}

function StatusRow({ name, check }: { name: string; check: StatusCheck | null }) {
  const status = check ? STATUS[check.status] : null
  return (
    <li className="flex items-center justify-between gap-4 py-2.5">
      <span className="text-muted">{name}</span>
      <span className="inline-flex items-center gap-2 font-medium" title={check?.detail}>
        <StatusDot tone={status?.tone ?? 'neutral'} pulse={check?.status === 'ok'} />
        {status?.label ?? 'Checking…'}
      </span>
    </li>
  )
}

/** Loaded after first paint from the cached /api/status route. */
export function SystemStatus() {
  const [status, setStatus] = useState<StatusResponse | null>(null)
  useEffect(() => {
    let alive = true
    fetch('/api/status')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data: StatusResponse) => alive && setStatus(data))
      .catch((err: unknown) => {
        const failed: StatusCheck = { status: 'error', detail: String(err) }
        if (alive) setStatus({ supabase: failed, api: failed, apiSupabase: null })
      })
    return () => {
      alive = false
    }
  }, [])
  return (
    <ul className="mt-2 divide-y divide-border">
      <StatusRow name="Web → Supabase" check={status?.supabase ?? null} />
      <StatusRow name="Web → API" check={status?.api ?? null} />
      {status?.api.status === 'ok' && <StatusRow name="API → Supabase" check={status.apiSupabase ?? { status: 'not_configured' }} />}
    </ul>
  )
}
