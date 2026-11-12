import type { TargetingProfile } from '@ansly/types'

export const MAX_LEAD_PROFILE_IMPORT_BYTES = 1_000_000
export const MAX_IMPORTED_TARGETING_PROFILES = 25

export const LEAD_PROFILE_IMPORT_FIELDS = [
  { name: 'name', type: 'required string (max 120 characters)' },
  { name: 'description', type: 'optional string (max 2,000 characters)' },
  { name: 'target_roles', type: 'optional array of strings' },
  { name: 'keywords', type: 'optional array of strings' },
  { name: 'excluded_keywords', type: 'optional array of strings' },
  { name: 'industries', type: 'optional array of strings' },
  { name: 'locations', type: 'optional array of strings' },
  { name: 'remote_preferences', type: '"any", "remote", "hybrid", or "onsite"' },
  { name: 'employment_types', type: 'optional array of strings' },
  { name: 'opportunity_types', type: 'optional array of strings' },
  { name: 'minimum_requirements', type: 'optional string' },
  { name: 'contactability_preferences', type: 'optional string' },
  { name: 'qualification_preferences', type: 'optional JSON object' },
] as const

export type TargetingProfileImport = Pick<TargetingProfile, 'name'> &
  Partial<Omit<TargetingProfile, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'name'>>

export interface LeadProfileImportPlan {
  profiles: TargetingProfileImport[]
  warnings: string[]
}

export const LEAD_PROFILE_IMPORT_EXAMPLE = {
  name: 'Senior product engineering',
  description: 'Remote product engineering opportunities at early-stage companies.',
  target_roles: ['Product Engineer', 'Full-stack Engineer'],
  keywords: ['TypeScript', 'React', 'product'],
  excluded_keywords: ['unpaid', 'recruiting agency'],
  industries: ['Software', 'AI'],
  locations: ['United States'],
  remote_preferences: 'remote',
  employment_types: ['full-time', 'contract'],
  opportunity_types: ['job', 'contract'],
  minimum_requirements: 'Must include compensation and a clear hiring contact.',
  contactability_preferences: 'Prefer a public email or application page.',
  qualification_preferences: {
    minimum_confidence: 0.7,
    require_compensation: true,
  },
}

const PROFILE_FIELDS: readonly string[] = LEAD_PROFILE_IMPORT_FIELDS.map(({ name }) => name)
const ARRAY_FIELDS = [
  'target_roles',
  'keywords',
  'excluded_keywords',
  'industries',
  'locations',
  'employment_types',
  'opportunity_types',
] as const
const STRING_LIMITS: Record<string, number> = {
  name: 120,
  description: 2000,
  minimum_requirements: 5000,
  contactability_preferences: 2000,
}
const REMOTE_PREFERENCES = ['any', 'remote', 'hybrid', 'onsite']
const SYSTEM_FIELDS = ['id', 'user_id', 'is_active', 'created_at', 'updated_at']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getProfiles(root: unknown): unknown[] {
  if (Array.isArray(root)) return root
  if (!isRecord(root)) {
    throw new Error('JSON must be a targeting profile object, an array of profiles, or an object with a "profiles" array.')
  }
  if ('profiles' in root) {
    if (!Array.isArray(root.profiles)) throw new Error('"profiles" must be an array.')
    return root.profiles
  }
  return [root]
}

function validateProfile(value: unknown, index: number, warnings: string[]): TargetingProfileImport {
  const label = `Profile ${index + 1}`
  if (!isRecord(value)) throw new Error(`${label} must be a JSON object.`)

  const systemFields = Object.keys(value).filter((key) => SYSTEM_FIELDS.includes(key))
  if (systemFields.length) warnings.push(`${label}: system-managed fields were ignored: ${systemFields.join(', ')}.`)
  const unknownFields = Object.keys(value).filter(
    (key) => !PROFILE_FIELDS.includes(key) && !SYSTEM_FIELDS.includes(key) && !key.startsWith('_'),
  )
  if (unknownFields.length) warnings.push(`${label}: unsupported fields were ignored: ${unknownFields.join(', ')}.`)

  const name = value.name
  if (typeof name !== 'string' || !name.trim()) throw new Error(`${label}.name is required and must be a non-empty string.`)
  if (name.trim().length > STRING_LIMITS.name) throw new Error(`${label}.name must be 120 characters or fewer.`)

  const profile: Record<string, unknown> = {
    name: name.trim(),
    remote_preferences: 'any',
  }

  for (const [field, maxLength] of Object.entries(STRING_LIMITS)) {
    if (field === 'name' || !(field in value) || value[field] == null) continue
    const fieldValue = value[field]
    if (typeof fieldValue !== 'string') throw new Error(`${label}.${field} must be a string.`)
    if (fieldValue.length > maxLength) throw new Error(`${label}.${field} must be ${maxLength} characters or fewer.`)
    profile[field] = fieldValue.trim() || null
  }

  for (const field of ARRAY_FIELDS) {
    if (!(field in value) || value[field] == null) continue
    const fieldValue = value[field]
    if (
      !Array.isArray(fieldValue) ||
      fieldValue.length > 100 ||
      !fieldValue.every((item) => typeof item === 'string' && item.length <= 200)
    ) {
      throw new Error(`${label}.${field} must be an array of up to 100 strings, each 200 characters or fewer.`)
    }
    profile[field] = fieldValue.map((item) => item.trim()).filter(Boolean)
  }

  if ('remote_preferences' in value && value.remote_preferences != null) {
    if (typeof value.remote_preferences !== 'string' || !REMOTE_PREFERENCES.includes(value.remote_preferences)) {
      throw new Error(`${label}.remote_preferences must be one of: ${REMOTE_PREFERENCES.join(', ')}.`)
    }
    profile.remote_preferences = value.remote_preferences
  }

  if ('qualification_preferences' in value && value.qualification_preferences != null) {
    if (!isRecord(value.qualification_preferences)) {
      throw new Error(`${label}.qualification_preferences must be a JSON object.`)
    }
    profile.qualification_preferences = value.qualification_preferences
  }

  return profile as TargetingProfileImport
}

export function parseLeadProfileImport(content: string): LeadProfileImportPlan {
  let root: unknown
  try {
    root = JSON.parse(content)
  } catch {
    throw new Error('The content is not valid JSON. Check for missing quotes, commas, or brackets.')
  }

  const rawProfiles = getProfiles(root)
  if (rawProfiles.length === 0) throw new Error('Add at least one profile to import.')
  if (rawProfiles.length > MAX_IMPORTED_TARGETING_PROFILES) {
    throw new Error(`Import up to ${MAX_IMPORTED_TARGETING_PROFILES} profiles at a time.`)
  }

  const warnings: string[] = []
  const profiles = rawProfiles.map((profile, index) => validateProfile(profile, index, warnings))
  const seenNames = new Set<string>()
  for (const profile of profiles) {
    const normalizedName = profile.name.trim().toLocaleLowerCase()
    if (seenNames.has(normalizedName)) {
      throw new Error(`The profile name "${profile.name}" appears more than once in this import.`)
    }
    seenNames.add(normalizedName)
  }

  return { profiles, warnings }
}
