'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * Renders `signedOut` (what the static HTML contains) and switches to `signedIn` once the browser finds a
 * session in its cookies. This keeps marketing pages static: the server never waits on an auth check.
 */
export function SignedInSwitch({ signedIn, signedOut }: { signedIn: ReactNode; signedOut: ReactNode }) {
  const [isSignedIn, setSignedIn] = useState(false)
  useEffect(() => {
    let alive = true
    void createClient()
      .auth.getSession()
      .then(({ data }) => alive && setSignedIn(Boolean(data.session)))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])
  return <>{isSignedIn ? signedIn : signedOut}</>
}
