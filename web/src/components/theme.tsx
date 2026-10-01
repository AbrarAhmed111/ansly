'use client'

import { clsx } from 'clsx'
import { Monitor, Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'

export type Theme = 'system' | 'light' | 'dark'

const KEY = 'ansly-theme'

/** Runs before paint (in <head>) so a saved theme never flashes. */
export const themeScript = `try{var t=localStorage.getItem('${KEY}');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`

function readTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY)
    return t === 'light' || t === 'dark' ? t : 'system'
  } catch {
    return 'system'
  }
}

function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'system') delete root.dataset.theme
  else root.dataset.theme = theme
  try {
    if (theme === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, theme)
  } catch {
    // Storage unavailable — the choice lasts for this page only.
  }
}

const OPTIONS = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
] as const

export function ThemeToggle({ compact, className }: { compact?: boolean; className?: string }) {
  const [theme, setTheme] = useState<Theme | null>(null)
  useEffect(() => setTheme(readTheme()), [])

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={clsx('inline-flex rounded-lg border border-border bg-surface-muted p-0.5', className)}
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          title={label}
          onClick={() => {
            setTheme(value)
            applyTheme(value)
          }}
          className={clsx(
            'inline-flex items-center justify-center gap-1.5 rounded-md text-[13px] font-medium transition',
            compact ? 'h-7 flex-1 px-2' : 'h-8 px-3',
            theme === value ? 'bg-surface text-fg shadow-xs ring-1 ring-border' : 'text-muted hover:text-fg',
          )}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden />
          {compact ? <span className="sr-only">{label}</span> : label}
        </button>
      ))}
    </div>
  )
}
