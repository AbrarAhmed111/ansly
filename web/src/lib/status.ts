import type { HealthResponse, ServiceStatus } from '@ansly/types'

export interface StatusCheck {
  status: ServiceStatus
  detail?: string
}

/** Pings Supabase Auth's health endpoint with the publishable key. */
export async function checkSupabase(): Promise<StatusCheck> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) return { status: 'not_configured' }

  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/auth/v1/health`, {
      headers: { apikey: key },
      cache: 'no-store',
    })
    return res.ok
      ? { status: 'ok' }
      : { status: 'error', detail: `HTTP ${res.status}` }
  } catch (err) {
    return { status: 'error', detail: String(err) }
  }
}

/** Calls the llm service's /health endpoint. */
export async function checkApi(): Promise<
  StatusCheck & { health?: HealthResponse }
> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL
  if (!baseUrl) return { status: 'not_configured' }

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/health`, {
      cache: 'no-store',
    })
    if (!res.ok) return { status: 'error', detail: `HTTP ${res.status}` }
    return { status: 'ok', health: (await res.json()) as HealthResponse }
  } catch (err) {
    return { status: 'error', detail: String(err) }
  }
}
