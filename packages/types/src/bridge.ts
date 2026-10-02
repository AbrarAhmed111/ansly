/**
 * window.postMessage protocol between the web app and the extension's
 * content-script bridge, which only runs on the web app's own origin.
 */

export const BRIDGE_WEB = 'ansly-web'
export const BRIDGE_EXTENSION = 'ansly-extension'

/** Tokens for a Supabase session created for the extension alone. */
export interface ExtensionSession {
  access_token: string
  refresh_token: string
  /** Unix seconds */
  expires_at: number
  user: { id: string; email: string | null }
}

export type WebToExtensionMessage =
  | { source: typeof BRIDGE_WEB; type: 'ANSLY_PING' }
  | { source: typeof BRIDGE_WEB; type: 'ANSLY_CONNECT'; session: ExtensionSession }
  | { source: typeof BRIDGE_WEB; type: 'ANSLY_DISCONNECT' }
  /** Lists the sites Ansly runs on (answered with ANSLY_SITES). */
  | { source: typeof BRIDGE_WEB; type: 'ANSLY_GET_SITES' }
  /** Turns Ansly off on a site. Adding a site needs a click in the extension (browser permission prompt). */
  | { source: typeof BRIDGE_WEB; type: 'ANSLY_REMOVE_SITE'; domain: string }

export interface ExtensionStatusPayload {
  version: string
  connected: boolean
  email: string | null
}

export type ExtensionToWebMessage =
  | ({ source: typeof BRIDGE_EXTENSION; type: 'ANSLY_STATUS' } & ExtensionStatusPayload)
  | { source: typeof BRIDGE_EXTENSION; type: 'ANSLY_CONNECTED'; ok: boolean; error?: string }
  | { source: typeof BRIDGE_EXTENSION; type: 'ANSLY_SITES'; sites: string[] }
