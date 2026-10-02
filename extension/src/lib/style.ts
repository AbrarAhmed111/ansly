import type { AnswerLength, AnswerStyle, AnswerTone } from '@ansly/types'

export const LENGTHS: { value: Exclude<AnswerLength, 'auto'>; label: string }[] = [
  { value: 'concise', label: 'Concise' },
  { value: 'standard', label: 'Standard' },
  { value: 'detailed', label: 'Detailed' },
]

export const TONES: { value: AnswerTone; label: string }[] = [
  { value: 'professional', label: 'Professional' },
  { value: 'friendly', label: 'Friendly' },
  { value: 'enthusiastic', label: 'Enthusiastic' },
  { value: 'confident', label: 'Confident' },
  { value: 'formal', label: 'Formal' },
  { value: 'technical', label: 'Technical' },
]

/** Length used for "auto", per question category. Mirrors CATEGORY_DEFAULT_LENGTH in llm/src/app/answers/prompt.py. */
const CATEGORY_DEFAULT: Record<string, { length: Exclude<AnswerLength, 'auto'>; label: string }> = {
  cover_letter: { length: 'detailed', label: 'cover letters' },
  skill_check: { length: 'concise', label: 'yes/no questions' },
  logistics: { length: 'concise', label: 'logistics questions' },
}

const COVER_LETTER = /\b(cover(ing)? letter|motivation(al)? letter|letter of motivation)\b/i

/** Category guess before the API has answered (the API's `category` wins once it has). */
export function localCategory(question: string): string | null {
  return COVER_LETTER.test(question) ? 'cover_letter' : null
}

export function resolveLength(length: AnswerLength, category: string | null): Exclude<AnswerLength, 'auto'> {
  if (length !== 'auto') return length
  return (category && CATEGORY_DEFAULT[category]?.length) || 'standard'
}

/** "Detailed · auto for cover letters", "Standard · auto". */
export function autoLabel(category: string | null): string {
  const length = LENGTHS.find((l) => l.value === resolveLength('auto', category))!.label
  const what = category ? CATEGORY_DEFAULT[category]?.label : undefined
  return what ? `${length} · auto for ${what}` : `${length} · auto`
}

export const sameStyle = (a: AnswerStyle, b: AnswerStyle) =>
  a.length === b.length && a.tone === b.tone && (a.instruction ?? '').trim() === (b.instruction ?? '').trim()
