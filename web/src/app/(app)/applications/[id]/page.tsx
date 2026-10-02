'use client'

import {
  BRIDGE_EXTENSION,
  BRIDGE_WEB,
  type Application,
  type ApplicationAnswer,
  type ApplicationEvent,
  type ApplicationStatus,
  type ExtensionToWebMessage,
  type Resume,
  type WebToExtensionMessage,
} from '@ansly/types'
import { ArrowLeft, ExternalLink, Rocket, Save, Trash2, Wand2 } from 'lucide-react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useConfirm } from '@/components/dialog'
import {
  Alert,
  Badge,
  Button,
  Card,
  CharCount,
  CopyButton,
  EmptyState,
  ErrorText,
  Field,
  IconButton,
  Input,
  Overline,
  SegmentedControl,
  Select,
  SkeletonText,
  Textarea,
  buttonStyles,
} from '@/components/ui'
import { prepareApplication } from '@/lib/api'
import { STATUS_META, STATUS_OPTIONS } from '@/lib/applications'
import { errorMessage } from '@/lib/format'
import { createClient } from '@/lib/supabase/client'
import { AnswersPanel } from './answers-panel'
import { PrepPanel } from './prep-panel'
import { Timeline } from './timeline'

type Tab = 'overview' | 'prep' | 'letter' | 'answers'

/** Tells the extension the next page at this URL belongs to the application; resolves false if it doesn't answer. */
function handOffToExtension(app: Application, skills: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => done(false), 800)
    function done(ok: boolean) {
      clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      resolve(ok)
    }
    function onMessage(event: MessageEvent<ExtensionToWebMessage>) {
      if (event.source !== window || event.data?.source !== BRIDGE_EXTENSION) return
      if (event.data.type === 'ANSLY_APPLICATION_STARTED') done(event.data.ok)
    }
    window.addEventListener('message', onMessage)
    const message: WebToExtensionMessage = {
      source: BRIDGE_WEB,
      type: 'ANSLY_START_APPLICATION',
      application: {
        id: app.id,
        job_id: app.job_id,
        company: app.company,
        role: app.role,
        job_url: app.job_url,
        status: app.status,
        resume_id: app.resume_id,
        location: app.location,
        skills,
      },
    }
    window.postMessage(message, window.location.origin)
  })
}

export default function ApplicationPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [app, setApp] = useState<Application | null>(null)
  const [events, setEvents] = useState<ApplicationEvent[]>([])
  const [answers, setAnswers] = useState<ApplicationAnswer[]>([])
  const [resumes, setResumes] = useState<Resume[]>([])
  const [skills, setSkills] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [preparing, setPreparing] = useState(false)
  const [notes, setNotes] = useState('')
  const [letter, setLetter] = useState('')
  const [jobUrl, setJobUrl] = useState('')
  const [confirm, confirmDialog] = useConfirm()

  const load = useCallback(async () => {
    const supabase = createClient()
    const [a, ev, an, rs] = await Promise.all([
      supabase.from('applications').select('*').eq('id', id).maybeSingle(),
      supabase.from('application_events').select('*').eq('application_id', id).order('occurs_at', { ascending: false }),
      supabase.from('application_answers').select('*').eq('application_id', id).order('created_at'),
      supabase.from('resumes').select('*').order('created_at', { ascending: false }),
    ])
    if (a.error) return setError(a.error.message)
    if (!a.data) return setError('Application not found.')
    const application = a.data as Application
    setApp(application)
    setNotes(application.notes ?? '')
    setLetter(application.cover_letter ?? '')
    setJobUrl(application.job_url ?? '')
    setEvents((ev.data ?? []) as ApplicationEvent[])
    setAnswers((an.data ?? []) as ApplicationAnswer[])
    setResumes((rs.data ?? []) as Resume[])
    if (application.job_id) {
      const { data } = await supabase.from('jobs').select('skills').eq('id', application.job_id).maybeSingle()
      setSkills((data?.skills as string[]) ?? [])
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  async function update(values: Partial<Application>, message?: string) {
    const { error } = await createClient().from('applications').update(values).eq('id', id)
    if (error) return toast.error(error.message)
    if (message) toast.success(message)
    await load()
  }

  async function prepare() {
    setPreparing(true)
    const pending = toast.loading('Preparing… this takes about a minute.')
    try {
      const result = await prepareApplication(id)
      toast.success(result.llm_available ? 'Application prepared' : 'Prepared without AI text: providers were busy', { id: pending })
      await load()
      setTab('prep')
    } catch (err) {
      toast.error(errorMessage(err), { id: pending })
    } finally {
      setPreparing(false)
    }
  }

  async function applyWithAnsly() {
    if (!app?.job_url) return
    const connected = await handOffToExtension(app, skills)
    window.open(app.job_url, '_blank', 'noopener')
    if (!connected) toast('Install and connect the Ansly extension to fill this application with ✨.', { icon: '🧩' })
    if (app.status === 'interested' || app.status === 'preparing') void update({ status: 'applied' })
  }

  async function remove() {
    if (!(await confirm({ title: 'Delete this application?', description: 'Its timeline, answers and cover letter are deleted too.', confirmLabel: 'Delete' }))) return
    const { error } = await createClient().from('applications').delete().eq('id', id)
    if (error) return toast.error(error.message)
    toast.success('Deleted')
    router.push('/applications')
  }

  if (!app) {
    return (
      <>
        <ErrorText>{error}</ErrorText>
        {!error && (
          <Card>
            <SkeletonText />
          </Card>
        )}
      </>
    )
  }

  const tabs = [
    { value: 'overview', label: 'Overview' },
    { value: 'prep', label: 'Preparation' },
    { value: 'letter', label: 'Cover letter' },
    { value: 'answers', label: `Answers${answers.length ? ` (${answers.length})` : ''}` },
  ] as const

  return (
    <div className="animate-fade-up">
      <Link href="/applications" className="mb-6 inline-flex items-center gap-1.5 text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" />
        Applications
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Overline tone="accent">{app.company}</Overline>
          <h1 className="mt-1.5 text-h2">{app.role}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-muted">
            <Badge tone={STATUS_META[app.status].tone} dot>
              {STATUS_META[app.status].label}
            </Badge>
            {app.location && <span>{app.location}</span>}
            {app.applied_at && <span>· Applied {new Date(app.applied_at).toLocaleDateString()}</span>}
            {app.job_id && (
              <Link href={`/jobs/${app.job_id}`} className="text-accent hover:underline">
                · View match
              </Link>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={app.status}
            aria-label="Status"
            className="w-40"
            onChange={(e) => void update({ status: e.target.value as ApplicationStatus }, 'Status updated')}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          {!app.prep && (
            <Button variant="secondary" icon={Wand2} loading={preparing} onClick={() => void prepare()}>
              Prepare
            </Button>
          )}
          {app.job_url && (
            <Button icon={Rocket} onClick={() => void applyWithAnsly()}>
              Apply with Ansly
            </Button>
          )}
          <IconButton icon={Trash2} label="Delete application" tone="danger" onClick={() => void remove()} />
        </div>
      </div>

      <SegmentedControl role="tablist" label="Sections" options={tabs} value={tab} onChange={setTab} className="mb-5" />

      {tab === 'overview' && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <Card className="h-fit space-y-5">
            <Field label="Posting URL" htmlFor="job-url" help="Ansly's extension recognizes this page and uses this application's context.">
              <div className="flex gap-2">
                <Input id="job-url" type="url" value={jobUrl} onChange={(e) => setJobUrl(e.target.value)} className="flex-1" />
                {jobUrl !== (app.job_url ?? '') ? (
                  <Button variant="secondary" onClick={() => void update({ job_url: jobUrl.trim() || null }, 'URL saved')}>
                    Save
                  </Button>
                ) : (
                  app.job_url && (
                    <a href={app.job_url} target="_blank" rel="noreferrer" className={buttonStyles({ variant: 'secondary', size: 'icon' })} aria-label="Open posting">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )
                )}
              </div>
            </Field>
            <Field label="Resume" htmlFor="resume" help={resumes.length ? undefined : 'Upload resumes on the Resumes page.'}>
              <Select
                id="resume"
                value={app.resume_id ?? ''}
                onChange={(e) => void update({ resume_id: e.target.value || null }, 'Resume selected')}
              >
                <option value="">None</option>
                {resumes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Notes" htmlFor="notes">
              <Textarea id="notes" rows={6} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            {notes !== (app.notes ?? '') && (
              <Button size="sm" icon={Save} onClick={() => void update({ notes: notes.trim() || null }, 'Notes saved')}>
                Save notes
              </Button>
            )}
          </Card>
          <Card>
            <h2 className="mb-4 text-title">Timeline</h2>
            <Timeline applicationId={id} events={events} onAdded={() => void load()} />
          </Card>
        </div>
      )}

      {tab === 'prep' && (
        <Card>
          <PrepPanel application={app} resumes={resumes} preparing={preparing} onPrepare={() => void prepare()} />
        </Card>
      )}

      {tab === 'letter' &&
        (letter || app.cover_letter ? (
          <Card className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-title">Cover letter</h2>
              <CopyButton text={letter} label="Copy" />
            </div>
            <Alert tone="accent">Generated from your profile only. Read it, make it yours, then use it.</Alert>
            <Textarea value={letter} rows={16} onChange={(e) => setLetter(e.target.value)} aria-label="Cover letter" className="text-body-lg" />
            <div className="flex items-center justify-between">
              <CharCount count={letter.length} />
              {letter !== (app.cover_letter ?? '') && (
                <Button size="sm" icon={Save} onClick={() => void update({ cover_letter: letter.trim() || null }, 'Cover letter saved')}>
                  Save
                </Button>
              )}
            </div>
          </Card>
        ) : (
          <EmptyState
            icon={Wand2}
            title="No cover letter yet"
            description="Prepare the application and Ansly drafts one from your profile."
            action={
              <Button icon={Wand2} loading={preparing} onClick={() => void prepare()}>
                Prepare application
              </Button>
            }
          />
        ))}

      {tab === 'answers' && <AnswersPanel applicationId={id} answers={answers} onChanged={() => void load()} />}
      {confirmDialog}
    </div>
  )
}
