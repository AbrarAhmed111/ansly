'use client'

import type { MemoryConflict, MemoryItem, MemoryResponse, MemoryScope } from '@ansly/types'
import { Brain, Check, History, Pencil, RotateCcw, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useConfirm } from '@/components/dialog'
import {
  Alert,
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorText,
  IconButton,
  Input,
  PageHeader,
  Select,
  Skeleton,
  Stat,
} from '@/components/ui'
import { confirmMemory, deleteMemory, getMemory, resolveMemoryConflict, updateMemory } from '@/lib/api'
import { errorMessage, timeAgo } from '@/lib/format'

const SCOPE_LABELS: Record<MemoryScope, string> = {
  global: 'All applications',
  category: 'General preference',
  company: 'One company',
  job: 'One application',
}

const SOURCE_LABELS: Record<MemoryItem['sourceType'], string> = {
  profile: 'Your profile',
  skills: 'Your profile',
  ask_and_learn: 'You answered this during a job application',
  web: 'You added this on the web',
  onboarding: 'You answered this during setup',
  memory_edit: 'You edited this',
}

/** Where a fact came from, in a sentence: provenance is what makes memory trustworthy. */
function provenance(item: MemoryItem): string {
  if (item.sourceType === 'profile' || item.sourceType === 'skills') return item.sourceLabel ?? 'Your profile'
  if (item.sourceType === 'ask_and_learn' && item.sourceLabel) {
    const when = item.createdAt ? `, ${new Date(item.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}` : ''
    return `Asked during an application to ${item.sourceLabel}${when}`
  }
  return SOURCE_LABELS[item.sourceType]
}

function ItemEditor({ item, onDone }: { item: MemoryItem; onDone: (changed: boolean) => void }) {
  const [value, setValue] = useState(item.value)
  const [scope, setScope] = useState<MemoryScope>(item.scope)
  const [company, setCompany] = useState(item.company ?? '')
  const [busy, setBusy] = useState(false)
  const fromProfile = item.id.startsWith('profile:')
  const scopes = (Object.keys(SCOPE_LABELS) as MemoryScope[]).filter((s) => s !== 'job' || item.scope === 'job')

  async function save() {
    if (!value.trim()) return toast.error('Give it a value, or delete it instead')
    setBusy(true)
    try {
      await updateMemory(item.id, {
        value: value.trim() !== item.value ? value.trim() : null,
        ...(fromProfile || scope === item.scope ? {} : { scope, company: scope === 'company' ? company.trim() : null }),
      })
      toast.success('Application Memory updated')
      onDone(true)
    } catch (e) {
      toast.error(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-accent/30 bg-accent-soft/40 p-3">
      {item.options ? (
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={item.label}>
          {item.options.map((o) => (
            <Chip key={o} role="radio" aria-checked={value === o} selected={value === o} onClick={() => setValue(o)}>{o}</Chip>
          ))}
        </div>
      ) : (
        <Input aria-label={item.label} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
      )}
      {!fromProfile && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-body-sm text-muted" htmlFor={`scope-${item.id}`}>Applies to</label>
          <Select id={`scope-${item.id}`} value={scope} onChange={(e) => setScope(e.target.value as MemoryScope)} className="w-auto">
            {scopes.map((s) => <option key={s} value={s}>{SCOPE_LABELS[s]}</option>)}
          </Select>
          {scope === 'company' && (
            <Input aria-label="Company" placeholder="Company" value={company} onChange={(e) => setCompany(e.target.value)} className="w-48" />
          )}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={() => onDone(false)}>Cancel</Button>
        <Button size="sm" onClick={save} loading={busy}>Update</Button>
      </div>
    </div>
  )
}

function MemoryRow({ item, onChanged, confirm }: {
  item: MemoryItem
  onChanged: () => void
  confirm: ReturnType<typeof useConfirm>[0]
}) {
  const [editing, setEditing] = useState(false)
  const learned = item.sourceType !== 'profile' && item.sourceType !== 'skills'

  async function run(action: () => Promise<unknown>, done: string) {
    try {
      await action()
      toast.success(done)
      onChanged()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  async function remove() {
    const ok = await confirm({
      title: `Forget “${item.label}”?`,
      description: item.sourceType === 'profile'
        ? 'This clears it from your profile. Ansly will ask again the next time an application needs it.'
        : 'Ansly will stop using it and ask again the next time an application needs it.',
      confirmLabel: 'Forget',
    })
    if (ok) await run(() => deleteMemory(item.id), 'Forgotten')
  }

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-start gap-3">
        <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-body">
            <span className="font-medium">{item.label}</span>
            <span className="text-muted">: </span>
            {item.value}
          </p>
          <p className="mt-0.5 text-caption text-muted">
            {provenance(item)}
            {item.updatedAt && <> · Last updated {timeAgo(item.updatedAt)}</>}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {learned && <Badge tone={item.scope === 'job' || item.scope === 'company' ? 'warning' : 'neutral'}>
              {item.scope === 'company' && item.company ? `Only ${item.company}` : SCOPE_LABELS[item.scope]}
            </Badge>}
            {item.answersDirectly && <Badge tone="accent">Answers instantly</Badge>}
          </div>
          {item.stale && !editing && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-warning/25 bg-warning-soft px-3 py-2 text-body-sm">
              <span className="text-fg">Still accurate? Last confirmed {timeAgo(item.lastConfirmedAt)}.</span>
              <Button size="sm" variant="secondary" onClick={() => void run(() => confirmMemory(item.id), 'Thanks, confirmed')}>Yes</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Update</Button>
            </div>
          )}
          {editing && <ItemEditor item={item} onDone={(changed) => { setEditing(false); if (changed) onChanged() }} />}
        </div>
        {!editing && (
          <div className="-mr-1.5 -mt-1 flex shrink-0 gap-0.5">
            {item.sourceType !== 'skills' && <IconButton icon={Pencil} label={`Edit ${item.label}`} onClick={() => setEditing(true)} />}
            {learned && (
              <IconButton icon={History} label={`Mark ${item.label} outdated`}
                onClick={() => void run(() => updateMemory(item.id, { status: 'outdated' }), 'Marked outdated: Ansly won’t use it')} />
            )}
            <IconButton icon={Trash2} label={`Forget ${item.label}`} tone="danger" onClick={() => void remove()} />
          </div>
        )}
      </div>
    </li>
  )
}

function ConflictCard({ conflict, onResolved }: { conflict: MemoryConflict; onResolved: (data: MemoryResponse) => void }) {
  const [busy, setBusy] = useState<'profile' | 'memory' | null>(null)
  async function resolve(use: 'profile' | 'memory') {
    if (!conflict.otherId) return
    setBusy(use)
    try {
      onResolved(await resolveMemoryConflict({ id: conflict.otherId, use }))
      toast.success('Resolved')
    } catch (e) {
      toast.error(errorMessage(e))
      setBusy(null)
    }
  }
  const winner = conflict.winnerSource === 'profile' ? 'Profile' : 'Newer memory'
  return (
    <Card className="border-warning/40">
      <div className="flex items-start gap-3">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="font-medium">Ansly found conflicting information: {conflict.label}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-body-sm">
            <dt className="text-muted">{winner}</dt><dd>{conflict.winner} <span className="text-muted">(used now)</span></dd>
            <dt className="text-muted">{conflict.otherId?.startsWith('skill:') ? 'Application Memory' : 'Older application memory'}</dt><dd>{conflict.other}</dd>
          </dl>
          <p className="text-caption text-muted">{conflict.rule}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" loading={busy === 'profile'} onClick={() => void resolve('profile')}>
              Use {conflict.winnerSource === 'profile' ? 'profile' : 'newer answer'}
            </Button>
            {conflict.otherId?.startsWith('skill:') ? (
              <span className="text-caption text-muted">Or remove it from that experience on your profile.</span>
            ) : (
              <Button size="sm" variant="ghost" loading={busy === 'memory'} onClick={() => void resolve('memory')}>Use older memory</Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}

export default function MemoryPage() {
  const [data, setData] = useState<MemoryResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [confirm, confirmDialog] = useConfirm()

  const load = useCallback(async () => {
    try {
      setData(await getMemory())
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [])
  useEffect(() => void load(), [load])

  const active = data?.items.filter((i) => i.status === 'active') ?? []
  const history = data?.items.filter((i) => i.status !== 'active') ?? []
  const groups = (data?.groups ?? []).map((g) => ({ group: g, items: active.filter((i) => i.group === g) })).filter((g) => g.items.length)

  return (
    <>
      <PageHeader
        title="Application Memory"
        description="Everything Ansly has learned outside your resume: what you told it while applying, and the preferences on your profile. It answers similar questions from here, instantly."
      />
      {confirmDialog}

      <Alert tone="accent" title="Ansly only remembers what you choose to save" className="mb-6">
        Facts are added when you tick “Remember this”, never from generated text. Your profile always wins over older
        memory. Edit or forget anything here.
      </Alert>

      {error && <ErrorText>{error}</ErrorText>}

      {!data && !error && (
        <div className="space-y-4" aria-busy="true" aria-label="Loading Application Memory">
          <div className="grid gap-4 sm:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div>
          {[0, 1].map((i) => <Skeleton key={i} className="h-40" />)}
        </div>
      )}

      {data && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Learned facts" value={data.counts.learned} icon={Brain} hint="From your applications" />
            <Stat label="Application preferences" value={data.counts.preferences} icon={ShieldCheck} hint="Scoped to a role, company or job" />
            <Stat label="From your profile" value={data.counts.profile} icon={Check} hint="Always used first" />
          </div>

          {data.conflicts.length > 0 && (
            <section aria-labelledby="conflicts" className="space-y-3">
              <h2 id="conflicts" className="text-title">Needs your decision</h2>
              {data.conflicts.map((c) => <ConflictCard key={`${c.key}-${c.otherId}`} conflict={c} onResolved={setData} />)}
            </section>
          )}

          {groups.length === 0 ? (
            <EmptyState
              icon={Brain}
              title="Nothing learned yet"
              description="When an application asks something your profile doesn't cover, Ansly asks you once, right on the page. Tick “Remember this” and it shows up here."
              action={<Link href="/playground" className="text-accent underline">Try a question</Link>}
            />
          ) : (
            groups.map(({ group, items }) => (
              <Card key={group}>
                <h2 className="mb-3 text-title">{group}</h2>
                <ul className="divide-y divide-border">
                  {items.map((item) => <MemoryRow key={item.id} item={item} onChanged={() => void load()} confirm={confirm} />)}
                </ul>
              </Card>
            ))
          )}

          {history.length > 0 && (
            <section>
              <Button variant="ghost" size="sm" icon={History} aria-expanded={showHistory} onClick={() => setShowHistory((v) => !v)}>
                {showHistory ? 'Hide' : 'Show'} outdated and replaced ({history.length})
              </Button>
              {showHistory && (
                <Card className="mt-3">
                  <p className="mb-3 text-body-sm text-muted">Ansly doesn’t use these. Replaced ones were overridden by your profile.</p>
                  <ul className="divide-y divide-border">
                    {history.map((item) => (
                      <li key={item.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                        <div className="min-w-0 flex-1">
                          <p className="text-body text-muted"><span className="font-medium text-fg">{item.label}</span>: {item.value}</p>
                          <p className="text-caption text-subtle">{item.status === 'superseded' ? 'Replaced by your profile' : 'Marked outdated'} · {provenance(item)}</p>
                        </div>
                        <IconButton icon={RotateCcw} label={`Use ${item.label} again`}
                          onClick={() => void confirmMemory(item.id).then(() => { toast.success('Restored'); void load() }, (e) => toast.error(errorMessage(e)))} />
                        <IconButton icon={Trash2} label={`Forget ${item.label}`} tone="danger"
                          onClick={() => void deleteMemory(item.id).then(() => { toast.success('Forgotten'); void load() }, (e) => toast.error(errorMessage(e)))} />
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </section>
          )}
        </div>
      )}
    </>
  )
}
