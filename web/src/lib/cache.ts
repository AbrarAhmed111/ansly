'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * A tiny stale-while-revalidate cache for API reads.
 *
 * - Revisiting a page shows the last data instantly (no skeleton), then refreshes it.
 * - Two components asking for the same key share one request.
 * - Mutations call `invalidate(prefix)` so the next read refetches.
 */

interface Entry<T> {
  data?: T
  at: number
  promise?: Promise<T>
}

const entries = new Map<string, Entry<unknown>>()
const listeners = new Map<string, Set<() => void>>()

function notify(key: string) {
  listeners.get(key)?.forEach((fn) => fn())
}

export function peek<T>(key: string): T | undefined {
  return entries.get(key)?.data as T | undefined
}

export function prime<T>(key: string, data: T) {
  entries.set(key, { data, at: Date.now() })
  notify(key)
}

/** Fetches `key`, sharing an in-flight request and reusing data fresher than `maxAge` ms. */
export function load<T>(key: string, fetcher: () => Promise<T>, maxAge = 0): Promise<T> {
  const entry = entries.get(key) as Entry<T> | undefined
  if (entry?.promise) return entry.promise
  if (entry?.data !== undefined && Date.now() - entry.at < maxAge) return Promise.resolve(entry.data)
  const promise = fetcher().then(
    (data) => {
      entries.set(key, { data, at: Date.now() })
      notify(key)
      return data
    },
    (error) => {
      const current = entries.get(key)
      if (current) delete current.promise
      throw error
    },
  )
  entries.set(key, { ...(entry ?? { at: 0 }), promise })
  return promise
}

/** Drops every cached key starting with `prefix` (e.g. after a delete). */
export function invalidate(prefix: string) {
  for (const key of [...entries.keys()]) {
    if (key.startsWith(prefix)) {
      entries.delete(key)
      notify(key)
    }
  }
}

/** For tests. */
export function clearCache() {
  entries.clear()
}

export interface Cached<T> {
  data: T | undefined
  error: string | null
  /** True only while there's nothing to show yet. */
  loading: boolean
  refresh: () => Promise<T | undefined>
}

/** Reads `key` through the cache; shows cached data at once and revalidates in the background. */
export function useCached<T>(key: string | null, fetcher: () => Promise<T>, toMessage: (e: unknown) => string): Cached<T> {
  const [data, setData] = useState<T | undefined>(() => (key ? peek<T>(key) : undefined))
  const [error, setError] = useState<string | null>(null)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const refresh = useCallback(async () => {
    if (!key) return undefined
    try {
      const value = await load(key, () => fetcherRef.current())
      setData(value)
      setError(null)
      return value
    } catch (e) {
      setError(toMessage(e))
      return undefined
    }
  }, [key, toMessage])

  useEffect(() => {
    if (!key) return
    setData(peek<T>(key))
    const listener = () => {
      const value = peek<T>(key)
      if (value !== undefined) setData(value)
    }
    const set = listeners.get(key) ?? new Set()
    set.add(listener)
    listeners.set(key, set)
    void refresh()
    return () => {
      set.delete(listener)
    }
  }, [key, refresh])

  return { data, error, loading: data === undefined && !error, refresh }
}
