import type { ApiFailure } from './messages'

export interface FriendlyError {
  title: string
  message: string
  action: 'retry' | 'connect' | 'reload' | null
}

/**
 * What to tell the user when a request fails: what happened and what to do, never an HTTP status, an error code or
 * a provider's message. Messages the API writes for people (the daily limit, a missing resume) are kept.
 */
export function friendlyError(error: ApiFailure, doing = 'generate this answer'): FriendlyError {
  switch (error.code) {
    case 'not_connected':
      return { title: 'Ansly isn’t connected', message: 'Connect Ansly to your account to continue.', action: 'connect' }
    case 'unavailable':
      return { title: 'AI service is temporarily busy', message: 'Please try again in a moment.', action: 'retry' }
    case 'rate_limited':
      return { title: 'Slow down a little', message: error.message, action: 'retry' }
    case 'network':
      return /updated|reload/i.test(error.message)
        ? { title: 'Ansly was updated', message: 'Reload this page to keep using it.', action: 'reload' }
        : { title: 'Can’t reach Ansly', message: 'Check your internet connection and try again.', action: 'retry' }
    case 'conflict':
      return { title: 'Ansly needs more information from you', message: error.message, action: null }
    case 'bad_request':
      return { title: `Ansly couldn’t ${doing}`, message: 'Something about this field confused it. Your profile information is safe.', action: 'retry' }
    default:
      return { title: `Ansly couldn’t ${doing}`, message: 'Your profile information is safe.', action: 'retry' }
  }
}
