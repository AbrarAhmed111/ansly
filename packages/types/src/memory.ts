/**
 * Application Memory API (`/api/v1/memory`).
 * Keep in sync with llm/src/app/schemas/memory.py.
 */

import type { MemoryScope } from './database'

export type MemorySourceType = 'profile' | 'skills' | 'ask_and_learn' | 'web' | 'onboarding' | 'memory_edit'

export interface MemoryItem {
  /** A profile_facts id, `profile:<column>` for a profile preference, or `skill:<id>` for a declined skill. */
  id: string
  key: string | null
  label: string
  group: string
  value: string
  valueType: 'text' | 'boolean' | 'number' | 'choice'
  options: string[] | null
  scope: MemoryScope
  company: string | null
  sourceType: MemorySourceType
  /** "Acme · Software Engineer": the application it was learned during. */
  sourceLabel: string | null
  createdAt: string | null
  updatedAt: string | null
  lastConfirmedAt: string | null
  status: 'active' | 'outdated' | 'superseded'
  /** A drifting preference nobody confirmed for a while: ask "Still accurate?". */
  stale: boolean
  /** Ansly answers questions about it directly, without the model. */
  answersDirectly: boolean
}

export interface MemoryConflict {
  key: string
  label: string
  /** The value that answers now, by the rule, and the one it overrides. */
  winner: string
  winnerSource: 'profile' | 'memory'
  other: string
  otherSource: 'memory'
  otherId: string | null
  rule: string
}

/** `GET /api/v1/memory` */
export interface MemoryResponse {
  items: MemoryItem[]
  conflicts: MemoryConflict[]
  groups: string[]
  counts: { learned: number; preferences: number; profile: number; stale: number; conflicts: number }
}

/** `PATCH /api/v1/memory/{id}` */
export interface UpdateMemoryRequest {
  value?: string | null
  scope?: MemoryScope | null
  company?: string | null
  status?: 'active' | 'outdated' | null
}

/** `POST /api/v1/memory/conflicts/resolve` */
export interface ResolveConflictRequest {
  id: string
  use: 'profile' | 'memory'
}
