'use client'

import { Monitor, Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { SegmentedControl } from '@/components/ui'

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
    // Storage unavailable: the choice lasts for this page only.
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
    <SegmentedControl
      label="Theme"
      options={OPTIONS}
      value={theme}
      size={compact ? 'sm' : 'md'}
      iconOnly={compact}
      className={className}
      onChange={(value) => {
        setTheme(value)
        applyTheme(value)
      }}
    />
  )
}
