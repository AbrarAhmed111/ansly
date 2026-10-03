/**
 * Evidence corpus and requirement-to-evidence matching.
 * Keep in sync with `llm/src/app/schemas/matching.py`.
 */

export type EvidenceSource =
  | 'profile'
  | 'experience'
  | 'project'
  | 'skill'
  | 'education'
  | 'achievement'
  | 'fact'
  | 'resume'

/** One fact the tailored resume may draw on. Every claim must trace back to at least one. */
export interface Evidence {
  /** Stable id, e.g. "exp_12" or "resume:exp_1:b2". */
  id: string
  source: EvidenceSource
  /** Id of the profile row or resume item it came from. */
  sourceId: string
  label: string
  text: string
  /** Skill/technology tokens this evidence supports. */
  skills: string[]
}

export type SupportLevel = 'strong' | 'partial' | 'none'

export type RequirementPriority = 'must_have' | 'nice_to_have'

export interface RequirementMatch {
  requirementId: string
  requirement: string
  priority: RequirementPriority
  support: SupportLevel
  /** Always ids that exist in the evidence corpus; empty when support is 'none'. */
  evidenceIds: string[]
  /** Deterministic skill match, or LLM semantic match (which must cite evidence). */
  method: 'deterministic' | 'semantic'
  note: string | null
}

export interface MatchSummary {
  analyzed: number
  supported: number
  partial: number
  unsupported: number
}

/** Stored on the tailoring: the matches and the evidence they cite (later steps reuse this corpus). */
export interface MatchAnalysis {
  matches: RequirementMatch[]
  evidence: Evidence[]
  /** Canonical names of skills the user said they don't have; never evidence. */
  declinedSkills: string[]
}
