'use client'

import { clsx } from 'clsx'
import { CornerDownLeft, Search, type LucideIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Kbd, Overline } from '@/components/ui'

export interface Command {
  label: string
  href: string
  icon: LucideIcon
  group: string
  keywords?: string
}

/** Ctrl/Cmd+K launcher for pages and quick actions. */
export function CommandPalette({
  commands,
  open,
  onOpenChange,
}: {
  commands: Command[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const ref = useRef<HTMLDialogElement>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        onOpenChange(!open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      setQuery('')
      setActive(0)
      d.showModal()
    } else if (!open && d.open) d.close()
  }, [open])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter((c) => `${c.label} ${c.group} ${c.keywords ?? ''}`.toLowerCase().includes(q))
  }, [commands, query])

  useEffect(() => setActive(0), [query])

  function run(c: Command | undefined) {
    if (!c) return
    onOpenChange(false)
    router.push(c.href)
  }

  let lastGroup = ''
  return (
    <dialog
      ref={ref}
      aria-label="Command palette"
      onCancel={(e) => {
        e.preventDefault()
        onOpenChange(false)
      }}
      onClick={(e) => e.target === ref.current && onOpenChange(false)}
      className="mx-auto mt-[12vh] w-[calc(100%-2rem)] max-w-xl open:animate-dialog-in"
    >
      {open && (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-raised">
          <div className="flex items-center gap-3 border-b border-border px-4">
            <Search className="h-4 w-4 shrink-0 text-subtle" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setActive((a) => Math.min(a + 1, results.length - 1))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setActive((a) => Math.max(a - 1, 0))
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  run(results[active])
                }
              }}
              placeholder="Search pages and actions…"
              className="h-12 flex-1 bg-transparent text-body-lg placeholder:text-subtle focus:outline-none"
              role="combobox"
              aria-expanded
              aria-controls="command-list"
              aria-activedescendant={results[active] ? `cmd-${active}` : undefined}
            />
            <Kbd>Esc</Kbd>
          </div>
          <ul id="command-list" role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
            {results.length === 0 && <li className="px-3 py-8 text-center text-muted">No results for “{query}”.</li>}
            {results.map((c, i) => {
              const header = c.group !== lastGroup ? c.group : null
              lastGroup = c.group
              const Icon = c.icon
              return (
                <li key={`${c.group}-${c.href}`} role="presentation">
                  {header && <Overline className="px-3 pb-1 pt-3 first:pt-1">{header}</Overline>}
                  <button
                    id={`cmd-${i}`}
                    role="option"
                    aria-selected={i === active}
                    onMouseMove={() => setActive(i)}
                    onClick={() => run(c)}
                    className={clsx(
                      'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left',
                      i === active ? 'bg-accent-soft text-accent' : 'text-fg',
                    )}
                  >
                    <Icon className={clsx('h-4 w-4 shrink-0', i === active ? 'text-accent' : 'text-subtle')} />
                    <span className="flex-1">{c.label}</span>
                    {i === active && <CornerDownLeft className="h-3.5 w-3.5" />}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </dialog>
  )
}
