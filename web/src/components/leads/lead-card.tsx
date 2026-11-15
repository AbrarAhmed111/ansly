'use client'

import type { EmailDraft, Lead } from '@ansly/types'
import { clsx } from 'clsx'
import { ArrowUpRight, CheckCheck, Link2, Mail, PenLine, RotateCcw, Send, Trash2, UserRound } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { Badge, Button, CopyButton, IconButton, buttonStyles } from '@/components/ui'
import { STATE_BADGE, draftState } from '@/lib/lead-emails'
import { leadTier, relativeDate } from '@/lib/leads'

const EXTERNAL = { target: '_blank', rel: 'noopener noreferrer nofollow' } as const

export function LeadCard({
  lead,
  selected,
  highlighted,
  busy,
  onSelect,
  onStatus,
  onDelete,
  draft,
  writing,
  onWriteEmail,
  onWriteAndSend,
}: {
  lead: Lead
  selected: boolean
  /** Saved by the collection the user just ran from the extension. */
  highlighted: boolean
  busy: boolean
  onSelect: (selected: boolean) => void
  onStatus: (status: Lead['status']) => void
  onDelete: () => void
  /** This lead's email draft, when one exists. */
  draft?: EmailDraft
  writing?: boolean
  onWriteEmail?: () => void
  /** Write and send at once when Ansly is confident about the resume. */
  onWriteAndSend?: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const tier = leadTier(lead)
  const email = lead.contact_info?.email
  const applyUrl = lead.contact_info?.application_url
  const posted = relativeDate(lead.publication_date)
  const collected = relativeDate(lead.collected_at)
  const contacted = lead.status === 'contacted'
  const long = lead.description.length > 360

  return (
    <article
      className={clsx(
        'group rounded-xl border bg-surface shadow-xs transition',
        selected ? 'border-accent/50 ring-2 ring-accent/15' : 'border-border hover:border-border-strong',
        contacted && !selected && 'opacity-80',
      )}
    >
      <div className="flex gap-3 p-5">
        <input
          type="checkbox"
          checked={selected}
          onChange={(event) => onSelect(event.target.checked)}
          aria-label={`Select ${lead.title}`}
          className="mt-1.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-[rgb(var(--accent))]"
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {tier === 'email' && (
              <Badge tone="success" dot>
                Email
              </Badge>
            )}
            {tier === 'link' && (
              <Badge tone="accent" dot>
                Apply link
              </Badge>
            )}
            {contacted && <Badge>Contacted</Badge>}
            {highlighted && <Badge tone="warning">Just collected</Badge>}
            {draft && (
              <Badge tone={STATE_BADGE[draftState(draft)].tone} dot>
                Email: {STATE_BADGE[draftState(draft)].label}
              </Badge>
            )}
            {lead.source_platform === 'linkedin' && <span className="text-caption text-subtle">LinkedIn</span>}
          </div>

          <h3 className="mt-2 line-clamp-3 text-title leading-snug [overflow-wrap:anywhere]" title={lead.title}>
            {lead.title}
          </h3>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-body-sm text-muted">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <UserRound className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {lead.author_profile_url ? (
                <a href={lead.author_profile_url} {...EXTERNAL} className="truncate hover:text-fg hover:underline">
                  {lead.author_name}
                </a>
              ) : (
                <span className="truncate">{lead.author_name}</span>
              )}
            </span>
            {posted && <span>Posted {posted.toLowerCase()}</span>}
            {collected && <span>Collected {collected.toLowerCase()}</span>}
          </div>

          <p
            className={clsx(
              'mt-3 whitespace-pre-line text-body-sm leading-relaxed text-fg/85',
              !expanded && long && 'line-clamp-4',
            )}
          >
            {lead.description}
          </p>
          {long && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="mt-1 text-caption font-medium text-accent hover:underline"
            >
              {expanded ? 'Show less' : 'Show full post'}
            </button>
          )}

          {lead.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="text-caption text-subtle">Matched</span>
              {lead.tags.map((tag) => (
                <Badge key={tag}>{tag}</Badge>
              ))}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
            {email && (
              <div className="flex min-w-0 items-center gap-1 rounded-lg border border-border bg-surface-muted/50 py-0.5 pl-3 pr-0.5">
                <Mail className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
                <a href={`mailto:${email}`} className="truncate text-body-sm font-medium hover:underline">
                  {email}
                </a>
                <CopyButton text={email} />
              </div>
            )}
            {applyUrl && (
              <a href={applyUrl} {...EXTERNAL} className={buttonStyles({ variant: tier === 'link' ? 'primary' : 'secondary', size: 'sm' })}>
                <Link2 className="h-4 w-4" aria-hidden />
                Apply
              </a>
            )}
            {lead.original_post_url && (
              <a href={lead.original_post_url} {...EXTERNAL} className={buttonStyles({ variant: 'ghost', size: 'sm' })}>
                <ArrowUpRight className="h-4 w-4" aria-hidden />
                View post
              </a>
            )}

            {email &&
              (draft ? (
                <Link href={`/leads/review?leads=${lead.id}`} className={buttonStyles({ variant: 'primary', size: 'sm' })}>
                  <PenLine className="h-4 w-4" aria-hidden />
                  {draftState(draft) === 'sent' ? 'View email' : 'Review email'}
                </Link>
              ) : (
                <>
                  {onWriteAndSend && (
                    <Button size="sm" icon={Send} loading={writing} disabled={busy} onClick={onWriteAndSend}>
                      Write & send
                    </Button>
                  )}
                  {onWriteEmail && (
                    <Button size="sm" variant="secondary" icon={PenLine} disabled={busy || writing} onClick={onWriteEmail}>
                      Write email
                    </Button>
                  )}
                </>
              ))}

            <div className="ml-auto flex items-center gap-1">
              {contacted ? (
                <Button variant="ghost" size="sm" icon={RotateCcw} disabled={busy} onClick={() => onStatus('new')}>
                  Mark as new
                </Button>
              ) : (
                <Button variant="secondary" size="sm" icon={CheckCheck} disabled={busy} onClick={() => onStatus('contacted')}>
                  Mark contacted
                </Button>
              )}
              <IconButton icon={Trash2} label="Delete lead" tone="danger" onClick={onDelete} disabled={busy} />
            </div>
          </div>
        </div>
      </div>
    </article>
  )
}
