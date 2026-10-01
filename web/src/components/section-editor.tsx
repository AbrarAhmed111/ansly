'use client'

import { clsx } from 'clsx'
import { ArrowDown, ArrowUp, ExternalLink, ListChecks, Pencil, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { Sheet, useConfirm, type ConfirmOptions } from '@/components/dialog'
import { OnSearchParam } from '@/components/search-param'
import { SECTION_ICONS } from '@/components/section-icons'
import { TagInput } from '@/components/tag-input'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorText,
  Field,
  IconTile,
  Input,
  PageHeader,
  Select,
  Skeleton,
  Textarea,
} from '@/components/ui'
import { sectionBySlug, toFormValues, toRow, type FieldDef, type Row, type SectionDef } from '@/lib/sections'
import { createClient } from '@/lib/supabase/client'

type Confirm = (options: ConfirmOptions) => Promise<boolean>

const lines = (value: unknown) =>
  String(value ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

function FieldInput({
  field,
  value,
  onChange,
  disabled,
}: {
  field: FieldDef
  value: unknown
  onChange: (value: unknown) => void
  disabled?: boolean
}) {
  const id = `f-${field.name}`
  if (field.type === 'checkbox') {
    return (
      <label
        htmlFor={id}
        className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-surface-muted/50 px-3 py-2.5 text-sm font-medium transition hover:border-border-strong"
      >
        <input
          id={id}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 cursor-pointer rounded border-border accent-[rgb(var(--accent))]"
        />
        {field.label}
      </label>
    )
  }
  const common = {
    id,
    required: field.required,
    placeholder: field.placeholder,
    disabled,
    value: String(value ?? ''),
  }
  let control
  if (field.type === 'list' && field.tags) {
    control = (
      <TagInput
        id={id}
        value={lines(value)}
        placeholder={field.placeholder}
        disabled={disabled}
        onChange={(tags) => onChange(tags.join('\n'))}
      />
    )
  } else if (field.type === 'textarea' || field.type === 'list') {
    control = <Textarea {...common} rows={field.type === 'list' ? 4 : 5} onChange={(e) => onChange(e.target.value)} />
  } else if (field.type === 'select') {
    control = (
      <Select {...common} onChange={(e) => onChange(e.target.value)}>
        <option value="">Not specified</option>
        {field.options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    )
  } else {
    control = (
      <Input
        {...common}
        type={field.type === 'month' ? 'month' : field.type === 'number' ? 'number' : field.type === 'url' ? 'url' : 'text'}
        step={field.type === 'number' ? '0.5' : undefined}
        min={field.type === 'number' ? 0 : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }
  return (
    <Field label={field.label} required={field.required} htmlFor={id} help={field.help}>
      {control}
    </Field>
  )
}

function ItemSheet({
  section,
  row,
  open,
  onClose,
  onSaved,
  onDelete,
  nextSortOrder,
  confirm,
}: {
  section: SectionDef
  row?: Row
  open: boolean
  onClose: () => void
  onSaved: () => void
  onDelete: (row: Row) => void
  nextSortOrder: number
  confirm: Confirm
}) {
  const initial = useMemo(() => toFormValues(section, row), [section, row])
  const [values, setValues] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const dirty = JSON.stringify(values) !== JSON.stringify(initial)

  async function requestClose() {
    if (
      dirty &&
      !(await confirm({ title: 'Discard changes?', description: 'Your edits to this item will be lost.', confirmLabel: 'Discard' }))
    )
      return
    onClose()
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const data = toRow(section, values)
    const { error } = row
      ? await supabase.from(section.table).update(data).eq('id', row.id)
      : await supabase.from(section.table).insert({ ...data, sort_order: nextSortOrder })
    setBusy(false)
    if (error) {
      setError(error.code === '23505' ? `You already have that ${section.singular}.` : error.message)
      return
    }
    toast.success(row ? 'Changes saved' : `Added ${section.singular}`)
    onSaved()
  }

  const formId = `form-${section.slug}`
  return (
    <Sheet
      open={open}
      onClose={() => void requestClose()}
      title={row ? `Edit ${section.singular}` : `Add ${section.singular}`}
      description={row ? section.itemTitle(row) : section.description}
      footer={
        <div className="flex items-center gap-2">
          {row && (
            <Button type="button" variant="danger-soft" onClick={() => onDelete(row)} className="-ml-2">
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="secondary" onClick={() => void requestClose()}>
              Cancel
            </Button>
            <Button type="submit" form={formId} loading={busy}>
              {row ? 'Save changes' : `Add ${section.singular}`}
            </Button>
          </div>
        </div>
      }
    >
      <form id={formId} onSubmit={onSubmit} className="grid gap-5 px-6 py-6 sm:grid-cols-2">
        {section.fields.map((field) => (
          <div key={field.name} className={field.wide || field.type === 'textarea' || field.type === 'list' ? 'sm:col-span-2' : ''}>
            <FieldInput
              field={field}
              value={values[field.name]}
              disabled={field.name === 'end_date' && Boolean(values.is_current)}
              onChange={(value) => setValues((v) => ({ ...v, [field.name]: value }))}
            />
          </div>
        ))}
        {error && (
          <div className="sm:col-span-2">
            <ErrorText>{error}</ErrorText>
          </div>
        )}
      </form>
    </Sheet>
  )
}

function ItemCard({
  section,
  row,
  index,
  total,
  onEdit,
  onDelete,
  onMove,
}: {
  section: SectionDef
  row: Row
  index: number
  total: number
  onEdit: () => void
  onDelete: () => void
  onMove: (direction: -1 | 1) => void
}) {
  const Icon = SECTION_ICONS[section.slug]
  const tech = Array.isArray(row.technologies) ? (row.technologies as string[]) : []
  const highlights = Array.isArray(row.highlights) ? (row.highlights as string[]).length : 0
  const url = typeof row.url === 'string' && row.url ? row.url : null
  const subtitle = section.itemSubtitle(row)

  return (
    <Card className="group relative p-0 transition hover:border-border-strong">
      <div className="flex gap-4 p-5">
        <div className="hidden sm:block">
          <IconTile icon={Icon} />
        </div>
        <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left focus-visible:outline-none">
          <span className="absolute inset-0 rounded-xl" aria-hidden />
          <p className="font-semibold tracking-tight">{section.itemTitle(row)}</p>
          {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
          {typeof row.description === 'string' && row.description && (
            <p className="mt-2.5 line-clamp-2 text-sm leading-relaxed text-muted">{row.description}</p>
          )}
          {(tech.length > 0 || highlights > 0) && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {highlights > 0 && (
                <Badge tone="accent">
                  <ListChecks className="h-3 w-3" />
                  {highlights} highlight{highlights === 1 ? '' : 's'}
                </Badge>
              )}
              {tech.slice(0, 6).map((t) => (
                <Badge key={t}>{t}</Badge>
              ))}
              {tech.length > 6 && <span className="text-xs text-subtle">+{tech.length - 6} more</span>}
            </div>
          )}
        </button>
        <div className="relative flex shrink-0 items-start gap-0.5 transition md:opacity-0 md:focus-within:opacity-100 md:group-hover:opacity-100">
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-muted hover:text-fg"
              aria-label="Open link"
              title="Open link"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
          <Button variant="ghost" size="icon-sm" aria-label="Move up" title="Move up" disabled={index === 0} onClick={() => onMove(-1)}>
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Move down"
            title="Move down"
            disabled={index === total - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDown className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Edit" title="Edit" onClick={onEdit}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Delete" title="Delete" onClick={onDelete} className="hover:bg-danger/10 hover:text-danger">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Card>
  )
}

const LEVEL_DOTS: Record<string, number> = { beginner: 1, intermediate: 2, advanced: 3, expert: 4 }

function SkillsBoard({
  section,
  rows,
  onEdit,
  onAdded,
}: {
  section: SectionDef
  rows: Row[]
  onEdit: (row: Row) => void
  onAdded: () => void
}) {
  const categories = section.fields.find((f) => f.name === 'category')?.options ?? []
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  async function quickAdd(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    const { error } = await createClient()
      .from(section.table)
      .insert({ ...toRow(section, { name, category }), sort_order: rows.length })
    setBusy(false)
    if (error) {
      toast.error(error.code === '23505' ? `${name.trim()} is already in your skills` : error.message)
      return
    }
    toast.success(`Added ${name.trim()}`)
    setName('')
    input.current?.focus()
    onAdded()
  }

  const groups = [...categories, { value: '', label: 'Uncategorized' }]
    .map((c) => ({ ...c, rows: rows.filter((r) => (r.category ?? '') === c.value) }))
    .filter((g) => g.rows.length)

  return (
    <div className="space-y-4">
      <Card className="p-3">
        <form onSubmit={quickAdd} className="flex flex-col gap-2 sm:flex-row">
          <Input
            ref={input}
            icon={Plus}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Quick add a skill, e.g. TypeScript"
            aria-label="Skill name"
            className="flex-1"
          />
          <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category" className="sm:w-48">
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
          <Button type="submit" loading={busy} disabled={!name.trim()}>
            Add
          </Button>
        </form>
      </Card>

      {groups.length === 0 && (
        <EmptyState
          icon={SECTION_ICONS.skills}
          title="No skills yet"
          description="Add the languages, frameworks and tools you actually use. Press Enter after each one."
        />
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {groups.map((g) => (
          <Card key={g.value || 'none'}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[13px] font-semibold uppercase tracking-wider text-muted">{g.label}</h3>
              <span className="text-xs tabular-nums text-subtle">{g.rows.length}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {g.rows.map((row) => {
                const dots = LEVEL_DOTS[String(row.level ?? '')] ?? 0
                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => onEdit(row)}
                    title={[row.level, row.years ? `${row.years} yrs` : ''].filter(Boolean).join(' · ') || 'Edit skill'}
                    className="group inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[13px] font-medium shadow-xs transition hover:border-accent/40 hover:bg-accent-soft hover:text-accent"
                  >
                    {String(row.name)}
                    {dots > 0 && (
                      <span className="flex gap-0.5" aria-label={String(row.level)}>
                        {[1, 2, 3, 4].map((d) => (
                          <span
                            key={d}
                            className={clsx('h-1.5 w-1.5 rounded-full', d <= dots ? 'bg-accent' : 'bg-border-strong')}
                          />
                        ))}
                      </span>
                    )}
                    {typeof row.years === 'number' && row.years > 0 && (
                      <span className="text-xs font-normal text-subtle group-hover:text-accent/70">{row.years}y</span>
                    )}
                  </button>
                )
              })}
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

/** Takes the slug, not the SectionDef: the definition holds functions, which can't cross from a server page. */
export function SectionEditor({ slug }: { slug: string }) {
  const section = sectionBySlug(slug)!
  const [rows, setRows] = useState<Row[] | null>(null)
  const [editing, setEditing] = useState<Row | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirm, confirmDialog] = useConfirm()
  const Icon = SECTION_ICONS[section.slug]
  const isSkills = section.slug === 'skills'

  const load = useCallback(async () => {
    const { data, error } = await createClient()
      .from(section.table)
      .select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
    if (error) setError(error.message)
    else setRows(data as Row[])
  }, [section.table])

  useEffect(() => {
    void load()
  }, [load])

  async function remove(row: Row) {
    const ok = await confirm({
      title: `Delete ${section.singular}?`,
      description: (
        <>
          <span className="font-medium text-fg">{section.itemTitle(row)}</span> will be removed from your profile. This
          can&apos;t be undone.
        </>
      ),
      confirmLabel: 'Delete',
    })
    if (!ok) return
    const { error } = await createClient().from(section.table).delete().eq('id', row.id)
    if (error) toast.error(error.message)
    else {
      toast.success('Deleted')
      setEditing(null)
      void load()
    }
  }

  async function move(index: number, direction: -1 | 1) {
    if (!rows) return
    const other = index + direction
    if (other < 0 || other >= rows.length) return
    const reordered = [...rows]
    ;[reordered[index], reordered[other]] = [reordered[other], reordered[index]]
    setRows(reordered)
    const supabase = createClient()
    const results = await Promise.all(
      reordered.map((r, i) => supabase.from(section.table).update({ sort_order: i }).eq('id', r.id)),
    )
    const failed = results.find((r) => r.error)
    if (failed?.error) toast.error(failed.error.message)
  }

  const done = () => {
    setEditing(null)
    void load()
  }

  const addButton = (
    <Button onClick={() => setEditing('new')}>
      <Plus className="h-4 w-4" />
      Add {section.singular}
    </Button>
  )

  return (
    <div className="animate-fade-up">
      <PageHeader
        eyebrow="Profile"
        title={
          <span className="flex items-center gap-3">
            {section.title}
            {rows && rows.length > 0 && (
              <span className="rounded-full bg-surface-muted px-2 py-0.5 text-sm font-medium tabular-nums text-muted">
                {rows.length}
              </span>
            )}
          </span>
        }
        description={section.description}
        actions={
          isSkills ? (
            <Button variant="secondary" onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" />
              Add with details
            </Button>
          ) : rows && rows.length > 0 ? (
            addButton
          ) : undefined
        }
      />
      <ErrorText>{error}</ErrorText>

      {rows === null && !error && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="flex gap-4">
              <Skeleton className="h-9 w-9 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-1/4" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </Card>
          ))}
        </div>
      )}

      {rows && isSkills && (
        <SkillsBoard section={section} rows={rows} onEdit={setEditing} onAdded={load} />
      )}

      {rows?.length === 0 && !isSkills && (
        <EmptyState
          icon={Icon}
          title={`No ${section.title.toLowerCase()} yet`}
          description={section.description}
          action={addButton}
        />
      )}

      {rows && !isSkills && rows.length > 0 && (
        <div className="space-y-3">
          {rows.map((row, i) => (
            <ItemCard
              key={row.id}
              section={section}
              row={row}
              index={i}
              total={rows.length}
              onEdit={() => setEditing(row)}
              onDelete={() => void remove(row)}
              onMove={(d) => void move(i, d)}
            />
          ))}
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong py-4 text-sm font-medium text-muted transition hover:border-accent/50 hover:bg-accent-soft/50 hover:text-accent"
          >
            <Plus className="h-4 w-4" />
            Add {section.singular}
          </button>
        </div>
      )}

      {editing && (
        <ItemSheet
          key={editing === 'new' ? 'new' : editing.id}
          section={section}
          row={editing === 'new' ? undefined : editing}
          open
          onClose={() => setEditing(null)}
          onSaved={done}
          onDelete={(row) => void remove(row)}
          nextSortOrder={rows?.length ?? 0}
          confirm={confirm}
        />
      )}
      <OnSearchParam name="new" onMatch={() => setEditing('new')} />
      {confirmDialog}
    </div>
  )
}
