'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { Avatar } from '@/components/ui'
import { displayName, signedAvatarUrl } from '@/lib/avatar'
import { createClient } from '@/lib/supabase/client'

export interface Identity {
  userId: string
  email: string
  /** Name from the profile (falls back to the sign-up name until the profile loads). */
  name: string | null
  avatarPath: string | null
  avatarUrl: string | null
}

interface IdentityContextValue extends Identity {
  /** Name to show: the name, else the email. */
  label: string
  /** Updates the shown identity after a save, without refetching. */
  update: (patch: {
    name?: string | null
    avatarPath?: string | null
  }) => Promise<void>
}

const IdentityContext = createContext<IdentityContextValue | null>(null)

/** Who is signed in, as shown across the app: sidebar, user menu, greetings and the Personal page. */
export function IdentityProvider({
  userId,
  email,
  name: initialName,
  children,
}: {
  userId: string
  email: string
  name: string | null
  children: ReactNode
}) {
  const [identity, setIdentity] = useState<Identity>({
    userId,
    email,
    name: initialName,
    avatarPath: null,
    avatarUrl: null,
  })

  useEffect(() => {
    let alive = true
    const supabase = createClient()
    void (async () => {
      // `select('*')` keeps the name working on a database without the avatar_path column yet.
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle<{ full_name: string | null; avatar_path?: string | null }>()
      if (!alive || !data) return
      const avatarUrl = await signedAvatarUrl(supabase, data.avatar_path)
      if (!alive) return
      setIdentity(i => ({
        ...i,
        name: data.full_name?.trim() || i.name,
        avatarPath: data.avatar_path ?? null,
        avatarUrl,
      }))
    })()
    return () => {
      alive = false
    }
  }, [userId])

  const update = useCallback(
    async (patch: { name?: string | null; avatarPath?: string | null }) => {
      const avatarUrl =
        patch.avatarPath === undefined
          ? undefined
          : await signedAvatarUrl(createClient(), patch.avatarPath)
      setIdentity(i => ({
        ...i,
        ...(patch.name !== undefined && { name: patch.name?.trim() || null }),
        ...(patch.avatarPath !== undefined && {
          avatarPath: patch.avatarPath,
          avatarUrl: avatarUrl ?? null,
        }),
      }))
    },
    [],
  )

  const value = useMemo(
    () => ({
      ...identity,
      label: displayName(identity.name, identity.email),
      update,
    }),
    [identity, update],
  )
  return (
    <IdentityContext.Provider value={value}>
      {children}
    </IdentityContext.Provider>
  )
}

export function useIdentity(): IdentityContextValue | null {
  return useContext(IdentityContext)
}

/** The signed-in user's picture, falling back to their initials (and when the image fails to load). */
export function UserAvatar({
  className,
  src,
  name,
}: {
  className?: string
  src?: string | null
  name?: string
}) {
  const identity = useIdentity()
  const url = src !== undefined ? src : identity?.avatarUrl
  const [failed, setFailed] = useState<string | null>(null)
  return (
    <Avatar
      name={name ?? identity?.label ?? '?'}
      src={url && url !== failed ? url : null}
      onImageError={() => setFailed(url ?? null)}
      className={className}
    />
  )
}
