'use client'

import type { ResumeRecord } from '@ansly/types'
import { Download, ExternalLink, Files, Pencil, Plus, RefreshCcw, Trash2, Upload } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Dialog, useConfirm } from '@/components/dialog'
import { Badge, Button, Card, EmptyState, ErrorText, Field, IconButton, Input, Skeleton, Textarea } from '@/components/ui'
import { createResume, deleteResume, listRoleResumes, replaceRoleResume, resumeFileLink, updateResume } from '@/lib/api'
import { errorMessage } from '@/lib/format'
import {
  PARSE_STATUS,
  ROLE_RESUME_ACCEPT,
  formatBytes,
  formatDate,
  roleResumeFileProblem,
  uploadRoleResumeFile,
} from '@/lib/resume'
import { createClient } from '@/lib/supabase/client'

async function userId() {
  const {
    data: { user },
  } = await createClient().auth.getUser()
  if (!user) throw new Error('Your session has expired. Sign in again.')
  return user.id
}

/** Opens a resume's original file: PDFs in a new tab, Word files as a download. */
export async function openResumeFile(resume: { id: string; fileType?: string; file_type?: string }) {
  const pdf = (resume.fileType ?? resume.file_type) === 'pdf'
  // Open the tab first (in the click), then point it at the signed link, so popup blockers allow it.
  const tab = pdf ? window.open('about:blank', '_blank') : null
  try {
    const { url } = await resumeFileLink(resume.id, pdf)
    if (tab) tab.location.href = url
    else window.location.assign(url)
  } catch (e) {
    tab?.close()
    toast.error(errorMessage(e))
  }
}

export function useRoleResumes() {
  const [items, setItems] = useState<ResumeRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    try {
      setItems((await listRoleResumes()).items)
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [])
  useEffect(() => void refresh(), [refresh])
  return { items, error, refresh }
}

/** Upload (new) or edit the label of a role resume. `onDone` gets the saved record. */
export function RoleResumeDialog({
  open,
  onClose,
  editing,
  defaultLabel = '',
  onDone,
}: {
  open: boolean
  onClose: () => void
  editing?: ResumeRecord | null
  defaultLabel?: string
  onDone: (resume: ResumeRecord) => void
}) {
  const [label, setLabel] = useState('')
  const [note, setNote] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setLabel(editing?.roleLabel ?? defaultLabel)
    setNote(editing?.roleNote ?? '')
    setFile(null)
    setError(null)
  }, [open, editing, defaultLabel])

  async function save() {
    if (!label.trim()) return setError('Add the kind of role this resume is for.')
    setBusy(true)
    setError(null)
    try {
      if (editing) {
        onDone(await updateResume(editing.id, { roleLabel: label.trim(), roleNote: note.trim() }))
      } else {
        if (!file) throw new Error('Choose a PDF or Word file.')
        const problem = roleResumeFileProblem(file)
        if (problem) throw new Error(problem)
        const uploaded = await uploadRoleResumeFile(createClient(), await userId(), file)
        onDone(
          await createResume({
            name: file.name,
            filePath: uploaded.path,
            fileType: uploaded.fileType,
            fileSize: uploaded.size,
            roleLabel: label.trim(),
            roleNote: note.trim() || null,
          }),
        )
      }
      onClose()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={() => !busy && onClose()} labelledBy="role-resume-title">
      <h2 id="role-resume-title" className="text-title">
        {editing ? 'Edit role resume' : 'Add a role resume'}
      </h2>
      <p className="mt-1 text-body-sm text-muted">
        Ansly attaches it to emails for this kind of role, exactly as you upload it.
      </p>
      <form
        className="mt-5 space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <Field label="Role" htmlFor="role-label" required help="Any label, e.g. Backend Engineer, MERN Stack Developer.">
          <Input id="role-label" value={label} maxLength={120} autoFocus onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label="Use it for (optional)" htmlFor="role-note">
          <Textarea
            id="role-note"
            rows={2}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Node.js / Python backend and API roles"
          />
        </Field>
        {!editing && (
          <Field label="File" htmlFor="role-file" required help="PDF or Word (.docx), up to 10 MB.">
            <input
              ref={input}
              id="role-file"
              type="file"
              accept={ROLE_RESUME_ACCEPT}
              className="sr-only"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <Button type="button" variant="secondary" icon={Upload} onClick={() => input.current?.click()}>
              {file ? file.name : 'Choose file'}
            </Button>
          </Field>
        )}
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            {editing ? 'Save' : busy ? 'Uploading…' : 'Add resume'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

/** The role resume library. `startUpload` opens the add dialog right away (e.g. from the command palette). */
export function RoleResumes({ startUpload = false }: { startUpload?: boolean }) {
  const { items, error, refresh } = useRoleResumes()
  const [dialog, setDialog] = useState<{ open: boolean; editing: ResumeRecord | null }>({ open: startUpload, editing: null })
  const [replacing, setReplacing] = useState<ResumeRecord | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const replaceInput = useRef<HTMLInputElement>(null)
  const [confirm, confirmDialog] = useConfirm()

  async function replace(resume: ResumeRecord, file: File | undefined) {
    if (!file) return
    const problem = roleResumeFileProblem(file)
    if (problem) return toast.error(problem)
    setBusy(resume.id)
    try {
      const uploaded = await uploadRoleResumeFile(createClient(), await userId(), file)
      const result = await replaceRoleResume(resume.id, {
        name: file.name,
        filePath: uploaded.path,
        fileType: uploaded.fileType,
        fileSize: uploaded.size,
      })
      toast.success(
        result.draftsUpdated
          ? `Replaced. ${result.draftsUpdated} unsent email${result.draftsUpdated === 1 ? '' : 's'} now attach the new file.`
          : 'Replaced',
      )
      await refresh()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
      setReplacing(null)
      if (replaceInput.current) replaceInput.current.value = ''
    }
  }

  async function remove(resume: ResumeRecord) {
    const ok = await confirm({
      title: `Delete “${resume.roleLabel}”?`,
      description: 'The file is deleted. Unsent emails that attach it will ask you to choose another resume.',
      confirmLabel: 'Delete',
    })
    if (!ok) return
    setBusy(resume.id)
    try {
      await deleteResume(resume.id)
      toast.success('Deleted')
      await refresh()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      {confirmDialog}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body-sm text-muted">
          {items === null ? 'Loading…' : `${items.length} role resume${items.length === 1 ? '' : 's'} · PDF or Word, up to 10 MB`}
        </p>
        <Button size="sm" icon={Plus} onClick={() => setDialog({ open: true, editing: null })}>
          Add role resume
        </Button>
      </div>
      <input
        ref={replaceInput}
        type="file"
        accept={ROLE_RESUME_ACCEPT}
        className="sr-only"
        aria-label="Replacement resume file"
        onChange={(e) => replacing && void replace(replacing, e.target.files?.[0])}
      />
      <ErrorText>{error}</ErrorText>
      <div className="mt-4">
        {items === null && !error && (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        )}
        {items?.length === 0 && (
          <EmptyState
            icon={Files}
            title="No role resumes yet"
            description="Add, for example, a Backend Engineer resume and a Frontend Developer resume. PDF or Word."
            action={
              <Button icon={Plus} onClick={() => setDialog({ open: true, editing: null })}>
                Add role resume
              </Button>
            }
          />
        )}
        {items && items.length > 0 && (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {items.map((resume) => {
              const status = PARSE_STATUS[resume.parseStatus]
              return (
                <li key={resume.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{resume.roleLabel}</span>
                      <Badge>{resume.fileType.toUpperCase()}</Badge>
                      {resume.parseStatus !== 'parsed' && (
                        <Badge tone={status.tone} dot>
                          {resume.parseStatus === 'failed' ? 'Text not read' : status.label}
                        </Badge>
                      )}
                    </div>
                    <p className="truncate text-caption text-subtle">
                      {[resume.fileName ?? resume.name, formatBytes(resume.fileSize), `updated ${formatDate(resume.updatedAt)}`]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    {resume.roleNote && <p className="mt-0.5 text-body-sm text-muted">{resume.roleNote}</p>}
                    {resume.parseStatus === 'failed' && (
                      <p className="mt-0.5 text-caption text-muted">
                        It can still be attached, but Ansly matches it by its label only.
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <IconButton
                      icon={resume.fileType === 'pdf' ? ExternalLink : Download}
                      label={resume.fileType === 'pdf' ? 'Open' : 'Download'}
                      onClick={() => void openResumeFile(resume)}
                    />
                    <IconButton icon={Pencil} label="Edit label" onClick={() => setDialog({ open: true, editing: resume })} />
                    <IconButton
                      icon={RefreshCcw}
                      label="Replace file"
                      disabled={busy === resume.id}
                      onClick={() => {
                        setReplacing(resume)
                        replaceInput.current?.click()
                      }}
                    />
                    <IconButton
                      icon={Trash2}
                      label="Delete"
                      tone="danger"
                      disabled={busy === resume.id}
                      onClick={() => void remove(resume)}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <RoleResumeDialog
        open={dialog.open}
        editing={dialog.editing}
        onClose={() => setDialog({ open: false, editing: null })}
        onDone={() => void refresh()}
      />
    </Card>
  )
}
