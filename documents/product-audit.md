# Ansly Product Audit

Date: 2026-10-03

This audit reflects the current repository state across the public site, authenticated web app, browser extension, FastAPI LLM service, Supabase data layer, shared contracts, analytics, and operational tooling.

## Executive Summary

Ansly is an AI job application assistant built around one trust boundary: help the user apply faster, but only from their own profile, resume, saved answers, and facts they explicitly provide.

The product now covers two main workflows:

1. Application answer assistance:
   - Build a structured candidate profile.
   - Detect questions on job application pages.
   - Generate, adapt, save, reuse, review, and fill answers.
   - Ask for missing facts inline instead of inventing unsupported claims.
   - Fill one field or fill many eligible fields together after user review.

2. Resume tailoring:
   - Upload a master Word resume.
   - Analyze a job posting.
   - Match job requirements to profile/resume evidence.
   - Tailor a copy of the user's own Word document.
   - Validate changes against protected fields and evidence.
   - Review diffs, warnings, and download the tailored `.docx`.

The product is intentionally user-controlled. Ansly does not submit applications, does not auto-apply, and does not claim skills or experience that are not present in the user's data.

Current strengths:

- Strong grounding model: structured profile, profile facts, saved answers, resume evidence, deterministic prechecks, and strict prompts.
- Browser extension works as an unpacked Chromium extension for Chrome and Microsoft Edge.
- Extension supports field detection, choice-field filling, contenteditable filling, right-click answering, keyboard shortcut, site permissions, and job-aware resume tailoring.
- Web app has a full authenticated dashboard, profile editor, saved-answer manager, resume workflow, settings, data import/export, extension setup, and privacy page.
- Supabase RLS protects user-owned rows for profile, saved answers, usage, resumes, job contexts, tailorings, candidate evidence, and LLM call logs.
- API uses the user's JWT for profile and product reads, preserving user-scoped access.
- Performance work has been added: answer routing, batching, saved-answer adaptation, job-content hashing, prompt trimming, semantic retrieval fallback, usage/cost accounting, dashboards, and benchmark scripts.

Main release risks:

- Live ATS QA still matters. Generic DOM detection is broad, but sites like Workday, Greenhouse, Lever, Ashby, LinkedIn, Indeed, and custom embedded forms can behave differently.
- LLM costs now have instrumentation, but production limits and alerting still need active monitoring.
- Resume tailoring depends on `.docx` structure. Very complex Word files may parse or map imperfectly.
- The extension must be rebuilt and reloaded after env or UI changes. Store publishing is optional, but unpacked personal use has manual steps.
- Some docs in `README.md` still reference older audit paths in status text and may need a docs pass.

## Repository Map

| Area | Path | Purpose |
| --- | --- | --- |
| Web app | `web/` | Next.js public site, auth, dashboard, profile, answers, extension setup, resume tailoring, settings |
| Extension | `extension/` | WXT MV3 browser extension for Chrome, Edge, and configured Firefox build targets |
| API / LLM | `llm/` | FastAPI service for answers, saved-answer matching, profile facts, jobs, resumes, tailorings, metrics |
| Shared types | `packages/types/` | Cross-workspace TypeScript contracts for API, database, bridge, resume, job, tailoring |
| Design tokens | `packages/design/` | Shared design primitives and theme tokens |
| Supabase | `supabase/` | SQL migrations, RLS, storage bucket rules, migration tests, analytics SQL |
| Documents | `documents/` | Product plans, phase docs, and audits |

## Product Version Boundary

The README describes V1 as implemented, with V1.1 fill-all / ask-and-learn work in progress. The codebase also contains V1.2 resume tailoring functionality and performance/accounting work.

Implemented product areas:

- Public landing page.
- Email/password auth through Supabase.
- Candidate profile.
- Saved answers.
- Playground answer testing.
- Browser extension connection flow.
- Extension popup and site controls.
- In-page field detection and answer popover.
- Fill-all panel.
- Ask-and-learn missing information flow.
- Master resume upload and parsing.
- Resume discrepancy review.
- Job analysis.
- Resume tailoring pipeline.
- Tailoring history, preview, diff review, and download.
- Settings for theme, export/import, enabled sites, and resume page limit.
- Usage, token, LLM call, and application analytics.

Still out of scope:

- Job board or job discovery feed.
- Application tracker.
- Automated application submission.
- Autonomous browser agent.
- Resume auto-upload to external ATS pages.
- Cover-letter document generation as a separate product.
- Interview preparation.

## Public Web Pages

### Landing Page: `/`

Source: `web/src/app/page.tsx`

Purpose:

- Explains Ansly as a browser extension for job applications.
- Shows the product promise: fill applications faster without inventing experience.
- Routes visitors to signup or signed-in users to dashboard.
- Links to "How it works" with smooth scrolling.
- Shows DevAbby attribution and product branding.
- Displays system status sourced from the web status API.

Key notes:

- The hero centers on answer generation and truthfulness.
- The page uses Supabase/API status checks.
- It is the public positioning surface, not the main product workspace.

### Login / Signup: `/login`

Source: `web/src/app/login/page.tsx`

Purpose:

- Email/password sign-in and sign-up through Supabase Auth.
- Supports `mode=signup`.
- Supports safe `next` redirect handling.
- Stores signup name in user metadata.
- Shows onboarding copy and privacy link.

Current product behavior:

- New signup/login flow includes owner-access messaging for extension access.
- Sign-up can redirect to `/profile/personal` when a session is immediately available.

### Privacy: `/privacy`

Source: `web/src/app/privacy/page.tsx`

Purpose:

- Privacy policy surface for web and extension listing needs.
- Documents key privacy claims around local detection, user approval, and data handling.

### Error / Not Found

Sources:

- `web/src/app/error.tsx`
- `web/src/app/not-found.tsx`

Purpose:

- App-level recovery for unexpected errors and missing routes.

## Authenticated Web App

Protected app routes live under `web/src/app/(app)` and are wrapped by `web/src/app/(app)/layout.tsx`.

The layout:

- Requires an authenticated Supabase user.
- Redirects unauthenticated users to `/login`.
- Wraps pages in the shared `AppShell`.

### Dashboard: `/dashboard`

Source: `web/src/app/(app)/dashboard/page.tsx`

Purpose:

- Main authenticated overview.
- Guides the user to strengthen profile data.
- Surfaces usage, token usage, resume state, saved answers, and extension setup.

Key functionality:

- Loads dashboard data through `loadDashboard`.
- Computes profile completeness from profile signals.
- Shows profile section status and quick links.
- Shows last-7-days usage:
  - generated answers
  - filled fields
  - saved answers reused
  - resumes tailored
- Shows AI usage via `TokenUsage`.
- Shows whether a master resume exists.
- Links to resume tailoring, playground, saved answers, and extension setup.

### Profile: `/profile`, `/profile/personal`, `/profile/[section]`

Sources:

- `web/src/app/(app)/profile/page.tsx`
- `web/src/app/(app)/profile/personal/page.tsx`
- `web/src/app/(app)/profile/[section]/page.tsx`
- `web/src/components/section-editor.tsx`
- `web/src/lib/sections.ts`

Purpose:

- Stores the user's factual candidate profile.
- Provides the grounding data for answers and resume tailoring.

Personal profile fields:

- Full name.
- Headline.
- Email.
- Phone.
- Location.
- Summary.
- Links.
- Work authorization.
- Sponsorship.
- Notice period.
- Salary expectation.
- Willingness to relocate.
- Preferred work mode.
- Additional free-form context.
- Resume page limit setting is stored on the profile and edited in settings.

Structured sections:

- Experiences.
- Projects.
- Skills.
- Education.
- Achievements.

Important behavior:

- Section CRUD uses sheets/forms.
- Rows are user-owned through Supabase RLS.
- Skills support level `none`, meaning "I do not have this skill"; this helps answer skill yes/no questions truthfully.
- Additional context is treated as user-provided truth and can be used by answers and tailoring.

### Playground: `/playground`

Source: `web/src/app/(app)/playground/page.tsx`

Purpose:

- Lets users test answer generation without opening an application form.

Key functionality:

- Generate a profile-grounded answer from a question.
- Add optional job context:
  - company
  - role
  - job description
  - character limit
- Regenerate with style/length/tone adjustments.
- Save edited answers as preferred saved answers.
- Copy answers.
- Shows confidence, category, provider/model, and used sources.
- Handles insufficient-information responses by sending users back to profile sections.

### Saved Answers: `/saved-answers`

Source: `web/src/app/(app)/saved-answers/page.tsx`

Purpose:

- Manage reusable answers for repeated application questions.

Key functionality:

- Search saved answers.
- Add, edit, delete, copy.
- Track category, company, role, use count, and last use.
- API save path classifies questions when possible.
- Saved answers can be reused as-is or adapted to the current job by the API/extension.

### Extension Setup: `/extension`

Source: `web/src/app/(app)/extension/page.tsx`

Purpose:

- Detect whether the extension is installed.
- Connect/disconnect the extension to the user's account.

Flow:

1. Web page sends `ANSLY_PING`.
2. Extension web bridge replies with status.
3. If disconnected, user enters credentials.
4. Web creates a separate extension Supabase session.
5. Web sends tokens through `ANSLY_CONNECT`.
6. Extension stores the session.
7. Web shows connected state.

Important architecture:

- The extension has a separate Supabase session. This avoids Supabase refresh-token rotation conflicts with the web app session.

### Resume Home: `/resume`

Source: `web/src/app/(app)/resume/page.tsx`

Purpose:

- Main resume tailoring workspace.
- Shows master resume state and tailoring history.

Key functionality:

- Loads master resume and tailoring list in parallel.
- Shows parse status and version.
- Warns if the master is an older PDF.
- Links to upload/replace/review parsed resume.
- Links to discrepancy review when resume/profile differences exist.
- Lists tailored resumes with status, review, download, and delete actions.
- Warms tailoring detail cache on hover/focus.

### Upload Resume: `/resume/upload`

Sources:

- `web/src/app/(app)/resume/upload/page.tsx`
- `web/src/app/(app)/resume/upload/upload-resume.tsx`

Purpose:

- Upload and register the user's master resume.

Key functionality:

- Accepts Word `.docx` files for new master resumes.
- Uploads to Supabase Storage.
- Registers the resume through the API.
- Parses the resume to structured JSON.
- Lets the user review and save parsed content.
- Supports replacing the master resume.

Important behavior:

- Existing older PDF resume rows can remain readable, but new uploads are DOCX-only.

### Resume Discrepancies: `/resume/discrepancies`

Source: `web/src/app/(app)/resume/discrepancies/page.tsx`

Purpose:

- Shows differences between parsed resume data and profile data.
- Lets users decide what to keep.

Key functionality:

- Lists discrepancy items.
- Lets the user apply or dismiss individual differences.
- Saves corrected structured resume content.

### Tailor Resume: `/resume/tailor`

Sources:

- `web/src/app/(app)/resume/tailor/page.tsx`
- `web/src/app/(app)/resume/tailor/tailor-form.tsx`

Purpose:

- Start tailoring from a pasted job description or prefilled job context.

Key functionality:

- Creates/analyzes job context when needed.
- Starts tailoring.
- Redirects to `/resume/[tailoringId]`.

### Tailoring Detail: `/resume/[tailoringId]`

Source: `web/src/app/(app)/resume/[tailoringId]/page.tsx`

Purpose:

- Poll, review, preview, download, retry, or delete a tailoring.

Key functionality:

- Polls status with backoff/retry delay from API.
- Shows pipeline progress.
- Shows match requirements, diffs, warnings, unsupported requirements, and validation issues.
- Supports previewing tailored/original files.
- Downloads the tailored DOCX via signed URL.
- Deletes a tailoring and its tailored document.

### Settings: `/settings`

Source: `web/src/app/(app)/settings/page.tsx`

Purpose:

- Account, appearance, extension site management, resume length, export, and import.

Key functionality:

- Shows signed-in user.
- Sign out.
- Theme toggle.
- Enabled-sites management for the extension.
- Resume page limit: 1, 2, or 3 pages.
- Export profile, saved answers, resume details, and tailoring history as JSON.
- Optionally include parsed/tailored resume text in export.
- Import Ansly JSON export.

## Web API Routes

### `/auth/callback`

Source: `web/src/app/auth/callback/route.ts`

Purpose:

- Completes Supabase auth callback and redirects safely.

### `/auth/signout`

Source: `web/src/app/auth/signout/route.ts`

Purpose:

- Signs out the user and redirects.

### `/api/status`

Source: `web/src/app/api/status/route.ts`

Purpose:

- Provides web-side status checks for public/status UI.

## Browser Extension

Source root: `extension/`

Framework:

- WXT.
- React.
- Manifest V3.
- Builds for Chrome and Edge:
  - `pnpm --filter @ansly/extension build`
  - `pnpm --filter @ansly/extension build:edge`

### Popup

Sources:

- `extension/src/entrypoints/popup/App.tsx`
- `extension/src/entrypoints/popup/Sites.tsx`
- `extension/src/entrypoints/popup/style.css`

Purpose:

- Toolbar control center.

Displayed state:

- Brand and version.
- Connection state.
- Profile summary and completeness.
- System status.
- Active-site permission/enablement controls.

Settings:

- Show Ansly on application forms.
- Disable/enable current site.
- Use job descriptions.
- Usage analytics.
- Review before fill.
- Overwrite filled fields.
- Offer resume tailoring.
- Theme.
- Keyboard shortcut link.

Footer/actions:

- Copy diagnostics.
- Open privacy.
- Disconnect.

### Background Service Worker

Source: `extension/src/entrypoints/background.ts`

Purpose:

- Owns extension session.
- Calls API.
- Handles permissions, context menus, keyboard commands, and web-open actions.

Message handlers:

- `generate`
- `resolve`
- `regenerate`
- `matchSaved`
- `saveAnswer`
- `useSaved`
- `track`
- `generateBatch`
- `matchSavedBatch`
- `saveMissing`
- `getProfileValues`
- `getConnection`
- `getProfileSummary`
- `connect`
- `disconnect`
- `openWebApp`
- `getSites`
- `removeSite`
- `enableSite`
- `getMasterResume`
- `analyzeJob`
- `startTailoring`
- `getTailoring`
- `downloadTailoring`

Special behavior:

- Fallback for older API deployments without `/answers/resolve`.
- Context menu item: "Answer with Ansly".
- Keyboard shortcut: `generate-answer`.
- Dynamic site permission registration.
- Startup permission reconciliation.
- On install, opens web `/extension`.

### Web Bridge Content Script

Source: `extension/src/entrypoints/web-bridge.content.ts`

Purpose:

- Runs on the configured web app origin.
- Bridges web page messages and extension background.

Messages:

- `ANSLY_PING`
- `ANSLY_CONNECT`
- `ANSLY_DISCONNECT`
- `ANSLY_STATUS`
- `ANSLY_CONNECTED`

Security:

- Checks source and origin.
- Only runs on configured web origin.

### In-Page Content App

Sources:

- `extension/src/entrypoints/content/index.tsx`
- `extension/src/components/content/App.tsx`
- `extension/src/components/content/Popover.tsx`
- `extension/src/components/content/Panel.tsx`
- `extension/src/components/content/TailorCard.tsx`
- `extension/src/components/content/MissingForm.tsx`
- `extension/src/components/content/styles.ts`

Purpose:

- Injected product UI on application/job pages.

High-level behavior:

- Loads settings and subscribes to updates.
- Detects job pages and application fields.
- Renders field-level Ansly buttons.
- Shows answer popover for one field.
- Shows fill-all panel for batches.
- Shows resume tailoring card on job pages when enabled.
- Uses shadow DOM for CSS isolation.
- Repositions UI on scroll/resize/layout shifts.

### Field Detection

Sources:

- `extension/src/lib/detection/scan.ts`
- `extension/src/lib/detection/classify.ts`
- `extension/src/lib/detection/question.ts`

Detected controls:

- Text inputs.
- Textareas.
- Contenteditable fields.
- Choice groups and native/select-like controls where supported by classification/fill logic.

Skipped or ignored examples:

- Hidden fields.
- Disabled/read-only fields.
- Personal identity fields such as name, email, phone, address, URLs.
- Search boxes.
- Unsupported short fields.
- Sensitive demographic categories.

Question extraction:

- `aria-labelledby`.
- Labels.
- `aria-label`.
- Surrounding text.
- Fieldset legends.
- Placeholder.
- Humanized name/id.

Dynamic behavior:

- Mutation observer rescans relevant DOM changes.
- Shadow roots are inspected.
- Geometry helpers keep UI positioned beside fields.

### Filling Behavior

Source: `extension/src/lib/fill.ts`

Supported fill targets:

- Text input.
- Textarea.
- Contenteditable.
- Choice fields.
- Native select.
- Some combobox patterns.

Behavior:

- Uses native setters where possible.
- Dispatches `input` and `change`.
- Verifies final value.
- Supports snapshots and restore/undo in fill-all.
- Respects max-length constraints for text fields.

### Job Detection and Context

Sources:

- `extension/src/lib/job-context.ts`
- `extension/src/lib/job/detect.ts`
- `extension/src/lib/job/generic.ts`
- `extension/src/lib/job/json-ld.ts`
- `extension/src/lib/job/adapters/linkedin.ts`
- `extension/src/lib/job/adapters/indeed.ts`

Purpose:

- Extract job title, company, URL, and optional description.
- Detect pages that are actually job postings.
- Avoid treating generic pages/blogs as jobs.

Known adapters:

- LinkedIn.
- Indeed.
- JSON-LD JobPosting.
- Generic job-page heuristic.

Privacy:

- Job description is included only when the user setting allows it.

### One-Field Answer Popover

Source: `extension/src/components/content/Popover.tsx`

Flow:

1. User clicks Ansly button, keyboard shortcut, or context menu.
2. Popover opens for the target field.
3. Extension calls `resolve`.
4. API returns either:
   - a saved-answer match,
   - an adapted saved answer,
   - a generated answer,
   - or insufficient information.
5. User can edit, restyle, regenerate, save, fill, or close.
6. Fill records duration and edited flag when analytics are enabled.

Additional behavior:

- Shows missing-information form when the API asks for profile data.
- Can open profile/web app paths.
- Can use saved answers and record saved-answer use.
- Provides "answer the rest together" entry point.

### Fill-All Panel

Source: `extension/src/components/content/Panel.tsx`

Purpose:

- Batch-answer many detected fields on an application page.

Key functionality:

- Fetches profile values for deterministic profile fields.
- Sends answerable questions in chunks.
- Uses `/answers/generate-batch`.
- Allows saved-answer matching/adaptation in batch.
- Tracks progress.
- Lets the user review low-confidence/missing answers.
- Fills all or reviewed fields.
- Supports undo snapshots.
- Saves missing info through `/profile/missing`.
- Records `fill_all` usage.

### Resume Tailoring Card

Source: `extension/src/components/content/TailorCard.tsx`

Purpose:

- Offer resume tailoring directly on detected job pages.

Flow:

1. Detect job page.
2. Analyze job.
3. Check master resume state.
4. Start tailoring.
5. Poll status.
6. Show result.
7. Open review in web app or download tailored DOCX.

Important behavior:

- Passes stored `jobContextId` back into answer-generation context so answer usage can be linked to the same job.

## FastAPI LLM Service

Source root: `llm/src/app`

Framework:

- FastAPI.
- Pydantic schemas.
- Async HTTP/Supabase REST helpers.
- Provider gateway with fallback.

### API Router

Source: `llm/src/app/api/router.py`

Main route groups:

- `/health`
- `/api/v1/answers`
- `/api/v1/saved-answers`
- `/api/v1/events`
- `/api/v1/profile`
- `/api/v1/resumes`
- `/api/v1/jobs`
- `/api/v1/tailorings`

### Health

Source: `llm/src/app/api/routes/health.py`

Endpoint:

- `GET /health`

Purpose:

- Shows app status.
- Checks Supabase.
- Shows LLM gateway deployment availability.

### Answers

Source: `llm/src/app/api/routes/answers.py`

Endpoints:

- `POST /api/v1/answers/generate`
- `POST /api/v1/answers/regenerate`
- `POST /api/v1/answers/resolve`
- `POST /api/v1/answers/generate-batch`

Core behavior:

- Authenticates user JWT.
- Applies rate limits.
- Classifies question.
- Retrieves relevant profile context.
- Uses deterministic answers for supported simple questions.
- Uses saved answers where appropriate.
- Adapts saved answers when context differs.
- Uses semantic retrieval fallback when configured.
- Builds compact prompts.
- Calls the LLM gateway with stage labels.
- Parses and validates JSON output.
- Records usage and LLM calls in the background.

Answer optimization features:

- `answer_stage` routing for simple vs complex answers.
- Batch generation for fill-all.
- Saved-answer adaptation instead of unnecessary full generation.
- Job description digesting.
- Compact candidate evidence formatting.
- Optional embedding-backed candidate evidence table.
- Token budget constants by task stage.

### Saved Answers

Source: `llm/src/app/api/routes/saved_answers.py`

Endpoints:

- `POST /api/v1/saved-answers/match`
- `POST /api/v1/saved-answers/match-batch`
- `POST /api/v1/saved-answers`
- `POST /api/v1/saved-answers/{id}/use`

Behavior:

- Similarity match against user's saved answers.
- Batch match for fill-all.
- Create saved answer with classification.
- Increment use count and last-used timestamp.
- Record usage.

### Profile Missing Info

Source: `llm/src/app/api/routes/profile.py`

Endpoint:

- `POST /api/v1/profile/missing`

Purpose:

- Saves facts Ansly asked for inline.

Supported writes:

- Profile fields.
- Skills, including "none".
- Free-form profile facts.

### Usage Events

Source: `llm/src/app/api/routes/events.py`

Endpoint:

- `POST /api/v1/events`

Tracked public events include:

- `fill`
- `fill_all`
- `use_saved_answer`
- `job_detected`
- `resume_previewed`

Additional event fields:

- Category.
- Provider/stage where relevant.
- Duration.
- Edited flag.
- Job key and job context where backend-provided.

Privacy:

- Usage events do not store question or answer text.

### Jobs

Source: `llm/src/app/api/routes/jobs.py`

Endpoint:

- `POST /api/v1/jobs/analyze`

Purpose:

- Analyze a job posting.
- Extract title/company/location/requirements.
- Store or reuse a job context.

Performance behavior:

- Uses content hash to reuse matching analysis for the same user/job content.
- Records `job_analyzed` usage, tokens, LLM calls, and job key.

### Resumes

Source: `llm/src/app/api/routes/resumes.py`

Endpoints:

- `POST /api/v1/resumes`
- `GET /api/v1/resumes`
- `GET /api/v1/resumes/master`
- `PATCH /api/v1/resumes/{resume_id}`
- `POST /api/v1/resumes/{resume_id}/master`
- `DELETE /api/v1/resumes/{resume_id}`

Purpose:

- Register uploaded master resumes.
- Parse resumes to structured JSON.
- List resume versions.
- Return current master with discrepancies.
- Update parsed content.
- Promote a version to master.
- Delete resume versions and files.

### Tailorings

Source: `llm/src/app/api/routes/tailorings.py`

Endpoints:

- `POST /api/v1/tailorings`
- `GET /api/v1/tailorings`
- `GET /api/v1/tailorings/{tailoring_id}`
- `GET /api/v1/tailorings/{tailoring_id}/files`
- `GET /api/v1/tailorings/{tailoring_id}/download`
- `DELETE /api/v1/tailorings/{tailoring_id}`

Purpose:

- Start, poll, preview, download, list, and delete resume tailorings.

Pipeline:

1. Analyze job.
2. Match requirements to candidate evidence.
3. Plan tailored changes.
4. Apply changes to structured resume.
5. Validate evidence/protected fields.
6. Render tailored DOCX from the user's original Word document.
7. Store output file.

Concurrency:

- Tailoring step lease columns prevent duplicate workers from processing the same step simultaneously.

### LLM Gateway

Sources:

- `llm/src/app/gateway/*`
- `llm/src/app/core/pricing.py`
- `llm/src/app/core/token_budget.py`
- `llm/src/app/core/llm_usage.py`

Purpose:

- Route requests through configured providers.
- Support fallback.
- Attach provider/model/stage metadata.
- Track token usage, cached tokens, thinking tokens, duration, TTFT, cost, and request IDs.

Supported provider families in code/config:

- OpenAI-compatible providers.
- Anthropic.
- Google/Gemini style providers.
- Groq/OpenRouter-like routing depending on env configuration.

## Resume Tailoring Engine

Source root: `llm/src/app/resume`

Important modules:

- `analysis/analyze.py`: job analysis.
- `matching/match.py`: requirement/candidate matching.
- `matching/select.py`: prompt evidence selection.
- `tailoring/plan.py`: tailored-change planning.
- `tailoring/apply.py`: apply plans to structured resume.
- `validation/validate.py`: deterministic validation.
- `validation/review.py`: LLM-assisted review.
- `docx/*`: Word document parsing/editing/mapping/integrity.
- `pipeline.py`: orchestrates the workflow.

Current product guarantee:

- The model does not directly edit the Word file.
- AI proposes structured changes.
- Code applies validated changes.
- Protected fields and unsupported claims are checked.
- Output is a tailored copy; the master remains unchanged.

## Supabase Data Layer

Source: `supabase/migrations`

### Core Profile Tables

- `profiles`
- `experiences`
- `projects`
- `skills`
- `education`
- `achievements`
- `saved_answers`
- `usage_events`

Security:

- RLS enabled.
- User-owned policies.
- Anonymous access revoked from product tables.

### Ask-And-Learn

Migration: `20261003000000_profile_facts.sql`

Adds:

- `profile_facts`
- Skill level `none`
- `fill_all` usage event kind

Purpose:

- Store user-provided missing facts.
- Support truthful "I do not have this skill" answers.

### Resume Tailoring

Migration: `20261004000000_resume_tailoring.sql`

Adds:

- `resumes`
- `job_contexts`
- `resume_tailorings`
- `resumes` storage bucket
- Storage RLS policies
- Tailoring usage event kinds

Follow-up migrations add:

- Tailoring metrics.
- DOCX-only new resume upload enforcement.
- Additional profile context.
- Tailoring step leases.
- Dashboard summary function.
- Job content hash.

### Candidate Evidence / Semantic Retrieval

Migration: `20261011000000_candidate_evidence.sql`

Adds:

- `candidate_evidence`
- vector embeddings through `extensions.vector(768)`
- `match_candidate_evidence(...)`

Purpose:

- Optional semantic retrieval fallback without storing raw profile text in the vector table.

Security:

- RLS enabled.
- Own-row policies.
- Function is granted only to authenticated users.

### Usage Accounting

Migrations:

- `20261011010000_job_token_usage.sql`
- `20261012000000_llm_call_accounting.sql`

Adds:

- `usage_events.job_key`
- `usage_events.job_context_id`
- `usage_events.llm_calls`
- `usage_events.edited`
- `resume_tailorings.tokens`
- `resume_tailorings.llm_calls`
- `llm_calls`
- `job_token_usage` view
- `application_usage` view

Purpose:

- Attribute model cost and latency by job, stage, provider, model, and usage pattern.
- Analyze where token/cost load comes from.

Security:

- `llm_calls` is RLS protected.
- Views use `security_invoker = true`.

### Rate Limiting

Migration: `20261002010000_rate_limit.sql`

Adds:

- `rate_limit_hits`
- `check_rate_limit(max_hits, window_seconds)`

Purpose:

- Authenticated per-user burst limiting.

Security:

- RLS enabled on hits table.
- Function execution restricted to authenticated role.

### Analytics SQL

Sources:

- `supabase/analytics/tailoring_metrics.sql`
- `supabase/analytics/application_usage.sql`

Purpose:

- Owner-run queries for tailoring, token, cost, latency, cache, stage, and quality signals.

## Shared Type Contracts

Source: `packages/types/src`

Key contracts:

- `api.ts`: answer, saved answer, events, missing info.
- `database.ts`: Supabase row shapes.
- `bridge.ts`: web-to-extension bridge.
- `resume.ts`: structured resume and resume API types.
- `job.ts`: job analysis API types.
- `matching.ts`: requirement matching types.
- `tailoring.ts`: tailoring plan/status/detail/download types.
- `progress.ts`: progress/polling helpers.
- `fields.ts`: detected-field types.
- `completeness.ts`: profile completeness model.

Value:

- Keeps web, extension, and API behavior aligned.
- Makes extension/browser code safer around API changes.

## End-To-End Flows

### New User Flow

1. User signs up in web app.
2. User is guided to complete personal profile.
3. User fills structured sections.
4. User uploads a master DOCX resume when ready.
5. User opens `/extension`.
6. User connects extension session.
7. User enables Ansly on selected job/application sites.

### One Answer Flow

1. Content script detects an eligible question.
2. User clicks Ansly or uses shortcut/context menu.
3. Popover opens.
4. Background calls `/answers/resolve`.
5. API checks saved answers and generation path.
6. User reviews/edits.
7. User clicks Fill.
8. Extension fills the field and records analytics if enabled.
9. User submits manually.

### Fill-All Flow

1. User opens panel for a form.
2. Extension collects eligible fields.
3. Deterministic profile values are fetched.
4. Batch answer request is sent.
5. Saved answers may be reused/adapted.
6. Missing info prompts appear for unsupported questions.
7. User reviews.
8. Extension fills selected/all fields.
9. Usage event records `fill_all`.

### Ask-And-Learn Flow

1. API returns insufficient information with structured missing items.
2. Extension shows inline form.
3. User answers missing questions.
4. Extension saves through `/profile/missing`.
5. Answer generation retries with new facts.
6. Future questions can use the saved information.

### Resume Tailoring Flow

1. User uploads master DOCX.
2. API parses and stores structured resume JSON.
3. User confirms or fixes parsed content.
4. Extension or web app analyzes a job.
5. User starts tailoring.
6. API pipeline matches, plans, validates, renders.
7. User reviews tailored result in web app.
8. User downloads tailored DOCX.

### Extension Site Permission Flow

1. Popup identifies the active domain.
2. User grants host permission.
3. Background registers site.
4. Content script injects into open tabs.
5. Settings page can remove enabled sites.

## Privacy And Safety Posture

Implemented controls:

- Detection runs locally.
- Job description sharing is opt-in.
- Extension only sends data when user asks for answer/match/save/fill/tailor actions.
- Usage analytics avoid question and answer text.
- Resume files are private in Supabase Storage.
- Product tables use RLS.
- API reads user data with the user's token.
- User reviews answers before filling.
- User submits applications manually.
- Model prompts instruct refusal when unsupported.
- Deterministic checks handle common high-risk cases such as skills and logistics.
- Resume tailoring validates protected fields, unsupported technologies, metrics, traceability, and document-safety issues.

Risk areas:

- LLM outputs still require user review.
- Some ATS forms can misclassify fields or block script-driven filling.
- Contenteditable/rich text editors vary widely.
- Semantic retrieval depends on embedding provider configuration and vector availability.
- Resume parsing/tailoring quality depends on DOCX structure.
- Extension session tokens are stored in extension storage.

## Performance And Cost Controls

Implemented:

- Batch answer generation.
- Saved-answer match batching.
- Saved-answer adaptation instead of full generation.
- Deterministic answer routing for simple/logistics/choice cases.
- Job description digesting.
- Compact prompts and evidence selection.
- Token budgets by stage.
- Job analysis reuse through content hash.
- Candidate evidence semantic retrieval fallback.
- Provider usage/cost logging.
- Application-level usage rollups.
- Dashboard token usage.
- Benchmark scripts:
  - `llm/scripts/benchmark_tokens.py`
  - `llm/scripts/benchmark_retrieval.py`
  - `llm/scripts/benchmark_live.py`
  - `llm/scripts/eval_answers.py`

Recommended next improvements:

- Add production alerts for p90 latency, p90 cost, failed calls, and unpriced calls.
- Monitor per-stage model costs from `application_usage`.
- Tune saved-answer matching thresholds from production outcomes.
- Cache repeated profile context reads where safe.
- Add rate-limit dashboards by user and route.
- Track extension-side field detection precision from diagnostics without storing sensitive text.

## Testing Coverage

Root scripts:

- `pnpm check`
- `pnpm test`
- `pnpm --filter @ansly/web typecheck`
- `pnpm --filter @ansly/extension typecheck`
- `pnpm --filter @ansly/extension test`
- `pnpm --filter @ansly/llm test`
- `pnpm --filter @ansly/supabase test`

Covered areas:

- Extension detection, runtime, fill behavior, job detection, job context, popup/content workflows.
- LLM answer engine, auth, config, endpoints, gateway, performance, fill-all, evidence/accounting, token reduction.
- Resume API, parsing, schema, tailoring engine, DOCX tailoring.
- Supabase migrations, RLS isolation, storage policies, dashboard summaries, job hashes, LLM call accounting, analytics queries.
- Web typechecking and unit tests where present.

Known test note:

- Extension tests may print a React `act(...)` warning in one controlled-field fill test while still passing.

## Deployment And Personal Use

Web:

- Deploy `web/` to Vercel or another Next.js host.
- Set Supabase and API environment variables.

LLM API:

- Deploy `llm/` to a Python host.
- Configure Supabase URL/key and model provider keys.
- Verify `GET /health`.

Extension:

- For Chrome personal use:
  - `pnpm --filter @ansly/extension build`
  - Load `extension/.output/chrome-mv3` unpacked.
- For Microsoft Edge personal use:
  - `pnpm --filter @ansly/extension build:edge`
  - Load `extension/.output/edge-mv3` unpacked.

No store publishing fee is required for personal unpacked use.

Operational reminders:

- Rebuild extension after changing `.env`, API URL, web URL, popup UI, or content script code.
- Reload the unpacked extension in `chrome://extensions` or `edge://extensions`.
- Apply Supabase migrations before using new schema-dependent features.
- Production Supabase Auth redirect URLs must include deployed web callback URL.

## Current Gaps

Product gaps:

- No job-search/discovery experience.
- No application tracker.
- No automatic resume upload to ATS sites.
- No cover-letter document workflow.
- No team/admin access model.
- No billing/subscription system.

Extension gaps:

- ATS-specific adapters are limited.
- Generic field detection needs live QA on more sites.
- Disabled/enabled site UX is split across popup and settings.
- Extension updates require manual reload for unpacked installs.

Resume gaps:

- DOCX parsing can struggle with highly custom layouts.
- Preview fidelity depends on browser rendering and document complexity.
- Older PDFs remain legacy records but cannot be used for new tailoring.

Backend/performance gaps:

- Semantic retrieval is optional and depends on embedding env/provider.
- Production model pricing table must be kept current.
- Cost/latency monitoring is available but not automated as alerts.
- Cache invalidation strategy for profile/evidence data should be monitored.

Security/privacy gaps to keep reviewing:

- Extension host permissions should remain as narrow as possible.
- Storage signed URLs should stay short-lived.
- Any new views should use `security_invoker = true`.
- Any new public tables should enable RLS before grants.

## Recommended Next Steps

1. Run full `pnpm check` after any release candidate.
2. Do live QA on LinkedIn, Indeed, Workday, Greenhouse, Lever, Ashby, and custom company forms.
3. Build a small release checklist for web/API/env/Supabase/extension reload.
4. Add production dashboards or alerts using `application_usage` and `llm_calls`.
5. Validate real DOCX resumes with varied layouts before advertising resume tailoring broadly.
6. Improve docs around V1/V1.1/V1.2 naming so README and product docs stay consistent.
7. Keep user-review gates in place for both answers and tailored resume changes.
