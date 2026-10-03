'use client'

import type {
  ResumeAchievement,
  ResumeCertification,
  ResumeCustomSection,
  ResumeEducation,
  ResumeExperience,
  ResumeProject,
  ResumeSkillGroup,
  StructuredResume,
} from '@ansly/types'
import { Plus, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button, Card, CardHeader, Checkbox, Field, IconButton, Input, Textarea } from '@/components/ui'
import { bulletsToLines, linesToBullets } from '@/lib/resume'

type Patch<T> = (patch: Partial<T>) => void

const csv = (items: string[]) => items.join(', ')
const fromCsv = (text: string) =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
const orNull = (text: string) => (text.trim() ? text : null)

function nextId(prefix: string, ids: string[]) {
  let n = ids.length + 1
  while (ids.includes(`${prefix}_${n}`)) n++
  return `${prefix}_${n}`
}

/** Bullets as one line each. Keeps raw text while typing; converts to bullets (keeping ids) on every change. */
function BulletsField({
  id,
  label,
  value,
  onChange,
  prefix,
}: {
  id: string
  label: string
  value: ResumeExperience['bullets']
  onChange: (bullets: ResumeExperience['bullets']) => void
  prefix: string
}) {
  const [text, setText] = useState(bulletsToLines(value))
  return (
    <Field label={label} htmlFor={id} help="One bullet per line." className="sm:col-span-2">
      <Textarea
        id={id}
        rows={Math.min(10, Math.max(3, value.length + 1))}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          onChange(linesToBullets(e.target.value, value, prefix))
        }}
      />
    </Field>
  )
}

function ItemCard({ title, onRemove, children }: { title: string; onRemove: () => void; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="truncate font-medium">{title}</p>
        <IconButton icon={Trash2} label={`Remove ${title}`} tone="danger" onClick={onRemove} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </div>
  )
}

function Text({ id, label, value, onChange, wide }: { id: string; label: string; value: string | null; onChange: (v: string) => void; wide?: boolean }) {
  return (
    <Field label={label} htmlFor={id} className={wide ? 'sm:col-span-2' : undefined}>
      <Input id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    </Field>
  )
}

function ListSection<T extends { id: string }>({
  title,
  description,
  prefix,
  items,
  onChange,
  make,
  label,
  render,
}: {
  title: string
  /** Id prefix for new items, matching the parser's ids (exp_3, proj_2...). */
  prefix: string
  description: string
  items: T[]
  onChange: (items: T[]) => void
  make: (id: string) => T
  label: (item: T) => string
  render: (item: T, patch: Patch<T>) => ReactNode
}) {
  return (
    <Card>
      <CardHeader
        title={title}
        description={description}
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={Plus}
            onClick={() => onChange([...items, make(nextId(prefix, items.map((i) => i.id)))])}
          >
            Add
          </Button>
        }
      />
      <div className="mt-4 space-y-3">
        {items.length === 0 && <p className="text-muted">Nothing here.</p>}
        {items.map((item) => (
          <ItemCard key={item.id} title={label(item) || 'New item'} onRemove={() => onChange(items.filter((i) => i !== item))}>
            {render(item, (patch) => onChange(items.map((i) => (i === item ? { ...i, ...patch } : i))))}
          </ItemCard>
        ))}
      </div>
    </Card>
  )
}

/** Editor for a parsed (Structured) resume. Every field is what the resume says; nothing here is generated. */
export function ParsedEditor({ value, onChange }: { value: StructuredResume; onChange: (next: StructuredResume) => void }) {
  const set = (patch: Partial<StructuredResume>) => onChange({ ...value, ...patch })
  const c = value.contact
  const setContact = (patch: Partial<StructuredResume['contact']>) => set({ contact: { ...c, ...patch } })

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Contact" description="Tailoring never changes these." />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Text id="c-name" label="Name" value={c.name} onChange={(v) => setContact({ name: v })} />
          <Text id="c-headline" label="Headline" value={c.headline} onChange={(v) => setContact({ headline: orNull(v) })} />
          <Text id="c-email" label="Email" value={c.email} onChange={(v) => setContact({ email: orNull(v) })} />
          <Text id="c-phone" label="Phone" value={c.phone} onChange={(v) => setContact({ phone: orNull(v) })} />
          <Text id="c-location" label="Location" value={c.location} onChange={(v) => setContact({ location: orNull(v) })} />
          <Field label="Links" htmlFor="c-links" help="One URL per line." className="sm:col-span-2">
            <Textarea
              id="c-links"
              rows={2}
              value={c.links.map((l) => l.url).join('\n')}
              onChange={(e) =>
                setContact({
                  links: e.target.value
                    .split('\n')
                    .map((u) => u.trim())
                    .filter(Boolean)
                    .map((url) => ({ url, label: c.links.find((l) => l.url === url)?.label ?? (url.includes('linkedin') ? 'LinkedIn' : url.includes('github') ? 'GitHub' : 'Website') })),
                })
              }
            />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Summary" />
        <Textarea className="mt-4" rows={4} value={value.summary ?? ''} onChange={(e) => set({ summary: orNull(e.target.value) })} aria-label="Summary" />
      </Card>

      <ListSection<ResumeExperience>
        title="Experience"
        prefix="exp"
        description="Titles, companies and dates are protected: tailoring never changes them."
        items={value.experience}
        onChange={(experience) => set({ experience })}
        make={(id) => ({ id, company: '', title: '', location: null, startDate: null, endDate: null, isCurrent: false, bullets: [], technologies: [] })}
        label={(e) => [e.title, e.company].filter(Boolean).join(' at ')}
        render={(e, patch) => (
          <>
            <Text id={`${e.id}-title`} label="Title" value={e.title} onChange={(v) => patch({ title: v })} />
            <Text id={`${e.id}-company`} label="Company" value={e.company} onChange={(v) => patch({ company: v })} />
            <Text id={`${e.id}-start`} label="Start" value={e.startDate} onChange={(v) => patch({ startDate: orNull(v) })} />
            <Text id={`${e.id}-end`} label="End" value={e.endDate} onChange={(v) => patch({ endDate: orNull(v) })} />
            <Text id={`${e.id}-location`} label="Location" value={e.location} onChange={(v) => patch({ location: orNull(v) })} />
            <div className="flex items-end pb-2">
              <Checkbox id={`${e.id}-current`} label="Current job" checked={e.isCurrent} onChange={(v) => patch({ isCurrent: v })} />
            </div>
            <BulletsField id={`${e.id}-bullets`} label="Bullets" value={e.bullets} prefix={e.id} onChange={(bullets) => patch({ bullets })} />
            <Text id={`${e.id}-tech`} label="Technologies" value={csv(e.technologies)} onChange={(v) => patch({ technologies: fromCsv(v) })} wide />
          </>
        )}
      />

      <ListSection<ResumeProject>
        title="Projects"
        prefix="proj"
        description="Tailoring may reorder, select or reword these, never invent one."
        items={value.projects}
        onChange={(projects) => set({ projects })}
        make={(id) => ({ id, name: '', role: null, url: null, startDate: null, endDate: null, bullets: [], technologies: [] })}
        label={(p) => p.name}
        render={(p, patch) => (
          <>
            <Text id={`${p.id}-name`} label="Name" value={p.name} onChange={(v) => patch({ name: v })} />
            <Text id={`${p.id}-role`} label="Role" value={p.role} onChange={(v) => patch({ role: orNull(v) })} />
            <Text id={`${p.id}-url`} label="URL" value={p.url} onChange={(v) => patch({ url: orNull(v) })} wide />
            <BulletsField id={`${p.id}-bullets`} label="Bullets" value={p.bullets} prefix={p.id} onChange={(bullets) => patch({ bullets })} />
            <Text id={`${p.id}-tech`} label="Technologies" value={csv(p.technologies)} onChange={(v) => patch({ technologies: fromCsv(v) })} wide />
          </>
        )}
      />

      <ListSection<ResumeSkillGroup>
        title="Skills"
        prefix="skills"
        description="Groups as they appear on your resume."
        items={value.skills}
        onChange={(skills) => set({ skills })}
        make={(id) => ({ id, label: null, items: [] })}
        label={(g) => g.label ?? 'Skills'}
        render={(g, patch) => (
          <>
            <Text id={`${g.id}-label`} label="Group label" value={g.label} onChange={(v) => patch({ label: orNull(v) })} />
            <Text id={`${g.id}-items`} label="Skills (comma-separated)" value={csv(g.items)} onChange={(v) => patch({ items: fromCsv(v) })} wide />
          </>
        )}
      />

      <ListSection<ResumeEducation>
        title="Education"
        prefix="edu"
        description="Protected: tailoring never changes it."
        items={value.education}
        onChange={(education) => set({ education })}
        make={(id) => ({ id, institution: '', degree: null, fieldOfStudy: null, startDate: null, endDate: null, grade: null, bullets: [] })}
        label={(e) => e.institution}
        render={(e, patch) => (
          <>
            <Text id={`${e.id}-inst`} label="Institution" value={e.institution} onChange={(v) => patch({ institution: v })} wide />
            <Text id={`${e.id}-degree`} label="Degree" value={e.degree} onChange={(v) => patch({ degree: orNull(v) })} />
            <Text id={`${e.id}-field`} label="Field of study" value={e.fieldOfStudy} onChange={(v) => patch({ fieldOfStudy: orNull(v) })} />
            <Text id={`${e.id}-start`} label="Start" value={e.startDate} onChange={(v) => patch({ startDate: orNull(v) })} />
            <Text id={`${e.id}-end`} label="End" value={e.endDate} onChange={(v) => patch({ endDate: orNull(v) })} />
            <Text id={`${e.id}-grade`} label="Grade" value={e.grade} onChange={(v) => patch({ grade: orNull(v) })} />
          </>
        )}
      />

      <ListSection<ResumeCertification>
        title="Certifications"
        prefix="cert"
        description="Only certifications listed here can ever appear on a tailored resume."
        items={value.certifications}
        onChange={(certifications) => set({ certifications })}
        make={(id) => ({ id, name: '', issuer: null, date: null, url: null })}
        label={(c) => c.name}
        render={(c, patch) => (
          <>
            <Text id={`${c.id}-name`} label="Name" value={c.name} onChange={(v) => patch({ name: v })} wide />
            <Text id={`${c.id}-issuer`} label="Issuer" value={c.issuer} onChange={(v) => patch({ issuer: orNull(v) })} />
            <Text id={`${c.id}-date`} label="Date" value={c.date} onChange={(v) => patch({ date: orNull(v) })} />
          </>
        )}
      />

      <ListSection<ResumeAchievement>
        title="Achievements"
        prefix="ach"
        description="Awards, honors and accomplishments."
        items={value.achievements}
        onChange={(achievements) => set({ achievements })}
        make={(id) => ({ id, title: '', description: null, date: null, url: null })}
        label={(a) => a.title}
        render={(a, patch) => (
          <>
            <Text id={`${a.id}-title`} label="Title" value={a.title} onChange={(v) => patch({ title: v })} />
            <Text id={`${a.id}-date`} label="Date" value={a.date} onChange={(v) => patch({ date: orNull(v) })} />
            <Text id={`${a.id}-desc`} label="Description" value={a.description} onChange={(v) => patch({ description: orNull(v) })} wide />
          </>
        )}
      />

      <ListSection<ResumeCustomSection>
        title="Other sections"
        prefix="custom"
        description="Languages, volunteering, publications… kept exactly as written."
        items={value.customSections}
        onChange={(customSections) => set({ customSections })}
        make={(id) => ({ id, heading: '', bullets: [] })}
        label={(s) => s.heading}
        render={(s, patch) => (
          <>
            <Text id={`${s.id}-heading`} label="Heading" value={s.heading} onChange={(v) => patch({ heading: v })} wide />
            <BulletsField id={`${s.id}-bullets`} label="Lines" value={s.bullets} prefix={s.id} onChange={(bullets) => patch({ bullets })} />
          </>
        )}
      />
    </div>
  )
}

/** Problems that would make the save fail server-side (required fields). */
export function editorErrors(resume: StructuredResume): string[] {
  const errors: string[] = []
  if (!resume.contact.name.trim()) errors.push('Your name is required.')
  resume.experience.forEach((e, i) => {
    if (!e.company.trim() || !e.title.trim()) errors.push(`Experience ${i + 1} needs a title and a company.`)
  })
  resume.projects.forEach((p, i) => !p.name.trim() && errors.push(`Project ${i + 1} needs a name.`))
  resume.education.forEach((e, i) => !e.institution.trim() && errors.push(`Education ${i + 1} needs an institution.`))
  resume.certifications.forEach((c, i) => !c.name.trim() && errors.push(`Certification ${i + 1} needs a name.`))
  resume.achievements.forEach((a, i) => !a.title.trim() && errors.push(`Achievement ${i + 1} needs a title.`))
  resume.customSections.forEach((s, i) => !s.heading.trim() && errors.push(`Section ${i + 1} needs a heading.`))
  return errors
}

/** Drops empty skill groups before saving. */
export function cleanResume(resume: StructuredResume): StructuredResume {
  return { ...resume, skills: resume.skills.filter((g) => g.items.length > 0) }
}
