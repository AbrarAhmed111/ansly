/**
 * Field classification: decides whether a form field should get the ✨ button.
 * Basic personal fields (name, email, phone, address, password, dates, numbers,
 * links) never do; open-ended questions do.
 */

import { extractQuestion, type ExtractedQuestion } from './question'

export type FieldKind = 'textarea' | 'input' | 'contenteditable' | 'select'

export type SkipReason =
  | 'not-a-text-field'
  | 'hidden'
  | 'disabled'
  | 'input-type'
  | 'autocomplete'
  | 'personal'
  | 'search'
  | 'no-question'
  | 'short-input'
  | 'choice'

export interface FieldClassification {
  eligible: boolean
  kind: FieldKind | null
  question: ExtractedQuestion
  /** Questions like "Why…", "Describe…", "Tell us…" that expect a paragraph. */
  longAnswer: boolean
  reason?: SkipReason
}

const SKIP_INPUT_TYPES = new Set([
  'email', 'tel', 'password', 'date', 'datetime-local', 'month', 'week', 'time', 'number', 'range', 'color',
  'url', 'hidden', 'checkbox', 'radio', 'file', 'submit', 'button', 'reset', 'image', 'search',
])

// HTML autocomplete tokens for personal data.
const PERSONAL_AUTOCOMPLETE =
  /\b(name|given-name|additional-name|family-name|honorific-\w+|nickname|email|tel(-\w+)?|street-address|address-line\d|address-level\d|postal-code|country(-name)?|bday(-\w+)?|sex|url|photo|username|new-password|current-password|one-time-code|cc-\w+|organization-title|organization)\b/

// Labels of basic personal fields. Matched against the whole (short) label so that
// "Why do you want to work at this address?" style questions are not caught.
const PERSONAL_LABEL = new RegExp(
  '^(?:your )?(?:' +
    [
      '(?:first|last|middle|full|given|family|preferred|legal|sur)\\s*name', 'name', 'surname', 'pronouns?',
      'e-?mail(?: address)?', '(?:phone|mobile|cell|telephone)(?: number)?', 'phone',
      '(?:street |home |mailing )?address(?: line \\d)?', 'city', 'state', 'province', 'region', 'county',
      'zip(?: ?code)?', 'postal ?code', 'post ?code', 'country', 'location', 'current location',
      'linkedin(?: profile)?(?: url)?', 'github(?: profile)?(?: url)?', '(?:personal )?website(?: url)?',
      'portfolio(?: url| link)?', 'twitter(?: url)?', 'url', 'other website', 'blog',
      'date of birth', 'birth ?date', 'dob', 'age', 'gender', 'race', 'ethnicity', 'veteran status',
      'disability status', 'password', 'confirm password', 'username',
      'current (?:company|employer)', 'current (?:job )?title', 'company', 'school', 'university', 'degree',
      'gpa', 'start date', 'end date', 'graduation (?:date|year)', 'available start date',
      'salary', 'expected salary', 'current salary', 'desired salary', 'years of experience',
    ].join('|') +
    ')\\s*[:?]?$',
  'i',
)

// Personal keywords in a short label ("Mobile phone number", "City, State", "LinkedIn Profile URL").
const PERSONAL_KEYWORD =
  /\b(?:(?:first|last|middle|full|given|family|legal|preferred) name|e-?mail|phone|mobile|telephone|address|zip|postal|post ?code|city|country|linkedin|github|twitter|website|portfolio|url|date of birth|birthday|pronouns?|nationality|gender|ethnicity|veteran|disability)\b/i
// Questions with one-word or numeric answers that a paragraph would break.
const SHORT_ANSWER = /^(how many years|years of|how did you (hear|find|learn) about|how (much|many)|what is your (current |desired |expected )?(salary|compensation|notice period|gpa)\b|when can you start)/i

const SEARCH_HINT = /\bsearch\b/i
const LONG_ANSWER = /^(why|describe|tell (us|me)|explain|how|what (makes|excites|interests|motivates|attracts|would|do you|are)|share|give (us|me) an example|walk (us|me) through|in your own words|please (describe|explain|tell|share))\b/i
const QUESTION_LIKE = /\?\s*$|^(why|what|how|describe|tell|explain|share|do you|have you|are you|would you|can you|please|in a few|briefly|give)\b/i
const COVER_LETTER = /\b(cover letter|additional information|anything else|message to (the )?(hiring|recruit))/i

export function fieldKind(el: Element): FieldKind | null {
  if (el instanceof HTMLTextAreaElement) return 'textarea'
  if (el instanceof HTMLSelectElement) return 'select'
  if (el instanceof HTMLInputElement) return 'input'
  if (el instanceof HTMLElement && el.isContentEditable) return 'contenteditable'
  const ce = el.getAttribute('contenteditable')
  if (ce !== null && ce !== 'false') return 'contenteditable'
  return null
}

function isHidden(el: HTMLElement): boolean {
  if (el.hidden || el.closest('[hidden], [aria-hidden="true"], [inert]')) return true
  const view = el.ownerDocument.defaultView
  if (!view) return false
  if (view.getComputedStyle(el).visibility === 'hidden') return true
  // display:none on any ancestor hides the field too.
  for (let node: HTMLElement | null = el; node && node !== el.ownerDocument.body; node = node.parentElement) {
    if (view.getComputedStyle(node).display === 'none') return true
  }
  return false
}

export function classifyField(el: Element): FieldClassification {
  const kind = fieldKind(el)
  const empty = { text: '', source: 'none' as const, hint: null }
  if (!kind || !(el instanceof HTMLElement)) {
    return { eligible: false, kind: null, question: empty, longAnswer: false, reason: 'not-a-text-field' }
  }
  const skip = (reason: SkipReason, question: ExtractedQuestion = empty): FieldClassification => ({
    eligible: false, kind, question, longAnswer: false, reason,
  })

  if (kind === 'select') return skip('choice')
  if (el instanceof HTMLInputElement) {
    const type = (el.getAttribute('type') ?? 'text').toLowerCase()
    if (SKIP_INPUT_TYPES.has(type) || !['text', ''].includes(type)) return skip('input-type')
  }
  if ((el as HTMLInputElement).disabled || (el as HTMLInputElement).readOnly || el.getAttribute('aria-disabled') === 'true') {
    return skip('disabled')
  }
  if (isHidden(el)) return skip('hidden')

  const autocomplete = (el.getAttribute('autocomplete') ?? '').toLowerCase()
  if (autocomplete && autocomplete !== 'off' && autocomplete !== 'on' && PERSONAL_AUTOCOMPLETE.test(autocomplete)) {
    return skip('autocomplete')
  }
  if (el.getAttribute('role') === 'searchbox' || el.getAttribute('role') === 'combobox') return skip('search')

  const question = extractQuestion(el)
  const text = question.text
  if (SEARCH_HINT.test(text) || SEARCH_HINT.test(el.getAttribute('name') ?? '') || SEARCH_HINT.test(el.id)) {
    return skip('search', question)
  }
  if (!text) return skip('no-question', question)
  if (PERSONAL_LABEL.test(text)) return skip('personal', question)

  const longAnswer = LONG_ANSWER.test(text) || COVER_LETTER.test(text)
  if (!longAnswer && text.length <= 40 && !text.endsWith('?') && PERSONAL_KEYWORD.test(text)) {
    return skip('personal', question)
  }
  if (kind === 'input') {
    // Single-line inputs only get ✨ when they clearly ask an open question.
    if (SHORT_ANSWER.test(text)) return skip('short-input', question)
    if (!longAnswer && !QUESTION_LIKE.test(text) && text.length < 40) return skip('short-input', question)
  }
  return { eligible: true, kind, question, longAnswer: longAnswer || kind !== 'input' }
}
