'use client'

import { useEffect, useState } from 'react'

function partOfDay(hour: number): string {
  if (hour < 5) return 'Working late'
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

/**
 * "Good morning, Ada" in the viewer's own time zone. The server renders the neutral `fallback` and the
 * time-of-day greeting replaces it after mount, so there's no hydration mismatch.
 */
export function Greeting({ firstName, fallback }: { firstName: string | null; fallback: string }) {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    const greeting = partOfDay(new Date().getHours())
    setText(firstName ? `${greeting}, ${firstName}` : greeting)
  }, [firstName])
  return <>{text ?? fallback}</>
}

/** Today's date, e.g. "Sunday, 15 November", in the viewer's locale and time zone. */
export function Today() {
  const [text, setText] = useState('')
  useEffect(() => {
    setText(new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }))
  }, [])
  return <>{text || 'Dashboard'}</>
}
