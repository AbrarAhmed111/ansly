import type { AnswerLength, AnswerTone } from '@ansly/types'
import { storage } from 'wxt/utils/storage'

export type Theme = 'system' | 'light' | 'dark'

export interface Settings {
  /** Master switch for ✨ on sites the user has enabled. */
  enabled: boolean
  /** Send the job description with questions (off by default). */
  useJobDescription: boolean
  /** Record fill / saved-answer usage events. */
  analytics: boolean
  theme: Theme
  /** "auto" = the question category's default (cover letters: detailed). */
  defaultLength: AnswerLength
  defaultTone: AnswerTone
  /** Fill all shows the answers in the panel first, with one confirm (old per-answer review). */
  reviewBeforeFill: boolean
  /** Fill all also replaces fields that already have text. */
  overwriteFilled: boolean
  /** Outline every candidate field: green = detected (with kind), grey = ignored (hover for why). */
  detectionDebug: boolean
  /** Show the "Tailor resume" pill on job posting pages (enabled sites only). */
  offerTailoring: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  useJobDescription: false,
  analytics: true,
  theme: 'system',
  defaultLength: 'auto',
  defaultTone: 'professional',
  reviewBeforeFill: false,
  overwriteFilled: false,
  detectionDebug: false,
  offerTailoring: true,
}

export const settingsItem = storage.defineItem<Settings>('sync:settings', {
  fallback: DEFAULT_SETTINGS,
})

/**
 * One-time popup notice after updating from V1, where Ansly ran on every site.
 * null = never decided (pre-V1.1 install), true = show, false = dismissed / fresh install.
 */
export const sitesNoticeItem = storage.defineItem<boolean | null>('local:sitesNotice', { fallback: null })

export async function getSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...(await settingsItem.getValue()) }
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch }
  await settingsItem.setValue(next)
  return next
}

/**
 * V1 -> V1.1: drop the per-host opt-out list (sites are opt-in now) and show the notice.
 * "Enabled everywhere" is deliberately not carried over. Runs once per install.
 */
export async function migrateFromV1(): Promise<void> {
  if ((await sitesNoticeItem.getValue()) !== null) return
  const stored = (await settingsItem.getValue()) as Settings & { disabledSites?: string[] }
  if (stored && 'disabledSites' in stored) {
    const { disabledSites: _, ...rest } = stored
    await settingsItem.setValue({ ...DEFAULT_SETTINGS, ...rest })
  }
  await sitesNoticeItem.setValue(true)
}
