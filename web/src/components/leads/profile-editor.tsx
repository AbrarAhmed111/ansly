'use client'

import type { TargetingProfile } from '@ansly/types'
import { Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Sheet } from '@/components/dialog'
import { TagInput } from '@/components/tag-input'
import { Button, Chip, ErrorText, Field, Input, SegmentedControl, Textarea } from '@/components/ui'
import { EMPTY_PROFILE, profileValues, type TargetingProfileValues } from '@/lib/leads'

const REMOTE_OPTIONS = [
  { value: 'any', label: 'Any' },
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'onsite', label: 'Onsite' },
] as const

const OPPORTUNITY_TYPES = [
  { value: 'job', label: 'Full-time job' },
  { value: 'contract', label: 'Contract' },
  { value: 'freelance', label: 'Freelance' },
  { value: 'part_time', label: 'Part-time' },
  { value: 'consulting', label: 'Consulting' },
  { value: 'startup', label: 'Startup' },
]

/** Create a profile, or edit every field of an existing one. */
export function ProfileEditor({
  open,
  profile,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean
  /** The profile being edited; null creates a new one. */
  profile: TargetingProfile | null
  onClose: () => void
  onSave: (values: TargetingProfileValues) => Promise<void>
  onDelete: (profile: TargetingProfile) => Promise<void>
}) {
  const [values, setValues] = useState<TargetingProfileValues>(EMPTY_PROFILE)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setValues(profile ? profileValues(profile) : EMPTY_PROFILE)
    setError(null)
  }, [open, profile])

  const set = <K extends keyof TargetingProfileValues>(key: K, value: TargetingProfileValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }))

  const missingTerms = values.target_roles.length === 0 && values.keywords.length === 0
  const canSave = Boolean(values.name.trim()) && !missingTerms

  async function save() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      await onSave(values)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save this profile.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={profile ? 'Edit targeting profile' : 'New targeting profile'}
      description="Ansly saves LinkedIn posts that mention your roles or keywords and skips any that mention an excluded word."
      footer={
        <div className="flex items-center justify-between gap-2">
          {profile ? (
            <Button variant="danger-soft" icon={Trash2} onClick={() => void onDelete(profile)}>
              Delete profile
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => void save()} loading={saving} disabled={!canSave}>
              {profile ? 'Save changes' : 'Create profile'}
            </Button>
          </div>
        </div>
      }
    >
      <form
        className="space-y-5 px-6 py-6"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <Field label="Profile name" htmlFor="profile-name" required>
          <Input
            id="profile-name"
            value={values.name}
            maxLength={120}
            onChange={(event) => set('name', event.target.value)}
            placeholder="e.g. Full stack, remote"
            autoFocus
          />
        </Field>

        <section className="space-y-4 rounded-xl border border-border bg-surface-muted/40 p-4">
          <div>
            <h3 className="text-body font-medium">Matching</h3>
            <p className="text-caption text-muted">Press Enter or comma to add. Click × to remove.</p>
          </div>
          <Field
            label="Target roles"
            htmlFor="profile-roles"
            help="A post is relevant when it mentions any role or keyword. Plurals and hyphens are handled."
          >
            <TagInput
              id="profile-roles"
              value={values.target_roles}
              onChange={(next) => set('target_roles', next)}
              placeholder="Full Stack Developer, Software Engineer"
            />
          </Field>
          <Field label="Keywords" htmlFor="profile-keywords">
            <TagInput
              id="profile-keywords"
              value={values.keywords}
              onChange={(next) => set('keywords', next)}
              placeholder="React, Next.js, Python"
            />
          </Field>
          <Field
            label="Exclude posts that mention"
            htmlFor="profile-excluded"
            help={
              <>
                Whole words, including variants: <strong>angular</strong> also skips AngularJS, <strong>dm</strong> skips
                “DM me”. <strong>java</strong> does not skip JavaScript.
              </>
            }
          >
            <TagInput
              id="profile-excluded"
              value={values.excluded_keywords}
              onChange={(next) => set('excluded_keywords', next)}
              placeholder="angular, dm, unpaid"
            />
          </Field>
          {missingTerms && <p className="text-caption text-warning">Add at least one target role or keyword.</p>}
        </section>

        <section className="space-y-4">
          <div>
            <h3 className="text-body font-medium">Preferences</h3>
            <p className="text-caption text-muted">Saved with the profile for reference. Matching doesn’t use them yet.</p>
          </div>
          <Field label="Locations" htmlFor="profile-locations">
            <TagInput
              id="profile-locations"
              value={values.locations}
              onChange={(next) => set('locations', next)}
              placeholder="Remote, Pakistan"
            />
          </Field>
          <Field label="Work mode">
            <SegmentedControl
              label="Work mode"
              options={REMOTE_OPTIONS}
              value={values.remote_preferences}
              onChange={(next) => set('remote_preferences', next)}
            />
          </Field>
          <Field label="Opportunity types">
            <div className="flex flex-wrap gap-2">
              {OPPORTUNITY_TYPES.map((type) => {
                const selected = values.opportunity_types.includes(type.value)
                return (
                  <Chip
                    key={type.value}
                    selected={selected}
                    onClick={() =>
                      set(
                        'opportunity_types',
                        selected
                          ? values.opportunity_types.filter((value) => value !== type.value)
                          : [...values.opportunity_types, type.value],
                      )
                    }
                  >
                    {type.label}
                  </Chip>
                )
              })}
            </div>
          </Field>
          <Field label="Notes" htmlFor="profile-description">
            <Textarea
              id="profile-description"
              rows={3}
              maxLength={2000}
              value={values.description ?? ''}
              onChange={(event) => set('description', event.target.value)}
              placeholder="What this profile is for"
            />
          </Field>
        </section>

        <ErrorText>{error}</ErrorText>
        <button type="submit" hidden />
      </form>
    </Sheet>
  )
}
