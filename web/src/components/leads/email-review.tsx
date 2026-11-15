'use client'

import type { EmailDraft, Lead, ResumeRecord } from '@ansly/types'
import { clsx } from 'clsx'
import {
  ArrowLeft,
  Check,
  CircleAlert,
  ExternalLink,
  FileText,
  Mail,
  Paperclip,
  RotateCcw,
  Send,
  Sparkles,
  Upload,
  X,
} from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import toast from 'react-hot-toast'
import { Dialog, useConfirm } from '@/components/dialog'
import { connectGmail, GmailStatus, useEmailConnection } from '@/components/email-connection'
import { RoleResumeDialog, openResumeFile, useRoleResumes } from '@/components/resume/role-resumes'
import {
  Alert,
  Badge,
  Button,
  Card,
  CopyButton,
  EmptyState,
  ErrorText,
  SegmentedControl,
  Skeleton,
  buttonStyles,
} from '@/components/ui'
import {
  approveEmailDraft,
  approveReadyEmailDrafts,
  rematchEmailDrafts,
  listEmailDrafts,
  listLeads,
  previewSend,
  regenerateEmailDraft,
  unapproveEmailDraft,
  updateEmailDraft,
} from '@/lib/api'
import { errorMessage } from '@/lib/format'
import {
  ERROR_LABEL,
  ISSUE_LABEL,
  STATE_BADGE,
  draftState,
  needsReview,
  sendConfirmed,
  type SendSummary,
} from '@/lib/lead-emails'
import { formatBytes } from '@/lib/resume'

type View = 'todo' | 'approved' | 'sent' | 'all'

const VIEWS = [
  { value: 'todo', label: 'To review' },
  { value: 'approved', label: 'Approved' },
  { value: 'sent', label: 'Sent' },
  { value: 'all', label: 'All' },
] as const

const CONFIDENCE_TEXT: Record<string, string> = {
  high: 'Ansly is confident',
  medium: 'Possible match',
  low: 'Weak match',
  none: 'No match',
}

/** "Senior Full Stack Engineer", from the detected role, else the post's first line. */
function draftTitle(draft: EmailDraft, lead: Lead | undefined) {
  const raw = draft.detected_role?.title ?? lead?.title ?? draft.subject
  return raw.replace(/^[^\p{L}\p{N}]+/u, '').trim() || raw
}

function inView(draft: EmailDraft, view: View, lead: Lead | undefined) {
  const state = draftState(draft)
  if (view === 'approved') return state === 'approved'
  if (view === 'sent') return state === 'sent'
  if (view === 'todo') return needsReview(draft, lead)
  return true
}

export function EmailReview({ leadIds }: { leadIds: string[] | null }) {
  const [drafts, setDrafts] = useState<EmailDraft[] | null>(null)
  const [leads, setLeads] = useState<Record<string, Lead>>({})
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<View>('todo')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const { connection, refresh: refreshConnection } = useEmailConnection()
  const library = useRoleResumes()
  const [confirm, confirmDialog] = useConfirm()
  const [sendState, setSendState] = useState<
    | { step: 'idle' }
    | { step: 'confirm'; preview: Awaited<ReturnType<typeof previewSend>>; retry: boolean }
    | { step: 'sending'; done: number; total: number }
    | { step: 'done'; summary: SendSummary }
  >({ step: 'idle' })

  const load = useCallback(async () => {
    // Drafts render as soon as they arrive; lead titles fill in when the (larger) leads list does.
    const leadsRequest = listLeads()
      .then(({ leads: leadRows }) => setLeads(Object.fromEntries(leadRows.map((l) => [l.id, l]))))
      .catch(() => undefined)
    try {
      setDrafts((await listEmailDrafts(leadIds ?? undefined)).drafts)
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    }
    await leadsRequest
  }, [leadIds])

  useEffect(() => void load(), [load])

  const visible = useMemo(() => (drafts ?? []).filter((d) => inView(d, view, leads[d.lead_id])), [drafts, view, leads])
  const viewOptions = useMemo(
    () =>
      VIEWS.map((option) => {
        const count = (drafts ?? []).filter((d) => inView(d, option.value, leads[d.lead_id])).length
        return { value: option.value, label: count ? `${option.label} ${count}` : option.label }
      }),
    [drafts, leads],
  )
  const selected = drafts?.find((d) => d.id === selectedId) ?? visible[0] ?? null
  const counts = useMemo(() => {
    const all = drafts ?? []
    return {
      approved: all.filter((d) => draftState(d) === 'approved').length,
      failed: all.filter((d) => draftState(d) === 'failed').length,
      needsResume: all.filter((d) => draftState(d) === 'needs_resume').map((d) => d.id),
      ready: all.filter((d) => d.delivery_status === 'draft' && d.issues.length === 1 && d.issues[0] === 'not_approved')
        .map((d) => d.id),
    }
  }, [drafts])
  const [bulkBusy, setBulkBusy] = useState<'match' | 'approve' | null>(null)

  const mergeDrafts = (updated: EmailDraft[]) => {
    const byId = new Map(updated.map((d) => [d.id, d]))
    setDrafts((current) => current?.map((d) => byId.get(d.id) ?? d) ?? null)
  }

  async function matchAgain() {
    const ids = counts.needsResume
    if (!ids.length) return
    setBulkBusy('match')
    const progress = toast.loading(`Matching resumes… 0 of ${ids.length}`)
    let matched = 0
    try {
      for (let i = 0; i < ids.length; i += 25) {
        const result = await rematchEmailDrafts(ids.slice(i, i + 25))
        matched += result.matched
        mergeDrafts(result.drafts)
        toast.loading(`Matching resumes… ${Math.min(i + 25, ids.length)} of ${ids.length} · ${matched} matched`, {
          id: progress,
        })
      }
      toast.success(
        matched
          ? `${matched} of ${ids.length} now have a resume. Approve them, then send.`
          : 'No new confident matches. Pick these resumes yourself.',
        { id: progress, duration: 6000 },
      )
    } catch (e) {
      toast.error(errorMessage(e), { id: progress })
    } finally {
      setBulkBusy(null)
    }
  }

  async function approveAllReady() {
    const ids = counts.ready
    if (!ids.length) return
    const ok = await confirm({
      title: `Approve ${ids.length} email${ids.length === 1 ? '' : 's'}?`,
      description:
        'Every email that has a recipient and a resume decision is approved as written. Nothing is sent until you click Send approved and confirm.',
      confirmLabel: `Approve ${ids.length}`,
      tone: 'neutral',
    })
    if (!ok) return
    setBulkBusy('approve')
    try {
      const result = await approveReadyEmailDrafts(ids)
      mergeDrafts(result.drafts)
      toast.success(`${result.approved} approved. Click Send approved to send them.`)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBulkBusy(null)
    }
  }

  const replace = (draft: EmailDraft) => setDrafts((current) => current?.map((d) => (d.id === draft.id ? draft : d)) ?? null)

  const next = (after: EmailDraft) => {
    const index = visible.findIndex((d) => d.id === after.id)
    const following = visible.slice(index + 1).find((d) => d.id !== after.id && draftState(d) !== 'sent')
    if (following) setSelectedId(following.id)
  }

  async function openSend(retry: boolean) {
    const ids = (drafts ?? [])
      .filter((d) => (retry ? draftState(d) === 'failed' : draftState(d) === 'approved'))
      .map((d) => d.id)
    if (!ids.length) return
    try {
      const preview = await previewSend({ draft_ids: ids, retry })
      setSendState({ step: 'confirm', preview, retry })
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  async function send(mayDuplicate: boolean) {
    if (sendState.step !== 'confirm' || !sendState.preview.confirm_token) return
    const { preview } = sendState
    const ids = preview.ready.map((r) => r.draft_id)
    setSendState({ step: 'sending', done: 0, total: ids.length })
    try {
      const summary = await sendConfirmed(preview.confirm_token!, ids, mayDuplicate, (done, total) =>
        setSendState({ step: 'sending', done, total }),
      )
      setSendState({ step: 'done', summary })
    } catch (e) {
      toast.error(errorMessage(e))
      setSendState({ step: 'idle' })
    }
    await load()
    void refreshConnection()
  }

  const gmailReady = connection?.connected && connection.status === 'connected'

  return (
    <div className="animate-fade-up space-y-4 pb-24">
      {confirmDialog}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/leads" className="inline-flex items-center gap-1 text-body-sm text-muted hover:text-fg">
            <ArrowLeft className="h-4 w-4" /> Leads
          </Link>
          <h1 className="mt-1 text-h2">Review emails</h1>
          <p className="text-muted">Each email is written for one lead. Check it, approve it, then send.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <GmailStatus returnTo="/leads/review" connection={connection} />
          {counts.needsResume.length > 0 && (
            <Button size="sm" variant="secondary" icon={Sparkles} loading={bulkBusy === 'match'} disabled={Boolean(bulkBusy)}
              onClick={() => void matchAgain()}>
              Match resumes again ({counts.needsResume.length})
            </Button>
          )}
          {counts.ready.length > 0 && (
            <Button size="sm" variant="secondary" icon={Check} loading={bulkBusy === 'approve'} disabled={Boolean(bulkBusy)}
              onClick={() => void approveAllReady()}>
              Approve all ready ({counts.ready.length})
            </Button>
          )}
          <SegmentedControl label="Show" size="sm" options={viewOptions} value={view} onChange={setView} />
        </div>
      </div>
      <ErrorText>{error}</ErrorText>

      {drafts === null && !error ? (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <Skeleton className="h-96 w-full rounded-xl" />
          <Skeleton className="h-96 w-full rounded-xl" />
        </div>
      ) : drafts?.length === 0 ? (
        <EmptyState
          icon={Mail}
          title="No email drafts yet"
          description="On the Leads page, select leads with an email address and click Write emails."
          action={
            <Link href="/leads" className={buttonStyles()}>
              Go to Leads
            </Link>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr] lg:items-start">
          <Card className="max-h-60 overflow-y-auto p-2 lg:sticky lg:top-4 lg:max-h-[calc(100vh-10rem)]">
            {visible.length === 0 && (
              <p className="p-4 text-body-sm text-muted">
                {view === 'todo'
                  ? 'Nothing left to review.'
                  : view === 'approved'
                    ? 'No approved emails waiting to send.'
                    : view === 'sent'
                      ? 'No sent emails yet.'
                      : 'No drafts.'}
              </p>
            )}
            <ul className="space-y-1">
              {visible.map((draft) => {
                const state = draftState(draft)
                const lead = leads[draft.lead_id]
                return (
                  <li key={draft.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(draft.id)}
                      className={clsx(
                        'w-full rounded-lg px-3 py-2.5 text-left transition',
                        selected?.id === draft.id ? 'bg-accent-soft' : 'hover:bg-surface-muted',
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="line-clamp-2 text-body-sm font-medium leading-snug">{draftTitle(draft, lead)}</span>
                        <Badge tone={STATE_BADGE[state].tone} className="shrink-0">
                          {STATE_BADGE[state].label}
                        </Badge>
                      </div>
                      <p className="mt-0.5 truncate text-caption text-muted">
                        {[draft.detected_role?.company, draft.recipient_email ?? 'No recipient'].filter(Boolean).join(' · ')}
                      </p>
                    </button>
                  </li>
                )
              })}
            </ul>
          </Card>
          {selected && (
            <DraftEditor
              key={selected.id}
              draft={selected}
              lead={leads[selected.lead_id]}
              library={library.items ?? []}
              onLibraryChanged={() => void library.refresh()}
              onChange={replace}
              onApprovedNext={(d) => {
                replace(d)
                next(d)
              }}
              confirm={confirm}
            />
          )}
        </div>
      )}

      {/* Send bar: portaled to <body> so the page's entry animation (a transform) can't pin it mid-page. */}
      {mounted && drafts && drafts.length > 0 && createPortal(
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur lg:left-64">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2">
            <p className="mr-auto min-w-0 text-body-sm text-muted">
              {counts.approved} approved{counts.failed ? ` · ${counts.failed} failed` : ''}
              {connection?.connected && ` · sending as ${connection.email_address}`}
            </p>
            {!gmailReady ? (
              connection && !connection.configured ? (
                <span className="text-body-sm text-muted">Gmail sending isn’t set up on the server. Copy emails instead.</span>
              ) : (
                <Button icon={Mail} onClick={() => void connectGmail('/leads/review')}>
                  {connection?.connected ? 'Reconnect Gmail to send' : 'Connect Gmail to send'}
                </Button>
              )
            ) : (
              <>
                {counts.failed > 0 && (
                  <Button variant="secondary" icon={RotateCcw} onClick={() => void openSend(true)}>
                    Retry failed ({counts.failed})
                  </Button>
                )}
                <Button icon={Send} disabled={!counts.approved} onClick={() => void openSend(false)}>
                  Send approved ({counts.approved})
                </Button>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}

      <SendDialog state={sendState} onClose={() => setSendState({ step: 'idle' })} onSend={send} />
    </div>
  )
}

function DraftEditor({
  draft,
  lead,
  library,
  onLibraryChanged,
  onChange,
  onApprovedNext,
  confirm,
}: {
  draft: EmailDraft
  lead: Lead | undefined
  library: ResumeRecord[]
  onLibraryChanged: () => void
  onChange: (draft: EmailDraft) => void
  onApprovedNext: (draft: EmailDraft) => void
  confirm: ReturnType<typeof useConfirm>[0]
}) {
  const [recipient, setRecipient] = useState(draft.recipient_email ?? '')
  const [subject, setSubject] = useState(draft.subject)
  const [body, setBody] = useState(draft.body)
  const [busy, setBusy] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const locked = draft.delivery_status === 'sent' || draft.delivery_status === 'sending'
  const dirty =
    recipient.trim() !== (draft.recipient_email ?? '') || subject !== draft.subject || body !== draft.body
  const state = draftState(draft)

  // Keep the editor in sync when the draft changes elsewhere (approve, attachment).
  useEffect(() => {
    if (!dirty) {
      setRecipient(draft.recipient_email ?? '')
      setSubject(draft.subject)
      setBody(draft.body)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.version])

  async function run<T>(label: string, work: () => Promise<T>): Promise<T | undefined> {
    setBusy(label)
    try {
      return await work()
    } catch (e) {
      toast.error(errorMessage(e))
      return undefined
    } finally {
      setBusy(null)
    }
  }

  const save = () =>
    run('save', async () => {
      const saved = await updateEmailDraft(draft.lead_id, {
        expected_version: draft.version,
        recipient_email: recipient.trim(),
        subject,
        body,
      })
      onChange(saved)
      toast.success('Saved')
      return saved
    })

  async function approve(andNext: boolean) {
    let current: EmailDraft | undefined = draft
    if (dirty) current = await save()
    if (!current) return
    const approved = await run('approve', () => approveEmailDraft(current.lead_id, current.version))
    if (approved) (andNext ? onApprovedNext : onChange)(approved)
  }

  async function setResume(resumeId: string | null) {
    setPickerOpen(false)
    const updated = await run('resume', () =>
      updateEmailDraft(draft.lead_id, {
        expected_version: draft.version,
        ...(resumeId ? { resume_id: resumeId } : { send_without_resume: true }),
      }),
    )
    if (updated) onChange(updated)
  }

  /** One click: attach this resume (or none), approve the email, and open the next one. Unsaved edits go with it. */
  async function attachAndApprove(resumeId: string | null) {
    const updated = await run('resume', async () => {
      const saved = await updateEmailDraft(draft.lead_id, {
        expected_version: draft.version,
        ...(dirty ? { recipient_email: recipient.trim(), subject, body } : {}),
        ...(resumeId ? { resume_id: resumeId } : { send_without_resume: true }),
      })
      return approveEmailDraft(saved.lead_id, saved.version)
    })
    if (updated) onApprovedNext(updated)
  }

  async function regenerate() {
    const ok = await confirm({
      title: 'Rewrite this email?',
      description: draft.is_user_edited
        ? 'Your edits will be replaced by a new version. You’ll need to approve it again.'
        : 'The current text is replaced by a new version. You’ll need to approve it again.',
      confirmLabel: 'Rewrite',
      tone: draft.is_user_edited ? 'danger' : 'neutral',
    })
    if (!ok) return
    const updated = await run('regenerate', () =>
      regenerateEmailDraft(draft.lead_id, {
        expected_version: draft.version,
        confirm_replace: true,
        confirm_discard_edits: draft.is_user_edited,
      }),
    )
    if (updated) {
      onChange(updated)
      setSubject(updated.subject)
      setBody(updated.body)
    }
  }

  const fullEmail = `To: ${recipient}\nSubject: ${subject}\n\n${body}`
  const issues = draft.issues.filter((i) => !(dirty && i === 'not_approved'))

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-[14rem] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATE_BADGE[state].tone} dot>
              {STATE_BADGE[state].label}
            </Badge>
            <h2 className="line-clamp-2 min-w-0 text-title leading-snug">{draftTitle(draft, lead)}</h2>
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-caption text-muted">
            {[draft.detected_role?.company, lead?.author_name].filter(Boolean).join(' · ')}
            {lead?.original_post_url && (
              <a
                href={lead.original_post_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 text-accent hover:underline"
              >
                View post <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            )}
          </p>
        </div>
        <CopyButton text={fullEmail} label="Copy email" />
      </div>

      {(draft.delivery_status === 'failed' && draft.last_error_code) || draft.delivery_status === 'sent' ? (
        <div className="px-5 pt-4">
          {draft.delivery_status === 'sent' ? (
            <Alert tone="success" title="Sent through Gmail">
              {draft.sent_at ? new Date(draft.sent_at).toLocaleString() : ''} · The lead is marked Contacted.
            </Alert>
          ) : (
            <Alert tone={draft.last_error_code === 'outcome_unknown' ? 'warning' : 'danger'} title="Not sent">
              {ERROR_LABEL[draft.last_error_code ?? ''] ?? draft.last_error_code}
            </Alert>
          )}
        </div>
      ) : null}

      {/* Email header, laid out like a mail client */}
      <div className="mt-2 divide-y divide-border border-b border-border">
        <label htmlFor="draft-to" className="grid grid-cols-[4.5rem_1fr] items-center gap-3 px-5 py-2.5">
          <span className="text-body-sm text-muted">To</span>
          {locked ? (
            <span className="truncate text-body">{recipient}</span>
          ) : (
            <input
              id="draft-to"
              type="email"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              className="-mx-2 w-[calc(100%+1rem)] min-w-0 rounded-md bg-transparent px-2 py-1 text-body text-fg transition placeholder:text-subtle hover:bg-surface-muted/60 focus:bg-surface-muted focus:outline-none"
              placeholder="name@company.com"
            />
          )}
        </label>
        {!locked && draft.post_email && recipient.trim() && recipient.trim() !== draft.post_email && (
          <p className="px-5 py-1.5 text-caption text-warning">
            Different from the address in the post ({draft.post_email}).
          </p>
        )}
        <label htmlFor="draft-subject" className="grid grid-cols-[4.5rem_1fr] items-center gap-3 px-5 py-2.5">
          <span className="text-body-sm text-muted">Subject</span>
          {locked ? (
            <span className="truncate text-body font-medium">{subject}</span>
          ) : (
            <input
              id="draft-subject"
              value={subject}
              maxLength={200}
              onChange={(e) => setSubject(e.target.value)}
              className="-mx-2 w-[calc(100%+1rem)] min-w-0 rounded-md bg-transparent px-2 py-1 text-body font-medium text-fg transition hover:bg-surface-muted/60 focus:bg-surface-muted focus:outline-none"
            />
          )}
        </label>
      </div>

      {/* Message: grows with the email, no inner scrolling */}
      <div className="px-5 py-4">
        {locked ? (
          <div className="whitespace-pre-wrap text-body leading-relaxed text-fg/90 [overflow-wrap:anywhere]">{body}</div>
        ) : (
          <>
            <label htmlFor="draft-body" className="sr-only">
              Message
            </label>
            <textarea
              id="draft-body"
              value={body}
              maxLength={10000}
              onChange={(e) => setBody(e.target.value)}
              className="-mx-2 block min-h-[24rem] w-[calc(100%+1rem)] resize-none rounded-lg bg-transparent px-2 py-1.5 text-body leading-relaxed text-fg transition hover:bg-surface-muted/40 focus:bg-surface-muted/50 focus:outline-none [field-sizing:content]"
            />
            <p className="mt-2 text-right text-caption tabular-nums text-subtle">{body.length.toLocaleString()} / 10,000</p>
          </>
        )}
      </div>

      <div className="space-y-3 border-t border-border px-5 py-4">
        <AttachmentCard
          draft={draft}
          locked={locked}
          busy={busy === 'resume'}
          library={library}
          onChange={() => setPickerOpen(true)}
          onQuickPick={(resumeId) => void attachAndApprove(resumeId)}
        />
        {!locked && issues.length > 0 && (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-body-sm">
            {issues.map((issue) => (
              <li key={issue} className="flex items-center gap-1.5 text-muted">
                <CircleAlert className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
                {ISSUE_LABEL[issue] ?? issue}
              </li>
            ))}
          </ul>
        )}
      </div>

      {!locked && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-surface-muted/40 px-5 py-3">
          <Button variant="secondary" size="sm" onClick={() => void save()} disabled={!dirty} loading={busy === 'save'}>
            {dirty ? 'Save' : 'Saved'}
          </Button>
          <Button variant="ghost" size="sm" icon={Sparkles} onClick={() => void regenerate()} loading={busy === 'regenerate'}>
            Rewrite
          </Button>
          <span className="flex-1" />
          {draft.approved && !dirty ? (
            <Button
              variant="ghost"
              size="sm"
              icon={X}
              onClick={() => void run('approve', () => unapproveEmailDraft(draft.lead_id, draft.version)).then((d) => d && onChange(d))}
            >
              Unapprove
            </Button>
          ) : (
            <>
              <Button variant="secondary" size="sm" icon={Check} onClick={() => void approve(false)} loading={busy === 'approve'}>
                Approve
              </Button>
              <Button size="sm" icon={Check} onClick={() => void approve(true)} disabled={busy === 'approve'}>
                Approve & next
              </Button>
            </>
          )}
        </div>
      )}

      <ResumePicker
        open={pickerOpen}
        draft={draft}
        library={library}
        onClose={() => setPickerOpen(false)}
        onPick={(id) => void setResume(id)}
        onUpload={() => {
          setPickerOpen(false)
          setUploadOpen(true)
        }}
      />
      <RoleResumeDialog
        open={uploadOpen}
        defaultLabel={draft.detected_role?.title ?? ''}
        onClose={() => setUploadOpen(false)}
        onDone={(resume) => {
          onLibraryChanged()
          void setResume(resume.id)
        }}
      />
    </Card>
  )
}

function AttachmentCard({
  draft,
  locked,
  busy,
  library,
  onChange,
  onQuickPick,
}: {
  draft: EmailDraft
  locked: boolean
  busy: boolean
  library: ResumeRecord[]
  onChange: () => void
  /** Attach this resume (null: none), approve, and move on. */
  onQuickPick: (resumeId: string | null) => void
}) {
  const resume = draft.resume
  return (
    <div
      className={clsx(
        'rounded-xl border p-4',
        draft.resume_selection === 'needs_selection' ? 'border-warning/40 bg-warning-soft/40' : 'border-border',
      )}
    >
      <div className="flex flex-wrap items-start gap-3">
        <Paperclip className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
        <div className="min-w-[12rem] flex-1 text-body-sm">
          {resume ? (
            <>
              <p className="font-medium">{resume.label ?? resume.name}</p>
              <p className="text-caption text-muted [overflow-wrap:anywhere]">
                {[resume.file_name, resume.file_type.toUpperCase(), formatBytes(resume.file_size)].filter(Boolean).join(' · ')}
              </p>
              <p className="mt-1 text-caption text-muted">
                {draft.resume_selection === 'auto' ? `Chosen by Ansly: ${draft.match_reason ?? ''}` : 'Chosen by you.'}
              </p>
            </>
          ) : draft.resume_selection === 'none_by_user' ? (
            <p className="text-muted">No resume attached (your choice).</p>
          ) : (
            <>
              <p className="font-medium text-fg">Choose a resume for this role</p>
              <p className="text-caption text-muted">
                {draft.match_confidence && draft.match_confidence !== 'none'
                  ? `${CONFIDENCE_TEXT[draft.match_confidence]}: ${draft.match_reason ?? ''}`
                  : draft.match_reason ?? 'None of your role resumes clearly fits this role.'}
              </p>
            </>
          )}
        </div>
        <div className="flex gap-1">
          {resume && (
            <Button variant="ghost" size="sm" icon={ExternalLink} onClick={() => void openResumeFile(resume)}>
              Open
            </Button>
          )}
          {!locked && (
            <Button variant="secondary" size="sm" onClick={onChange} loading={busy}>
              {resume || draft.resume_selection === 'none_by_user' ? 'Change' : 'Choose'}
            </Button>
          )}
        </div>
      </div>
      {!locked && draft.resume_selection === 'needs_selection' && library.length > 0 && (
        <div className="mt-3 border-t border-warning/20 pt-3">
          <p className="mb-2 text-caption text-muted">Attach & approve in one click:</p>
          <div className="flex flex-wrap gap-2">
            {library.map((option) => (
              <Button
                key={option.id}
                size="sm"
                variant="secondary"
                icon={Check}
                disabled={busy}
                onClick={() => onQuickPick(option.id)}
                title={`Attach ${option.fileName ?? option.name}, approve, and open the next email`}
              >
                {option.roleLabel}
              </Button>
            ))}
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onQuickPick(null)}>
              No resume
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function ResumePicker({
  open,
  draft,
  library,
  onClose,
  onPick,
  onUpload,
}: {
  open: boolean
  draft: EmailDraft
  library: ResumeRecord[]
  onClose: () => void
  onPick: (resumeId: string | null) => void
  onUpload: () => void
}) {
  return (
    <Dialog open={open} onClose={onClose} labelledBy="picker-title" wide>
      <h2 id="picker-title" className="text-title">
        Attach a resume
      </h2>
      <p className="mt-1 text-body-sm text-muted">
        For {draft.detected_role?.title ?? 'this role'}. The file is attached exactly as uploaded.
      </p>
      <ul className="mt-4 max-h-80 space-y-2 overflow-y-auto">
        {library.length === 0 && <li className="text-body-sm text-muted">You haven’t added role resumes yet.</li>}
        {library.map((resume) => (
          <li key={resume.id}>
            <button
              type="button"
              onClick={() => onPick(resume.id)}
              className={clsx(
                'flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition hover:border-accent/50',
                draft.resume?.id === resume.id ? 'border-accent bg-accent-soft' : 'border-border',
              )}
            >
              <FileText className="h-4 w-4 shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body-sm font-medium">{resume.roleLabel}</span>
                <span className="block truncate text-caption text-muted">
                  {resume.fileName ?? resume.name}
                  {resume.roleNote ? ` · ${resume.roleNote}` : ''}
                </span>
              </span>
              {draft.resume?.id === resume.id && <Check className="h-4 w-4 text-accent" aria-hidden />}
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-5 flex flex-wrap justify-between gap-2">
        <Button variant="secondary" icon={Upload} onClick={onUpload}>
          Upload a resume for this role
        </Button>
        <Button variant="ghost" onClick={() => onPick(null)}>
          Send without a resume
        </Button>
      </div>
    </Dialog>
  )
}

function SendDialog({
  state,
  onClose,
  onSend,
}: {
  state:
    | { step: 'idle' }
    | { step: 'confirm'; preview: Awaited<ReturnType<typeof previewSend>>; retry: boolean }
    | { step: 'sending'; done: number; total: number }
    | { step: 'done'; summary: SendSummary }
  onClose: () => void
  onSend: (mayDuplicate: boolean) => void
}) {
  const [mayDuplicateOk, setMayDuplicateOk] = useState(false)
  useEffect(() => setMayDuplicateOk(false), [state.step])
  const open = state.step !== 'idle'

  return (
    <Dialog open={open} onClose={() => state.step !== 'sending' && onClose()} labelledBy="send-title" wide>
      {state.step === 'confirm' && (
        <>
          <h2 id="send-title" className="text-title">
            {state.preview.ready.length
              ? `Send ${state.preview.ready.length} email${state.preview.ready.length === 1 ? '' : 's'}?`
              : 'Nothing ready to send'}
          </h2>
          {state.preview.connection_email && (
            <p className="mt-1 text-body-sm text-muted">From {state.preview.connection_email} through Gmail.</p>
          )}
          {state.preview.connection_issue && (
            <Alert tone="warning" className="mt-3" title={ERROR_LABEL[state.preview.connection_issue] ?? 'Gmail unavailable'} />
          )}
          <ul className="mt-4 max-h-72 space-y-2 overflow-y-auto">
            {state.preview.ready.map((item) => (
              <li key={item.draft_id} className="rounded-lg border border-border px-3 py-2 text-body-sm">
                <p className="truncate font-medium">{item.recipient_email}</p>
                <p className="truncate text-caption text-muted">{item.subject}</p>
                <p className="text-caption text-muted">
                  {item.attachment_name ? `📎 ${item.attachment_name}` : 'No attachment'}
                  {item.may_duplicate && ' · may already have been sent'}
                </p>
              </li>
            ))}
          </ul>
          {state.preview.excluded.length > 0 && (
            <p className="mt-3 text-caption text-muted">
              Not included: {state.preview.excluded.length} (
              {Array.from(new Set(state.preview.excluded.flatMap((e) => e.issues)))
                .map((i) => ISSUE_LABEL[i] ?? i)
                .join(', ')}
              )
            </p>
          )}
          {state.preview.ready.some((r) => r.may_duplicate) && (
            <label className="mt-3 flex items-start gap-2 text-body-sm">
              <input
                type="checkbox"
                checked={mayDuplicateOk}
                onChange={(e) => setMayDuplicateOk(e.target.checked)}
                className="mt-1 h-4 w-4 accent-[rgb(var(--accent))]"
              />
              I checked Gmail’s Sent folder; these weren’t sent. Send them again.
            </label>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              icon={Send}
              disabled={
                !state.preview.confirm_token ||
                (state.preview.ready.some((r) => r.may_duplicate) && !mayDuplicateOk)
              }
              onClick={() => onSend(mayDuplicateOk)}
            >
              Send {state.preview.ready.length}
            </Button>
          </div>
        </>
      )}
      {state.step === 'sending' && (
        <div aria-live="polite">
          <h2 id="send-title" className="text-title">
            Sending… {state.done} of {state.total}
          </h2>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-muted">
            <div className="h-full bg-accent transition-all" style={{ width: `${Math.max(4, (state.done / state.total) * 100)}%` }} />
          </div>
          <p className="mt-3 text-body-sm text-muted">Keep this tab open until it finishes.</p>
        </div>
      )}
      {state.step === 'done' && (
        <div aria-live="polite">
          <h2 id="send-title" className="text-title">
            {state.summary.sent} sent{state.summary.failed.length ? `, ${state.summary.failed.length} failed` : ''}
          </h2>
          {state.summary.stopped && (
            <Alert tone="warning" className="mt-3" title="Stopped early">
              {ERROR_LABEL[state.summary.stopped] ?? state.summary.stopped}. {state.summary.notAttempted} not attempted.
            </Alert>
          )}
          {state.summary.failed.length > 0 && (
            <ul className="mt-3 space-y-1 text-body-sm">
              {state.summary.failed.map((f) => (
                <li key={f.draftId} className="text-muted">
                  {ERROR_LABEL[f.code ?? ''] ?? f.message ?? 'Failed'}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-body-sm text-muted">
            Sent leads are marked Contacted. Failed emails keep their text; use Retry failed when you’re ready.
          </p>
          <div className="mt-5 flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}
