# Ansly Performance and API Load Audit

Date: 2026-10-03

Purpose: describe where Ansly currently spends browser time, server time, Supabase calls, storage calls, and LLM/API calls, then list practical ways to improve page load time and reduce API load.

This audit is based on the current repository implementation across the Next.js web app, browser extension, FastAPI LLM service, and Supabase schema.

## Executive Summary

Ansly already has several good performance foundations:

- Resume web pages use a small client-side stale-while-revalidate cache.
- Fill-all answer generation has batch endpoints that fetch the profile once and can answer several fields in one model call.
- Resume tailoring is step-based and resumable, so long work can survive serverless freezing.
- Extension analytics avoid sending text and can be disabled.
- Supabase reads are user-scoped through the user's JWT, keeping the security model simple.

Main performance and load risks:

- The landing page is forced dynamic and pings Supabase and the API on every request.
- The dashboard fans out multiple Supabase requests on every load.
- API calls to Supabase create a new `httpx.AsyncClient` per request, losing connection reuse.
- Single-field extension answer flow usually does `matchSaved` and then `generate`, two background/API round trips before the user sees an answer.
- Saved-answer matching loads up to 500 saved answers every match request.
- Resume tailoring uses several LLM calls and polls every 2 seconds while running.
- DOCX preview can download/render both documents as soon as tailoring is ready, even if the user may not open preview.
- Extension content script scans the full DOM and open shadow roots after DOM mutations and has a 700ms layout tick while active.

Highest-impact recommendations:

1. Stop doing live status checks on the landing page render path.
2. Add a small server-side summary endpoint or RPC for dashboard counts/profile completeness.
3. Reuse HTTP clients in the FastAPI service.
4. Make single-field answer generation optionally include saved-answer matching in one API request.
5. Cache saved-answer lists or matching material per user for a short TTL.
6. Tune tailoring polling with progressive backoff or status-specific intervals.
7. Lazy-load DOCX preview only after the user opens preview.
8. Add request/timing telemetry before deep optimization.

## Product Hot Paths

### Public Landing Page

Source: `web/src/app/page.tsx`

Current behavior:

- `dynamic = 'force-dynamic'`.
- On every page render:
  - Creates a Supabase server client.
  - Calls `supabase.auth.getUser()`.
  - Calls `checkSupabase()`, which hits Supabase Auth health with `cache: 'no-store'`.
  - Calls `checkApi()`, which hits the LLM service `/health` with `cache: 'no-store'`.
  - If API health succeeds, page renders API-to-Supabase status too.

Performance impact:

- First byte waits on external Supabase/API health checks.
- Public anonymous traffic can create unnecessary API and Supabase health load.
- `force-dynamic` disables static rendering and CDN caching for the landing page.

Suggested improvements:

- Move system status to a client component that loads after first paint.
- Cache status for 30-120 seconds via Next route handler, edge cache, or in-memory API cache.
- Remove live status from the first viewport, or show "Status" as a link to a dedicated status panel.
- Consider static rendering for the marketing content and only personalize the CTA client-side after session detection.

Expected benefit:

- Faster landing TTFB and LCP.
- Less load on deployed API from casual visitors.

### Dashboard

Source: `web/src/app/(app)/dashboard/page.tsx`

Current behavior:

- `dynamic = 'force-dynamic'`.
- Loads full profile through `loadFullProfile()`.
- `loadFullProfile()` performs parallel Supabase reads:
  - `profiles`
  - `experiences`
  - `projects`
  - `skills`
  - `education`
  - `achievements`
  - `profile_facts`
- Then dashboard performs additional parallel reads:
  - `saved_answers` count
  - `usage_events` last 7 days, selecting all `kind` rows and counting in JS
  - `resumes` master count
  - `resume_tailorings` ready count

Performance impact:

- A dashboard load can fan out to roughly 11 Supabase requests.
- Weekly usage selects rows instead of asking the database for grouped counts.
- Counts use exact count, which can get slower as tables grow.

Suggested improvements:

- Add a single `/api/v1/profile/summary` or Supabase RPC that returns:
  - profile completeness inputs
  - section counts
  - saved answer count
  - weekly usage counts grouped by kind
  - master resume existence
  - ready tailoring count
- Replace weekly usage row fetch with grouped aggregation. If staying on PostgREST, create an RPC such as `dashboard_summary()`.
- Consider approximate or cached counts for non-critical dashboard numbers.
- Cache dashboard summary for 10-30 seconds per user in the API or browser.

Expected benefit:

- Fewer Supabase round trips.
- Faster dashboard load.
- Lower database/API overhead for repeated navigation.

### Resume Pages

Sources:

- `web/src/app/(app)/resume/page.tsx`
- `web/src/app/(app)/resume/[tailoringId]/page.tsx`
- `web/src/lib/cache.ts`
- `web/src/lib/docx-preview.ts`

Current strengths:

- Client-side SWR cache deduplicates in-flight requests and reuses recently loaded data.
- Resume list and master resume load in parallel.
- Tailoring detail is warmed on hover/focus from the list.
- Next config has `staleTimes: { dynamic: 30 }`.

Current load risks:

- Tailoring detail polls every 2 seconds while running.
- Polling calls can also drive pipeline work server-side for up to 8 seconds.
- Once ready, the detail page prefetches preview renderer and downloads preview documents in the background.
- Preview requires signed URLs and document downloads from Supabase Storage.

Suggested improvements:

- Use progressive polling:
  - 1s for the first 5 seconds.
  - 2s while active.
  - 5s after 30 seconds.
  - pause when tab is hidden.
- Return `retryAfterMs` from `GET /tailorings/{id}` so the client follows server guidance.
- Lazy-load preview documents only when the user opens preview, while still preloading the renderer if desired.
- Cache signed preview URLs until near expiry instead of requesting them repeatedly.
- Add `updatedAt` or `version` to tailoring responses so the client can skip state updates when unchanged.

Expected benefit:

- Lower API load during resume tailoring.
- Less storage bandwidth if users download directly without previewing.

### Extension Content Script

Sources:

- `extension/src/components/content/App.tsx`
- `extension/src/lib/detection/scan.ts`
- `extension/src/lib/job/detect.ts`
- `extension/src/lib/job/generic.ts`

Current behavior:

- Scans the full document plus open shadow roots.
- Uses a MutationObserver with 300ms debounce.
- Observes `childList`, subtree, and selected attributes.
- Uses a layout tick on scroll/resize and also every 700ms while active and fields/panels/debug UI exist.
- Job-page detection checks every 1500ms for up to 8 attempts after URL/title changes.
- Tracks one `job_detected` event per job when analytics are enabled.

Performance impact:

- On large ATS pages, full DOM scans after mutations can be expensive.
- Periodic layout ticks force repeated `getBoundingClientRect()` calls for detected fields.
- Job detection repeatedly reads page text during the initial SPA render window.

Suggested improvements:

- Only scan visible form regions first, then expand if the user opens the fill-all panel.
- Add a max candidate cap for automatic sparkle rendering, with fill-all panel available for the rest.
- Replace the 700ms layout interval with:
  - scroll/resize handlers
  - ResizeObserver on tracked fields
  - IntersectionObserver for visibility
- Pause scanning when the document is hidden.
- Cache job detection by `location.href + document.title + body length bucket` during the same page session.
- In debug mode, keep full scans; in normal mode, reduce diagnostics work.

Expected benefit:

- Less CPU on heavy application pages.
- Lower chance the extension feels intrusive.

### Extension Answer Flow

Sources:

- `extension/src/components/content/Popover.tsx`
- `extension/src/components/content/Panel.tsx`
- `extension/src/entrypoints/background.ts`
- `llm/src/app/api/routes/answers.py`
- `llm/src/app/api/routes/saved_answers.py`

Current single-field flow:

1. User opens popover.
2. Extension calls `matchSaved`.
3. If no match, extension calls `generate`.
4. Generate fetches profile data, runs prechecks, and may call an LLM.

Current fill-all flow:

- Background has `matchSavedBatch` and `generateBatch`.
- API has `match-batch` and `generate-batch`.
- Batch answer generation fetches profile once and can answer up to 10 pending questions per model call.

Performance impact:

- Single-field path pays an extra network round trip before generation.
- Saved-answer match endpoint loads up to 500 saved answers on every request.
- Saved-answer matching is CPU-local after the DB read, which is fine at small scale but grows with answer count.

Suggested improvements:

- Add `prefer_saved_answer: true` to `/answers/generate`, or create `/answers/resolve`.
  - It should check saved answers and return either a saved answer or generated answer in one round trip.
- Cache recent saved answers per user for 30-120 seconds in the API.
- Add an `updated_at` watermark so extension can cache saved answers locally and only refetch when changed.
- Limit saved-answer match candidates by category when the classifier is confident.
- For very large saved-answer libraries, add trigram/vector indexing later. This is not urgent for V1.

Expected benefit:

- Faster first answer popover.
- Fewer API and Supabase requests.
- Lower cost for repeat users with many saved answers.

### FastAPI / Supabase REST Client

Source: `llm/src/app/db/rest.py`

Current behavior:

- `SupabaseRest._client()` creates a new `httpx.AsyncClient` for every select/insert/update/delete/rpc/count call.
- Each operation opens and closes a client context.
- Queries run with the user's access token, preserving RLS.

Performance impact:

- No connection pooling across several Supabase calls in the same API request.
- Resume tailoring and dashboard-style API routes can pay repeated TLS/connection overhead.

Suggested improvements:

- Use a shared `httpx.AsyncClient` per app process, or per request dependency, with connection pooling.
- Keep user-specific headers per request, but reuse the underlying client.
- Add timing logs for Supabase calls by table and operation.
- Add bulk insert for usage events where possible.

Expected benefit:

- Faster API responses with multiple Supabase calls.
- Lower overhead under concurrent usage.

### Answer Generation API

Sources:

- `llm/src/app/api/routes/answers.py`
- `llm/src/app/answers/engine.py`
- `llm/src/app/answers/profile_context.py`

Current strengths:

- Deterministic prechecks avoid LLM calls for some logistics and unsupported skill questions.
- Batch generation fetches profile once.
- Batch generation chunks model calls by 10 pending questions.
- Usage events record tokens.

Current load risks:

- Single-answer generation fetches profile context per question.
- Regeneration always calls the model.
- Usage event insert happens after each generated answer.
- Daily limit checks and burst limit checks add Supabase calls before generation.

Suggested improvements:

- Short-cache profile context per user for 30-60 seconds in the API.
- For extension single-field sessions, allow client to pass a `profile_context_version` and reuse server cache when fresh.
- For fill-all, insert usage events in one bulk request.
- Add answer cache for exact repeated question + style + profile updated timestamp + job context hash, with a short TTL.
- Add deterministic answers for more common logistics questions and choice fields.
- Only run daily limit check after deterministic precheck when no model will be used, if product rules allow no-model answers not to count.

Expected benefit:

- Lower Supabase load.
- Fewer model calls for repeated or simple fields.

### Resume Tailoring Pipeline

Sources:

- `llm/src/app/api/routes/jobs.py`
- `llm/src/app/api/routes/tailorings.py`
- `llm/src/app/resume/pipeline.py`
- `llm/src/app/resume/analysis/analyze.py`
- `llm/src/app/resume/matching/match.py`
- `llm/src/app/resume/tailoring/plan.py`
- `llm/src/app/resume/validation/review.py`

Current behavior:

- Job analysis is separate from start tailoring.
- Tailoring steps:
  - queued
  - analyzing
  - matching
  - tailoring
  - validating
  - rendering
  - ready
- Polling can drive work when background tasks are unavailable or frozen.
- Rendering uploads a tailored DOCX to Supabase Storage.
- Truthfulness review may run while the file uploads.

Performance impact:

- Resume tailoring is the heaviest feature by design.
- It can use multiple LLM calls for one user action.
- Polling may cause a request to stay open while work is performed.
- Re-tailoring the same resume/job can repeat analysis and matching work.

Suggested improvements:

- Cache job analysis by normalized job URL or content hash.
- Cache match analysis by `(resume_id, resume_version, job_context_id, pipeline_version)`.
- Cache tailoring plan by `(resume_id, resume_version, job_context_id, profile/resume hash, pipeline_version)` where safe.
- Store per-step duration and token counts in `resume_tailorings` or a metrics table.
- Add status-specific polling hints to reduce polling load.
- Consider a background queue for production if usage grows beyond personal/small-team use.

Expected benefit:

- Faster retries and repeated tailoring.
- Better visibility into cost drivers.

### Supabase Schema and Query Patterns

Sources:

- `supabase/migrations/*.sql`
- `supabase/analytics/tailoring_metrics.sql`

Current strengths:

- User-owned tables have RLS.
- Several user_id indexes exist.
- Tailoring metrics SQL exists.
- `step_started_at` supports leasing/resume behavior.

Potential gaps to verify with EXPLAIN/advisors:

- `usage_events` queries by `created_at`, `kind`, and current user.
- `saved_answers` lists by `updated_at desc`.
- `resume_tailorings` lists by `created_at desc` and filters by status.
- `resumes` filters by `is_master`.
- `job_contexts` and `resume_tailorings` joins are done manually through separate REST calls.

Suggested indexes to evaluate:

- `usage_events(user_id, created_at desc, kind)`
- `saved_answers(user_id, updated_at desc)`
- `resume_tailorings(user_id, created_at desc)`
- `resume_tailorings(user_id, status, created_at desc)`
- `resumes(user_id, is_master)` where `is_master = true`

Do not add indexes blindly. Check current migration definitions and run query plans or Supabase advisors first.

## Prioritized Improvement Backlog

### P0: Measure First

Add simple timing instrumentation before changing architecture:

- Web:
  - landing server render time
  - dashboard server render time
  - resume detail initial load time
  - preview document download/render time
- API:
  - route duration
  - Supabase call count per route
  - Supabase total time per route
  - LLM call count, provider, model, tokens, duration
- Extension:
  - scan duration
  - number of candidate fields
  - popover time to first answer
  - fill-all time to first completed row

Why first:

- It prevents optimizing the wrong thing.
- It gives GPT or another reviewer concrete numbers to reason about.

### P1: Landing Page Fast Path

Change:

- Remove blocking `checkSupabase()` and `checkApi()` from the page render path.
- Load system status client-side after first paint or through a cached route.
- Consider removing `force-dynamic` if the only dynamic need is signed-in CTA.

Expected impact:

- Biggest public page speed win.
- Reduces health-check traffic.

### P1: Dashboard Summary

Change:

- Create one API endpoint or Postgres RPC for dashboard summary.
- Return section counts and usage aggregates instead of full rows where possible.

Expected impact:

- Major reduction in Supabase round trips.
- Faster authenticated home.

### P1: API HTTP Connection Reuse

Change:

- Refactor `SupabaseRest` to reuse `httpx.AsyncClient`.
- Keep RLS by setting authorization per request.

Expected impact:

- Lower latency for routes with multiple Supabase calls.
- Lower connection overhead.

### P1: Combine Saved Match + Generate

Change:

- Add one endpoint for "resolve answer":
  - classify question
  - check saved answer
  - if no match, generate answer
- Update popover to call that endpoint for single-field use.

Expected impact:

- Removes one round trip for most single-field generation.
- Simplifies extension state machine.

### P2: Saved Answer Cache

Change:

- Cache the user's saved-answer list briefly in the API.
- Or let extension cache saved answers with an updated-at watermark.

Expected impact:

- Less repeated loading of up to 500 rows.

### P2: Tailoring Poll Backoff

Change:

- Have server response include `retryAfterMs`.
- Client uses tab visibility and server hint to schedule next poll.

Expected impact:

- Lower API load during long tailoring runs.

### P2: Lazy DOCX Preview

Change:

- Do not fetch signed preview URLs or download documents until user opens preview.
- Keep optional prefetch only after user hovers/focuses preview button.

Expected impact:

- Lower Supabase Storage bandwidth.
- Faster ready-page idle work.

### P2: Extension Scan Throttling

Change:

- Replace periodic layout tick with observers where possible.
- Pause scans when hidden.
- Cap automatic sparkle rendering on very large forms.

Expected impact:

- Lower CPU on large ATS pages.

### P3: Cache Tailoring Intermediate Results

Change:

- Cache job analysis and matching by content/version hash.
- Reuse results on retry.

Expected impact:

- Lower LLM cost for retry and repeated jobs.

### P3: Database Aggregation and Index Tuning

Change:

- Use Supabase advisors and EXPLAIN on dashboard, saved-answer, and tailoring list queries.
- Add only verified useful indexes.

Expected impact:

- Better scale as data grows.

## Questions to Ask GPT or a Performance Reviewer

Use this prompt:

```text
I have a product called Ansly: a Next.js web app, browser extension, FastAPI LLM service, and Supabase backend.

The main flows are:
- landing page
- authenticated dashboard/profile
- browser extension field detection and answer generation
- fill-all batch answering
- resume tailoring with DOCX preview/download

Known current implementation:
- Landing page is force-dynamic and blocks on Supabase health + API health checks.
- Dashboard loads full profile sections plus separate counts/usage queries.
- FastAPI Supabase REST wrapper creates a new httpx.AsyncClient for each DB call.
- Extension single-field answer flow calls saved-answer match first, then generate if no match.
- Saved-answer match loads up to 500 saved answers every request.
- Fill-all already has match-batch and generate-batch endpoints.
- Resume tailoring has multi-step LLM pipeline and client polls every 2 seconds while running.
- Ready tailoring page prefetches preview documents from Supabase Storage.
- Extension scans the page DOM and open shadow roots after mutations and has periodic layout ticks.

Please suggest practical ways to improve:
1. page load time,
2. API request count,
3. Supabase query count and database load,
4. LLM token/API cost,
5. extension CPU usage,
6. resume tailoring latency.

Prioritize changes by impact and implementation effort. Include what metrics I should capture before and after each change.
```

## Suggested Metrics Dashboard

Track these before making large changes:

| Area | Metric | Target Direction |
| --- | --- | --- |
| Landing | TTFB | Down |
| Landing | LCP | Down |
| Dashboard | Supabase calls per load | Down |
| Dashboard | Server render duration | Down |
| Extension | DOM scan duration | Down |
| Extension | fields scanned per page | Informational |
| Extension | time to first answer | Down |
| Answers API | Supabase calls per answer | Down |
| Answers API | deterministic answer rate | Up |
| Answers API | tokens per answered question | Down |
| Saved answers | rows loaded per match | Down |
| Tailoring | total pipeline duration | Down |
| Tailoring | LLM calls per tailoring | Down |
| Tailoring | tokens per tailoring | Down |
| Tailoring | polls per tailoring | Down |
| Storage | preview/download signed URL calls | Down |

## Release-Safe Optimization Order

1. Add timing logs and lightweight metrics.
2. Move landing status checks off the render path.
3. Add dashboard summary endpoint/RPC.
4. Reuse FastAPI HTTP clients.
5. Combine saved match + generate for single-field answering.
6. Add saved-answer caching.
7. Tune tailoring polling.
8. Lazy-load DOCX preview assets.
9. Optimize extension scanning.
10. Add verified indexes and tailoring intermediate caches.

This order keeps behavior mostly unchanged while reducing the most obvious unnecessary load first.
