'use client'

import type { Resume } from '@ansly/types'
import { clsx } from 'clsx'
import { Download, FileText, Star, Trash2, Upload } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import toast from 'react-hot-toast'
import { useConfirm } from '@/components/dialog'
import { OnSearchParam } from '@/components/search-param'
import { TagInput } from '@/components/tag-input'
import { Badge, Button, Card, EmptyState, ErrorText, Field, IconButton, IconTile, Input, PageHeader, Skeleton } from '@/components/ui'
import { errorMessage } from '@/lib/format'
import { createClient } from '@/lib/supabase/client'

const BUCKET = 'resumes'
const MAX_BYTES = 5 * 1024 * 1024
const ACCEPT = '.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function formatSize(bytes: number | null): string {
  if (!bytes) return ''
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function ResumeCard({
  resume,
  onChanged,
  onDelete,
  onDefault,
}: {
  resume: Resume
  onChanged: () => void
  onDelete: () => void
  onDefault: () => void
}) {
  const [name, setName] = useState(resume.name)
  const [roles, setRoles] = useState(resume.target_roles)

  async function save(values: Partial<Resume>) {
    const { error } = await createClient().from('resumes').update(values).eq('id', resume.id)
    if (error) return toast.error(error.message)
    onChanged()
  }

  async function download() {
    const { data, error } = await createClient().storage.from(BUCKET).createSignedUrl(resume.file_path, 60)
    if (error || !data) return toast.error(error?.message ?? 'Could not open the file')
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start gap-4">
        <IconTile icon={FileText} tone={resume.is_default ? 'accent' : 'neutral'} />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => name.trim() && name !== resume.name && void save({ name: name.trim() })}
              aria-label="Resume name"
              className="max-w-xs font-medium"
            />
            {resume.is_default && <Badge tone="accent">Default</Badge>}
          </div>
          <p className="text-caption text-subtle">
            {resume.file_name} · {formatSize(resume.size_bytes)}
          </p>
          <Field label="Use for roles like" htmlFor={`roles-${resume.id}`} help="Ansly picks this resume for matching jobs.">
            <TagInput
              id={`roles-${resume.id}`}
              value={roles}
              onChange={(v) => {
                setRoles(v)
                void save({ target_roles: v })
              }}
              placeholder="Full Stack Engineer…"
            />
          </Field>
        </div>
        <div className="flex gap-0.5">
          {!resume.is_default && <IconButton icon={Star} label="Make default" onClick={onDefault} />}
          <IconButton icon={Download} label="Download" onClick={() => void download()} />
          <IconButton icon={Trash2} label="Delete" tone="danger" onClick={onDelete} />
        </div>
      </div>
    </Card>
  )
}

export default function ResumesPage() {
  const [resumes, setResumes] = useState<Resume[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const [confirm, confirmDialog] = useConfirm()

  const load = useCallback(async () => {
    const { data, error } = await createClient().from('resumes').select('*').order('created_at', { ascending: false })
    if (error) setError(error.message)
    else setResumes(data as Resume[])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function upload(file: File | undefined) {
    if (!file) return
    if (file.size > MAX_BYTES) return toast.error('Resumes can be up to 5 MB.')
    setUploading(true)
    try {
      const supabase = createClient()
      const { data: auth } = await supabase.auth.getUser()
      if (!auth.user) throw new Error('Your session has expired. Sign in again.')
      const safe = file.name.replace(/[^\w.-]+/g, '-').slice(-80)
      const path = `${auth.user.id}/${crypto.randomUUID()}-${safe}`
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined })
      if (uploadError) throw new Error(uploadError.message)
      const { error } = await supabase.from('resumes').insert({
        name: file.name.replace(/\.[^.]+$/, ''),
        file_path: path,
        file_name: file.name,
        mime_type: file.type || null,
        size_bytes: file.size,
        is_default: !resumes?.length,
      })
      if (error) {
        await supabase.storage.from(BUCKET).remove([path])
        throw new Error(error.message)
      }
      toast.success('Resume uploaded')
      await load()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setUploading(false)
      if (input.current) input.current.value = ''
    }
  }

  async function makeDefault(resume: Resume) {
    const supabase = createClient()
    // One default per user: clear the old one first.
    const cleared = await supabase.from('resumes').update({ is_default: false }).eq('is_default', true)
    if (cleared.error) return toast.error(cleared.error.message)
    const { error } = await supabase.from('resumes').update({ is_default: true }).eq('id', resume.id)
    if (error) return toast.error(error.message)
    toast.success(`${resume.name} is now your default`)
    await load()
  }

  async function remove(resume: Resume) {
    if (!(await confirm({ title: `Delete ${resume.name}?`, description: 'The file is deleted from storage.', confirmLabel: 'Delete' }))) return
    const supabase = createClient()
    const { error } = await supabase.from('resumes').delete().eq('id', resume.id)
    if (error) return toast.error(error.message)
    await supabase.storage.from(BUCKET).remove([resume.file_path])
    toast.success('Deleted')
    await load()
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    void upload(e.dataTransfer.files?.[0])
  }

  return (
    <div className="animate-fade-up">
      <PageHeader
        eyebrow="Profile"
        title="Resumes"
        description="Upload the resumes you apply with. Ansly picks the best one for each application, and the extension can attach it to the form."
        actions={
          <Button icon={Upload} loading={uploading} onClick={() => input.current?.click()}>
            Upload resume
          </Button>
        }
      />
      <input ref={input} type="file" accept={ACCEPT} className="sr-only" id="resume-file" onChange={(e) => void upload(e.target.files?.[0])} />
      <ErrorText>{error}</ErrorText>

      {resumes === null && !error && <Skeleton className="h-32 w-full rounded-xl" />}

      {resumes?.length === 0 && (
        <label
          htmlFor="resume-file"
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={clsx('block cursor-pointer rounded-xl transition', dragging && 'ring-4 ring-accent/15')}
        >
          <EmptyState icon={Upload} title="Drop your resume here" description="PDF or Word, up to 5 MB. Stored privately: only you can read it." />
        </label>
      )}

      <div className="space-y-3">
        {resumes?.map((r) => (
          <ResumeCard key={r.id} resume={r} onChanged={() => void load()} onDelete={() => void remove(r)} onDefault={() => void makeDefault(r)} />
        ))}
      </div>
      <OnSearchParam name="new" onMatch={() => input.current?.click()} />
      {confirmDialog}
    </div>
  )
}
