/**
 * Updating an unpacked install: rebuild into the same folder, then reload. Reloading keeps the extension ID,
 * so storage (settings, session, enabled sites) is kept. Removing the extension is what erases it.
 */

/** The build this code came from; "dev" in tests and the dev server, where nothing is stamped. */
export const RUNNING_BUILD = typeof __ANSLY_BUILD_ID__ === 'string' ? __ANSLY_BUILD_ID__ : 'dev'

/** The build currently in the extension folder on disk, or null when it can't be read. */
export async function diskBuild(): Promise<string | null> {
  try {
    // build.json is written by the build hook, so WXT's typed public paths don't list it.
    const url = (browser.runtime.getURL as (path: string) => string)('/build.json')
    const response = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' })
    if (!response.ok) return null
    const data = (await response.json()) as { buildId?: unknown }
    return typeof data.buildId === 'string' ? data.buildId : null
  } catch {
    return null
  }
}

/** Loaded with "Load unpacked" (not from a store), so a reload picks up new files from the folder. */
export async function isUnpacked(): Promise<boolean> {
  try {
    return (await browser.management.getSelf()).installType === 'development'
  } catch {
    return false
  }
}

export function buildLabel(buildId: string): string {
  const date = new Date(buildId)
  if (Number.isNaN(date.getTime())) return buildId
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** Restarts the extension from the files on disk. Open tabs keep the old page script until they're refreshed. */
export function reloadExtension(): void {
  browser.runtime.reload()
}
