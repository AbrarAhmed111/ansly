'use client'

import type { ApplicationAnswer } from '@ansly/types'
import { MessageSquareText, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import {
  Badge,
  Button,
  Card,
  CharCount,
  CopyButton,
  EmptyState,
  Field,
  IconButton,
  Input,
  Textarea,
} from '@/components/ui'
import { createClient } from '@/lib/supabase/client'

const SOURCE_LABELS = { prepared: 'Prepared', extension: 'From the extension', manual: 'Added by you' } as const

function AnswerItem({ item, onChanged }: { item: ApplicationAnswer; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [answer, setAnswer] = useState(item.answer)
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    const { error } = await createClient().from('application_answers').update({ answer: answer.trim() }).eq('id', item.id)
    setBusy(false)
    if (error) return toast.error(error.message)
    setEditing(false)
    onChanged()
  }

  async function remove() {
    const { error } = await createClient().from('application_answers').delete().eq('id', item.id)
    if (error) return toast.error(error.message)
    onChanged()
  }

  return (
    <Card className="group">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-title">{item.question}</p>
          <Badge className="mt-1.5">{SOURCE_LABELS[item.source]}</Badge>
        </div>
        <div className="-mr-1.5 -mt-1 flex gap-0.5">
          <CopyButton text={item.answer} />
          <IconButton icon={Pencil} label="Edit" onClick={() => setEditing(true)} />
          <IconButton icon={Trash2} label="Delete" tone="danger" onClick={() => void remove()} />
        </div>
      </div>
      {editing ? (
        <div className="mt-3 space-y-2">
          <Textarea value={answer} rows={6} onChange={(e) => setAnswer(e.target.value)} aria-label="Answer" />
          <div className="flex items-center justify-between">
            <CharCount count={answer.length} />
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => { setAnswer(item.answer); setEditing(false) }}>
                Cancel
              </Button>
              <Button size="sm" loading={busy} disabled={!answer.trim()} onClick={() => void save()}>
                Save
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <p className="mt-3 whitespace-pre-wrap leading-relaxed text-fg/85">{item.answer}</p>
      )}
    </Card>
  )
}

export function AnswersPanel({ applicationId, answers, onChanged }: { applicationId: string; answers: ApplicationAnswer[]; onChanged: () => void }) {
  const [adding, setAdding] = useState(false)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)

  async function add(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const { error } = await createClient()
      .from('application_answers')
      .insert({ application_id: applicationId, question: question.trim(), answer: answer.trim(), source: 'manual' })
    setBusy(false)
    if (error) return toast.error(error.code === '23505' ? 'That question already has an answer.' : error.message)
    setQuestion('')
    setAnswer('')
    setAdding(false)
    onChanged()
  }

  return (
    <div className="space-y-3">
      <p className="text-body-sm text-muted">
        Answers prepared for this application, and every answer you fill with the extension on its page. New answers stay
        consistent with these.
      </p>
      {answers.length === 0 && !adding && (
        <EmptyState icon={MessageSquareText} title="No answers yet" description="Prepare the application, or fill questions with ✨ on the application page." />
      )}
      {answers.map((a) => (
        <AnswerItem key={a.id} item={a} onChanged={onChanged} />
      ))}
      {adding ? (
        <Card>
          <form onSubmit={add} className="space-y-3">
            <Field label="Question" htmlFor="new-q">
              <Input id="new-q" required value={question} onChange={(e) => setQuestion(e.target.value)} />
            </Field>
            <Field label="Answer" htmlFor="new-a" hint={<CharCount count={answer.length} />}>
              <Textarea id="new-a" required rows={5} value={answer} onChange={(e) => setAnswer(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={busy} disabled={question.trim().length < 2 || !answer.trim()}>
                Add answer
              </Button>
            </div>
          </form>
        </Card>
      ) : (
        <Button variant="secondary" icon={Plus} onClick={() => setAdding(true)}>
          Add an answer
        </Button>
      )}
    </div>
  )
}
