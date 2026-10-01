import type { HealthResponse, ServiceStatus } from '@ansly/types'
import { API_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config'

export interface StatusCheck {
  status: ServiceStatus
  detail?: string
}

export interface ExtensionStatus {
  supabase: StatusCheck
  api: StatusCheck
  apiSupabase?: StatusCheck
}

/** Pings Supabase Auth's health endpoint with the publishable key. */
async function checkSupabase(): Promise<StatusCheck> {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return { status: 'not_configured' }
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, { headers: { apikey: SUPABASE_PUBLISHABLE_KEY } })
    return res.ok ? { status: 'ok' } : { status: 'error', detail: `HTTP ${res.status}` }
  } catch (err) {
    return { status: 'error', detail: String(err) }
  }
}

/** Calls the llm service's /health endpoint. */
async function checkApi(): Promise<StatusCheck & { health?: HealthResponse }> {
  try {
    const res = await fetch(`${API_URL}/health`)
    if (!res.ok) return { status: 'error', detail: `HTTP ${res.status}` }
    return { status: 'ok', health: (await res.json()) as HealthResponse }
  } catch (err) {
    return { status: 'error', detail: String(err) }
  }
}

/** Connectivity of the extension and API (shown under "System status" in the popup). */
export async function getStatus(): Promise<ExtensionStatus> {
  const [supabase, { health, ...api }] = await Promise.all([checkSupabase(), checkApi()])
  return { supabase, api, apiSupabase: health?.supabase }
}
