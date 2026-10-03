'use client'

import { CalendarDays, Gauge } from 'lucide-react'
import { useMemo } from 'react'
import { Stat } from '@/components/ui'
import { type TokenEvent, compactNumber, tokenUsage } from '@/lib/usage'

/** Today's and the average daily AI token use. Days are the viewer's own (local time), so it renders on the client. */
export function TokenUsage({ events }: { events: TokenEvent[] }) {
  const usage = useMemo(() => tokenUsage(events), [events])
  return (
    <>
      <Stat label="Tokens used today" value={compactNumber(usage.today)} icon={Gauge} hint="Answers and tailored resumes" />
      <Stat
        label="Average per day"
        value={compactNumber(usage.perDay)}
        icon={CalendarDays}
        hint={usage.days > 1 ? `Over the last ${usage.days} days` : 'Since today'}
      />
    </>
  )
}
