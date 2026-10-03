import { NextResponse } from 'next/server'
import { checkApi, checkSupabase } from '@/lib/status'

// Shared by every visitor and regenerated at most once a minute, so status checks
// don't run per page view and never sit in front of the landing page's first paint.
export const revalidate = 60

export async function GET() {
  const [supabase, api] = await Promise.all([checkSupabase(), checkApi()])
  return NextResponse.json({
    supabase,
    api: { status: api.status, detail: api.detail },
    apiSupabase: api.health?.supabase ?? null,
  })
}
