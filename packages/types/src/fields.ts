/**
 * Typed form fields, as detected by the extension and sent to the API.
 * Every candidate field gets a kind; nothing is silently dropped.
 */

export type FieldKind =
  /** Essay / free-form textarea → LLM. */
  | 'open_text'
  /** Short factual question → LLM, concise. */
  | 'short_text'
  /** Name, email, phone, links, city → straight from the profile, no LLM. */
  | 'profile'
  /** Select, radio group, combobox → choose one option. */
  | 'choice_single'
  /** Checkbox group, multi-select. */
  | 'choice_multi'
  /** Years of experience, salary. */
  | 'number'
  /** Search, password, file upload, captcha, EEO, consent, hidden. */
  | 'ignored'

/** Profile values the extension fills directly. */
export type ProfileKey =
  | 'full_name'
  | 'first_name'
  | 'last_name'
  | 'email'
  | 'phone'
  | 'location'
  | 'city'
  | 'headline'
  | 'linkedin'
  | 'github'
  | 'website'
  | 'portfolio'
  | 'current_company'
  | 'current_title'

export type SkipReason =
  | 'hidden'
  | 'disabled'
  | 'input-type'
  | 'search'
  | 'password'
  | 'file'
  | 'captcha'
  | 'eeo'
  | 'consent'
  | 'personal'
  | 'no-question'
  | 'not-a-field'

export interface DetectedField {
  /** Stable for the page session. */
  id: string
  kind: FieldKind
  question: string
  /** For choice fields. */
  options?: string[]
  maxLength?: number | null
  required: boolean
  frameId?: number
  /** For kind 'profile'. */
  profileKey?: ProfileKey
  /** For kind 'ignored'; shown in debug mode. */
  skipReason?: SkipReason
}

/** Values for `profile` fields, resolved by the extension background from the user's profile. */
export type ProfileValues = Partial<Record<ProfileKey, string>>
