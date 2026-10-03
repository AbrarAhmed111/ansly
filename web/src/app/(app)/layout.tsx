import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { AppShell } from '@/components/app-shell'
import { createClient } from '@/lib/supabase/server'

export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient()
  // Verified locally from the JWT (see middleware), not fetched from Supabase Auth on every navigation.
  const { data } = await supabase.auth.getClaims()
  const claims = data?.claims
  if (!claims?.sub) redirect('/login')

  const metadata = (claims.user_metadata ?? {}) as Record<string, unknown>
  const name = typeof metadata.full_name === 'string' ? metadata.full_name : null

  return (
    <AppShell name={name} email={claims.email ?? ''} userId={claims.sub}>
      {children}
    </AppShell>
  )
}
