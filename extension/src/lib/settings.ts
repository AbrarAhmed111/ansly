import { storage } from 'wxt/utils/storage'

export type Theme = 'system' | 'light' | 'dark'

export interface Settings {
  /** Show ✨ on application forms. */
  enabled: boolean
  /** Hostnames where ✨ is turned off. */
  disabledSites: string[]
  /** Send the job description with questions (off by default). */
  useJobDescription: boolean
  /** Record fill / saved-answer usage events. */
  analytics: boolean
  theme: Theme
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  disabledSites: [],
  useJobDescription: false,
  analytics: true,
  theme: 'system',
}

export const settingsItem = storage.defineItem<Settings>('sync:settings', {
  fallback: DEFAULT_SETTINGS,
})

export async function getSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...(await settingsItem.getValue()) }
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch }
  await settingsItem.setValue(next)
  return next
}

export function isEnabledOn(settings: Settings, hostname: string): boolean {
  return settings.enabled && !settings.disabledSites.includes(hostname)
}
