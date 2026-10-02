'use client'

import type { AnswerResponse, AnswerStyle, UsedSource } from '@ansly/types'
import { clsx } from 'clsx'
import { BookmarkPlus, Briefcase, Check, ChevronDown, CornerDownLeft, FileQuestion, RefreshCw, SearchX, Sparkles, Wand2 } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { SECTION_ICONS } from '@/components/section-icons'
import {
  Alert,
  Badge,
  Button,
  Card,
  CharCount,
  Chip,
  CopyButton,
  EmptyState,
  Field,
  IconTile,
  Input,
  KeyHint,
  Overline,
  PageHeader,
  SkeletonText,
  Textarea,
  buttonStyles,
  chipStyles,
} from '@/components/ui'
import { generateAnswer, regenerateAnswer, saveAnswer } from '@/lib/api'
import { errorMessage, humanize } from '@/lib/format'

const EXAMPLES = [
  'Tell us about yourself.',
  'Why are you interested in this role?',
  'Describe a project you are proud of.',
  'What is your greatest professional achievement?',
  'Do you have experience with Kubernetes?',
]

/** Presets map onto the same length / tone values as the extension's controls. */
const TWEAKS: { label: string; style: Partial<AnswerStyle> }[] = [
  { label: 'Shorter', style: { length: 'concise' } },
  { label: 'More detailed', style: { length: 'detailed' } },
  { label: 'More technical', style: { tone: 'technical' } },
  { label: 'More enthusiastic', style: { tone: 'enthusiastic' } },
  { label: 'More formal', style: { tone: 'formal' } },
]

const DEFAULT_STYLE: AnswerStyle = { length: 'auto', tone: 'professional' }

const isOn = (style: AnswerStyle, preset: Partial<AnswerStyle>) =>
  Object.entries(preset).every(([k, v]) => style[k as keyof AnswerStyle] === v)

const SOURCE_ROUTES: Record<UsedSource['type'], { slug: string; label: string }> = {
  profile: { slug: 'personal', label: 'Personal' },
  experience: { slug: 'experience', label: 'Experience' },
  project: { slug: 'projects', label: 'Project' },
  skill: { slug: 'skills', label: 'Skill' },
  education: { slug: 'education', label: 'Education' },
  achievement: { slug: 'achievements', label: 'Achievement' },
  fact: { slug: 'additional', label: 'Additional detail' },
}

const CONFIDENCE_TONE = { high: 'success', medium: 'accent', low: 'warning' } as const

export default function PlaygroundPage() {
  const [question, setQuestion] = useState('')
  const [showContext, setShowContext] = useState(false)
  const [company, setCompany] = useState('')
  const [role, setRole] = useState('')
  const [description, setDescription] = useState('')
  const [maxLength, setMaxLength] = useState('')
  const [result, setResult] = useState<AnswerResponse | null>(null)
  const [asked, setAsked] = useState('')
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'generate' | 'regenerate' | null>(null)
  const [instruction, setInstruction] = useState('')
  const [style, setStyle] = useState<AnswerStyle>(DEFAULT_STYLE)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const questionRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => questionRef.current?.focus(), [])

  const limit = Number(maxLength) > 0 ? Number(maxLength) : null
  const request = (s: AnswerStyle = style) => ({
    style: s,
    question: question.trim(),
    job_context:
      company.trim() || role.trim() || description.trim()
        ? { company: company.trim() || null, role: role.trim() || null, description: description.trim() || null }
        : null,
    field: { kind: 'textarea' as const, maxLength: limit },
  })

  function show(res: AnswerResponse) {
    setResult(res)
    setAnswer(res.answer)
    setSaved(false)
  }

  async function onGenerate(e?: FormEvent) {
    e?.preventDefault()
    if (question.trim().length < 2 || busy) return
    setBusy('generate')
    setError(null)
    setAsked(question.trim())
    try {
      show(await generateAnswer(request()))
    } catch (err) {
      setResult(null)
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  async function onRegenerate(preset?: Partial<AnswerStyle>) {
    if (!result || busy) return
    // A preset toggles: clicking an active one goes back to the default for that setting.
    let next = style
    if (preset && isOn(style, preset)) {
      next = {
        ...style,
        length: preset.length ? DEFAULT_STYLE.length : style.length,
        tone: preset.tone ? DEFAULT_STYLE.tone : style.tone,
      }
    } else if (preset) {
      next = { ...style, ...preset }
    }
    setStyle(next)
    setBusy('regenerate')
    setError(null)
    try {
      show(
        await regenerateAnswer({
          ...request(next),
          question: asked,
          previous_answer: answer || result.answer,
          instruction: instruction.trim() || null,
        }),
      )
      setInstruction('')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  async function onSave() {
    if (!answer.trim()) return
    setSaving(true)
    try {
      await saveAnswer({
        question: asked,
        answer: answer.trim(),
        category: result?.category ?? null,
        company: company.trim() || null,
        role: role.trim() || null,
      })
      setSaved(true)
      toast.success('Saved as preferred answer')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="animate-fade-up">
      <PageHeader
        eyebrow="Workspace"
        title="Try it"
        description="Ask any application question and see exactly what Ansly would write from your profile — the same engine the extension uses."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        {/* Question */}
        <Card className="h-fit lg:sticky lg:top-8">
          <form onSubmit={onGenerate} className="space-y-4">
            <Field label="Application question" htmlFor="question">
              <Textarea
                ref={questionRef}
                id="question"
                rows={4}
                value={question}
                placeholder="e.g. Why do you want to work at Acme?"
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void onGenerate()
                }}
              />
            </Field>

            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((q) => (
                <Chip key={q} selected={question === q} onClick={() => setQuestion(q)}>
                  {q}
                </Chip>
              ))}
            </div>

            <div className="rounded-lg border border-border">
              <button
                type="button"
                onClick={() => setShowContext((s) => !s)}
                aria-expanded={showContext}
                className="flex w-full items-center gap-2 px-3 py-2.5 font-medium"
              >
                <Briefcase className="h-4 w-4 text-subtle" />
                Job context
                <span className="font-normal text-subtle">— optional</span>
                {(company || role || description) && <Badge tone="accent">Added</Badge>}
                <ChevronDown className={clsx('ml-auto h-4 w-4 text-subtle transition', showContext && 'rotate-180')} />
              </button>
              {showContext && (
                <div className="grid gap-4 border-t border-border p-3 sm:grid-cols-2">
                  <Field label="Company" htmlFor="company">
                    <Input id="company" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme" />
                  </Field>
                  <Field label="Role" htmlFor="role">
                    <Input id="role" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Senior Engineer" />
                  </Field>
                  <Field label="Job description" htmlFor="description" className="sm:col-span-2">
                    <Textarea id="description" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Paste the job description for a role-specific answer" />
                  </Field>
                  <Field label="Character limit" htmlFor="max-length" help="Like a form field's maxlength.">
                    <Input id="max-length" type="number" min={1} value={maxLength} onChange={(e) => setMaxLength(e.target.value)} placeholder="None" />
                  </Field>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3">
              <KeyHint keys={['Ctrl', <CornerDownLeft key="enter" className="h-3 w-3" />]}>to generate</KeyHint>
              <Button type="submit" icon={Sparkles} loading={busy === 'generate'} disabled={question.trim().length < 2} className="ml-auto">
                Generate answer
              </Button>
            </div>
          </form>
        </Card>

        {/* Result */}
        <div className="min-w-0">
          {error && (
            <Alert tone="danger" title="Couldn't generate an answer" className="mb-4">
              {error}
            </Alert>
          )}

          {busy === 'generate' ? (
            <Card className="space-y-4">
              <div className="flex items-center gap-2 text-muted">
                <Sparkles className="h-4 w-4 animate-pulse text-accent" />
                Reading your profile and drafting an answer…
              </div>
              <SkeletonText />
            </Card>
          ) : !result ? (
            !error && (
              <EmptyState
                icon={Wand2}
                title="Your answer will appear here"
                description="Pick an example or type a question. Ansly only uses what's in your profile — try asking about something you haven't listed to see how it refuses to guess."
              />
            )
          ) : result.status === 'insufficient_information' ? (
            <Card className="space-y-4">
              <p className="font-medium text-muted">“{asked}”</p>
              <div className="flex gap-4">
                <IconTile icon={SearchX} tone="warning" />
                <div>
                  <h2 className="text-title">Not enough information in your profile</h2>
                  <p className="mt-1 leading-relaxed text-muted">
                    {result.missingInformation || result.answer || 'Ansly would rather say so than invent an answer.'}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                <Link href="/profile/experience" className={buttonStyles({ size: 'sm' })}>
                  Add experience
                </Link>
                <Link href="/profile/skills" className={buttonStyles({ size: 'sm', variant: 'secondary' })}>
                  Add skills
                </Link>
                <Link href="/profile/projects" className={buttonStyles({ size: 'sm', variant: 'secondary' })}>
                  Add a project
                </Link>
              </div>
            </Card>
          ) : (
            <Card className="p-0">
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
                <p className="min-w-0 flex-1 truncate font-medium text-muted" title={asked}>
                  “{asked}”
                </p>
                <Badge tone={CONFIDENCE_TONE[result.confidence]} dot>
                  {result.confidence} confidence
                </Badge>
              </div>

              <div className="p-5">
                <Textarea
                  value={answer}
                  onChange={(e) => {
                    setAnswer(e.target.value)
                    setSaved(false)
                  }}
                  rows={Math.min(16, Math.max(6, Math.ceil(answer.length / 70)))}
                  aria-label="Answer"
                  className={clsx(
                    'border-transparent bg-surface-muted/50 text-body-lg shadow-none hover:border-border',
                    busy === 'regenerate' && 'animate-pulse',
                  )}
                />
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-caption text-subtle">Edit freely — this is your answer.</span>
                  <CharCount count={answer.length} limit={limit} />
                </div>

                {result.usedSources.length > 0 && (
                  <div className="mt-5">
                    <Overline>Grounded in</Overline>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {result.usedSources.map((s) => {
                        const route = SOURCE_ROUTES[s.type]
                        const Icon = SECTION_ICONS[route.slug]
                        return (
                          <Link
                            key={`${s.type}-${s.id}`}
                            href={`/profile/${route.slug}`}
                            className={chipStyles({ className: 'rounded-md' })}
                          >
                            <Icon className="h-3 w-3" />
                            {s.label}
                          </Link>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-3 border-t border-border bg-surface-muted/30 px-5 py-4">
                <div className="flex flex-wrap gap-1.5">
                  {TWEAKS.map((t) => (
                    <Chip key={t.label} selected={isOn(style, t.style)} disabled={Boolean(busy)} onClick={() => void onRegenerate(t.style)}>
                      {t.label}
                    </Chip>
                  ))}
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    void onRegenerate()
                  }}
                  className="flex gap-2"
                >
                  <Input
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    placeholder="Or tell Ansly how to change it…"
                    aria-label="Regeneration instruction"
                    maxLength={500}
                    className="flex-1"
                  />
                  <Button type="submit" variant="secondary" icon={RefreshCw} loading={busy === 'regenerate'}>
                    Regenerate
                  </Button>
                </form>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button onClick={onSave} icon={saved ? Check : BookmarkPlus} loading={saving} disabled={saved || !answer.trim()}>
                    {saved ? 'Saved' : 'Save as preferred answer'}
                  </Button>
                  <CopyButton text={answer} label="Copy" />
                </div>
              </div>
            </Card>
          )}

          {result && (
            <p className="mt-3 flex items-center gap-1.5 text-caption text-subtle">
              <FileQuestion className="h-3.5 w-3.5" />
              Category: {humanize(result.category)}
              {result.provider && ` · ${result.provider}`}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
