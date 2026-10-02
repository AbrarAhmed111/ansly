import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { AppShell } from '@/components/app-shell'
import { createClient } from '@/lib/supabase/server'

export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const name = typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : null

  return (
    <AppShell name={name} email={user.email ?? ''} userId={user.id} createdAt={user.created_at}>
      {children}
    </AppShell>
  )
}
