/**
 * Field classification: gives every candidate form field a typed kind
 * (packages/types/src/fields.ts). Nothing is silently dropped: fields Ansly
 * won't touch are kind 'ignored' with a reason, shown in detection debug mode.
 *
 * - profile: name, email, phone, links, city → filled from the profile, no LLM
 * - open_text / short_text / number → LLM (these also get the ✨ button)
 * - choice_single / choice_multi → the model (or a profile preference) picks an option
 * - ignored: hidden, disabled, search, password, file, captcha, consent, EEO / demographics
 */

import type { FieldKind, ProfileKey, SkipReason } from '@ansly/types'
import { detectLimits } from '../limits'
import { extractGroupQuestion, extractQuestion, optionLabel, type ExtractedQuestion } from './question'

/** The kind of DOM control (how to read and fill it). */
export type ControlType = 'textarea' | 'input' | 'contenteditable' | 'select' | 'radio-group' | 'checkbox-group' | 'checkbox' | 'combobox' | 'listbox'

export interface FieldClassification {
  kind: FieldKind
  control: ControlType | null
  question: ExtractedQuestion
  /** For choice fields. Undefined when the widget only renders options once opened. */
  options?: string[]
  profileKey?: ProfileKey
  skipReason?: SkipReason
  required: boolean
  maxLength: number | null
  /** A word limit stated near the field ("Max 250 words"). */
  maxWords?: number | null
  /** A minimum stated near the field ("Minimum 100 characters"). */
  minLength?: number | null
  /** Questions like "Why…", "Describe…", "Tell us…" that expect a paragraph. */
  longAnswer: boolean
  /** Gets the ✨ button and popover (free-text kinds in a text control). */
  eligible: boolean
}

/** Element type, for the popover's FieldContext.kind. */
export type FieldElementKind = 'textarea' | 'input' | 'contenteditable' | 'select'

const IGNORED_INPUT_TYPES: Record<string, SkipReason> = {
  password: 'password', file: 'file', hidden: 'hidden', search: 'search',
  submit: 'input-type', button: 'input-type', reset: 'input-type', image: 'input-type',
  date: 'input-type', 'datetime-local': 'input-type', month: 'input-type', week: 'input-type', time: 'input-type',
  range: 'input-type', color: 'input-type',
}

// HTML autocomplete tokens -> profile values (or ignored personal data we don't keep).
const AUTOCOMPLETE_PROFILE: [RegExp, ProfileKey][] = [
  [/\bgiven-name\b/, 'first_name'],
  [/\bfamily-name\b/, 'last_name'],
  [/\b(?<!-)name\b/, 'full_name'],
  [/\bemail\b/, 'email'],
  [/\btel(-national)?\b/, 'phone'],
  [/\baddress-level2\b/, 'city'],
  [/\borganization-title\b/, 'current_title'],
  [/\borganization\b/, 'current_company'],
  [/\burl\b/, 'website'],
]
const AUTOCOMPLETE_PERSONAL =
  /\b(additional-name|honorific-\w+|nickname|street-address|address-line\d|address-level[13]|postal-code|country(-name)?|bday(-\w+)?|sex|photo|username|new-password|current-password|one-time-code|cc-\w+)\b/

// Short labels of profile fields. Order matters: "LinkedIn URL" before "URL".
const LABEL_PROFILE: [RegExp, ProfileKey][] = [
  [/^(?:legal |preferred )?(?:first|given)(?: name)?$|^first name/, 'first_name'],
  [/^(?:last|family|sur)\s*name$|^last name|^surname/, 'last_name'],
  [/^(?:your )?(?:full |legal )?name$|^full name/, 'full_name'],
  [/\be-?mail\b/, 'email'],
  [/\b(?:phone|mobile|cell|telephone)\b/, 'phone'],
  [/\blinked\s?in\b/, 'linkedin'],
  [/\bgithub\b/, 'github'],
  [/\bportfolio\b/, 'portfolio'],
  [/^(?:personal |your )?(?:website|web site|blog|homepage)\b|^(?:other )?(?:website|url)$|^url$/, 'website'],
  [/^city\b|^city,? state|^town\b/, 'city'],
  [/^(?:current )?location$|^where are you (?:based|located)|^current city/, 'location'],
  [/^(?:current )?(?:job )?title$|^headline$/, 'current_title'],
  [/^current (?:company|employer)$|^(?:current )?employer$/, 'current_company'],
]
// Personal fields the profile doesn't hold: Ansly leaves them to the user.
const LABEL_PERSONAL =
  /^(?:your )?(?:(?:street |home |mailing )?address(?: line \d)?|state|province|region|county|zip(?: ?code)?|postal ?code|post ?code|country|date of birth|birth ?date|dob|age|middle name|password|confirm password|username|twitter(?: url)?|company|school|university|degree|gpa|start date|end date|graduation (?:date|year)|available start date)\s*[:?]?$/

/** Voluntary demographic questions: never auto-answered. */
const EEO = /\b(gender|sex\b|race\b|racial|ethnic|ethnicity|hispanic|latin[oax]|veteran|disabilit|sexual orientation|transgender|lgbt|pronouns?)\b/i
const CONSENT = /\b(i agree|agree to|terms( (of|and) (use|service|conditions))?|privacy (policy|notice|statement)|consent|acknowledge|i certify|certify that|i confirm|i understand|i accept|accept the)\b/i
const CAPTCHA = /captcha|recaptcha|hcaptcha|turnstile/i
const SEARCH_HINT = /\bsearch\b/i

// Questions with numeric answers.
const NUMBER_ANSWER = /^(how many years|years of|number of years|how (much|many)\b)/i
const LONG_ANSWER = /^(why|describe|tell (us|me)|explain|how|what (makes|excites|interests|motivates|attracts|would|do you|are)|share|give (us|me) an example|walk (us|me) through|in your own words|please (describe|explain|tell|share))\b/i
const COVER_LETTER = /\b(cover letter|additional information|anything else|message to (the )?(hiring|recruit))/i
const PLACEHOLDER_OPTION = /^(select|choose|please (select|choose)|--|—|-|\.\.\.)/i

export function fieldKind(el: Element): FieldElementKind | null {
  if (el instanceof HTMLTextAreaElement) return 'textarea'
  if (el instanceof HTMLSelectElement) return 'select'
  if (el instanceof HTMLInputElement) return 'input'
  if (el instanceof HTMLElement && el.isContentEditable) return 'contenteditable'
  const ce = el.getAttribute('contenteditable')
  if (ce !== null && ce !== 'false') return 'contenteditable'
  if (el.getAttribute('role') === 'textbox') return 'contenteditable'
  return null
}

export function isHidden(el: HTMLElement): boolean {
  if (el.hidden) return true
  const hiddenAncestor = el.closest('[hidden], [aria-hidden="true"], [inert]')
  // An open modal <dialog> is shown on top of everything, even when the page marks the app it sits in as
  // aria-hidden / inert while it is open (LinkedIn Easy Apply): only what's hidden inside the dialog counts.
  const dialog = el.closest('dialog[open]')
  if (hiddenAncestor && (!dialog || dialog.contains(hiddenAncestor))) return true
  const view = el.ownerDocument.defaultView
  if (!view) return false
  if (view.getComputedStyle(el).visibility === 'hidden') return true
  // display:none on any ancestor hides the field too.
  for (let node: Element | null = el; node && node !== el.ownerDocument.body; node = node.parentElement ?? (node.getRootNode() as ShadowRoot).host ?? null) {
    if (node instanceof HTMLElement && view.getComputedStyle(node).display === 'none') return true
  }
  return false
}

const isDisabled = (el: HTMLElement) =>
  (el as HTMLInputElement).disabled || (el as HTMLInputElement).readOnly || el.getAttribute('aria-disabled') === 'true' || el.getAttribute('aria-readonly') === 'true'

const isRequired = (el: HTMLElement) => (el as HTMLInputElement).required || el.getAttribute('aria-required') === 'true'

const attrs = (el: Element) => [el.getAttribute('name'), el.id, el.getAttribute('class'), el.getAttribute('data-automation-id')].join(' ')

function profileKeyFor(el: HTMLElement, label: string): ProfileKey | null {
  const autocomplete = (el.getAttribute('autocomplete') ?? '').toLowerCase()
  if (autocomplete && autocomplete !== 'on' && autocomplete !== 'off') {
    for (const [re, key] of AUTOCOMPLETE_PROFILE) if (re.test(autocomplete)) return key
  }
  // "Can we email you about future roles?" is a question about email, not the email field.
  if (label.trim().endsWith('?')) return null
  const text = label.toLowerCase().replace(/\s*[:*]\s*$/, '').trim()
  if (!text || text.length > 60 || LONG_ANSWER.test(text)) return null
  for (const [re, key] of LABEL_PROFILE) if (re.test(text)) return key
  return null
}

const TEXT_CONTROLS: (ControlType | null)[] = ['textarea', 'input', 'contenteditable']

function base(control: ControlType | null, question: ExtractedQuestion, el?: HTMLElement): Omit<FieldClassification, 'kind' | 'eligible'> {
  const maxLength = el && (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) && el.maxLength > 0 ? el.maxLength : null
  return { control, question, required: el ? isRequired(el) : false, maxLength, longAnswer: false }
}

/** Limits the page states in words ("Max 250 words", "0/500") count as much as maxlength. Text controls only. */
function addLimits(b: Omit<FieldClassification, 'kind' | 'eligible'>, el: HTMLElement): void {
  if (!TEXT_CONTROLS.includes(b.control)) return
  const limits = detectLimits(el, [b.question.hint, b.question.text])
  b.maxLength = limits.maxLength
  if (limits.maxWords) b.maxWords = limits.maxWords
  if (limits.minLength) b.minLength = limits.minLength
}

const ignored = (b: Omit<FieldClassification, 'kind' | 'eligible'>, skipReason: SkipReason): FieldClassification => ({
  ...b, kind: 'ignored', skipReason, eligible: false,
})

/** Classifies one control: a text field, select, combobox, single checkbox or listbox. */
export function classifyField(el: Element): FieldClassification {
  const empty: ExtractedQuestion = { text: '', source: 'none', hint: null }
  if (!(el instanceof HTMLElement)) return ignored(base(null, empty), 'not-a-field')

  const role = el.getAttribute('role')
  let control: ControlType | null = fieldKind(el)
  if (role === 'combobox') control = 'combobox'
  else if (role === 'listbox') control = 'listbox'
  else if (el instanceof HTMLInputElement && el.type === 'checkbox') control = 'checkbox'
  else if (el instanceof HTMLInputElement && el.type === 'radio') control = 'radio-group'
  if (!control) return ignored(base(null, empty, el), 'not-a-field')

  const b = base(control, empty, el)
  const type = el instanceof HTMLInputElement ? (el.getAttribute('type') ?? 'text').toLowerCase() : ''
  if (type === 'hidden') return ignored(b, 'hidden')
  // The question is extracted even for ignored fields, so debug mode can show what was skipped.
  const question = extractQuestion(el)
  b.question = question
  addLimits(b, el)
  if (type && IGNORED_INPUT_TYPES[type]) return ignored(b, IGNORED_INPUT_TYPES[type])
  if (isDisabled(el)) return ignored(b, 'disabled')
  if (isHidden(el)) return ignored(b, 'hidden')
  if (CAPTCHA.test(attrs(el))) return ignored(b, 'captcha')
  if (role === 'searchbox') return ignored(b, 'search')
  const text = question.text
  if (SEARCH_HINT.test(text) || SEARCH_HINT.test(el.getAttribute('name') ?? '') || SEARCH_HINT.test(el.id)) {
    // A combobox labelled "Search..." is usually a site search, not a question.
    if (control !== 'combobox' || !text || text.length < 40) return ignored(b, 'search')
  }
  if (text && EEO.test(text) && text.length < 200) return ignored(b, 'eeo')

  // Choices
  if (control === 'checkbox') {
    if (!text || CONSENT.test(text)) return ignored(b, text ? 'consent' : 'no-question')
    return { ...b, kind: 'choice_single', options: ['Yes', 'No'], eligible: false }
  }
  if (control === 'select' || control === 'combobox' || control === 'listbox') {
    if (!text) return ignored(b, 'no-question')
    const options = choiceOptions(el)
    const multiple = (el as HTMLSelectElement).multiple || el.getAttribute('aria-multiselectable') === 'true'
    const key = profileKeyFor(el, text)
    if (key && !options?.length) return { ...b, kind: 'profile', profileKey: key, eligible: false }
    return { ...b, kind: multiple ? 'choice_multi' : 'choice_single', options, eligible: false }
  }

  // Text controls
  const key = profileKeyFor(el, text)
  if (key) return { ...b, kind: 'profile', profileKey: key, eligible: false }
  if (type === 'email') return { ...b, kind: 'profile', profileKey: 'email', eligible: false }
  if (type === 'tel') return { ...b, kind: 'profile', profileKey: 'phone', eligible: false }
  if (type === 'url') return { ...b, kind: 'profile', profileKey: 'website', eligible: false }

  const autocomplete = (el.getAttribute('autocomplete') ?? '').toLowerCase()
  if (AUTOCOMPLETE_PERSONAL.test(autocomplete)) return ignored(b, 'personal')
  if (!text) return ignored(b, 'no-question')
  if (LABEL_PERSONAL.test(text.toLowerCase())) return ignored(b, 'personal')

  const longAnswer = LONG_ANSWER.test(text) || COVER_LETTER.test(text)
  if (type === 'number' || (control === 'input' && NUMBER_ANSWER.test(text))) {
    return { ...b, kind: 'number', longAnswer: false, eligible: control === 'input' }
  }
  if (control === 'input') return { ...b, kind: 'short_text', longAnswer, eligible: true }
  return { ...b, kind: 'open_text', longAnswer: true, eligible: true }
}

/** Options of a select, a combobox's / listbox's rendered options, or undefined if not rendered yet. */
export function choiceOptions(el: HTMLElement): string[] | undefined {
  if (el instanceof HTMLSelectElement) {
    return [...el.options]
      .filter((o) => !o.disabled && o.textContent?.trim() && !(o.value === '' && PLACEHOLDER_OPTION.test(o.textContent.trim())))
      .filter((o) => !(o.index === 0 && PLACEHOLDER_OPTION.test(o.textContent!.trim())))
      .map((o) => o.textContent!.replace(/\s+/g, ' ').trim())
  }
  const root = el.getRootNode() as Document | ShadowRoot
  const listId = el.getAttribute('aria-controls') ?? el.getAttribute('aria-owns')
  const list = el.getAttribute('role') === 'listbox' ? el : listId ? root.getElementById?.(listId) : null
  const options = list ? [...list.querySelectorAll('[role=option]')].map((o) => optionLabel(o as HTMLElement)).filter(Boolean) : []
  return options.length ? options : undefined
}

const DOCUMENT_FILE = /\.(pdf|docx?|rtf|txt|odt)\s*$/i

/** Classifies a group of radios / checkboxes (native or role=radio / role=checkbox) as one field. */
export function classifyGroup(anchor: HTMLElement, controls: HTMLElement[], multiple: boolean): FieldClassification {
  const question = extractGroupQuestion(anchor, controls)
  const b: Omit<FieldClassification, 'kind' | 'eligible'> = {
    ...base(multiple ? 'checkbox-group' : 'radio-group', question),
    required: controls.some(isRequired) || isRequired(anchor),
  }
  const visible = controls.filter((c) => !isHidden(c) || isLabelled(c))
  if (!visible.length) return ignored(b, 'hidden')
  if (controls.every(isDisabled)) return ignored(b, 'disabled')
  if (!question.text) return ignored(b, 'no-question')
  if (EEO.test(question.text) && question.text.length < 200) return ignored(b, 'eeo')
  const options = controls.map(optionLabel)
  if (multiple && options.every((o) => CONSENT.test(o))) return ignored(b, 'consent')
  // Picking one of the user's uploaded resume files (LinkedIn Easy Apply) is a file choice, not a question.
  if (options.length && options.every((o) => DOCUMENT_FILE.test(o))) return ignored(b, 'file')
  return { ...b, kind: multiple ? 'choice_multi' : 'choice_single', options, eligible: false }
}

/** Custom radios often hide the real input behind a styled label. */
function isLabelled(el: HTMLElement): boolean {
  const label = el.closest('label') ?? (el.id ? (el.getRootNode() as Document).querySelector?.(`label[for="${el.id}"]`) : null)
  return Boolean(label && label instanceof HTMLElement && !isHidden(label))
}
