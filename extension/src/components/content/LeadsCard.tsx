import { useCallback, useEffect, useRef, useState } from 'react'
import { CollectionError, collectInBatches, leadsPath, type CollectionProgress, type CollectionResult } from '@/lib/leads/collect'
import { isLinkedInPostSearchUrl, MAX_POSTS, PostCollector, postSearchKey } from '@/lib/leads/linkedin-posts'
import { send } from '@/lib/messages'

/** One collector per tab: the card and the popup's Collect Info read the same posts. */
export const pagePosts = new PostCollector()

const SCAN_THROTTLE_MS = 600

/**
 * On a LinkedIn post search: the number of posts seen so far, updated as the user scrolls.
 * Only cards already on the page are read, and nothing is sent anywhere until the user clicks Collect.
 */
export function usePostSearch(enabled: boolean): { url: string | null; searchKey: string | null; count: number } {
  const [url, setUrl] = useState<string | null>(null)
  const searchKey = url ? postSearchKey(url) : null
  const [count, setCount] = useState(0)

  // LinkedIn is a single-page app: the search can start or change without a page load.
  useEffect(() => {
    if (!enabled) return setUrl(null)
    const check = () =>
      setUrl((current) => {
        const next = isLinkedInPostSearchUrl(location.href) ? location.href : null
        // Same search with new tracking params: keep the current value so nothing restarts.
        return next && current && postSearchKey(next) === postSearchKey(current) ? current : next
      })
    check()
    const timer = setInterval(check, 1000)
    return () => clearInterval(timer)
  }, [enabled])

  useEffect(() => {
    if (!url) return
    let pending: ReturnType<typeof setTimeout> | null = null
    const scan = () => {
      pending = null
      setCount(pagePosts.scan(document, url))
    }
    const schedule = () => {
      if (!pending) pending = setTimeout(scan, SCAN_THROTTLE_MS)
    }
    scan()
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('scroll', schedule, { passive: true })
    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', schedule)
      if (pending) clearTimeout(pending)
    }
  }, [url])

  return { url, searchKey, count: url ? count : 0 }
}

type State =
  | { step: 'ready' }
  | { step: 'collecting'; progress: CollectionProgress }
  | { step: 'done'; result: CollectionResult }
  | { step: 'error'; message: string; notConnected: boolean }

export function LeadsCard({ count, onDismiss }: { count: number; onDismiss: () => void }) {
  const [state, setState] = useState<State>({ step: 'ready' })
  const [minimized, setMinimized] = useState(false)
  const mounted = useRef(true)
  useEffect(() => () => void (mounted.current = false), [])

  const collect = useCallback(async () => {
    const posts = pagePosts.preview().candidates
    if (!posts.length) return
    setMinimized(false)
    setState({ step: 'collecting', progress: { done: 0, total: posts.length } })
    try {
      const result = await collectInBatches(posts, (progress) => {
        if (mounted.current) setState({ step: 'collecting', progress })
      })
      if (mounted.current) setState({ step: 'done', result })
    } catch (error) {
      if (!mounted.current) return
      const notConnected = error instanceof CollectionError && error.failure.code === 'not_connected'
      setState({ step: 'error', message: error instanceof Error ? error.message : 'Collection failed.', notConnected })
    }
  }, [])

  const open = (path: string) => void send('openWebApp', { path })
  const busy = state.step === 'collecting'

  if (minimized) {
    return (
      <div className="tailor-pill-wrap">
        <button className="pill" onClick={() => setMinimized(false)} aria-label={`Ansly: ${count} posts loaded. Open`}>
          <span className="pill-brand">Ansly</span>
          <span className="pill-stat">{count} posts</span>
          <span className="pill-action">{busy ? 'Collecting…' : 'Collect'}</span>
        </button>
      </div>
    )
  }

  return (
    <div className="tailor-card leads-card" role="dialog" aria-label="Collect leads from LinkedIn posts">
      <div className="header">
        <span className="brand">Ansly</span>
        <span className="muted">Leads</span>
        <span className="spacer" />
        <button className="icon-btn" onClick={() => setMinimized(true)} aria-label="Minimize">
          ▾
        </button>
        {!busy && (
          <button className="icon-btn" onClick={onDismiss} aria-label="Close">
            ✕
          </button>
        )}
      </div>

      <div className="body">
        {(state.step === 'ready' || state.step === 'error') && (
          <>
            <div className="leads-count" aria-live="polite">
              <span className="leads-count-number">{count}</span>
              <span className="leads-count-label">
                post{count === 1 ? '' : 's'} loaded
                <span className="muted">{count >= MAX_POSTS ? `Holding the first ${MAX_POSTS.toLocaleString()}` : 'Keep scrolling to load as many as you like'}</span>
              </span>
            </div>
            <div className="notice hint">
              Ansly keeps posts with an email or apply link that match your profile, and skips the rest.
            </div>
          </>
        )}

        {state.step === 'error' && (
          <div className="notice error">
            {state.notConnected ? <strong>Ansly isn’t connected. </strong> : null}
            {state.message}
          </div>
        )}

        {state.step === 'collecting' && <Progress progress={state.progress} />}
        {state.step === 'done' && <Result result={state.result} />}
      </div>

      <div className="footer">
        <span className="spacer" />
        {state.step === 'ready' && (
          <button className="btn primary" disabled={!count} onClick={() => void collect()}>
            Collect {count || ''} post{count === 1 ? '' : 's'}
          </button>
        )}
        {state.step === 'error' &&
          (state.notConnected ? (
            <button className="btn primary" onClick={() => open('/extension')}>
              Connect Ansly
            </button>
          ) : (
            <button className="btn primary" onClick={() => void collect()}>
              Try again
            </button>
          ))}
        {state.step === 'done' && (
          <>
            <button className="btn" onClick={() => setState({ step: 'ready' })}>
              Collect more
            </button>
            <button className="btn primary" onClick={() => open(leadsPath(state.result))}>
              Open dashboard
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function Progress({ progress }: { progress: CollectionProgress }) {
  const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0
  return (
    <div className="tailor-progress" aria-live="polite">
      <div className="tailor-progress-head">
        <span className="spinner" />
        <span className="tailor-activity">
          {progress.waitSeconds
            ? `Waiting ${progress.waitSeconds}s for the server… ${progress.done} of ${progress.total}`
            : `Matching posts to your profile… ${progress.done} of ${progress.total}`}
        </span>
        <span className="muted tailor-percent">{percent}%</span>
      </div>
      <div className="tailor-bar" role="progressbar" aria-label="Collection progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <span style={{ width: `${Math.max(percent, 4)}%` }} />
      </div>
      <div className="muted">Keep this tab open until it finishes.</div>
    </div>
  )
}

function Result({ result }: { result: CollectionResult }) {
  return (
    <>
      <div className="leads-result" aria-live="polite">
        <div>
          <span className="leads-result-number">{result.detected}</span>
          <span className="muted">posts detected</span>
        </div>
        <div>
          <span className="leads-result-number accent">{result.saved}</span>
          <span className="muted">new leads</span>
        </div>
      </div>
      <dl className="tailor-stats">
        <dt>With email</dt>
        <dd>{result.withEmail}</dd>
        <dt>With apply link</dt>
        <dd>{result.withLink}</dd>
        <dt>Already in your leads</dt>
        <dd>{result.duplicates}</dd>
        <dt>Skipped</dt>
        <dd>{result.skipped}</dd>
        {result.failed > 0 && (
          <>
            <dt>Couldn’t process</dt>
            <dd>{result.failed}</dd>
          </>
        )}
      </dl>
      <div className={`notice ${result.saved ? 'success' : 'info'}`}>
        {result.saved
          ? 'Check the dashboard to review and apply.'
          : 'No new leads this time. Try scrolling further or adjusting your profile’s roles and keywords.'}
      </div>
    </>
  )
}
