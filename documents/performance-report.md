# Ansly Performance Report

Date: 2026-10-03

What was changed in response to [ansly-performance-instructions.md](ansly-performance-instructions.md), building on [performance-audit.md](performance-audit.md). Numbers below are request and round-trip counts read from the code. Latency was not measured against production; every API request now logs a `perf` line (see §9) to capture real before/after numbers once deployed.

## Deploy checklist

1. Apply the migrations `20261009000000_dashboard_summary.sql` and `20261010000000_job_content_hash.sql`. Until then the code falls back to the old queries.
2. Deploy the API before (or with) the extension. A newer extension still works against an older API: `/answers/resolve` falls back to match-then-generate.
3. Rebuild and reload the extension.

## 1. Bottlenecks found

| Where | Before | Why it was slow |
| --- | --- | --- |
| `web/src/app/page.tsx` | `force-dynamic`, `auth.getUser()` + Supabase health + API health on every render | First byte waited on three external calls; no CDN caching |
| `web/src/middleware.ts` | `auth.getUser()` on every request, public pages included | One Supabase Auth round trip per navigation (plus another in the app layout) |
| `web/src/app/(app)/dashboard/page.tsx` | 7 profile queries, **then** 5 more (2 rounds, ~12 calls), up to 5,000 token rows counted in JS | Waterfall, full-row downloads for counts |
| `llm/src/app/db/rest.py`, `storage.py` | New `httpx.AsyncClient` per DB call | New TCP/TLS connection per query |
| `llm/src/app/gateway/adapters.py` | New OpenAI/Anthropic SDK client per LLM call | New provider connection per call; clients never closed |
| `llm/src/app/answers/profile_context.py` `fetch_profile_data` | Profile + up to 6 sections fetched **one after another** | Up to 7 sequential round trips before every answer |
| `llm/src/app/api/routes/answers.py` | Rate limit → daily count → profile, in sequence | 3+ round trips before the model |
| Extension popover | `matchSaved`, then `generate` | Two API round trips per field |
| `answers/similarity.py` `best_match` | Re-classified every saved question on every match | CPU: up to 500 × N classifications per request |
| `answers/engine.py` `complete_batch` | 10-question chunks run one after another | Fill all waited for each model call in turn |
| `resume/pipeline.py` `fetch_profile_rows`, step reads | Sequential reads | Extra round trips per tailoring step |
| `/jobs/analyze` | New row + LLM analysis every time | Re-tailoring the same posting repeated the analysis |
| Tailoring polling (web + extension) | Fixed 2 s, also in hidden tabs | On Vercel, polls run the steps: 2 s idle between work windows; needless polls elsewhere |
| Tailoring ready page | Downloaded both DOCX files + logged `resume_previewed` on every view | Bandwidth and a misleading metric for users who only download |
| `web/src/lib/docx-preview.ts` | `load()` with `maxAge = 0` | Each later call re-fetched `/files` and both documents |
| `extension/src/lib/detection/scan.ts` | Full `querySelectorAll('*')` walk for shadow roots, twice per scan; rescans on any mutation | CPU on large ATS pages; continuous churn could starve the debounce so no scan ran |
| `extension/src/components/content/App.tsx` | 700 ms `setInterval` re-render with `getBoundingClientRect` per field | Constant work on idle pages |

## 2. Changes implemented

**API (FastAPI)**
- `core/http.py`: one pooled `httpx.AsyncClient` per event loop (recreated when the loop changes, which is safe on serverless), with connect/read timeouts and keep-alive limits. `SupabaseRest` and `SupabaseStorage` attach the user's JWT **per request**; the shared client holds no credentials. Idempotent reads retry once on a stale pooled connection. The client is closed in the FastAPI lifespan.
- `gateway/adapters.py`: SDK clients cached per deployment and event loop.
- `answers/profile_context.py`: profile sections fetched in parallel; per-user TTL cache (30 s), dropped by `/profile/missing`.
- `answers/saved.py`: saved-answer list cached per user (30 s), dropped on create/use. `similarity.py` caches per-question features (LRU 4096).
- `answers/engine.py`: exact-answer cache (10 min) keyed by user, request, the exact profile rows used, and a hash of the system prompt. Regenerate never uses it. Deterministic answers for one-line logistics fields (`logistics_text`). Batch chunks run concurrently (up to 3).
- `api/routes/answers.py`: new `POST /answers/resolve`. Saved match, burst limit, daily count and profile are read concurrently. The burst limit only applies if an answer is generated; the daily limit only if the model is called. Usage events are inserted in bulk.
- `answers/prompt.py`: job description scaled per question type (none for logistics, 30% for skill/education checks).
- `api/routes/tailorings.py`: `retryAfterMs` on polls; the job title is read alongside pipeline work.
- `resume/pipeline.py`: parallel reads in every step. Matching reuses an earlier run's matches when resume version, job, pipeline version **and** the rebuilt evidence corpus are identical.
- `api/routes/jobs.py`, `resume/analysis/analyze.py`: `job_content_hash` (prompt + exactly what the analysis reads) lets the same posting reuse its analysis.
- `core/metrics.py` + middleware: one structured `perf` log line per API request.

**Web (Next.js)**
- Landing page is static. The signed-in CTA is resolved in the browser (`components/signed-in.tsx`); status loads after paint from `/api/status` (ISR, 60 s, 5 s timeout per check).
- Middleware skips public pages and uses `auth.getClaims()` (local JWT verification). The app layout uses claims instead of `getUser()`.
- Dashboard: `lib/dashboard.ts` calls the `dashboard_summary()` RPC, falling back to the old reads (now fully parallel) if the migration isn't applied. Completeness is computed from aggregate signals (`completenessFromSignals`).
- Tailoring page: follows `retryAfterMs`, slows to 10 s in hidden tabs (unless polls are running the steps) and polls immediately when the tab is shown again. The preview is fetched on Preview hover/focus/open only; documents are cached for the session.

**Extension**
- Popover: one `resolve` request per field.
- Fill all: profile values and saved matches requested in parallel; generation sent as concurrent 10-question chunks so rows fill in as each returns.
- Scanner: relevance-filtered mutations, debounce with a 1 s max wait, paused in hidden tabs, incremental shadow-root discovery (full walk at most every 5 s, or on interaction inside an unknown shadow root), single root walk per scan. Watches `open`/`inert` (dialogs).
- Layout: `ResizeObserver` + scroll/resize/transition/animation events replace the 700 ms interval.
- Job-page checks skip hidden tabs.
- Tailor card follows `retryAfterMs` and the hidden-tab rules.
- LinkedIn Easy Apply: fields inside an open `<dialog>` are no longer treated as hidden because the surrounding app is `aria-hidden`; the resume file picker is skipped.

**Database**
- `dashboard_summary(token_window_days)`: `security invoker`, explicit `user_id` filters, aggregates in Postgres, token use pre-bucketed into 15-minute windows (the browser still sums by local day in any time zone).
- `job_contexts.content_hash` + partial index `(user_id, content_hash)`.

## 3. Request reduction

| Flow | Before | After |
| --- | --- | --- |
| Landing page, server side | 3 external calls per view | 0 (static); status ≤ 1 check per minute shared by all visitors |
| Any signed-in navigation | 2 Supabase Auth round trips (middleware + layout) | 0 with asymmetric signing keys (local verification) |
| Dashboard | ~12 Supabase calls in 2 rounds | 1 RPC |
| Single answer, extension | 2 API requests; ~5–10 sequential DB round trips | 1 API request; 1 parallel DB round + usage insert |
| Repeated field, same inputs (within 10 min) | Full generation | Cached; no LLM call |
| Fill all (N questions) | Profile → saved match → generation, in sequence; chunks serial | Profile ∥ saved match; chunks concurrent; usage events: N inserts → 1 |
| Tailoring polls on Vercel | 2 s idle between work windows | 250 ms when the next poll runs a step |
| Ready tailoring, user only downloads | `/files` + 2 document downloads + an event | 0 |
| Re-tailoring the same posting | New analysis + new matching | Both reused (matching only if the evidence is identical) |

## 4. AI optimization

- **Fewer LLM calls:** saved matches resolved server-side, before any model work. Exact-answer cache. One-line logistics fields answered from the profile (salary, notice period, work authorization, plus yes/no sponsorship, relocation and work-mode when the wording is unambiguous). Job analysis and matching reused on re-runs.
- **Truthfulness kept:** deterministic answers only use explicit profile values; polarity-ambiguous wording ("Do you have a visa?") still goes to the model. The answer-cache key includes the exact profile rows, so profile edits always regenerate.
- **Tokens:** the job description is omitted for logistics and cut to 30% for skill/education checks (up to ~1,500 input tokens saved per such question when job descriptions are enabled).
- **Routing:** unchanged on purpose. The fastest, cheapest model (`gemini-2.5-flash-lite`) is already first; stronger models are fallbacks.
- **Time to first token:** streaming was not implemented. Answers are validated as a whole (allowed sources, character limit, provider fallback on invalid output), and streaming would show text before those checks. The pre-model latency was cut instead (above).

## 5. Frontend optimization

- **TTFB/LCP:** `/` is prerendered static (`○` in the build) and served without waiting on Supabase or the API.
- **Waterfalls:** the dashboard's two query rounds are now one RPC; signed-in pages lost two Auth round trips.
- **Lazy loading:** the DOCX renderer and documents load only on Preview intent.
- **Caching:** preview documents cached for the session; status shared via ISR.
- **Bundle:** unchanged. `docx-preview` was already a dynamic import; shared first-load JS is 103 kB.

## 6. Extension optimization

- **Scanning:** text-only and unrelated `class`/`style` churn no longer triggers rescans; one root walk per scan instead of two; shadow roots found incrementally.
- **Observers:** `open`/`inert` added; hidden tabs pause scans and job checks and catch up when shown.
- **Interval removal:** the 700 ms layout interval is gone.
- **Fill all:** first answers appear when the first chunk returns, not at the end.

## 7. Database optimization

- **New RPC:** `dashboard_summary`.
- **New column/index:** `job_contexts.content_hash` with a partial index.
- **Indexes considered and rejected (already covered or low value):**
  - `usage_events(user_id, created_at desc, kind)`: `(user_id, created_at desc)` exists; the per-user `kind` filter is cheap.
  - `saved_answers(user_id, updated_at desc)`: per-user rows are few (≤ 500); `user_id` index exists.
  - `resume_tailorings(user_id, status, created_at desc)`: `(user_id, created_at desc)` exists.
  - `resumes(user_id, is_master)`: the partial unique index `resumes_one_master_per_user` already serves it.
- **Aggregation:** counts and weekly usage computed in Postgres.

## 8. Tailoring optimization

- **Polling:** server-paced (`retryAfterMs`: 250 ms / 1 s / 2 s / 4 s), slow in hidden tabs.
- **Cached stages:** job analysis (by content hash) and matching (by identical evidence).
- **Lazy preview:** documents only load on Preview intent.
- **Parallel reads:** used in every step.
- **Pipeline latency on Vercel:** idle gaps between work windows drop from 2 s to 250 ms.

## 9. Verification

- **API:** `pytest` 274 passed (16 new performance tests); `ruff check` clean.
- **Extension:** `vitest` 132 passed (new: watcher relevance, hidden-tab pause, dialogs, late shadow roots, LinkedIn dialog fixture, resume picker, fill-all chunks, resolve popover); `tsc` clean; `wxt build` OK.
- **Web:** `jest` 39 passed; `tsc` and `next lint` clean; `next build` OK (`/` static, `/api/status` ISR 1 m).
- **Supabase:** migration tests 24 passed, including `dashboard_summary` isolation and anon denial.
- **Not done:** live latency benchmarks and live LinkedIn testing.

Reading the `perf` log (API): `route=POST /answers/resolve status=200 total_ms=… db_calls=… db_ms=… db_slowest=select:profiles:…ms llm_calls=… models=… tokens_in=… tokens_out=… cache.profile_hit=…`. Turn it off with `PERF_LOG=false`.

## 10. Remaining bottlenecks

- **Model latency** dominates generated answers. Without streaming, the user waits for the full answer; a streaming design would need incremental validation.
- **In-process caches are per instance.** On Vercel, warm-instance hit rates are unknown until the `perf` logs show them. Redis wasn't added (not justified yet).
- **Web edits to the profile or saved answers** show in the extension after up to 30 s. Writes through the API invalidate immediately.
- **The layout's name/email** come from the JWT, so metadata changes appear after the next token refresh (≤ 1 h).
- **Burst rate limit:** fill-all chunking uses one burst-limit hit per 10 questions (limit 10/minute shared with popovers).
- **Extension bundle:** popup/background are ~0.3–0.5 MB, mostly `tldts` and React. They load from local disk, so this was not prioritized.
- **Tailoring** is still several LLM calls per new job; the truthfulness review and rendering are inherently sequential with planning.
- **Prompt trimming beyond the job description** needs an eval run with provider keys (`llm/evals`) to confirm quality before cutting instructions.
