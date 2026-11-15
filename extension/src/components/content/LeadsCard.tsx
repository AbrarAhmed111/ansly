import { useCallback, useEffect, useRef, useState } from 'react'
import { CollectionError, collectInBatches, leadsPath, type CollectionProgress, type CollectionResult } from '@/lib/leads/collect'
import { isLinkedInPostSearchUrl, MAX_POSTS, PostCollector, postSearchKey } from '@/lib/leads/linkedin-posts'
import { send } from '@/lib/messages'
import { Brand, Icon, LogoMark } from '@/components/brand'

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
  const full = count >= MAX_POSTS

  if (minimized) {
    return (
      <div className="tailor-pill-wrap">
        <button className="pill leads-pill" onClick={() => setMinimized(false)} aria-label={`Ansly: ${count} posts loaded. Open`}>
          <LogoMark size={16} />
          <span className="pill-brand">Ansly</span>
          <span className="pill-stat">{count} posts</span>
          <span className="pill-action">
            {busy && <span className="spinner tiny" aria-hidden="true" />}
            {busy ? 'Collecting…' : 'Collect'}
          </span>
        </button>
      </div>
    )
  }

  return (
    <div className="tailor-card leads-card" role="dialog" aria-label="Collect leads from LinkedIn posts">
      <div className="header">
        <Brand />
        <span className="tag">Leads</span>
        <span className="spacer" />
        <button className="icon-btn" onClick={() => setMinimized(true)} aria-label="Minimize" title="Minimize">
          <Icon name="minus" size={16} />
        </button>
        {!busy && (
          <button className="icon-btn" onClick={onDismiss} aria-label="Close" title="Close">
            <Icon name="x" size={16} />
          </button>
        )}
      </div>

      <div className="body">
        {(state.step === 'ready' || state.step === 'error') && (
          <>
            <div className="leads-count" aria-live="polite">
              <span className="leads-count-number">{count.toLocaleString()}</span>
              <span className="leads-count-label">
                <span className="leads-live">
                  <span className={`live-dot${count && !full ? ' on' : ''}`} aria-hidden="true" />
                  post{count === 1 ? '' : 's'} loaded
                </span>
                <span className="muted">
                  {full
                    ? `Holding the first ${MAX_POSTS.toLocaleString()}`
                    : count
                      ? 'Keep scrolling to load as many as you like'
                      : 'Scroll the results to load posts'}
                </span>
              </span>
            </div>
            <div className="notice hint with-icon">
              <Icon name="sparkles" size={14} />
              <span>Ansly keeps posts with an email or apply link that match your profile, and skips the rest.</span>
            </div>
          </>
        )}

        {state.step === 'error' && (
          <div className="notice error with-icon" role="alert">
            <Icon name="alert" size={15} />
            <span>
              {state.notConnected ? <strong>Ansly isn’t connected. </strong> : null}
              {state.message}
            </span>
          </div>
        )}

        {state.step === 'collecting' && <Progress progress={state.progress} />}
        {state.step === 'done' && <Result result={state.result} />}
      </div>

      <div className="footer footer-row">
        {state.step === 'ready' && (
          <button className="btn primary wide" disabled={!count} onClick={() => void collect()}>
            Collect {count || ''} post{count === 1 ? '' : 's'}
          </button>
        )}
        {state.step === 'collecting' && (
          <button className="btn primary wide" disabled>
            <span className="spinner tiny light" aria-hidden="true" />
            Collecting…
          </button>
        )}
        {state.step === 'error' &&
          (state.notConnected ? (
            <button className="btn primary wide" onClick={() => open('/extension')}>
              Connect Ansly
            </button>
          ) : (
            <button className="btn primary wide" onClick={() => void collect()}>
              <Icon name="refresh" size={14} />
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
              <Icon name="arrowUpRight" size={14} />
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
    <div className="tailor-progress leads-progress" aria-live="polite">
      <div className="tailor-progress-head">
        <span className="tailor-activity">
          {progress.waitSeconds ? 'Waiting for the server…' : 'Matching posts to your profile…'}
        </span>
        <span className="tailor-percent">{percent}%</span>
      </div>
      <div className="tailor-bar" role="progressbar" aria-label="Collection progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <span style={{ width: `${Math.max(percent, 4)}%` }} />
      </div>
      <div className="leads-progress-meta muted">
        <span>
          {progress.done.toLocaleString()} of {progress.total.toLocaleString()} posts
          {progress.waitSeconds ? ` · retrying in ${progress.waitSeconds}s` : ''}
        </span>
        <span>Keep this tab open until it finishes.</span>
      </div>
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
        <div className={result.saved ? 'good' : undefined}>
          <span className="leads-result-number accent">{result.saved}</span>
          <span>new lead{result.saved === 1 ? '' : 's'}</span>
        </div>
      </div>
      <dl className="tailor-stats leads-stats">
        <dt><Icon name="mail" size={13} />With email</dt>
        <dd>{result.withEmail}</dd>
        <dt><Icon name="link" size={13} />With apply link</dt>
        <dd>{result.withLink}</dd>
        <dt><Icon name="check" size={13} />Already in your leads</dt>
        <dd>{result.duplicates}</dd>
        <dt><Icon name="minus" size={13} />Filtered (profile/contact)</dt>
        <dd>{result.filtered}</dd>
        {result.unidentified > 0 && (
          <>
            <dt><Icon name="info" size={13} />Couldn’t identify post</dt>
            <dd>{result.unidentified}</dd>
          </>
        )}
        {result.failed > 0 && (
          <>
            <dt><Icon name="alert" size={13} />Couldn’t process</dt>
            <dd>{result.failed}</dd>
          </>
        )}
      </dl>
      <div className={`notice with-icon ${result.saved ? 'success' : 'info'}`}>
        <Icon name={result.saved ? 'check' : 'info'} size={15} />
        <span>
          {result.saved
            ? 'Check the dashboard to review and apply.'
            : 'No new leads this time. Try scrolling further or adjusting your profile’s roles and keywords.'}
        </span>
      </div>
    </>
  )
}
