'use client'

import type { EmploymentType, SearchFilters, Workplace } from '@ansly/types'
import { TagInput } from '@/components/tag-input'
import { Badge, Chip, Field, Input } from '@/components/ui'
import { EMPLOYMENT_LABELS, WORKPLACE_LABELS } from '@/lib/jobs'

function toggle<T>(list: T[] | undefined, value: T): T[] {
  const current = list ?? []
  return current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
}

/** Edits the filters parsed from a natural-language search. */
export function SearchFiltersEditor({ value, onChange }: { value: SearchFilters; onChange: (value: SearchFilters) => void }) {
  const set = <K extends keyof SearchFilters>(key: K, v: SearchFilters[K]) => onChange({ ...value, [key]: v })
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Field label="Roles" htmlFor="f-roles" help="A job matches if its title contains one of these." className="sm:col-span-2">
        <TagInput id="f-roles" value={value.roles ?? []} onChange={(v) => set('roles', v)} placeholder="Full Stack Engineer…" />
      </Field>
      <Field label="Skills" htmlFor="f-skills" help="Jobs need at least one; with three or more, at least half." className="sm:col-span-2">
        <TagInput id="f-skills" value={value.skills ?? []} onChange={(v) => set('skills', v)} placeholder="Next.js, TypeScript…" />
      </Field>
      <Field label="Workplace" className="sm:col-span-2">
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(WORKPLACE_LABELS) as Workplace[]).map((w) => (
            <Chip key={w} selected={value.workplace?.includes(w)} onClick={() => set('workplace', toggle(value.workplace, w))}>
              {WORKPLACE_LABELS[w]}
            </Chip>
          ))}
        </div>
      </Field>
      <Field label="Locations" htmlFor="f-locations" help="Ignored for remote jobs." className="sm:col-span-2">
        <TagInput id="f-locations" value={value.locations ?? []} onChange={(v) => set('locations', v)} placeholder="Berlin, Europe…" />
      </Field>
      <Field label="Your years of experience" htmlFor="f-years" help="Hides jobs asking for much more.">
        <Input
          id="f-years"
          type="number"
          min={0}
          value={value.experience_years ?? ''}
          onChange={(e) => set('experience_years', e.target.value === '' ? null : Number(e.target.value))}
        />
      </Field>
      <Field label="Minimum yearly salary" htmlFor="f-salary" help="Jobs without a salary still show.">
        <Input
          id="f-salary"
          type="number"
          min={0}
          step={1000}
          value={value.min_salary ?? ''}
          onChange={(e) => set('min_salary', e.target.value === '' ? null : Number(e.target.value))}
        />
      </Field>
      <Field label="Employment type" className="sm:col-span-2">
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(EMPLOYMENT_LABELS) as EmploymentType[]).map((t) => (
            <Chip
              key={t}
              selected={value.employment_types?.includes(t)}
              onClick={() => set('employment_types', toggle(value.employment_types, t))}
            >
              {EMPLOYMENT_LABELS[t]}
            </Chip>
          ))}
        </div>
      </Field>
    </div>
  )
}

/** One-line view of a search's filters, as badges. */
export function SearchFiltersSummary({ filters }: { filters: SearchFilters }) {
  const items = [
    ...(filters.workplace ?? []).map((w) => WORKPLACE_LABELS[w]),
    ...(filters.roles ?? []),
    ...(filters.skills ?? []),
    ...(filters.locations ?? []),
    ...(filters.employment_types ?? []).map((t) => EMPLOYMENT_LABELS[t]),
    filters.experience_years != null ? `${filters.experience_years}+ years` : null,
    filters.min_salary ? `≥ ${Math.round(filters.min_salary / 1000)}k` : null,
  ].filter((v): v is string => Boolean(v))
  if (!items.length) return <p className="text-caption text-subtle">No filters: every new job matches.</p>
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <Badge key={item}>{item}</Badge>
      ))}
    </div>
  )
}
