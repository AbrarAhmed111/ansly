'use client'

import { clsx } from 'clsx'
import { Download, FileJson, LogOut, Palette, Upload, UserRound, X } from 'lucide-react'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import toast from 'react-hot-toast'
import { ThemeToggle } from '@/components/theme'
import { Alert, Avatar, Badge, Button, Card, CardHeader, ErrorText, IconButton, Overline, PageHeader } from '@/components/ui'
import { errorMessage, humanize, plural } from '@/lib/format'
import { exportProfile, planImport, runImport, type ImportPlan } from '@/lib/profile-import'
import { createClient } from '@/lib/supabase/client'

export default function SettingsPage() {
  const [email, setEmail] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void createClient()
      .auth.getUser()
      .then(({ data }) => {
        setEmail(data.user?.email ?? null)
        setUserId(data.user?.id ?? null)
      })
  }, [])

  async function onExport() {
    setExporting(true)
    try {
      const data = await exportProfile(createClient())
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
      setPlan(planImport(JSON.parse(await file.text())))
    } catch {
      setError('That file is not valid JSON.')
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
      <PageHeader eyebrow="Workspace" title="Settings" description="Your account, appearance and data." />

      <div className="space-y-6">
        <Card>
          <CardHeader icon={UserRound} title="Account" />
          <div className="mt-5 flex flex-wrap items-center gap-4 rounded-lg border border-border bg-surface-muted/50 p-4">
            <Avatar name={email ?? '?'} className="h-10 w-10" />
            <div className="min-w-0 flex-1">
              <Overline>Signed in as</Overline>
              <p className="truncate font-medium">{email ?? '…'}</p>
            </div>
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

        <Card>
          <CardHeader
            icon={Download}
            title="Export profile"
            description="Download your whole profile and saved answers as JSON."
            actions={
              <Button variant="secondary" icon={Download} onClick={onExport} loading={exporting}>
                Download JSON
              </Button>
            }
            className="flex-wrap"
          />
        </Card>

        <Card>
          <CardHeader
            icon={Upload}
            title="Import profile"
            description={
              <>
                Add items from an Ansly JSON export or a filled-in seed file (see{' '}
                <code className="rounded bg-surface-muted px-1 py-0.5 font-mono text-caption">supabase/seed/profile.seed.json</code>
                ). Items are added to your profile; your personal details are overwritten by the file&apos;s values.
              </>
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
                    <Alert tone="warning" title="These items will be skipped until they are filled in:">
                      <ul className="list-disc space-y-0.5 pl-5">
                        {plan.errors.map((e) => (
                          <li key={e}>{e}</li>
                        ))}
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
    </div>
  )
}
