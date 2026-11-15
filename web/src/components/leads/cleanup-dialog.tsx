'use client'

import type { CleanupResult } from '@ansly/types'
import { clsx } from 'clsx'
import { CircleAlert, Trash2, WandSparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Dialog } from '@/components/dialog'
import { Badge, Button } from '@/components/ui'
import { CLEANUP_CATEGORY_LABEL, type CleanupSummary } from '@/lib/lead-cleanup'

export type CleanupState =
  | { step: 'idle' }
  | { step: 'running'; done: number; total: number; removed: number }
  | { step: 'done'; summary: CleanupSummary }

type Choice = 'remove' | 'keep'

/** Progress, then what Ansly Cleanup removed and the leads it wants the user to decide on, one by one. */
export function CleanupDialog({
  state,
  onClose,
  onRemove,
}: {
  state: CleanupState
  onClose: () => void
  /** Deletes the leads the user chose to remove; resolves when done. */
  onRemove: (ids: string[]) => Promise<void>
}) {
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const [removing, setRemoving] = useState(false)
  const summary = state.step === 'done' ? state.summary : null
  useEffect(() => setChoices({}), [summary])

  const review = summary?.review ?? []
  const chosenRemove = review.filter((r) => choices[r.lead_id] === 'remove').map((r) => r.lead_id)
  const undecided = review.filter((r) => !choices[r.lead_id]).length
  const setAll = (choice: Choice) => setChoices(Object.fromEntries(review.map((r) => [r.lead_id, choice])))

  const apply = async () => {
    setRemoving(true)
    try {
      await onRemove(chosenRemove)
      onClose()
    } catch {
      // onRemove reported the error; the choices stay so the user can try again.
    } finally {
      setRemoving(false)
    }
  }

  return (
    <Dialog open={state.step !== 'idle'} onClose={() => state.step === 'done' && !removing && onClose()} labelledBy="cleanup-title" wide>
      <div className="flex items-center gap-2">
        <WandSparkles className="h-5 w-5 text-accent" aria-hidden />
        <h2 id="cleanup-title" className="text-title">
          Ansly Cleanup
        </h2>
      </div>

      {state.step === 'running' && (
        <div className="mt-4 space-y-3" role="status">
          <p className="text-body-sm text-muted">
            Checking {state.done} of {state.total} leads against your profile… {state.removed} removed so far.
          </p>
          <div className="h-2 overflow-hidden rounded-full bg-surface-muted">
            <div
              className="h-full rounded-full bg-accent transition-[width]"
              style={{ width: `${state.total ? Math.round((state.done / state.total) * 100) : 0}%` }}
            />
          </div>
        </div>
      )}

      {summary && (
        <div className="mt-4 space-y-5">
          <p className="text-body-sm text-muted">
            {summary.removed.length} removed · {summary.review.length} for you to check · {summary.kept} kept
            {summary.unchecked ? ` (${summary.unchecked} couldn’t be checked and were kept)` : ''}
            {summary.failed.length ? ` · ${summary.failed.length} not checked (request failed)` : ''}.
          </p>

          {review.length > 0 && (
            <section aria-labelledby="cleanup-review" className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id="cleanup-review" className="flex items-center gap-1.5 text-body font-medium">
                  <CircleAlert className="h-4 w-4 text-warning" aria-hidden />
                  Ansly isn’t sure: remove these?
                </h3>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setAll('remove')}>
                    Remove all
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setAll('keep')}>
                    Keep all
                  </Button>
                </div>
              </div>
              <ul className="space-y-2">
                {review.map((result) => (
                  <ResultRow
                    key={result.lead_id}
                    result={result}
                    choice={choices[result.lead_id]}
                    onChoose={(choice) => setChoices((c) => ({ ...c, [result.lead_id]: choice }))}
                  />
                ))}
              </ul>
            </section>
          )}

          {summary.removed.length > 0 && (
            <details className="rounded-xl border border-border p-3">
              <summary className="cursor-pointer text-body-sm font-medium">
                Removed {summary.removed.length} clear non-match{summary.removed.length === 1 ? '' : 'es'}
              </summary>
              <ul className="mt-2 space-y-2">
                {summary.removed.map((result) => (
                  <ResultRow key={result.lead_id} result={result} />
                ))}
              </ul>
            </details>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2">
            {review.length > 0 && undecided > 0 && (
              <span className="mr-auto text-caption text-muted">Leads you don’t choose for are kept.</span>
            )}
            <Button variant="secondary" onClick={onClose} disabled={removing}>
              {chosenRemove.length ? 'Keep all and close' : 'Done'}
            </Button>
            {chosenRemove.length > 0 && (
              <Button variant="danger" icon={Trash2} loading={removing} onClick={() => void apply()}>
                Remove {chosenRemove.length}
              </Button>
            )}
          </div>
        </div>
      )}
    </Dialog>
  )
}

function ResultRow({
  result,
  choice,
  onChoose,
}: {
  result: CleanupResult
  choice?: Choice
  onChoose?: (choice: Choice) => void
}) {
  return (
    <li
      className={clsx(
        'rounded-lg border p-3',
        choice === 'remove' ? 'border-danger/40 bg-danger/5' : choice === 'keep' ? 'border-success/40' : 'border-border',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-body-sm font-medium">{result.title || 'Untitled lead'}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone={result.category === 'job_seeker' ? 'warning' : 'neutral'}>
              {CLEANUP_CATEGORY_LABEL[result.category]}
            </Badge>
            {result.contacted && <Badge tone="success">Contacted</Badge>}
          </div>
        </div>
        {onChoose && (
          <div className="flex gap-1" role="group" aria-label={`Decide on ${result.title ?? 'this lead'}`}>
            <Button size="sm" variant={choice === 'keep' ? 'primary' : 'secondary'} aria-pressed={choice === 'keep'} onClick={() => onChoose('keep')}>
              Keep
            </Button>
            <Button size="sm" variant={choice === 'remove' ? 'danger' : 'secondary'} aria-pressed={choice === 'remove'} onClick={() => onChoose('remove')}>
              Remove
            </Button>
          </div>
        )}
      </div>
      <p className="mt-2 text-body-sm">{result.reason}</p>
      {(result.included_keywords.length > 0 || result.excluded_keywords.length > 0) && (
        <p className="mt-1 text-caption text-muted">
          {result.included_keywords.length > 0 && <>Your keywords: {result.included_keywords.join(', ')}. </>}
          {result.excluded_keywords.length > 0 && <>Excluded: {result.excluded_keywords.join(', ')}.</>}
        </p>
      )}
      {result.description && (
        <p className="mt-2 line-clamp-4 whitespace-pre-line text-caption text-muted">{result.description}</p>
      )}
    </li>
  )
}
