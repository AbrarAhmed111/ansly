'use client'

import { CalendarDays, FilePen, Gauge, Mail, Shapes, Sparkles, type LucideIcon } from 'lucide-react'
import { useMemo } from 'react'
import { Card, CardHeader } from '@/components/ui'
import {
  type TokenEvent,
  type TokenFeature,
  TOKEN_WINDOW_DAYS,
  compactNumber,
  tokenUsage,
  tokensByFeature,
} from '@/lib/usage'

const FEATURES: { feature: TokenFeature; label: string; icon: LucideIcon; hint: string; color: string }[] = [
  { feature: 'answers', label: 'Answers & forms', icon: Sparkles, hint: 'Generating, filling and rewriting answers', color: 'bg-accent' },
  { feature: 'tailoring', label: 'Resume tailoring', icon: FilePen, hint: 'Tailored resumes and job analysis', color: 'bg-orchid-400' },
  { feature: 'emails', label: 'Email generation', icon: Mail, hint: 'Leads: role detection, matching and emails', color: 'bg-magenta-400' },
  { feature: 'other', label: 'Other', icon: Shapes, hint: 'Everything else that used AI', color: 'bg-subtle' },
]

function Figure({ label, value, icon: Icon, hint }: { label: string; value: string; icon: LucideIcon; hint: string }) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-body-sm font-medium text-muted">
        <Icon className="h-3.5 w-3.5 text-subtle" aria-hidden />
        {label}
      </p>
      <p className="mt-1 text-h2 tabular-nums">{value}</p>
      <p className="truncate text-caption text-subtle">{hint}</p>
    </div>
  )
}

/**
 * AI token use in one card: today, the daily average and the window total, then the split by feature.
 * Days are the viewer's own (local time), so it renders on the client.
 */
export function AiUsage({ events }: { events: TokenEvent[] }) {
  const usage = useMemo(() => tokenUsage(events), [events])
  const byFeature = useMemo(() => tokensByFeature(events), [events])
  const total = byFeature ? Object.values(byFeature).reduce((sum, f) => sum + f.total, 0) : 0
  // "Other" only appears once something lands there.
  const shown = FEATURES.filter((f) => f.feature !== 'other' || (byFeature?.other.total ?? 0) > 0)

  return (
    <Card>
      <CardHeader title="AI usage" description={`Tokens Ansly used for you over the last ${TOKEN_WINDOW_DAYS} days.`} />

      <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3">
        <Figure label="Today" value={compactNumber(usage.today)} icon={Gauge} hint="Since midnight" />
        <Figure
          label="Per day"
          value={compactNumber(usage.perDay)}
          icon={CalendarDays}
          hint={usage.days > 1 ? `Average over ${usage.days} days` : 'Since today'}
        />
        {byFeature && (
          <Figure label="Total" value={compactNumber(total)} icon={Sparkles} hint={`Last ${TOKEN_WINDOW_DAYS} days`} />
        )}
      </div>

      {byFeature && (
        <>
          <div
            className="mt-6 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-surface-muted"
            role="img"
            aria-label={shown
              .map((f) => `${f.label}: ${compactNumber(byFeature[f.feature].total)} tokens`)
              .join(', ')}
          >
            {total > 0 &&
              shown.map(({ feature, color }) => {
                const used = byFeature[feature].total
                return used > 0 ? (
                  <div key={feature} className={`h-full ${color}`} style={{ width: `${(used / total) * 100}%` }} />
                ) : null
              })}
          </div>

          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {shown.map(({ feature, label, icon: Icon, hint, color }) => {
              const { today, total: used } = byFeature[feature]
              const share = total > 0 ? Math.round((used / total) * 100) : 0
              return (
                <li key={feature} className="flex items-start gap-3 rounded-lg border border-border p-3" title={hint}>
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${color}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-body-sm font-medium">
                      <Icon className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden />
                      <span className="truncate">{label}</span>
                    </p>
                    <p className="mt-0.5 text-caption text-subtle">
                      <span className="tabular-nums">{compactNumber(today)}</span> today
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold tabular-nums">{compactNumber(used)}</p>
                    <p className="text-caption tabular-nums text-subtle">{share}%</p>
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </Card>
  )
}
