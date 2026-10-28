'use client'

import { FileJson, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Alert, Button, ErrorText, Textarea } from '@/components/ui'
import { errorMessage, humanize, plural } from '@/lib/format'
import {
  MAX_PROFILE_IMPORT_BYTES,
  PROFILE_IMPORT_EXAMPLE,
  PROFILE_IMPORT_PROFILE_SCHEMA,
  byteLength,
  parseImportJson,
  runImport,
  type ImportPlan,
} from '@/lib/profile-import'
import { SECTIONS } from '@/lib/sections'
import { createClient } from '@/lib/supabase/client'

const fieldType = (type: string, options?: { value: string }[]) => {
  if (type === 'text' || type === 'textarea') return 'string'
  if (type === 'url') return 'HTTP(S) URL string'
  if (type === 'month') return 'ISO date string (YYYY-MM or YYYY-MM-DD)'
  if (type === 'checkbox') return 'boolean'
  if (type === 'list') return 'array of strings'
  if (type === 'number') return 'number from 0 to 999.9'
  if (type === 'select') return `one of ${options?.map((option) => option.value).join(', ')}`
  return type
}

export function ProfileJsonImport({ userId, onImported }: { userId: string; onImported: () => void }) {
  const [content, setContent] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const total = plan?.rows.reduce((sum, section) => sum + section.rows.length, 0) ?? 0

  function preview(value: string) {
    setContent(value)
    setError(null)
    try {
      setPlan(parseImportJson(value))
    } catch (e) {
      setPlan(null)
      setError(errorMessage(e))
    }
  }

  async function onFile(file?: File) {
    if (!file) return
    setFileName(file.name)
    if (file.size > MAX_PROFILE_IMPORT_BYTES) {
      setContent('')
      setPlan(null)
      setError('JSON files must be 1 MB or smaller.')
      return
    }
    try {
      preview(await file.text())
    } catch (e) {
      setPlan(null)
      setError(errorMessage(e))
    }
  }

  function validate() {
    setFileName(null)
    preview(content)
  }

  async function importProfile() {
    if (!plan || !userId) return
    setBusy(true)
    setError(null)
    try {
      const count = await runImport(createClient(), userId, plan)
      toast.success(`Imported ${plural(count, 'item')}`)
      setContent('')
      setFileName(null)
      setPlan(null)
      onImported()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 space-y-3 rounded-xl border border-border bg-surface-muted/30 p-4 text-fg">
      <div>
        <p className="font-medium">Import an Ansly JSON profile</p>
        <p className="mt-1 text-body-sm text-muted">
          Paste JSON or upload a file (up to 1 MB). Import adds profile items; matching skills are skipped.
          Provided personal details replace those same fields in your profile. Review the preview before saving.
        </p>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        aria-label="Upload profile JSON file"
        onChange={(event) => void onFile(event.target.files?.[0])}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" icon={Upload} onClick={() => fileInput.current?.click()}>
          Choose JSON file
        </Button>
        {fileName && <span className="text-caption text-muted">Loaded {fileName}</span>}
      </div>

      <label className="block text-body-sm font-medium" htmlFor="profile-json-input">Paste or edit JSON</label>
      <Textarea
        id="profile-json-input"
        aria-label="Paste or edit profile JSON"
        rows={12}
        maxLength={MAX_PROFILE_IMPORT_BYTES}
        spellCheck={false}
        className="font-mono text-body-sm"
        placeholder={'{\n  "version": 1,\n  "profile": { "full_name": "Alex Morgan" }\n}'}
        value={content}
        onChange={(event) => {
          setContent(event.target.value)
          setFileName(null)
          setPlan(null)
          setError(null)
        }}
      />
      <p className="text-caption text-muted">{byteLength(content).toLocaleString()} / {MAX_PROFILE_IMPORT_BYTES.toLocaleString()} bytes</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={validate} disabled={!content.trim()}>Preview JSON</Button>
        <Button type="button" variant="ghost" onClick={() => {
          setContent('')
          setFileName(null)
          setPlan(null)
          setError(null)
          if (fileInput.current) fileInput.current.value = ''
        }}>Clear</Button>
      </div>
      <ErrorText>{error}</ErrorText>

      {plan && (
        <div className="space-y-3" aria-live="polite">
          <div className="flex flex-wrap gap-2">
            {plan.profile && <span className="rounded-full border border-border px-2 py-0.5 text-caption">Personal details</span>}
            {plan.rows.filter((section) => section.rows.length).map((section) => (
              <span key={section.table} className="rounded-full border border-border px-2 py-0.5 text-caption">
                {section.rows.length} {humanize(section.table)}
              </span>
            ))}
          </div>
          {plan.errors.length > 0 && (
            <Alert tone="warning" title="Items with these problems will be skipped; valid items can still be imported:">
              <ul className="list-disc space-y-0.5 pl-5">
                {plan.errors.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </Alert>
          )}
          {plan.warnings.length > 0 && (
            <Alert tone="accent" title="Import notes">
              <ul className="list-disc space-y-0.5 pl-5">
                {plan.warnings.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </Alert>
          )}
          <Button onClick={() => void importProfile()} loading={busy} disabled={!plan.profile && total === 0}>
            {busy ? 'Importing…' : `Import ${plural(total, 'item')}`}
          </Button>
        </div>
      )}

      <details className="rounded-lg border border-border bg-surface p-3">
        <summary className="cursor-pointer font-medium">View JSON format and example</summary>
        <div className="mt-3 space-y-3 text-body-sm">
          <p>Use a JSON object with optional version 1. Every profile field is optional. Unknown keys are reported and ignored; account IDs, roles, permissions and ownership are never imported.</p>
          <div>
            <p className="font-medium">Profile fields</p>
            <ul className="list-disc pl-5 text-muted">
              {Object.entries(PROFILE_IMPORT_PROFILE_SCHEMA).map(([name, type]) => <li key={name}><code>{name}</code>: {type}</li>)}
            </ul>
          </div>
          <div>
            <p className="font-medium">Profile sections</p>
            <ul className="list-disc pl-5 text-muted">
              {SECTIONS.map((section) => (
                <li key={section.table}>
                  <code>{section.table}</code>: array of objects; required fields:{' '}
                  {section.fields.filter((field) => field.required).map((field) => field.name).join(', ') || 'none'}.
                  {' '}Fields: {section.fields.map((field) =>
                    `${field.name}${field.required ? ' (required)' : ''} — ${fieldType(field.type, field.options)}`).join('; ')}.
                </li>
              ))}
              <li><code>saved_answers</code>: array of objects with required string fields <code>question</code> and <code>answer</code>, and optional string <code>category</code>, <code>company</code> and <code>role</code>.</li>
            </ul>
          </div>
          <p>Missing or null values are allowed only for optional fields. Empty text is treated as null; arrays, checkboxes and numbers must use their JSON types. Dates use YYYY-MM or YYYY-MM-DD strings. JSON has no undefined values, comments, trailing commas, or native date objects. Resume files and tailoring history are export-only and are not imported.</p>
          <pre className="max-h-72 overflow-auto rounded-lg bg-surface-muted p-3 font-mono text-caption">{JSON.stringify(PROFILE_IMPORT_EXAMPLE, null, 2)}</pre>
          <Button type="button" variant="secondary" icon={FileJson} onClick={() => {
            setContent(JSON.stringify(PROFILE_IMPORT_EXAMPLE, null, 2))
            setFileName(null)
            setPlan(null)
            setError(null)
          }}>Use this example</Button>
        </div>
      </details>
    </div>
  )
}
