'use client'

import type { TargetingProfile } from '@ansly/types'
import { FileJson, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { Alert, Button, ErrorText, Field, Textarea } from '@/components/ui'
import { createClient } from '@/lib/supabase/client'
import {
  LEAD_PROFILE_IMPORT_EXAMPLE,
  LEAD_PROFILE_IMPORT_FIELDS,
  MAX_LEAD_PROFILE_IMPORT_BYTES,
  parseLeadProfileImport,
  type LeadProfileImportPlan,
} from '@/lib/lead-profile-import'

const SAMPLE_JSON = JSON.stringify(LEAD_PROFILE_IMPORT_EXAMPLE, null, 2)

export function LeadProfileJsonImport({
  existingProfiles,
  onImported,
  onClose,
}: {
  existingProfiles: TargetingProfile[]
  onImported: (profiles: TargetingProfile[]) => void
  onClose: () => void
}) {
  const [content, setContent] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [plan, setPlan] = useState<LeadProfileImportPlan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  function preview(value: string) {
    setContent(value)
    setError(null)
    if (new TextEncoder().encode(value).length > MAX_LEAD_PROFILE_IMPORT_BYTES) {
      setPlan(null)
      setError('JSON content must be 1 MB or smaller.')
      return
    }
    try {
      const nextPlan = parseLeadProfileImport(value)
      setPlan(nextPlan)
    } catch (reason) {
      setPlan(null)
      setError(reason instanceof Error ? reason.message : 'Unable to validate this JSON.')
    }
  }

  async function onFile(file?: File) {
    if (!file) return
    setFileName(file.name)
    if (file.size > MAX_LEAD_PROFILE_IMPORT_BYTES) {
      setContent('')
      setPlan(null)
      setError('JSON files must be 1 MB or smaller.')
      return
    }
    try {
      preview(await file.text())
    } catch (reason) {
      setPlan(null)
      setError(reason instanceof Error ? reason.message : 'Unable to read this file.')
    }
  }

  const existingByName = new Map(existingProfiles.map((profile) => [profile.name.trim().toLocaleLowerCase(), profile]))
  const matchFor = (name: string) => existingByName.get(name.trim().toLocaleLowerCase())

  async function importProfiles() {
    if (!plan) return
    setBusy(true)
    setError(null)
    try {
      const client = createClient()
      const saved: TargetingProfile[] = []
      const created = plan.profiles.filter((profile) => !matchFor(profile.name))
      // A profile with the same name as an existing one replaces that profile's fields.
      for (const profile of plan.profiles) {
        const existing = matchFor(profile.name)
        if (!existing) continue
        const { data, error: updateError } = await client
          .from('targeting_profiles')
          .update(profile)
          .eq('id', existing.id)
          .select('*')
          .single()
        if (updateError) throw updateError
        saved.push(data as TargetingProfile)
      }
      if (created.length) {
        const payload = created.map((profile, index) => ({
          ...profile,
          is_active: existingProfiles.length === 0 && index === 0,
        }))
        const { data, error: insertError } = await client.from('targeting_profiles').insert(payload).select('*')
        if (insertError) throw insertError
        saved.push(...((data ?? []) as TargetingProfile[]))
      }
      onImported(saved)
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save these profiles.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 px-6 py-6">
      <Alert tone="accent" title="Accepted JSON fields">
        <p>Use a single profile object, an array of profile objects, or an object with a <code>profiles</code> array. Each profile must include <code>name</code>. A profile with the same name as one you already have updates it.</p>
        <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {LEAD_PROFILE_IMPORT_FIELDS.map(({ name, type }) => (
            <li key={name}><code>{name}</code>: {type}</li>
          ))}
        </ul>
        <p className="mt-2">System fields such as IDs, ownership, and active state are never imported. Unsupported keys are ignored and reported.</p>
      </Alert>

      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        aria-label="Upload targeting profiles JSON file"
        onChange={(event) => void onFile(event.target.files?.[0])}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" icon={Upload} onClick={() => fileInput.current?.click()}>
          Choose JSON file
        </Button>
        {fileName && <span className="text-caption text-muted">Loaded {fileName}</span>}
      </div>

      <Field label="Paste or edit profile JSON" htmlFor="lead-profile-json">
        <Textarea
          id="lead-profile-json"
          rows={12}
          maxLength={MAX_LEAD_PROFILE_IMPORT_BYTES}
          spellCheck={false}
          className="font-mono text-body-sm"
          placeholder={'{\n  "name": "Product engineering",\n  "target_roles": ["Product Engineer"]\n}'}
          value={content}
          onChange={(event) => {
            setContent(event.target.value)
            setFileName(null)
            setPlan(null)
            setError(null)
          }}
        />
      </Field>
      <p className="text-caption text-muted">
        {new TextEncoder().encode(content).length.toLocaleString()} / {MAX_LEAD_PROFILE_IMPORT_BYTES.toLocaleString()} bytes
        {' · '}Up to 25 profiles per import
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => preview(content)} disabled={!content.trim()}>
          Preview JSON
        </Button>
        <Button type="button" variant="secondary" icon={FileJson} onClick={() => preview(SAMPLE_JSON)}>
          Use sample
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setContent('')
            setFileName(null)
            setPlan(null)
            setError(null)
            if (fileInput.current) fileInput.current.value = ''
          }}
        >
          Clear
        </Button>
      </div>
      <ErrorText>{error}</ErrorText>

      {plan && (
        <div className="space-y-3" aria-live="polite">
          <p className="text-body-sm font-medium">Ready to import {plan.profiles.length} targeting profile{plan.profiles.length === 1 ? '' : 's'}:</p>
          <ul className="list-disc space-y-1 pl-5 text-body-sm text-muted">
            {plan.profiles.map((profile) => (
              <li key={profile.name}>
                {profile.name}
                <span className="ml-2 text-caption text-subtle">
                  {matchFor(profile.name) ? 'updates your existing profile' : 'new profile'}
                </span>
              </li>
            ))}
          </ul>
          {plan.warnings.length > 0 && (
            <Alert tone="warning" title="Some fields will be ignored">
              <ul className="list-disc space-y-1 pl-5">
                {plan.warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            </Alert>
          )}
          <Button onClick={() => void importProfiles()} loading={busy}>
            {busy ? 'Importing…' : `Import ${plan.profiles.length} profile${plan.profiles.length === 1 ? '' : 's'}`}
          </Button>
        </div>
      )}
    </div>
  )
}
