import type { TrackedField } from './detection/scan'

/** Attributes that explain why a field was (not) detected. Never values. */
const ATTRIBUTES = ['type', 'name', 'id', 'role', 'autocomplete', 'aria-label', 'aria-labelledby', 'aria-describedby',
  'aria-required', 'placeholder', 'data-automation-id', 'data-testid', 'maxlength', 'contenteditable']

export interface FieldDiagnostic {
  question: string
  questionSource: string
  kind: string
  control: string | null
  skipReason?: string
  profileKey?: string
  options?: string[]
  required: boolean
  tag: string
  attributes: Record<string, string>
  controls: number
  inShadowRoot: boolean
}

export interface Diagnostics {
  hostname: string
  frame: 'top' | 'iframe'
  detected: number
  ignored: number
  fields: FieldDiagnostic[]
}

/**
 * A sanitized description of what detection saw on this frame: questions, kinds,
 * tags, roles and attributes. No field values, so it can be pasted into a test fixture.
 */
export function diagnostics(fields: TrackedField[], win: Window = window): Diagnostics {
  return {
    hostname: win.location.hostname,
    frame: win.top === win ? 'top' : 'iframe',
    detected: fields.filter((f) => f.kind !== 'ignored').length,
    ignored: fields.filter((f) => f.kind === 'ignored').length,
    fields: fields.map((f) => {
      const el = f.controls[0] ?? f.el
      const attributes: Record<string, string> = {}
      for (const name of ATTRIBUTES) {
        const value = el.getAttribute(name)
        if (value !== null) attributes[name] = value.slice(0, 200)
      }
      return {
        question: f.question.text,
        questionSource: f.question.source,
        kind: f.kind,
        control: f.control,
        ...(f.skipReason ? { skipReason: f.skipReason } : {}),
        ...(f.profileKey ? { profileKey: f.profileKey } : {}),
        ...(f.options ? { options: f.options } : {}),
        required: f.required,
        tag: el.tagName.toLowerCase(),
        attributes,
        controls: f.controls.length,
        inShadowRoot: el.getRootNode() instanceof ShadowRoot,
      }
    }),
  }
}
