'use client'

import type { TargetingProfile } from '@ansly/types'
import { clsx } from 'clsx'
import { Check, CircleAlert, FileJson, Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import { TagInput } from '@/components/tag-input'
import { Button, Card, Select, Spinner } from '@/components/ui'
import type { TargetingProfileValues } from '@/lib/leads'

const COLLAPSED_AT = 12

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/**
 * The active targeting profile, editable in place: adding or removing a role, keyword or exclusion
 * saves immediately. The full editor covers the remaining fields.
 */
export function ProfileCard({
  profiles,
  profile,
  saveState,
  onActivate,
  onPatch,
  onEdit,
  onCreate,
  onImport,
}: {
  profiles: TargetingProfile[]
  profile: TargetingProfile
  saveState: SaveState
  onActivate: (id: string) => void
  onPatch: (patch: Partial<TargetingProfileValues>) => void
  onEdit: () => void
  onCreate: () => void
  onImport: () => void
}) {
  const noTerms = profile.target_roles.length === 0 && profile.keywords.length === 0

  return (
    <Card className="p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <p className="text-caption font-medium uppercase tracking-[0.12em] text-subtle">Targeting profile</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {profiles.length > 1 ? (
              <Select
                aria-label="Active targeting profile"
                value={profile.id}
                onChange={(event) => onActivate(event.target.value)}
                className="h-9 w-auto max-w-[18rem] text-title font-semibold"
              >
                {profiles.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </Select>
            ) : (
              <h2 className="truncate text-title">{profile.name}</h2>
            )}
            <SaveIndicator state={saveState} />
          </div>
          <p className="mt-1 text-caption text-muted">The extension matches LinkedIn posts against this profile.</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="secondary" size="sm" icon={Pencil} onClick={onEdit}>
            Edit all
          </Button>
          <Button variant="ghost" size="sm" icon={Plus} onClick={onCreate}>
            New
          </Button>
          <Button variant="ghost" size="sm" icon={FileJson} onClick={onImport}>
            Import
          </Button>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <InlineTags
          id="inline-roles"
          label="Target roles"
          values={profile.target_roles}
          placeholder="Add a role…"
          onChange={(next) => onPatch({ target_roles: next })}
        />
        <InlineTags
          id="inline-keywords"
          label="Keywords"
          values={profile.keywords}
          placeholder="Add a keyword…"
          onChange={(next) => onPatch({ keywords: next })}
        />
        <InlineTags
          id="inline-excluded"
          label="Skip posts that mention"
          values={profile.excluded_keywords}
          placeholder="e.g. angular, dm"
          onChange={(next) => onPatch({ excluded_keywords: next })}
        />
      </div>
      {noTerms && (
        <p className="mt-3 flex items-center gap-1.5 text-caption text-warning">
          <CircleAlert className="h-3.5 w-3.5" aria-hidden />
          Add a role or keyword. Collection needs at least one to match posts.
        </p>
      )}
    </Card>
  )
}

function InlineTags({
  id,
  label,
  values,
  placeholder,
  onChange,
}: {
  id: string
  label: string
  values: string[]
  placeholder: string
  onChange: (next: string[]) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const long = values.length > COLLAPSED_AT
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-body-sm font-medium">
          {label}
        </label>
        {long ? (
          <button type="button" onClick={() => setExpanded((value) => !value)} className="text-caption text-accent hover:underline">
            {expanded ? 'Show less' : `Show all ${values.length}`}
          </button>
        ) : (
          <span className="text-caption tabular-nums text-subtle">{values.length}</span>
        )}
      </div>
      {/* Long lists scroll inside a short box so the leads stay in view; the add field is always at the end. */}
      <div className={clsx(long && !expanded && 'max-h-40 overflow-y-auto rounded-lg')}>
        <TagInput id={id} value={values} onChange={onChange} placeholder={placeholder} />
      </div>
    </div>
  )
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === 'saving') {
    return (
      <span className="inline-flex items-center gap-1 text-caption text-muted" role="status">
        <Spinner className="h-3 w-3" /> Saving…
      </span>
    )
  }
  if (state === 'saved') {
    return (
      <span className="inline-flex items-center gap-1 text-caption text-success" role="status">
        <Check className="h-3.5 w-3.5" aria-hidden /> Saved
      </span>
    )
  }
  if (state === 'error') {
    return (
      <span className="inline-flex items-center gap-1 text-caption text-danger" role="status">
        <CircleAlert className="h-3.5 w-3.5" aria-hidden /> Not saved
      </span>
    )
  }
  return null
}
