/**
 * Messages from content scripts / popup to the background service worker.
 * The background is the only place that holds the session and calls the API.
 */

import type {
  AnswerResponse,
  CreateSavedAnswerRequest,
  ExtensionSession,
  GenerateAnswerRequest,
  MatchSavedAnswerResponse,
  RegenerateAnswerRequest,
  SavedAnswer,
  TrackEventRequest,
} from '@ansly/types'
import type { ProfileSummary } from './profile-summary'

export type ErrorCode =
  | 'not_connected'
  | 'rate_limited'
  | 'network'
  | 'unavailable'
  | 'bad_request'
  | 'server'

export interface ApiFailure {
  code: ErrorCode
  message: string
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: ApiFailure }

export interface ConnectionState {
  connected: boolean
  email: string | null
  version: string
}

export interface RequestMap {
  generate: { payload: GenerateAnswerRequest; response: AnswerResponse }
  regenerate: { payload: RegenerateAnswerRequest; response: AnswerResponse }
  matchSaved: { payload: { question: string }; response: MatchSavedAnswerResponse }
  saveAnswer: { payload: CreateSavedAnswerRequest; response: SavedAnswer }
  useSaved: { payload: { id: string }; response: SavedAnswer }
  track: { payload: TrackEventRequest; response: null }
  getConnection: { payload: null; response: ConnectionState }
  getProfileSummary: { payload: null; response: ProfileSummary }
  connect: { payload: ExtensionSession; response: ConnectionState }
  disconnect: { payload: null; response: ConnectionState }
  openWebApp: { payload: { path: string }; response: null }
}

export type RequestType = keyof RequestMap

export interface Request<K extends RequestType = RequestType> {
  ansly: true
  type: K
  payload: RequestMap[K]['payload']
}

/** Messages from the background to a tab's content script. */
export type TabMessage = { ansly: true; type: 'shortcut' }

export function isRequest(message: unknown): message is Request {
  return typeof message === 'object' && message !== null && (message as Request).ansly === true && 'type' in message
}

/** Sends a typed request to the background and returns its Result. */
export async function send<K extends RequestType>(
  type: K,
  payload: RequestMap[K]['payload'],
): Promise<Result<RequestMap[K]['response']>> {
  try {
    const result = await browser.runtime.sendMessage({ ansly: true, type, payload } satisfies Request<K>)
    if (!result) return { ok: false, error: { code: 'server', message: 'No response from the extension.' } }
    return result as Result<RequestMap[K]['response']>
  } catch (e) {
    // Happens after the extension is updated while a page is open.
    return {
      ok: false,
      error: { code: 'network', message: `Ansly was updated — reload this page. (${e instanceof Error ? e.message : e})` },
    }
  }
}
