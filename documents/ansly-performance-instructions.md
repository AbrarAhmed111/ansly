You are a senior full-stack performance engineer, Next.js optimization expert, FastAPI/Python backend engineer, PostgreSQL/Supabase performance specialist, browser-extension performance engineer, and LLM systems architect.

I need you to perform a COMPLETE performance optimization of my application, **Ansly**.

The goal is not small cosmetic optimization.

I want you to systematically make the product feel **extremely fast** across:

- initial page loading
- navigation
- dashboard loading
- database reads
- API calls
- API response times
- Supabase queries
- authentication/session checks
- browser extension performance
- AI answer generation
- saved-answer matching
- fill-all generation
- resume tailoring
- background processing
- DOCX preview/download
- frontend rendering
- bundle size
- network requests
- perceived performance
- server-side processing
- LLM calls
- token usage
- repeated requests
- caching

The application consists of:

- Next.js web application
- React
- browser extension
- FastAPI Python LLM/backend service
- Supabase PostgreSQL
- Supabase Auth
- Supabase Storage
- LLM APIs
- resume tailoring pipeline
- DOCX generation/preview

## PRIMARY OBJECTIVE

Optimize the application so that:

1. Pages appear almost immediately whenever technically possible.
2. Navigation feels instant.
3. API request count is minimized.
4. API responses are as fast as possible.
5. Supabase round trips are minimized.
6. Duplicate database queries are eliminated.
7. Repeated network calls are cached/deduplicated safely.
8. AI answers begin and finish significantly faster.
9. Users receive visible feedback immediately when AI generation starts.
10. LLM calls and token consumption are minimized without reducing answer quality.
11. Resume tailoring completes faster.
12. The extension uses minimal CPU on large job/application pages.
13. Unnecessary work should never happen before the user actually needs it.
14. Expensive work should be cached/reused where correctness allows.
15. Performance improvements MUST NOT break existing functionality, authentication, RLS, user isolation, data correctness, or security.

---

# IMPORTANT WORKING RULE

Do NOT simply give me optimization suggestions.

Inspect the repository and IMPLEMENT the improvements.

Work through the codebase systematically.

Before changing something:

- understand how the current flow works
- identify its bottleneck
- identify unnecessary calls/work
- determine whether caching, batching, deduplication, parallelization, lazy loading, streaming, indexes, query aggregation, or architectural changes would improve it

After changing something:

- verify functionality
- verify TypeScript/Python correctness
- run applicable builds/tests/lint/type checks
- check for regressions
- explain the performance impact

Do not rewrite the entire architecture unnecessarily.

Prefer high-impact, low-risk changes first.

---

# PHASE 1 — PERFORMANCE INSTRUMENTATION

Before performing deeper optimization, add lightweight instrumentation where useful.

Measure at least:

## Web

- landing page server-render duration
- TTFB where measurable
- dashboard load duration
- dashboard database/API call count
- resume list load time
- resume-detail initial load time
- preview fetch duration
- preview render duration

## API

For important routes record:

- total request duration
- Supabase call count
- total Supabase time
- slowest Supabase operation
- LLM call count
- LLM model
- LLM request duration
- input tokens
- output tokens
- cache hit/miss
- deterministic-answer hit/miss

Avoid logging sensitive user content.

Use lightweight structured timing logs rather than introducing unnecessary heavy observability infrastructure.

## Extension

Measure:

- field scan duration
- number of DOM nodes/candidates scanned
- detected field count
- time from user click → answer request
- time to first answer
- full answer duration
- fill-all duration
- fill-all first completed item
- saved-answer cache hits

Performance logging should preferably be disabled or reduced in production unless needed.

---

# PHASE 2 — LANDING PAGE

Inspect:

`web/src/app/page.tsx`

Current problem:

The landing page is dynamically rendered and performs live Supabase/API health checks in the critical rendering path.

Remove external health checks from the initial page rendering path.

The marketing landing page should preferably be statically rendered / CDN cacheable.

Do NOT make anonymous visitors wait for:

- Supabase health
- API health
- unnecessary auth calls

Possible implementation:

- statically render marketing content
- move status checking into a small client component
- load status after first paint
- cache health status for approximately 30–120 seconds
- alternatively move status to a dedicated status panel/page
- personalize signed-in CTA separately without forcing the entire page dynamic

Goal:

Initial HTML must arrive without waiting for backend health checks.

Optimize for:

- TTFB
- FCP
- LCP

---

# PHASE 3 — NEXT.JS FRONTEND PERFORMANCE

Audit the entire Next.js application.

Look for:

- unnecessary `force-dynamic`
- unnecessary `no-store`
- unnecessary client components
- oversized `"use client"` boundaries
- duplicate requests
- serial fetching that can run in parallel
- unnecessary hydration
- large JS bundles
- components loaded before they are needed
- expensive rendering
- unnecessary rerenders
- unnecessary state
- large third-party libraries
- repeated Supabase calls
- missing Suspense boundaries
- missing loading states
- opportunities for dynamic imports
- opportunities for route/layout caching
- poor image/font loading
- waterfalls between server/client requests

Optimize using appropriate Next.js capabilities.

Prefer server components where interactivity is not required.

Keep client components small.

Use:

- `Promise.all()` where requests are truly independent
- request memoization
- dynamic imports
- lazy loading
- Suspense
- route caching
- revalidation
- prefetching only where useful
- stale-while-revalidate patterns where appropriate

Do NOT blindly cache user-sensitive data globally.

Any authenticated cache MUST preserve user isolation.

---

# PHASE 4 — DASHBOARD

Inspect:

`web/src/app/(app)/dashboard/page.tsx`

The current dashboard loads many profile tables separately and then performs additional queries for counts/statistics.

This can result in approximately 10–11 Supabase requests for one page.

Reduce this dramatically.

Implement a dashboard summary architecture.

Prefer either:

### Option A

A PostgreSQL/Supabase RPC such as:

`dashboard_summary()`

### Option B

A backend endpoint such as:

`GET /api/v1/profile/summary`

It should return only data required by the dashboard, such as:

- profile completeness information
- section counts
- saved-answer count
- weekly usage grouped by type
- master resume availability
- ready tailoring count

Do not download entire rows merely to calculate counts in JavaScript.

Perform aggregation inside PostgreSQL where appropriate.

Avoid exact counts where exactness is unnecessary.

Consider short user-scoped caching around 10–30 seconds where appropriate.

Target:

Turn ~11 calls into approximately 1–3 calls.

---

# PHASE 5 — FASTAPI HTTP CONNECTION REUSE

Inspect:

`llm/src/app/db/rest.py`

The current Supabase REST wrapper creates a new:

`httpx.AsyncClient`

for individual DB operations.

Fix this.

Use connection pooling.

Prefer one appropriately configured shared `httpx.AsyncClient` per application process.

Configure sensible:

- connect timeout
- read timeout
- keep-alive pool
- max connections
- max keep-alive connections

User-specific JWT/authorization must still be applied PER REQUEST.

Never leak one user's token into another user's request.

Implement proper FastAPI lifespan startup/shutdown handling where appropriate.

Reuse TCP/TLS connections.

This optimization is high priority.

---

# PHASE 6 — DATABASE / SUPABASE QUERY REDUCTION

Audit every major API route.

For each route determine:

- number of Supabase calls
- whether queries are sequential
- whether queries can be combined
- whether data is unnecessarily fetched
- whether only selected columns are needed
- whether aggregation belongs in PostgreSQL
- whether repeated reads can be cached
- whether writes can be batched

Avoid:

`select *`

unless genuinely needed.

Prefer narrow projections.

Avoid fetching hundreds of rows to perform a simple aggregate in Python/JavaScript.

Batch compatible inserts.

Use RPCs where they eliminate multiple network calls.

---

# PHASE 7 — DATABASE INDEX AUDIT

Examine migrations and actual queries before adding indexes.

Evaluate indexes for patterns such as:

`usage_events(user_id, created_at DESC, kind)`

`saved_answers(user_id, updated_at DESC)`

`resume_tailorings(user_id, created_at DESC)`

`resume_tailorings(user_id, status, created_at DESC)`

and a useful master-resume lookup such as:

`resumes(user_id, is_master)`

possibly with a partial index where appropriate.

DO NOT add indexes blindly.

Check:

- existing indexes
- query shapes
- cardinality
- EXPLAIN/EXPLAIN ANALYZE where possible
- Supabase advisors if available

Avoid duplicate or low-value indexes because excessive indexes increase write cost.

---

# PHASE 8 — AI SINGLE-ANSWER GENERATION

This is one of the highest-priority user-facing flows.

Current behavior is roughly:

User requests answer

→ saved answer matching request

→ wait

→ if no result

→ generation request

→ profile fetch

→ limit checks

→ LLM generation

→ response

This creates unnecessary latency.

Redesign the single-field API to resolve everything through ONE request.

For example:

`POST /answers/resolve`

or extend:

`POST /answers/generate`

with something like:

`prefer_saved_answer: true`

Server flow:

1. Normalize/classify question.
2. Check deterministic rules.
3. Check cached/saved answer.
4. If appropriate saved answer exists, return immediately.
5. Otherwise use cached profile context.
6. Generate only if necessary.
7. Return answer.

The extension should NOT normally make:

`matchSaved`

followed by:

`generate`

as two sequential network requests.

Goal:

One user action → one API request.

---

# PHASE 9 — AI GENERATION SPEED

Make AI generation feel significantly faster.

Audit every step that occurs BEFORE the LLM request.

Minimize pre-LLM latency.

Check:

- authentication validation
- rate-limit calls
- profile loading
- job context loading
- saved-answer matching
- prompt construction
- unnecessary database writes
- usage-event writes
- model selection

Do independent operations concurrently.

Do not make the user wait for analytics writes when they can safely happen after response processing.

Where safe, move non-critical writes outside the critical answer latency path.

However:

Do not create unreliable fire-and-forget work in serverless environments if it risks data loss.

Use reliable implementation patterns compatible with the deployment architecture.

---

# PHASE 10 — STREAMING AI RESPONSES

Investigate whether single-answer generation can use streaming.

If the frontend UX can support it cleanly:

- begin showing generated text as soon as model tokens arrive
- use SSE / streaming response / provider-native streaming
- show immediate loading state before first token
- allow the answer field to update progressively

Measure:

- request initiated → first model token
- request initiated → complete response

Prioritize reducing time-to-first-token.

Do NOT implement streaming if it makes the system unreliable or significantly complicates deterministic/saved answers.

Saved/deterministic answers should still return instantly.

---

# PHASE 11 — PROFILE CONTEXT CACHE

Currently single-answer generation may repeatedly rebuild/fetch profile context.

Add short user-scoped profile caching.

Potential TTL:

30–60 seconds.

Cache key should be tied to:

- user ID
- profile version / updated timestamp where available

Invalidate or naturally expire after profile changes.

Never serve another user's profile.

Consider a small bounded TTL/LRU structure if running in process.

If deployment has multiple server instances, treat this only as an opportunistic cache unless using shared infrastructure.

The system must remain correct after a cache miss.

---

# PHASE 12 — SAVED ANSWER MATCHING

Current behavior may fetch as many as 500 saved answers repeatedly.

Optimize it.

Possible strategy:

- cache saved answers per user for 30–120 seconds
- invalidate after saved answer create/update/delete
- use an updated-at/version watermark
- optionally allow the extension to maintain a short local cache
- classify the question before matching
- filter candidates by category when confidence is sufficient

Do not perform expensive semantic/vector infrastructure unless measurements show it is necessary.

For small datasets, fast in-memory comparison is fine.

For larger datasets, consider:

- PostgreSQL trigram index
- full-text search
- embeddings/vector matching

only when justified by actual data.

---

# PHASE 13 — AI ANSWER CACHE

Implement safe answer reuse for exact/repeated requests.

Potential cache key:

hash(
user_id,
normalized_question,
style,
profile_version,
job_context_hash,
answer_generation_version
)

Use a suitable short TTL.

Do not reuse answers if user/profile/job context changed.

Do not return stale cached answers for questions whose response depends on changing context.

Instrument cache hit/miss rate.

---

# PHASE 14 — DETERMINISTIC ANSWERS

Expand deterministic handling for common application questions where an LLM adds no value.

Examples may include:

- authorization-to-work questions
- sponsorship questions
- relocation availability
- notice period
- salary formatting when source data is explicit
- yes/no logistics
- common choice/dropdown questions
- known profile facts
- location information
- standardized application fields

ONLY answer deterministically where the value is explicitly supported by profile/user data.

Never invent personal facts.

This should reduce:

- latency
- tokens
- LLM requests
- cost

---

# PHASE 15 — FILL-ALL PERFORMANCE

The fill-all feature already batches requests.

Inspect and improve it further.

Ensure:

- profile is loaded only once
- saved answer matching is batched
- deterministic questions are resolved before the LLM
- remaining questions are grouped intelligently
- one model request handles multiple compatible questions
- unnecessary context is not repeated
- usage events are inserted in bulk
- UI updates progressively as batches complete

Current batch size should be evaluated rather than blindly increased.

Measure model latency versus batch size.

Optimize for fastest useful perceived completion rather than purely minimizing request count.

The first few answers should appear quickly instead of waiting for the entire batch when practical.

---

# PHASE 16 — LLM PROMPT OPTIMIZATION

Audit all prompts.

Reduce unnecessary prompt tokens.

Remove:

- repeated instructions
- duplicated profile context
- excessive examples
- fields irrelevant to a particular question
- verbose system text that does not improve answer quality

For answer generation include only relevant profile sections.

For example:

If a question is about skills, don't inject unrelated long project/history sections unless needed.

If about education, prioritize educational context.

Create compact structured context.

Preserve answer quality and factual grounding.

Record before/after:

- average input tokens
- average output tokens
- generation duration
- answer quality/regression checks

---

# PHASE 17 — MODEL ROUTING

Inspect whether every question currently uses the same model.

If multiple models are available, design safe model routing.

Use cheaper/faster models for simple questions.

Use stronger models only for questions requiring complex reasoning or resume rewriting.

Do NOT reduce quality just for speed.

Potential tiers:

### Tier 0
No model:
- deterministic answer
- saved answer
- exact cache

### Tier 1
Fast model:
- common application questions
- short summaries
- simple rewrites

### Tier 2
Higher-quality model:
- complex job-specific answers
- resume tailoring
- nuanced transformations

Keep routing simple and measurable.

---

# PHASE 18 — RESUME TAILORING

Inspect:

- `llm/src/app/api/routes/jobs.py`
- `llm/src/app/api/routes/tailorings.py`
- `llm/src/app/resume/pipeline.py`
- analysis
- matching
- planning
- validation
- rendering

Measure every stage independently.

Record:

- analyzing duration
- matching duration
- tailoring duration
- validation duration
- rendering duration
- LLM requests per stage
- tokens per stage
- storage duration

Identify independent work that can execute concurrently.

Do not parallelize stages that logically depend on each other.

---

# PHASE 19 — TAILORING INTERMEDIATE CACHE

Avoid repeating expensive LLM work.

Cache job analysis by something like:

`job_content_hash + analysis_version`

Cache match analysis by:

`resume_id + resume_version + job_context_id + pipeline_version`

Cache tailoring plan where safe using:

`resume version + job hash + relevant profile hash + pipeline version`

Retries of the same job/resume combination should reuse previous successful intermediate work where correctness allows.

Version caches explicitly so pipeline/prompt changes do not accidentally reuse incompatible data.

---

# PHASE 20 — TAILORING POLLING

The client currently polls frequently while tailoring is active.

Improve this.

The server should optionally return:

`retryAfterMs`

Example strategy:

- approximately 1s during initial startup
- approximately 2s while actively progressing
- approximately 5s after a longer wait
- slower when blocked
- stop when complete/error

Pause polling when:

`document.visibilityState === "hidden"`

Resume when visible.

Avoid creating multiple polling loops.

Deduplicate requests.

Do not poll when the job already reached a terminal state.

If the architecture makes SSE or another push mechanism clearly superior and deployment-safe, evaluate it, but do not introduce architectural complexity solely for novelty.

---

# PHASE 21 — DOCX PREVIEW

Do NOT download DOCX preview assets immediately when tailoring becomes ready.

Lazy load them.

Ideal behavior:

Tailoring becomes ready

→ page shows ready state

→ no document download yet

→ user clicks Preview

→ obtain/reuse signed URL

→ load renderer

→ fetch document

→ render preview

Optionally preload after Preview button hover/focus if measurements justify it.

Cache signed URLs until close to expiry.

Avoid repeatedly requesting signed URLs for the same document.

Goal:

Users who only click Download should not pay the preview bandwidth/performance cost.

---

# PHASE 22 — BROWSER EXTENSION CPU PERFORMANCE

Inspect:

- `extension/src/components/content/App.tsx`
- field scanning
- detection
- job detection
- DOM observers
- shadow-root traversal
- layout measurement

The extension currently scans large DOM areas and has periodic layout work.

Optimize aggressively while maintaining accurate field detection.

Replace frequent full-document scans where possible with incremental scans.

MutationObserver should inspect relevant changed nodes rather than repeatedly rescanning everything.

Use where appropriate:

- MutationObserver
- ResizeObserver
- IntersectionObserver
- requestAnimationFrame
- debouncing
- batching

Avoid continuous fixed-interval polling unless necessary.

Pause expensive extension activity when:

`document.hidden === true`

Cache page/job detection based on something similar to:

`location.href + document.title + relevant DOM signature`

Avoid repeatedly reading huge `document.body.innerText`.

---

# PHASE 23 — EXTENSION FIELD DETECTION

Optimize field discovery.

Prefer scanning:

- forms
- visible inputs
- textareas
- selects
- relevant contenteditable elements
- nearby label structures

before traversing the entire document.

Avoid processing irrelevant hidden DOM.

Consider maximum automatically decorated field count on enormous forms.

Allow Fill All to discover additional fields if necessary.

Avoid attaching excessive event listeners per field.

Prefer delegation when appropriate.

Clean observers/listeners when components unmount or SPA pages change.

---

# PHASE 24 — FRONTEND PERCEIVED PERFORMANCE

Even when work cannot technically finish instantly, the product should FEEL responsive.

For user-triggered AI generation:

Immediately show:

- loading indicator
- skeleton/state
- "Generating…" UI
- streaming text when available

Do not freeze the UI.

Optimistically open the answer panel before the request completes.

For navigation:

- use loading UI
- Suspense
- prefetch strategically
- maintain previous cached content during refresh where appropriate

Avoid blank pages during data revalidation.

---

# PHASE 25 — REQUEST DEDUPLICATION

Create or improve a reusable request cache/deduplication mechanism.

If multiple components request the same resource simultaneously:

Only one network request should execute.

Other callers should await the same in-flight promise.

Use TTL/SWR behavior where appropriate.

Pay particular attention to:

- profile
- resume list
- tailoring details
- job context
- signed URLs
- status
- saved-answer metadata

Do not allow unbounded cache growth.

---

# PHASE 26 — CLIENT CACHING

Review existing cache implementation:

`web/src/lib/cache.ts`

Improve it where justified.

Use stale-while-revalidate where useful.

For example:

Return recent cached dashboard/resume data immediately.

Refresh in background.

Update UI only if fresh data differs.

Avoid duplicate updates.

Use explicit invalidation after mutations.

Do not hide stale critical state from users.

---

# PHASE 27 — API RESPONSE PAYLOADS

Inspect response sizes.

Do not send data the UI doesn't use.

Create lightweight DTOs.

For lists:

Return summaries.

Fetch detail only when opened.

Do not include giant job descriptions, profile structures, raw LLM metadata, or document metadata in every list response unless required.

Consider pagination for potentially large collections.

---

# PHASE 28 — COMPRESSION AND HTTP

Check deployment configuration for:

- Brotli/gzip
- HTTP keep-alive
- CDN caching
- static asset immutable caching
- proper cache headers
- ETags where useful

Do not cache personalized/authenticated responses publicly.

---

# PHASE 29 — JAVASCRIPT BUNDLE OPTIMIZATION

Analyze frontend bundle size.

Identify large dependencies.

Lazy-load libraries used only for:

- DOCX preview
- complex editors
- analytics
- resume tools
- modals
- settings
- non-critical dashboard widgets

Do not send DOCX parsing/rendering code in the initial application bundle if it is only used after Preview.

Check for duplicate libraries and unnecessarily broad imports.

---

# PHASE 30 — REACT RENDER PERFORMANCE

Inspect high-frequency extension and web components.

Look for:

- unstable object/function props
- excessive context updates
- large state objects
- unnecessary effect reruns
- repeated expensive calculations
- missing memoization where measurements justify it
- stale closures
- unnecessary DOM reads/writes

Avoid adding `useMemo`/`useCallback` everywhere blindly.

Optimize real hotspots.

---

# PHASE 31 — DATABASE WRITES

Review analytics/usage events.

Do not make every AI response wait unnecessarily for several logging inserts.

Batch compatible events.

Minimize database writes generated by polling.

Never write an analytics event simply because a status endpoint was polled unless required.

Do not duplicate usage records.

---

# PHASE 32 — AUTH PERFORMANCE

Audit authentication calls.

Avoid repeatedly calling Supabase Auth for the same request/navigation if trusted framework/session context already exists and using it remains secure.

Do not weaken authentication.

Do not bypass RLS.

Do not expose service-role credentials to frontend code.

Performance improvement must NOT reduce security.

---

# PHASE 33 — CONCURRENCY

Find sequential operations like:

```ts
const a = await getA()
const b = await getB()
const c = await getC()
```

when they are independent.

Convert to:

```ts
const [a, b, c] = await Promise.all([
  getA(),
  getB(),
  getC(),
])
```

Do the same in Python using:

`asyncio.gather()`

only where operations are genuinely independent.

Do not parallelize operations with ordering dependencies.

---

# PHASE 34 — TIMEOUTS / RETRIES

Audit retry behavior.

Avoid retry storms.

Configure sensible:

- connection timeout
- API timeout
- model timeout
- exponential backoff
- jitter where appropriate

Do not retry non-idempotent operations blindly.

Avoid extremely long hanging requests.

---

# PHASE 35 — FAILURE FAST

For AI requests validate cheap failures before expensive work.

Examples:

- malformed request
- invalid field
- unsupported request
- missing required context
- quota unavailable

But avoid unnecessary database calls when deterministic logic can answer first.

Order checks intelligently.

---

# PHASE 36 — MEMORY / PROCESS CACHE SAFETY

If implementing in-memory cache:

- use TTL
- use maximum size
- avoid memory leaks
- never rely on local memory as durable storage
- never assume cache exists across deployments
- maintain correctness after restart
- key authenticated data by user
- avoid storing unnecessary sensitive text

---

# PHASE 37 — PERFORMANCE BUDGETS

Try to establish realistic targets.

For example:

Landing page:
- static/edge served where possible
- no external API dependency in initial render

Dashboard:
- dramatically fewer DB round trips
- warm/cached load should feel near-instant

Saved answer:
- ideally <100–300ms server/network dependent when cache hit

Deterministic answer:
- no LLM latency

Generated answer:
- minimize pre-model overhead
- lowest practical TTFT
- stream where appropriate

Extension:
- normal scans should not visibly affect page scrolling/input

Tailoring:
- reduce repeated LLM stages
- cache retries
- minimize unnecessary polling

Do not fake performance metrics.

Measure actual values whenever tools/environment permit.

---

# PHASE 38 — PRIORITY ORDER

Implement roughly in this order unless repository inspection gives a strong reason to change it:

## P0 — Measurement

1. Add timing instrumentation.
2. Capture baseline request counts/latency.

## P1 — Immediate user-visible wins

3. Remove landing-page backend checks from critical rendering path.
4. Reduce dashboard request fan-out.
5. Reuse FastAPI HTTP connections.
6. Merge saved-answer match + generate.
7. Reduce AI pre-processing latency.
8. Add/improve profile caching.
9. Add saved-answer caching.

## P2 — Large load reductions

10. Improve tailoring polling.
11. Lazy-load DOCX previews.
12. Optimize extension DOM scanning.
13. Batch analytics/database writes.
14. Optimize LLM prompts/context.
15. Add safe answer caching.

## P3 — Deeper scalability

16. Cache tailoring intermediate results.
17. Verify/add useful DB indexes.
18. Optimize frontend bundles.
19. Add intelligent model routing if applicable.
20. Improve database aggregation.

---

# DO NOT DO THESE

Do NOT:

- break RLS
- use service role on frontend
- cache one user's information for another user
- blindly add indexes
- blindly add memoization
- blindly convert everything to client-side rendering
- blindly cache authenticated responses
- introduce Redis unless clearly justified
- create giant architectural complexity for a small optimization
- remove functionality just to improve benchmark numbers
- reduce AI answer quality dramatically
- remove truthfulness safeguards
- fake async/background behavior
- silently swallow errors
- add unsafe fire-and-forget work
- make hundreds of unrelated refactors
- change visual design unless necessary for performance
- change public API contracts unnecessarily

---

# CODE QUALITY REQUIREMENTS

All changes should be:

- production-quality
- typed
- maintainable
- readable
- secure
- minimal where possible
- compatible with current architecture

Avoid giant files.

Extract reusable helpers where appropriate.

Add comments only where implementation intent isn't obvious.

---

# VERIFY EVERY MAJOR CHANGE

After implementation run applicable:

```bash
npm run build
npm run lint
npm run typecheck
```

or the repository's equivalent commands.

For Python:

```bash
pytest
ruff check .
mypy .
```

when configured.

Do not assume commands exist.

Inspect `package.json`, `pyproject.toml`, etc. first.

Fix errors introduced by your changes.

Do not "solve" build errors by disabling type checking.

---

# PERFORMANCE REPORT

When finished, give me a detailed report containing:

## 1. Bottlenecks Found

For every significant bottleneck:

- file
- function/component
- previous behavior
- why it was slow

## 2. Changes Implemented

For each change:

- file(s)
- exact optimization
- why it improves performance

## 3. Request Reduction

Estimate/measure changes such as:

Before:
Dashboard → ~11 Supabase calls

After:
Dashboard → ~1–3 calls

Before:
Single answer → saved-match request + generation request

After:
Single answer → one resolve request

## 4. AI Optimization

Report:

- reduced LLM calls
- deterministic paths
- cache paths
- prompt-token reductions
- profile caching
- answer caching
- time-to-first-token improvements if implemented

## 5. Frontend Optimization

Report improvements to:

- TTFB
- LCP
- JS bundle
- unnecessary rendering
- lazy loading
- caching
- request waterfalls

## 6. Extension Optimization

Report:

- scanning changes
- observer changes
- interval removal/reduction
- CPU reductions
- DOM work reductions

## 7. Database Optimization

Report:

- query consolidation
- new RPCs
- indexes added
- indexes considered but intentionally rejected
- aggregation changes

## 8. Tailoring Optimization

Report:

- reduced polling
- cached stages
- model/token reductions
- lazy preview
- pipeline latency changes

## 9. Verification

List:

- build results
- tests
- type checks
- lint
- important manual validation

## 10. Remaining Bottlenecks

Tell me what is still slow and WHY.

Do not pretend every bottleneck can be removed.

---

# IMPORTANT FINAL OBJECTIVE

I want Ansly to behave like a high-performance production SaaS product.

When the user opens a page:

show useful content immediately.

When data has already been fetched:

reuse it.

When multiple components need the same data:

deduplicate the request.

When multiple DB operations can become one:

combine them.

When requests can safely run concurrently:

parallelize them.

When work is not needed yet:

lazy-load it.

When an answer is deterministic:

do not call an LLM.

When an answer already exists:

reuse it.

When profile information was just loaded:

do not fetch it again.

When the same job/resume was analyzed:

reuse the analysis.

When a user does not open DOCX preview:

do not download preview documents.

When the browser tab is hidden:

do not aggressively poll or scan.

When the database can aggregate data:

do not download hundreds of rows and aggregate them in JavaScript.

When an HTTP connection exists:

reuse it.

When the AI begins responding:

show the user output as quickly as possible.

The goal is:

**minimum latency + minimum unnecessary API calls + minimum Supabase load + minimum LLM calls/tokens + minimum extension CPU usage + excellent perceived performance, while preserving security, correctness, answer quality, and all existing product functionality.**

Start by inspecting the repository and creating a short internal bottleneck map.

Then immediately begin implementing the highest-impact safe optimizations.

Do not stop after analysis.

Implement, verify, benchmark where possible, and continue through the priority list.