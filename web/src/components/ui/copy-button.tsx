'use client'

import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import toast from 'react-hot-toast'
import { buttonStyles } from './button'

/** Copies `text` and briefly shows a check. With `label`, renders a text button; otherwise icon-only. */
export function CopyButton({ text, label, className }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Could not copy to clipboard')
    }
  }

  const icon = copied ? <Check className="h-4 w-4 text-success" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />
  if (!label) {
    return (
      <button
        type="button"
        onClick={copy}
        aria-label="Copy"
        title="Copy"
        className={buttonStyles({ variant: 'ghost', size: 'icon-sm', className })}
      >
        {icon}
      </button>
    )
  }
  return (
    <button type="button" onClick={copy} className={buttonStyles({ variant: 'secondary', className })}>
      {icon}
      {copied ? 'Copied' : label}
    </button>
  )
}
