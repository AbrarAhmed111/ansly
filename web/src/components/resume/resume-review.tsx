'use client'

import type { ReviewItemOption, TailoringReviewChange, UpdateTailoringChangeRequest } from '@ansly/types'
import { Check, Pencil, RotateCcw, X } from 'lucide-react'
import { useState } from 'react'
import toast from 'react-hot-toast'
import { Badge, Button, Card, CardHeader, Select, Textarea } from '@/components/ui'
import { updateTailoringChange } from '@/lib/api'
import { errorMessage } from '@/lib/format'

const SECTIONS = [
  ['summary', 'Professional Summary'],
  ['headline', 'Professional Title'],
  ['skills', 'Skills and Keywords'],
  ['experience', 'Work Experience'],
  ['projects', 'Projects'],
  ['achievements', 'Achievements'],
  ['education', 'Education'],
] as const

function statusTone(status: TailoringReviewChange['status']) {
  if (status === 'accepted') return 'success'
  if (status === 'rejected') return 'danger'
  if (status === 'reverted') return 'warning'
  return 'neutral'
}

function evidenceLabel(status: TailoringReviewChange['evidenceStatus']) {
  switch (status) {
    case 'demonstrated':
      return 'Supported by your information'
    case 'potential':
      return 'Potential experience — confirm it'
    case 'unconfirmed':
      return 'Not yet confirmed'
    default:
      return 'Resume-based suggestion'
  }
}

export function ResumeReview({
  tailoringId,
  changes,
  items,
  onSaved,
}: {
  tailoringId: string
  changes: TailoringReviewChange[]
  items: ReviewItemOption[]
  onSaved: () => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [targets, setTargets] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)

  async function update(change: TailoringReviewChange, request: UpdateTailoringChangeRequest) {
    setBusy(change.id)
    try {
      await updateTailoringChange(tailoringId, change.id, request)
      setEditing(null)
      toast.success(
        request.action === 'accept' ? 'Change applied to your tailored resume' :
          request.action === 'reject' ? 'Suggestion skipped' :
            request.action === 'revert' ? 'Change reverted' : 'Edit saved',
      )
      onSaved()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardHeader
        title="Resume Review"
        description="Review every suggestion before it reaches your download. Changes are independent; revert any accepted change at any time."
      />
      {changes.length === 0 ? (
        <p className="mt-4 text-muted">No suggestions were generated. Your downloadable resume remains based on your original.</p>
      ) : (
        <div className="mt-4 space-y-6">
          {SECTIONS.map(([section, title]) => {
            const suggestions = changes.filter((change) => change.section === section)
            if (suggestions.length === 0) return null
            return (
              <section key={section} aria-label={title}>
                <h3 className="mb-3 text-body font-semibold">{title}</h3>
                <div className="space-y-3">
                  {suggestions.map((change) => {
                    const potential = change.confirmationRequired && change.change.action === 'add_bullet'
                    const isEditing = editing === change.id
                    const target = targets[change.id] ?? ''
                    const text = values[change.id] ?? ''
                    const canConfirmPotential = potential && Boolean(target && text.trim())
                    return (
                      <article key={change.id} className="rounded-lg border border-border bg-surface-muted/30 p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={statusTone(change.status)}>{change.status}</Badge>
                          <Badge>{evidenceLabel(change.evidenceStatus)}</Badge>
                          {change.item && <span className="text-caption text-subtle">{change.item}</span>}
                        </div>
                        {change.originalValue && (
                          <div className="mt-3">
                            <p className="text-caption font-medium text-subtle">Original</p>
                            <p className="mt-1 whitespace-pre-wrap text-body-sm">{change.originalValue}</p>
                          </div>
                        )}
                        <div className="mt-3">
                          <p className="text-caption font-medium text-subtle">
                            {potential ? 'Potential addition' : 'Suggested'}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-body-sm">
                            {change.suggestedValue || 'Add accurate details about this experience.'}
                          </p>
                        </div>
                        <p className="mt-3 text-caption text-muted">{change.reason}</p>

                        {potential && change.status !== 'accepted' && (
                          <div className="mt-3 grid gap-3">
                            <Select
                              value={target}
                              onChange={(event) => setTargets((current) => ({ ...current, [change.id]: event.target.value }))}
                              aria-label="Choose the job or project for this experience"
                            >
                              <option value="">Choose a job or project</option>
                              {items.map((item) => (
                                <option key={`${item.section}:${item.id}`} value={`${item.section}:${item.id}`}>
                                  {item.label}
                                </option>
                              ))}
                            </Select>
                            <Textarea
                              rows={3}
                              value={text}
                              onChange={(event) => setValues((current) => ({ ...current, [change.id]: event.target.value }))}
                              placeholder="Describe what you personally did. Include only accurate details; do not guess at metrics."
                              aria-label="Describe your confirmed experience"
                            />
                            <p className="text-caption text-subtle">
                              This isn’t added unless you confirm it. Your description becomes the resume bullet.
                            </p>
                          </div>
                        )}

                        {isEditing && !potential && (
                          <div className="mt-3 space-y-2">
                            <Textarea
                              rows={3}
                              value={text}
                              onChange={(event) => setValues((current) => ({ ...current, [change.id]: event.target.value }))}
                              aria-label="Edit suggested resume content"
                            />
                          </div>
                        )}

                        <div className="mt-4 flex flex-wrap gap-2">
                          {change.status === 'accepted' ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              icon={RotateCcw}
                              loading={busy === change.id}
                              onClick={() => void update(change, { action: 'revert' })}
                            >
                              Revert
                            </Button>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                icon={Check}
                                disabled={potential && !canConfirmPotential}
                                loading={busy === change.id}
                                onClick={() => {
                                  const selectedItem = items.find((item) => `${item.section}:${item.id}` === target)
                                  void update(change, {
                                    action: 'accept',
                                    ...(potential && selectedItem
                                      ? { value: text, section: selectedItem.section, item: selectedItem.id }
                                      : {}),
                                  })
                                }}
                              >
                                {potential ? 'Confirm and add' : change.category === 'skill' && change.confirmationRequired
                                  ? 'Confirm skill and add' : 'Accept'}
                              </Button>
                              {!potential && (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  icon={Pencil}
                                  onClick={() => {
                                    setEditing(isEditing ? null : change.id)
                                    setValues((current) => ({
                                      ...current,
                                      [change.id]: current[change.id] ?? change.suggestedValue ?? '',
                                    }))
                                  }}
                                >
                                  {isEditing ? 'Cancel edit' : 'Edit'}
                                </Button>
                              )}
                              {isEditing && (
                                <Button
                                  size="sm"
                                  icon={Check}
                                  loading={busy === change.id}
                                  onClick={() => void update(change, { action: 'edit', value: text })}
                                >
                                  Save edit
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                icon={X}
                                loading={busy === change.id}
                                onClick={() => void update(change, { action: 'reject' })}
                              >
                                Skip
                              </Button>
                            </>
                          )}
                        </div>
                      </article>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </Card>
  )
}
