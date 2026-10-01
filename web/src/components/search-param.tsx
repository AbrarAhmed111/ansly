'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect } from 'react'

function Watcher({ name, onMatch }: { name: string; onMatch: () => void }) {
  const params = useSearchParams()
  const router = useRouter()
  const path = usePathname()
  const value = params.get(name)
  useEffect(() => {
    if (!value) return
    onMatch()
    router.replace(path, { scroll: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return null
}

/** Runs `onMatch` once when `?name=…` is in the URL, then removes it (used for deep links like "?new=1"). */
export function OnSearchParam(props: { name: string; onMatch: () => void }) {
  return (
    <Suspense fallback={null}>
      <Watcher {...props} />
    </Suspense>
  )
}
