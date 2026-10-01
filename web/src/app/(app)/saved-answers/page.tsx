'use client'

import type { SavedAnswer } from '@ansly/types'
import { BookmarkCheck, Building2, Pencil, Plus, Repeat, Search, SearchX, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { Sheet, useConfirm, type ConfirmOptions } from '@/components/dialog'
import { OnSearchParam } from '@/components/search-param'
import {
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
  PageHeader,
  SearchInput,
  Skeleton,
  Textarea,
  buttonStyles,
} from '@/components/ui'
import { ApiError, saveAnswer } from '@/lib/api'
import { errorMessage, humanize } from '@/lib/format'
import { createClient } from '@/lib/supabase/client'

const LONG = 320

function SavedAnswerCard({
  item,
  onChanged,
  confirm,
}: {
  item: SavedAnswer
  onChanged: () => void
  confirm: (o: ConfirmOptions) => Promise<boolean>
}) {
  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [question, setQuestion] = useState(item.question)
  const [answer, setAnswer] = useState(item.answer)
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!question.trim() || !answer.trim()) return toast.error('Question and answer are required')
    setBusy(true)
    const { error } = await createClient()
      .from('saved_answers')
      .update({ question: question.trim(), answer: answer.trim() })
      .eq('id', item.id)
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success('Answer updated')
    setEditing(false)
    onChanged()
  }

  async function remove() {
    const ok = await confirm({
      title: 'Delete saved answer?',
      description: 'Ansly will stop offering it for similar questions. This can’t be undone.',
      confirmLabel: 'Delete',
    })
    if (!ok) return
    const { error } = await createClient().from('saved_answers').delete().eq('id', item.id)
    if (error) return toast.error(error.message)
    toast.success('Deleted')
    onChanged()
  }

  if (editing) {
    return (
      <Card className="space-y-4 border-accent/40 ring-4 ring-accent/10">
        <Field label="Question" htmlFor={`q-${item.id}`}>
          <Input id={`q-${item.id}`} value={question} onChange={(e) => setQuestion(e.target.value)} autoFocus />
        </Field>
        <Field label="Answer" htmlFor={`a-${item.id}`} hint={<CharCount count={answer.length} />}>
          <Textarea id={`a-${item.id}`} value={answer} rows={8} onChange={(e) => setAnswer(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setQuestion(item.question)
              setAnswer(item.answer)
              setEditing(false)
            }}
          >
            Cancel
          </Button>
          <Button onClick={save} loading={busy}>
            Save answer
          </Button>
        </div>
      </Card>
    )
  }

  const long = item.answer.length > LONG
  return (
    <Card className="group p-0 transition hover:border-border-strong">
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          <p className="text-title">{item.question}</p>
          <div className="-mr-1.5 -mt-1 flex shrink-0 gap-0.5 transition md:opacity-0 md:focus-within:opacity-100 md:group-hover:opacity-100">
            <CopyButton text={item.answer} />
            <IconButton icon={Pencil} label="Edit" onClick={() => setEditing(true)} />
            <IconButton icon={Trash2} label="Delete" tone="danger" onClick={remove} />
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {item.category && <Badge tone="accent">{humanize(item.category)}</Badge>}
          {(item.company || item.role) && (
            <Badge>
              <Building2 className="h-3 w-3" />
              {[item.role, item.company].filter(Boolean).join(' @ ')}
            </Badge>
          )}
          <Badge>
            <Repeat className="h-3 w-3" />
            Used {item.use_count}×
          </Badge>
        </div>
        <div className="mt-4 rounded-lg border border-border bg-surface-muted/50 px-4 py-3">
          <p className={`whitespace-pre-wrap leading-relaxed text-fg/85 ${long && !expanded ? 'line-clamp-4' : ''}`}>
            {item.answer}
          </p>
          {long && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="mt-2 text-caption font-medium text-accent hover:underline"
            >
              {expanded ? 'Show less' : 'Show full answer'}
            </button>
          )}
        </div>
      </div>
    </Card>
  )
}

function AddAnswerSheet({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [company, setCompany] = useState('')
  const [role, setRole] = useState('')
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (question.trim().length < 2 || !answer.trim()) return
    setBusy(true)
    const row = { question: question.trim(), answer: answer.trim(), company: company.trim() || null, role: role.trim() || null }
    try {
      // The API also classifies the question so it matches similar ones later.
      await saveAnswer(row)
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 0) {
        setBusy(false)
        return toast.error(errorMessage(err))
      }
      const { error } = await createClient().from('saved_answers').insert(row)
      if (error) {
        setBusy(false)
        return toast.error(error.message)
      }
    }
    setBusy(false)
    toast.success('Answer saved')
    setQuestion('')
    setAnswer('')
    setCompany('')
    setRole('')
    onAdded()
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add a saved answer"
      description="Write an answer once — Ansly offers it whenever a similar question comes up."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="add-answer" loading={busy} disabled={question.trim().length < 2 || !answer.trim()}>
            Save answer
          </Button>
        </div>
      }
    >
      <form id="add-answer" onSubmit={onSubmit} className="grid gap-5 px-6 py-6 sm:grid-cols-2">
        <Field label="Question" htmlFor="new-q" required className="sm:col-span-2">
          <Input id="new-q" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Why do you want to work here?" required />
        </Field>
        <Field label="Answer" htmlFor="new-a" required hint={<CharCount count={answer.length} />} className="sm:col-span-2">
          <Textarea id="new-a" rows={10} value={answer} onChange={(e) => setAnswer(e.target.value)} required />
        </Field>
        <Field label="Company" htmlFor="new-company" help="Optional — only if the answer is company-specific.">
          <Input id="new-company" value={company} onChange={(e) => setCompany(e.target.value)} />
        </Field>
        <Field label="Role" htmlFor="new-role">
          <Input id="new-role" value={role} onChange={(e) => setRole(e.target.value)} />
        </Field>
      </form>
    </Sheet>
  )
}

export default function SavedAnswersPage() {
  const [adding, setAdding] = useState(false)
  const [items, setItems] = useState<SavedAnswer[] | null>(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirm, confirmDialog] = useConfirm()

  const load = useCallback(async () => {
    const { data, error } = await createClient().from('saved_answers').select('*').order('updated_at', { ascending: false })
    if (error) setError(error.message)
    else setItems(data as SavedAnswer[])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || !items) return items
    return items.filter((i) => `${i.question} ${i.answer} ${i.company ?? ''} ${i.role ?? ''}`.toLowerCase().includes(q))
  }, [items, query])

  return (
    <div className="animate-fade-up">
      <PageHeader
        eyebrow="Workspace"
        title="Saved answers"
        description='Answers you saved with "Save as preferred answer" in the extension or playground. When a similar question comes up, Ansly offers them before generating a new one.'
        actions={
          <Button icon={Plus} onClick={() => setAdding(true)}>
            Add answer
          </Button>
        }
      />

      {items && items.length > 0 && (
        <div className="mb-5 flex items-center gap-3">
          <SearchInput
            icon={Search}
            placeholder="Search questions, answers, companies…"
            value={query}
            onChange={setQuery}
            aria-label="Search saved answers"
            className="flex-1"
          />
          <span className="shrink-0 tabular-nums text-muted">
            {filtered?.length ?? 0}
            {query && ` of ${items.length}`}
          </span>
        </div>
      )}

      <ErrorText>{error}</ErrorText>

      <div className="space-y-3">
        {items === null &&
          !error &&
          [0, 1, 2].map((i) => (
            <Card key={i} className="space-y-3">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/4" />
              <Skeleton className="h-16 w-full" />
            </Card>
          ))}

        {items?.length === 0 && (
          <EmptyState
            icon={BookmarkCheck}
            title="No saved answers yet"
            description='When an answer from ✨ is just right, click "Save as preferred answer". It will show up here and be offered for similar questions.'
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button icon={Plus} onClick={() => setAdding(true)}>
                  Write one now
                </Button>
                <Link href="/playground" className={buttonStyles({ variant: 'secondary' })}>
                  Try the playground
                </Link>
              </div>
            }
          />
        )}

        {items && items.length > 0 && filtered?.length === 0 && (
          <EmptyState
            icon={SearchX}
            title="No matches"
            description={`Nothing matches “${query.trim()}”.`}
            action={
              <Button variant="secondary" onClick={() => setQuery('')}>
                Clear search
              </Button>
            }
          />
        )}

        {filtered?.map((item) => (
          <SavedAnswerCard key={item.id} item={item} onChanged={load} confirm={confirm} />
        ))}
      </div>
      <OnSearchParam name="new" onMatch={() => setAdding(true)} />
      <AddAnswerSheet
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={() => {
          setAdding(false)
          void load()
        }}
      />
      {confirmDialog}
    </div>
  )
}
