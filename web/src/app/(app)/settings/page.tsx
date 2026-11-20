'use client'

import type { ApplicationAgentMode } from '@ansly/types'
import { clsx } from 'clsx'
import { CircleHelp, Download, FileJson, FileText, LogOut, Palette, Upload, UserRound, X } from 'lucide-react'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { Dialog } from '@/components/dialog'
import { EmailConnectionCard } from '@/components/email-connection'
import { EnabledSites } from '@/components/enabled-sites'
import { UserAvatar, useIdentity } from '@/components/identity'
import { ThemeToggle } from '@/components/theme'
import { Alert, Badge, Button, Card, CardHeader, Checkbox, ErrorText, IconButton, Overline, PageHeader, SegmentedControl, buttonStyles } from '@/components/ui'
import { errorMessage, humanize, plural } from '@/lib/format'
import {
  MAX_PROFILE_IMPORT_BYTES,
  exportProfile,
  exportResumes,
  parseImportJson,
  PROFILE_IMPORT_EXAMPLE,
  PROFILE_IMPORT_PROFILE_SCHEMA,
  PROFILE_IMPORT_SAVED_ANSWER_FIELDS,
  runImport,
  type ImportPlan,
} from '@/lib/profile-import'
import { SECTIONS } from '@/lib/sections'
import { createClient } from '@/lib/supabase/client'

export default function SettingsPage() {
  const [email, setEmail] = useState<string | null>(null)
  const identity = useIdentity()
  const [userId, setUserId] = useState<string | null>(null)
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [includeResumeContents, setIncludeResumeContents] = useState(false)
  const [pageLimit, setPageLimit] = useState<'1' | '2' | '3' | null>(null)
  const [applicationAgentMode, setApplicationAgentMode] = useState<ApplicationAgentMode>('normal')
  const [dragging, setDragging] = useState(false)
  const [importHelpOpen, setImportHelpOpen] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void createClient()
      .auth.getUser()
      .then(({ data }) => {
        setEmail(data.user?.email ?? null)
        setUserId(data.user?.id ?? null)
      })
    void createClient()
      .from('profiles')
      .select('resume_page_limit, application_agent_mode')
      .maybeSingle()
      .then(({ data }) => {
        setPageLimit(data?.resume_page_limit ? (String(data.resume_page_limit) as '1' | '2' | '3') : '2')
        setApplicationAgentMode(data?.application_agent_mode === 'aggressive' ? 'aggressive' : 'normal')
      })
  }, [])

  async function onPageLimit(value: '1' | '2' | '3') {
    if (!userId) return
    const previous = pageLimit
    setPageLimit(value)
    const { error: err } = await createClient().from('profiles').update({ resume_page_limit: Number(value) }).eq('id', userId)
    if (err) {
      setPageLimit(previous)
      toast.error(err.message)
    } else toast.success('Page limit saved')
  }

  async function onApplicationAgentMode(value: ApplicationAgentMode) {
    if (!userId) return
    const previous = applicationAgentMode
    setApplicationAgentMode(value)
    const { error: err } = await createClient()
      .from('profiles')
      .update({ application_agent_mode: value })
      .eq('id', userId)
    if (err) {
      setApplicationAgentMode(previous)
      toast.error(err.message)
    } else toast.success('Application agent behavior saved')
  }

  async function onExport() {
    setExporting(true)
    try {
      const supabase = createClient()
      const data = { ...(await exportProfile(supabase)), ...(await exportResumes(supabase, includeResumeContents)) }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `ansly-profile-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Export downloaded')
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setExporting(false)
    }
  }

  function reset() {
    setPlan(null)
    setFileName(null)
    setError(null)
    if (fileInput.current) fileInput.current.value = ''
  }

  async function onFile(file: File | undefined) {
    setError(null)
    setPlan(null)
    setFileName(file?.name ?? null)
    if (!file) return
    try {
      if (file.size > MAX_PROFILE_IMPORT_BYTES) throw new Error('JSON files must be 1 MB or smaller.')
      setPlan(parseImportJson(await file.text()))
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    void onFile(e.dataTransfer.files?.[0])
  }

  async function onImport() {
    if (!plan || !userId) return
    setBusy(true)
    try {
      const count = await runImport(createClient(), userId, plan)
      toast.success(`Imported ${plural(count, 'item')}`)
      reset()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const total = plan?.rows.reduce((sum, r) => sum + r.rows.length, 0) ?? 0

  return (
    <div className="animate-fade-up">
      <PageHeader title="Settings" description="Your account, appearance and data." />

      <div className="space-y-6">
        <Card>
          <CardHeader icon={UserRound} title="Account" />
          <div className="mt-5 flex flex-wrap items-center gap-4 rounded-lg border border-border bg-surface-muted/50 p-4">
            <UserAvatar className="h-10 w-10" />
            <div className="min-w-0 flex-1">
              <Overline>Signed in as</Overline>
              <p className="truncate font-medium">{identity?.name || email || '…'}</p>
              {identity?.name && email && <p className="truncate text-body-sm text-muted">{email}</p>}
            </div>
            <Link href="/profile/personal" className={buttonStyles({ variant: 'secondary' })}>
              Edit details
            </Link>
            <form action="/auth/signout" method="post">
              <Button variant="secondary" icon={LogOut}>
                Sign out
              </Button>
            </form>
          </div>
        </Card>

        <Card>
          <CardHeader
            icon={Palette}
            title="Appearance"
            description="Choose a theme, or follow your system setting."
            actions={<ThemeToggle />}
            className="flex-wrap"
          />
        </Card>

        <EnabledSites />

        <Card>
          <CardHeader
            icon={CircleHelp}
            title="Application Agent Behavior"
            description="Choose how independently Ansly handles uncertain application decisions."
            actions={
              <SegmentedControl
                label="Application agent mode"
                options={[
                  { value: 'normal', label: 'Normal Mode' },
                  { value: 'aggressive', label: 'Aggressive Mode' },
                ]}
                value={applicationAgentMode}
                onChange={onApplicationAgentMode}
              />
            }
            className="flex-wrap"
          />
          <div className="mt-4 grid gap-3 text-body-sm text-muted sm:grid-cols-2">
            <p>
              <span className="font-medium text-fg">Normal Mode:</span> Ask for help when resume selection or application answers are uncertain.
            </p>
            <p>
              <span className="font-medium text-fg">Aggressive Mode:</span> Make the best supported decisions and minimize interruptions. Never fabricate facts or bypass safeguards.
            </p>
          </div>
        </Card>

        <EmailConnectionCard />

        <Card>
          <CardHeader
            icon={FileText}
            title="Tailored resume length"
            description="Your tailored resume keeps your own document’s layout. The preview warns you when it runs past this many pages."
            actions={
              <SegmentedControl
                label="Page limit"
                options={[
                  { value: '1', label: '1 page' },
                  { value: '2', label: '2 pages' },
                  { value: '3', label: '3 pages' },
                ]}
                value={pageLimit}
                onChange={onPageLimit}
              />
            }
            className="flex-wrap"
          />
        </Card>

        <Card>
          <CardHeader
            icon={Download}
            title="Export profile"
            description="Download your whole profile, saved answers, resume details and tailoring history as JSON."
            actions={
              <Button variant="secondary" icon={Download} onClick={onExport} loading={exporting}>
                Download JSON
              </Button>
            }
            className="flex-wrap"
          />
          <div className="mt-4">
            <Checkbox
              id="export-resume-contents"
              label="Include the text of your parsed and tailored resumes (files are never included)"
              checked={includeResumeContents}
              onChange={setIncludeResumeContents}
            />
          </div>
        </Card>

        <Card>
          <CardHeader
            icon={Upload}
            title="Import profile"
            description={
              <>
                Add items from an Ansly JSON export. Items are added to your profile; your personal details are
                overwritten by the file&apos;s values.
              </>
            }
            actions={
              <Button variant="secondary" icon={CircleHelp} onClick={() => setImportHelpOpen(true)}>
                Supported fields
              </Button>
            }
          />

          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            id="import-file"
            onChange={(e) => onFile(e.target.files?.[0])}
          />

          {!fileName ? (
            <label
              htmlFor="import-file"
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={clsx(
                'mt-5 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition',
                dragging ? 'border-accent bg-accent-soft' : 'border-border-strong hover:border-accent/50 hover:bg-surface-muted/50',
              )}
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent-soft text-accent">
                <FileJson className="h-5 w-5" />
              </span>
              <p className="mt-3 font-medium">
                <span className="text-accent">Choose a file</span> or drag it here
              </p>
              <p className="mt-0.5 text-caption text-muted">JSON only</p>
            </label>
          ) : (
            <div className="mt-5 space-y-4">
              <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-muted/50 p-3">
                <FileJson className="h-5 w-5 shrink-0 text-accent" />
                <span className="min-w-0 flex-1 truncate font-medium">{fileName}</span>
                <IconButton icon={X} label="Remove file" onClick={reset} />
              </div>

              <ErrorText>{error}</ErrorText>

              {plan && (
                <>
                  <div className="flex flex-wrap gap-2">
                    {plan.profile && <Badge>Personal details</Badge>}
                    {plan.rows
                      .filter((r) => r.rows.length)
                      .map((r) => (
                        <Badge key={r.table}>
                          <span className="font-semibold tabular-nums text-fg">{r.rows.length}</span>
                          {humanize(r.table)}
                        </Badge>
                      ))}
                  </div>
                  {plan.errors.length > 0 && (
                    <Alert tone="warning" title="Items with these problems will be skipped; other valid items can still be imported:">
                      <ul className="list-disc space-y-0.5 pl-5">
                        {plan.errors.map((e) => (
                          <li key={e}>{e}</li>
                        ))}
                      </ul>
                    </Alert>
                  )}
                  {plan.warnings.length > 0 && (
                    <Alert tone="accent" title="Import notes">
                      <ul className="list-disc space-y-0.5 pl-5">
                        {plan.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                      </ul>
                    </Alert>
                  )}
                  <div className="flex gap-2">
                    <Button onClick={onImport} loading={busy} disabled={!plan.profile && total === 0}>
                      {busy ? 'Importing…' : `Import ${plural(total, 'item')}`}
                    </Button>
                    <Button variant="secondary" onClick={reset}>
                      Cancel
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </Card>
      </div>

      <Dialog open={importHelpOpen} onClose={() => setImportHelpOpen(false)} labelledBy="profile-import-help-title" wide>
        <h2 id="profile-import-help-title" className="text-h3">
          What can I import?
        </h2>
        <p className="mt-2 leading-relaxed text-muted">
          Use a JSON object with these top-level keys. Each section is a list of objects; unknown fields are ignored.
          Import adds section items, while values in <code>profile</code> replace your existing personal details.
        </p>

        <div className="mt-5 space-y-4">
          <section>
            <h3 className="font-semibold">Personal details — profile</h3>
            <ul className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-body-sm text-muted sm:grid-cols-2">
              {Object.entries(PROFILE_IMPORT_PROFILE_SCHEMA).map(([field, type]) => (
                <li key={field} className="flex min-w-0 flex-wrap gap-x-1">
                  <code className="break-all text-fg">{field}</code>
                  <span>({type})</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="font-semibold">Profile sections — lists of objects</h3>
            <ul className="mt-1 space-y-1 text-body-sm text-muted">
              {SECTIONS.map((section) => (
                <li key={section.table} className="break-words [overflow-wrap:anywhere]">
                  <code className="text-fg">{section.table}</code>: {section.fields.map((field) => field.name).join(', ')}
                </li>
              ))}
              <li className="break-words [overflow-wrap:anywhere]">
                <code className="text-fg">saved_answers</code>: {PROFILE_IMPORT_SAVED_ANSWER_FIELDS.join(', ')} (question and answer required)
              </li>
            </ul>
          </section>

          <section>
            <h3 className="font-semibold">Example JSON</h3>
            <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-surface-muted p-3 text-caption leading-relaxed sm:max-h-56">
              {JSON.stringify(PROFILE_IMPORT_EXAMPLE, null, 2)}
            </pre>
          </section>

          <p className="text-body-sm text-muted">
            Set <code>version</code> to <code>1</code>. Resume metadata, resume text, and tailoring history are export-only
            and are not imported.
          </p>
        </div>

        <div className="mt-6 flex justify-end">
          <Button onClick={() => setImportHelpOpen(false)}>Close</Button>
        </div>
      </Dialog>
    </div>
  )
}
