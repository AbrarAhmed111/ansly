'use client'

import { clsx } from 'clsx'
import { X } from 'lucide-react'
import { useState, type ClipboardEvent, type KeyboardEvent } from 'react'

const split = (text: string) =>
  text
    .split(/\n|,(?![^(]*\))/)
    .map((s) => s.trim())
    .filter(Boolean)

/** Chip input: Enter or comma adds a tag, Backspace on empty removes the last one. */
export function TagInput({
  id,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  id?: string
  value: string[]
  onChange: (value: string[]) => void
  placeholder?: string
  disabled?: boolean
}) {
  const [draft, setDraft] = useState('')

  const add = (items: string[]) => {
    const seen = new Set(value.map((v) => v.toLowerCase()))
    const next = [...value]
    for (const item of items) {
      if (!seen.has(item.toLowerCase())) {
        seen.add(item.toLowerCase())
        next.push(item)
      }
    }
    if (next.length !== value.length) onChange(next)
    setDraft('')
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if ((e.key === 'Enter' || e.key === ',') && draft.trim()) {
      e.preventDefault()
      add(split(draft))
    } else if (e.key === 'Enter') {
      e.preventDefault()
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1))
    }
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text')
    if (/[\n,]/.test(text)) {
      e.preventDefault()
      add(split(draft + text))
    }
  }

  return (
    <div
      className={clsx(
        'flex min-h-9 w-full cursor-text flex-wrap items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1.5 shadow-xs transition-[border-color,box-shadow]',
        'hover:border-border-strong focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/15',
        disabled && 'pointer-events-none opacity-60',
      )}
      onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.focus()}
    >
      {value.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-muted py-0.5 pl-2 pr-1 text-body-sm font-medium"
        >
          {tag}
          <button
            type="button"
            onClick={() => onChange(value.filter((t) => t !== tag))}
            className="rounded p-0.5 text-subtle hover:bg-border hover:text-fg"
            aria-label={`Remove ${tag}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={() => draft.trim() && add(split(draft))}
        placeholder={value.length ? '' : placeholder}
        className="h-6 min-w-[8rem] flex-1 bg-transparent px-1 text-fg placeholder:text-subtle focus:outline-none"
      />
    </div>
  )
}
