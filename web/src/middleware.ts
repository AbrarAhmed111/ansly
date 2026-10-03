import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { safeNext } from '@/lib/safe-next'
import { supabaseKey, supabaseUrl } from '@/lib/supabase/env'

const PROTECTED = ['/dashboard', '/profile', '/resume', '/saved-answers', '/settings', '/extension', '/playground']
const AUTH_PAGES = ['/login']
// Static pages that work the same signed in or out: no auth check, so they're served without waiting on Supabase.
const PUBLIC = ['/', '/privacy', '/api/status']

/** Refreshes the Supabase session cookie and guards signed-in pages. */
export async function middleware(request: NextRequest) {
  if (PUBLIC.includes(request.nextUrl.pathname)) return NextResponse.next()

  let response = NextResponse.next({ request })

  const supabase = createServerClient(supabaseUrl(), supabaseKey(), {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        )
      },
    },
  })

  // getClaims refreshes an expired session, then verifies the JWT locally against the project's signing keys
  // (falling back to the Auth server for legacy secrets), instead of a round trip to Supabase Auth per request.
  const { data } = await supabase.auth.getClaims()
  const user = data?.claims ?? null

  const path = request.nextUrl.pathname
  if (!user && PROTECTED.some((p) => path === p || path.startsWith(`${p}/`))) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = `?next=${encodeURIComponent(path + request.nextUrl.search)}`
    return NextResponse.redirect(url)
  }
  if (user && AUTH_PAGES.includes(path)) {
    const next = safeNext(request.nextUrl.searchParams.get('next'))
    return NextResponse.redirect(new URL(next, request.url))
  }
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
}
