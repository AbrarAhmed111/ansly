import type { ResumeBullet, ResumeParseStatus, TailoringStatus } from '@ansly/types'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Tone } from '@/components/ui'

export const MAX_RESUME_BYTES = 10 * 1024 * 1024

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
/** For the file picker. */
export const DOCX_ACCEPT = `.docx,${DOCX_MIME}`

/**
 * Tailoring edits a copy of the user's own Word document, so only .docx is accepted.
 * Returns null for a valid Word file, else a user-facing reason.
 */
export function resumeFileProblem(file: { name: string; type: string; size: number }): string | null {
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    return 'PDF resumes aren’t supported. Open your resume in Word or Google Docs, save it as a Word (.docx) file, and upload that.'
  }
  if (name.endsWith('.doc')) {
    return 'That’s an older Word (.doc) file. Open it in Word and use File → Save As → Word Document (.docx), then upload it.'
  }
  if (!name.endsWith('.docx')) return 'Upload your resume as a Word (.docx) file.'
  if (file.size > MAX_RESUME_BYTES) return 'That file is over 10 MB. Upload a smaller Word (.docx) file.'
  return null
}

/** `{user_id}/masters/{timestamp}-{safe name}`: storage policies only allow the user's own prefix. */
export function masterPath(userId: string, fileName: string, now = Date.now()): string {
  const safe =
    fileName
      .replace(/[^\w.-]+/g, '_')
      .replace(/\.{2,}/g, '.')
      .replace(/_+/g, '_')
      .slice(-80) || 'resume'
  return `${userId}/masters/${now}-${safe}`
}

/** Uploads the original file to the private `resumes` bucket and returns its path. */
export async function uploadResumeFile(supabase: SupabaseClient, userId: string, file: File) {
  const path = masterPath(userId, file.name)
  const { error } = await supabase.storage.from('resumes').upload(path, file, { contentType: DOCX_MIME, upsert: false })
  if (error) throw new Error(error.message)
  return path
}

export const PARSE_STATUS: Record<ResumeParseStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Reading…', tone: 'neutral' },
  parsed: { label: 'Ready', tone: 'success' },
  needs_review: { label: 'Needs review', tone: 'warning' },
  failed: { label: 'Couldn’t read', tone: 'danger' },
}

/** Progress steps shown while a tailoring runs, in order. */
export const TAILORING_STEPS: { status: TailoringStatus; label: string }[] = [
  { status: 'analyzing', label: 'Analyzing the job' },
  { status: 'matching', label: 'Matching requirements with your experience' },
  { status: 'tailoring', label: 'Tailoring your resume' },
  { status: 'validating', label: 'Checking every change against your evidence' },
  { status: 'rendering', label: 'Applying changes to your Word document' },
]

export function stepState(current: TailoringStatus, step: TailoringStatus): 'done' | 'active' | 'idle' {
  if (current === 'ready') return 'done'
  const order: TailoringStatus[] = ['queued', ...TAILORING_STEPS.map((s) => s.status)]
  const a = order.indexOf(current)
  const b = order.indexOf(step)
  if (a > b) return 'done'
  return a === b || (current === 'queued' && step === 'analyzing') ? 'active' : 'idle'
}

export const isRunning = (status: TailoringStatus) => status !== 'ready' && status !== 'failed'

/** "Sam Rivera Resume.docx" -> "Sam Rivera Resume". */
export const fileStem = (name: string) => name.replace(/\.(docx|pdf)$/i, '')

/** Bullets edited as one line each; existing ids are kept by position so plans and diffs still line up. */
export function linesToBullets(text: string, previous: ResumeBullet[], prefix: string): ResumeBullet[] {
  const used = new Set(previous.map((b) => b.id))
  let n = previous.length
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*[•\-*–]\s*/, '').trim())
    .filter(Boolean)
    .map((line, i) => {
      const existing = previous[i]
      if (existing) return { id: existing.id, text: line }
      let id = `${prefix}_b${++n}`
      while (used.has(id)) id = `${prefix}_b${++n}`
      used.add(id)
      return { id, text: line }
    })
}

export const bulletsToLines = (bullets: ResumeBullet[]) => bullets.map((b) => b.text).join('\n')

export type DiffPart = { text: string; kind: 'same' | 'added' | 'removed' }

/** Word-level diff (longest common subsequence) for the review screen. */
export function wordDiff(before: string, after: string): DiffPart[] {
  const a = before.split(/(\s+)/).filter(Boolean)
  const b = after.split(/(\s+)/).filter(Boolean)
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }
  const parts: DiffPart[] = []
  const push = (text: string, kind: DiffPart['kind']) => {
    const last = parts[parts.length - 1]
    if (last && last.kind === kind) last.text += text
    else parts.push({ text, kind })
  }
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push(a[i]!, 'same')
      i++
      j++
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      push(a[i++]!, 'removed')
    } else {
      push(b[j++]!, 'added')
    }
  }
  while (i < a.length) push(a[i++]!, 'removed')
  while (j < b.length) push(b[j++]!, 'added')
  return parts
}

/** "Nizam LLC" and "Nizam, LLC." are the same company. Mirrors `_company_key` in the API's discrepancies.py. */
export function companyKey(company: string | null | undefined): string {
  return (company ?? '')
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|co|gmbh|plc|pvt|private)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, '')
}

export function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
