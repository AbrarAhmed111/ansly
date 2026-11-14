import { NextResponse, type NextRequest } from 'next/server'
import { safeNext } from '@/lib/safe-next'
import { createClient } from '@/lib/supabase/server'

/** Email confirmation and password-reset links land here with a one-time code to exchange for a session. */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  const next = safeNext(request.nextUrl.searchParams.get('next'))

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(new URL(next, request.url))
  }
  const login = new URL('/login', request.url)
  if (next === '/reset-password') {
    // Expired or reused password-reset link: go straight back to asking for a new one.
    login.searchParams.set('mode', 'reset')
    login.searchParams.set('error', 'That reset link is invalid or has expired. Request a new one below.')
  } else {
    login.searchParams.set('error', 'That sign-in link is invalid or has expired. Please sign in again.')
  }
  return NextResponse.redirect(login)
}
