import {
  LEAD_PROFILE_IMPORT_EXAMPLE,
  MAX_IMPORTED_TARGETING_PROFILES,
  parseLeadProfileImport,
} from '../lead-profile-import'

describe('parseLeadProfileImport', () => {
  it('parses a single profile and applies defaults', () => {
    const plan = parseLeadProfileImport(JSON.stringify(LEAD_PROFILE_IMPORT_EXAMPLE))

    expect(plan.profiles).toHaveLength(1)
    expect(plan.profiles[0]).toMatchObject({
      name: 'Senior product engineering',
      target_roles: ['Product Engineer', 'Full-stack Engineer'],
      remote_preferences: 'remote',
      qualification_preferences: { minimum_confidence: 0.7, require_compensation: true },
    })
    expect(plan.warnings).toEqual([])
  })

  it('accepts a list and a profiles wrapper while ignoring system fields', () => {
    const plan = parseLeadProfileImport(JSON.stringify({
      profiles: [
        { name: 'One', user_id: 'untrusted', is_active: true },
        { name: 'Two', id: 'untrusted-id' },
      ],
    }))

    expect(plan.profiles.map(({ name }) => name)).toEqual(['One', 'Two'])
    expect(plan.profiles[0]).not.toHaveProperty('user_id')
    expect(plan.profiles[0]).not.toHaveProperty('is_active')
    expect(plan.warnings).toHaveLength(2)
  })

  it('rejects invalid required values, types, enum values, and duplicate names', () => {
    expect(() => parseLeadProfileImport('{"keywords":"react"}')).toThrow('name is required')
    expect(() => parseLeadProfileImport('{"name":"One","keywords":"react"}')).toThrow('array of up to 100 strings')
    expect(() => parseLeadProfileImport('{"name":"One","remote_preferences":"flexible"}')).toThrow('remote_preferences')
    expect(() => parseLeadProfileImport('[{"name":"One"},{"name":" one "}]')).toThrow('appears more than once')
  })

  it('caps the number of profiles per import', () => {
    const profiles = Array.from({ length: MAX_IMPORTED_TARGETING_PROFILES + 1 }, (_, index) => ({ name: `Profile ${index}` }))
    expect(() => parseLeadProfileImport(JSON.stringify(profiles))).toThrow('Import up to')
  })
})
