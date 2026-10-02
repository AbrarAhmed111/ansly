# Ansly Product Audit

Date: 2026-10-02

This audit describes the product as implemented in the repository: the public site, authenticated web app, FastAPI answer service, Supabase data layer, and browser extension flow.

## Executive Summary

Ansly is a V1 AI job application assistant. Its core loop is:

1. User builds a structured profile in the web app.
2. Browser extension detects open-ended questions on job application forms.
3. User clicks the Ansly mark beside a field.
4. Extension checks for a similar saved answer.
5. If none is chosen, the backend generates a profile-grounded answer.
6. User reviews or edits the answer.
7. User clicks Fill; Ansly fills the field and never submits the application.

The product is intentionally not a job board, resume builder, auto-apply tool, or autonomous agent in V1.

Implemented strengths:

- Clear V1 scope: profile-grounded job application answers.
- Separate web, extension, API, design, types, and Supabase workspaces.
- Strong anti-hallucination posture in prompt, prechecks, retrieval, and UI states.
- Extension has generic field detection, saved-answer reuse, review-before-fill, and framework-aware filling.
- Supabase RLS protects user-owned profile rows, saved answers, and usage events.
- API uses the user's JWT for database access, so backend profile reads remain user-scoped.
- Usage analytics avoid storing question or answer text.

Main remaining release gaps:

- Real deployment and Chrome Web Store packaging/listing are still manual.
- Site-specific adapters are intentionally not present yet; real-world QA may uncover ATS-specific issues.
- Extension popup changes require rebuilding/reloading the extension to appear in the browser.
- V2 product areas such as job discovery, matching, alerts, application tracking, resume tailoring, and cover letters are not implemented.

## Repository Map

| Area | Path | Purpose |
| --- | --- | --- |
| Web app | `web/` | Next.js app for landing, auth, dashboard, profile, saved answers, settings, extension setup |
| Extension | `extension/` | WXT Manifest V3 browser extension, content script UI, popup, background API client |
| API / LLM | `llm/` | FastAPI service for answer generation, saved-answer matching, usage events, health |
| Shared types | `packages/types/` | Database, API, bridge, and completeness contracts |
| Design tokens | `packages/design/` | Shared palette, themes, typography, gradients |
| Supabase | `supabase/` | Database migrations, seed files, migration tests |
| Product docs | `documents/` | Product plan, phases, and this audit |

## Product Version Boundary

Current implementation targets V1: "I already found a job. Help me apply."

In V1:

- Detect application questions.
- Generate profile-grounded answers.
- Use optional company, role, and job description context.
- Let the user edit, regenerate, save, and fill answers.
- Reuse preferred answers for similar questions.
- Keep the user in control.

Out of V1:

- Job search.
- Job scraping.
- Job recommendations.
- Job alerts.
- Application tracking.
- Resume builder.
- Cover letter platform.
- Automated submission.
- Autonomous browser operation.
- Interview preparation.

## Public Web Pages

### Landing Page: `/`

Source: `web/src/app/page.tsx`

Purpose:

- Presents Ansly as a browser extension for job applications.
- Explains the truthful, profile-grounded answer loop.
- Shows a product preview of an application field and generated answer.
- Links users to sign up or dashboard depending on auth state.
- Includes sections for "How it works", "Why Ansly", CTA, and system status.

Key functionality:

- Checks Supabase and API health dynamically.
- Detects signed-in user server-side.
- Primary CTA routes to `/dashboard` for signed-in users or `/login?mode=signup` for visitors.
- "See how it works" links to `#how-it-works`; global CSS enables smooth anchor scrolling.
- DevAbby attribution appears below the browser-extension badge.

Notes:

- Landing page imports status from `web/src/lib/status`.
- System status shows Web to Supabase, Web to API, and API to Supabase when available.

### Login / Signup: `/login`

Source: `web/src/app/login/page.tsx`

Purpose:

- Handles email/password sign-in and sign-up through Supabase Auth.
- Provides a polished onboarding/auth surface.

Key functionality:

- Supports `mode=signup`.
- Supports safe redirect via `next`, sanitized by `safeNext`.
- Sign-up stores `full_name` in Supabase user metadata.
- Uses Supabase email confirmation redirect to `/auth/callback`.
- If sign-up immediately creates a session, user is routed to `/profile/personal`.
- Includes privacy link and DevAbby attribution.

### Privacy: `/privacy`

Source: `web/src/app/privacy/page.tsx`

Purpose:

- Privacy policy page for product and extension listing needs.

### Error / Not Found

Sources:

- `web/src/app/error.tsx`
- `web/src/app/not-found.tsx`

Purpose:

- Generic application error handling and 404 recovery.

## Authenticated Web App Shell

Source: `web/src/app/(app)/layout.tsx`

Purpose:

- Protects authenticated routes.
- Redirects unauthenticated users to `/login`.
- Wraps authenticated pages in `AppShell`.

Protected route group:

- `/dashboard`
- `/profile`
- `/profile/personal`
- `/profile/[section]`
- `/playground`
- `/saved-answers`
- `/extension`
- `/settings`

## Authenticated Pages

### Dashboard: `/dashboard`

Source: `web/src/app/(app)/dashboard/page.tsx`

Purpose:

- Main workspace overview.
- Shows profile completeness, weekly activity, profile sections, and quick actions.

Key functionality:

- Loads the complete profile server-side.
- Computes completeness using `profileCompleteness`.
- Displays next incomplete profile step.
- Shows last 7 days usage counts:
  - generated answers: `generate`, `regenerate`
  - filled fields: `fill`
  - saved answers reused: `use_saved_answer`
- Shows saved answer count.
- Links to profile sections, playground, saved answers, and extension setup.

Failure behavior:

- If profile loading fails, shows an error with a migration hint.

### Profile Redirect: `/profile`

Source: `web/src/app/(app)/profile/page.tsx`

Purpose:

- Redirects to `/profile/personal`.

### Personal Profile: `/profile/personal`

Source: `web/src/app/(app)/profile/personal/page.tsx`

Purpose:

- Edits user personal information and application preferences.

Fields:

- Full name.
- Headline.
- Email.
- Phone.
- Location.
- Professional summary.
- Links: LinkedIn, GitHub, website, portfolio, other.
- Work authorization.
- Requires visa sponsorship.
- Notice period / availability.
- Salary expectation.
- Willing to relocate.
- Preferred work mode.

Key functionality:

- Loads profile from Supabase client-side.
- Upserts profile row.
- Shows live preview.
- Tracks unsaved changes.
- Warns on browser unload when dirty.
- Supports `Ctrl/Cmd+S` save.
- Shows floating save bar with discard/save controls.

Product significance:

- Logistics questions are answered only from explicit application preference fields.
- If a logistics preference is blank, the API returns insufficient information rather than guessing.

### Profile Sections: `/profile/[section]`

Sources:

- `web/src/app/(app)/profile/[section]/page.tsx`
- `web/src/components/section-editor.tsx`
- `web/src/lib/sections.ts`

Purpose:

- CRUD for structured profile sections.

Implemented sections:

- Experience.
- Projects.
- Skills.
- Education.
- Achievements.

Common behavior:

- Lists existing rows.
- Adds rows in a sheet.
- Edits rows in a sheet.
- Deletes with confirmation.
- Reorders rows with up/down controls.
- Loads rows ordered by `sort_order` and `created_at`.
- Supports `?new=1` to open the add sheet.

Experience fields:

- Title.
- Company.
- Location.
- Employment type.
- Start/end dates.
- Current role.
- Description.
- Highlights.
- Technologies.

Project fields:

- Name.
- Role.
- URL.
- Repository URL.
- Dates.
- Description.
- Highlights.
- Technologies.

Skills fields:

- Name.
- Category.
- Level.
- Years.

Skills-specific UI:

- Quick-add skill form.
- Grouped board by category.
- Skill proficiency dots.
- Unique skill name constraint per user.

Education fields:

- Institution.
- Degree.
- Field of study.
- Grade.
- Dates.
- Notes.

Achievements fields:

- Title.
- Date.
- URL.
- Description.

### Playground: `/playground`

Source: `web/src/app/(app)/playground/page.tsx`

Purpose:

- Lets users test the same answer engine used by the extension.

Key functionality:

- User enters an application question.
- Optional job context can be expanded:
  - Company.
  - Role.
  - Job description.
  - Character limit.
- Generates answer through API.
- Regenerates with preset tweaks:
  - Shorter.
  - More detailed.
  - More technical.
  - More enthusiastic.
  - More formal.
- Supports custom regeneration instruction.
- Shows confidence, category, provider, and used sources.
- Lets user edit answer.
- Lets user save as preferred answer.
- Lets user copy answer.

Insufficient information behavior:

- Shows a "not enough information" card.
- Links user to add experience, skills, or projects.

### Saved Answers: `/saved-answers`

Source: `web/src/app/(app)/saved-answers/page.tsx`

Purpose:

- Manages preferred answers reused by the extension.

Key functionality:

- Lists saved answers ordered by `updated_at`.
- Search by question, answer, company, or role.
- Add saved answer manually.
- Edit question and answer.
- Delete with confirmation.
- Copy answer.
- Shows category, company/role, and use count.
- Long answers can be expanded/collapsed.
- `?new=1` opens the add sheet.

Save behavior:

- Attempts to save through the API so the question can be classified.
- Falls back to direct Supabase insert if the API is unavailable with a network status.

### Extension Setup: `/extension`

Source: `web/src/app/(app)/extension/page.tsx`

Purpose:

- Detects extension presence and connects an independent extension session.

Key functionality:

- Uses `window.postMessage` bridge messages between web page and extension content script.
- Sends `ANSLY_PING`.
- Receives extension status with version, connected state, and email.
- If extension is installed but disconnected, prompts for email/password.
- Creates a separate Supabase session for the extension using an isolated Supabase client.
- Sends session tokens to the extension through `ANSLY_CONNECT`.
- Supports disconnect via `ANSLY_DISCONNECT`.
- Displays setup steps and connection state.

Important architectural note:

- The extension intentionally receives its own Supabase session. Sharing the web session would conflict with Supabase refresh-token rotation.

### Settings: `/settings`

Source: `web/src/app/(app)/settings/page.tsx`

Purpose:

- Account, theme, profile export, and profile import.

Key functionality:

- Shows signed-in email.
- Sign-out form posts to `/auth/signout`.
- Theme toggle.
- Export full profile and saved answers as JSON.
- Import profile from Ansly JSON export or seed file.
- Drag-and-drop JSON import.
- Validates import plan and shows skipped item errors.
- Imports rows and overwrites personal details from file values.

## Web Auth Routes

### Auth Callback: `/auth/callback`

Source: `web/src/app/auth/callback/route.ts`

Purpose:

- Completes Supabase auth redirects and routes user to safe next page.

### Sign Out: `/auth/signout`

Source: `web/src/app/auth/signout/route.ts`

Purpose:

- Signs out through Supabase and redirects.

## Browser Extension Surfaces

### Extension Popup

Source:

- `extension/src/entrypoints/popup/App.tsx`
- `extension/src/entrypoints/popup/style.css`

Purpose:

- Quick status and settings panel from the browser toolbar.

Displayed state:

- Brand header and extension version.
- Connection state.
- Profile summary:
  - Name or email.
  - Completeness.
- Connect prompt if disconnected.

Settings:

- Enable/disable Ansly on application forms.
- Disable on the current hostname.
- Use job descriptions.
- Usage analytics.
- Theme: system, light, dark.
- Keyboard shortcut link to `chrome://extensions/shortcuts`.

Footer actions:

- Toggle system status.
- Open privacy.
- Disconnect when connected.

System status:

- Extension to Supabase.
- Extension to API.
- API to Supabase.

Notes:

- Popup source changes require rebuilding/reloading the extension bundle in the browser.
- The popup uses design tokens injected from `@ansly/design`.

### Background Service Worker

Source: `extension/src/entrypoints/background.ts`

Purpose:

- Central extension runtime for session, API calls, saved answers, usage tracking, and commands.

Message handlers:

- `generate`: POST `/api/v1/answers/generate`.
- `regenerate`: POST `/api/v1/answers/regenerate`.
- `matchSaved`: POST `/api/v1/saved-answers/match`.
- `saveAnswer`: POST `/api/v1/saved-answers`.
- `useSaved`: POST `/api/v1/saved-answers/{id}/use`.
- `track`: POST `/api/v1/events`, only when analytics setting is enabled.
- `getConnection`: reads local extension session.
- `getProfileSummary`: fetches user profile summary from Supabase.
- `connect`: stores extension session.
- `disconnect`: clears extension session.
- `openWebApp`: opens a safe path under configured web URL.

Other behavior:

- Keyboard shortcut `generate-answer` sends a message to the active tab.
- On extension install, opens the web app extension setup page.

### Web Bridge Content Script

Source: `extension/src/entrypoints/web-bridge.content.ts`

Purpose:

- Runs only on the configured web app origin.
- Bridges `window.postMessage` between the web app and extension background.

Messages:

- Web to extension:
  - `ANSLY_PING`.
  - `ANSLY_CONNECT`.
  - `ANSLY_DISCONNECT`.
- Extension to web:
  - `ANSLY_STATUS`.
  - `ANSLY_CONNECTED`.

Security controls:

- Requires event source to be `window`.
- Requires event origin to equal page origin.
- Requires expected bridge source marker.
- Web origin match is fixed at build time from `WXT_WEB_URL`.

### Content Script App

Source:

- `extension/src/entrypoints/content/index.tsx`
- `extension/src/components/content/App.tsx`
- `extension/src/components/content/Popover.tsx`
- `extension/src/components/content/styles.ts`

Purpose:

- Injects the in-page Ansly UI beside eligible fields.

High-level flow:

1. Load extension settings.
2. Subscribe to settings changes.
3. If enabled for the hostname, scan fields.
4. Render Ansly buttons beside eligible fields.
5. User clicks a button or uses keyboard shortcut.
6. Popover opens for that target field.
7. Popover checks saved answers.
8. Popover generates if needed.
9. User edits, regenerates, saves, fills, or closes.

UI isolation:

- Uses a shadow DOM root so page CSS cannot style Ansly UI.
- Repositions buttons and popover on scroll, resize, and periodic layout shifts.
- Closes popover on outside click.

### Field Detection

Sources:

- `extension/src/lib/detection/scan.ts`
- `extension/src/lib/detection/classify.ts`
- `extension/src/lib/detection/question.ts`

Candidate fields:

- `input`
- `textarea`
- `select`
- `[contenteditable]`

Skipped fields:

- Non-text fields.
- Hidden fields.
- Disabled/read-only fields.
- Selects.
- Input types such as email, phone, password, date, number, file, checkbox, radio, URL, search.
- Personal data fields such as name, email, phone, address, location, LinkedIn, GitHub, portfolio URL.
- Search boxes.
- Short single-line fields that do not clearly ask a question.

Question extraction order:

1. `aria-labelledby`.
2. `<label>`.
3. `aria-label`.
4. Surrounding text.
5. Fieldset legend.
6. Placeholder.
7. Humanized name/id.

Eligible question examples:

- Why...
- Describe...
- Tell us...
- Explain...
- How...
- What makes/excites/interests/motivates...
- Share...
- Give an example...
- Cover letter / additional information style prompts.

Dynamic behavior:

- Uses `MutationObserver` with debounce.
- Watches changes to hidden, style, class, disabled, readonly, aria-hidden, contenteditable, and type attributes.

### Job Context Extraction

Source: `extension/src/lib/job-context.ts`

Purpose:

- Extracts limited context from the application page.

Known behavior from product flow:

- Company and role are included when found.
- Job description is included only when the user opts in through extension settings.
- Full page HTML is not sent.

### Popover Answer Flow

Source: `extension/src/components/content/Popover.tsx`

Initial state:

- `matching`: checks similar saved answers.

Saved answer path:

1. Calls `matchSaved`.
2. If match exists, shows saved answer preview.
3. User can use saved answer or generate a new one.
4. Using saved answer records use count through `useSaved`.

Generation path:

1. Calls `generate` with question, job context, and field metadata.
2. Shows loading state.
3. If answer is returned:
   - Editable textarea.
   - Confidence badge.
   - Source labels.
   - Character count.
   - Regenerate.
   - Save as preferred.
   - Fill.
4. If insufficient information:
   - Shows missing information message.
   - Offers "Add information" link to web app.
5. If error:
   - Shows not connected or generation failure.
   - Offers connect or retry.

Keyboard behavior:

- Escape closes and refocuses the field.
- Ctrl/Cmd+Enter fills when answer is ready.

### Filling Behavior

Source: `extension/src/lib/fill.ts`

Supported fields:

- Text inputs.
- Textareas.
- Contenteditable fields.

Text input and textarea behavior:

- Uses native prototype value setter where available.
- Dispatches `input` and `change` events.
- Respects `maxLength` by truncating before fill.
- Verifies filled value.

Contenteditable behavior:

- Focuses field.
- Selects existing content.
- Attempts `document.execCommand('insertText')`.
- Falls back to `textContent`.
- Dispatches `input` and `change`.
- Verifies filled value.

Product guarantee:

- Ansly fills only after user clicks Fill.
- Ansly does not submit applications.

## API / LLM Service

Base structure:

- FastAPI app in `llm/src/app`.
- API routes under `/api/v1`.
- Health route at `/health`.

### Health

Source: `llm/src/app/api/routes/health.py`

Endpoint:

- `GET /health`

Returns:

- App status.
- App name.
- Environment.
- Supabase status.
- LLM gateway deployment counts.
- Deployment details outside production.

### Generate / Regenerate Answers

Source:

- `llm/src/app/api/routes/answers.py`
- `llm/src/app/answers/engine.py`
- `llm/src/app/answers/prompt.py`
- `llm/src/app/answers/profile_context.py`
- `llm/src/app/schemas/answers.py`

Endpoints:

- `POST /api/v1/answers/generate`
- `POST /api/v1/answers/regenerate`

Request fields:

- `question`.
- Optional `job_context`:
  - company.
  - role.
  - description.
  - url.
- Optional `field`:
  - label.
  - maxLength.
  - kind.
- Regenerate adds:
  - previous_answer.
  - instruction.

Response fields:

- `status`: `answered` or `insufficient_information`.
- `answer`.
- `confidence`.
- `usedSources`.
- `missingInformation`.
- `category`.
- `intent`.
- `provider`.
- `model`.

Answer pipeline:

1. Authenticate Supabase JWT.
2. Apply burst rate limit.
3. Apply daily generation limit.
4. Classify question.
5. Fetch relevant profile rows via Supabase REST using user token.
6. Build structured profile context.
7. Run deterministic prechecks.
8. Build prompt with strict grounding rules.
9. Call LLM gateway with provider fallback.
10. Parse and validate structured JSON answer.
11. Record usage event.

Precheck behavior:

- Empty profile returns insufficient information.
- Logistics questions require explicit profile preferences.
- Skill-check questions require the asked skill to appear in fetched profile corpus.
- If a target skill is missing, the model receives an explicit "not in profile" warning.

Prompt rules:

- Use only facts in candidate profile.
- Job context is employer/role context, not candidate facts.
- If unsupported, return `insufficient_information`.
- Yes/no answers say yes only when supported.
- First-person, natural, concise, plain prose.
- Respect character limits.
- Return exact JSON shape.

### Saved Answers API

Source: `llm/src/app/api/routes/saved_answers.py`

Endpoints:

- `POST /api/v1/saved-answers/match`
- `POST /api/v1/saved-answers`
- `POST /api/v1/saved-answers/{answer_id}/use`

Behavior:

- Match loads recent saved answers and uses similarity scoring.
- Create classifies question if category is not provided.
- Use increments `use_count` and sets `last_used_at`.
- Create/use record usage events.

### Usage Events API

Source: `llm/src/app/api/routes/events.py`

Endpoint:

- `POST /api/v1/events`

Allowed kinds:

- `fill`
- `use_saved_answer`

Privacy note:

- Usage events store kind, category, provider where relevant, and timestamp.
- They do not store question text or answer text.

## LLM Gateway

Sources:

- `llm/src/app/gateway/*`

Purpose:

- Routes generation through configured providers and deployments.
- Supports fallback when providers fail or are unavailable.
- Health exposes deployment counts.

Provider families referenced by docs:

- Gemini.
- Groq.
- OpenAI.
- Anthropic.
- Mistral.
- Cerebras.
- Cohere.
- OpenRouter.

## Supabase Data Model

Sources:

- `supabase/migrations/20261002000000_profile_schema.sql`
- `supabase/migrations/20261002010000_rate_limit.sql`

### Tables

`profiles`

- One row per user.
- Personal details, summary, links, and application preferences.
- Created automatically by `handle_new_user`.

`experiences`

- Role history.
- Includes company, title, location, type, dates, description, highlights, technologies.

`projects`

- Product/open-source/side project entries.
- Includes URLs, dates, description, highlights, technologies.

`skills`

- Skill list.
- Category, level, years.
- Unique per user by lowercase skill name.

`education`

- Institution, degree, field, dates, grade, description.

`achievements`

- Title, date, URL, description.

`saved_answers`

- Preferred answers.
- Question, answer, category, optional company/role.
- Use count and last-used timestamp.

`usage_events`

- Product analytics and limits.
- Kind, category, provider, timestamp.
- No question or answer text.

`rate_limit_hits`

- Internal table for shared per-user burst limiting.

### RLS

Enabled tables:

- `profiles`
- `experiences`
- `projects`
- `skills`
- `education`
- `achievements`
- `saved_answers`
- `usage_events`
- `rate_limit_hits`

Policies:

- Authenticated users can read/insert/update/delete only their own section and saved-answer rows.
- Users can read and insert their own usage events.
- Anonymous role is revoked from product tables.
- `rate_limit_hits` is not directly accessible to anon or authenticated users.

### Rate Limiting

Function:

- `public.check_rate_limit(max_hits, window_seconds)`

Behavior:

- Security definer function.
- Requires authenticated `auth.uid()`.
- Deletes old hits outside the window.
- Uses advisory transaction lock per user.
- Inserts a hit or returns seconds to wait.

## Shared Type Contracts

Sources:

- `packages/types/src/api.ts`
- `packages/types/src/bridge.ts`
- `packages/types/src/database.ts`
- `packages/types/src/completeness.ts`

Purpose:

- Keep web, extension, and API aligned.

Important contracts:

- Answer API request/response.
- Job context.
- Field context.
- Saved answer matching and creation.
- Usage event tracking.
- Web-to-extension session bridge.
- Extension status payload.
- Database row types.
- Profile completeness model.

## End-to-End Extension Flow

### Setup Flow

1. User signs into web app.
2. User opens `/extension`.
3. Web app posts `ANSLY_PING`.
4. Extension web bridge replies with status if installed.
5. If installed but disconnected, user enters password.
6. Web app creates a separate Supabase session.
7. Web app sends `ANSLY_CONNECT` with extension session.
8. Extension stores session.
9. Extension replies `ANSLY_CONNECTED` and then `ANSLY_STATUS`.
10. `/extension` shows connected state.

### Application Page Flow

1. Content script loads on matching web pages.
2. Settings determine whether Ansly is enabled on the current hostname.
3. DOM scanner finds candidate fields.
4. Classifier filters to eligible open-ended fields.
5. Ansly button appears beside each eligible field.
6. User clicks button.
7. Popover opens.
8. Saved-answer matching runs first.
9. User either uses a saved answer or generates a new answer.
10. Generated answer is editable.
11. User may regenerate or save as preferred.
12. User clicks Fill.
13. Extension fills field and dispatches browser events.
14. Extension records fill usage if analytics are enabled.
15. User reviews the real page and submits manually.

### Disconnected Flow

1. User clicks Ansly button.
2. Popover attempts match/generate.
3. Background API client has no valid session.
4. Popover shows "Ansly isn't connected."
5. User can open `/extension` to connect.

### Insufficient Information Flow

1. User asks about unsupported skill/preference/experience.
2. API precheck or model output returns `insufficient_information`.
3. Popover says profile lacks enough information.
4. User can open profile page and add missing details.

## Privacy and Safety Posture

Implemented safety controls:

- Extension sends question text, field metadata, and optional job context, not full page HTML.
- Job descriptions are opt-in.
- Analytics can be disabled.
- Analytics do not store question or answer text.
- Answers are generated from user-owned profile rows under RLS.
- The API does not use a service role key for profile reads.
- The user reviews and edits before filling.
- Ansly never submits forms.
- Prompt explicitly forbids invented facts.
- Skill and logistics prechecks catch common high-risk hallucination cases before the model runs.

Important risk areas:

- Any LLM-generated answer still needs user review.
- Generic DOM detection may misclassify some real-world ATS fields.
- Contenteditable filling may vary across rich text editors.
- Job context extraction may be imperfect on heavily dynamic or obfuscated pages.
- Extension session tokens are stored by the extension; browser extension security depends on the extension runtime and host permissions.

## Testing Coverage

Documented checks:

- Root `pnpm check` runs lint, typecheck, build, and test across workspaces.

Web tests:

- Section form conversion.
- Profile import.
- Completeness.
- Redirect safety.

Extension tests:

- Detection on representative ATS markup.
- Job context extraction.
- React-controlled field filling.
- Runtime geometry.
- Popover flows.
- API client behavior.

LLM tests:

- Gateway fallback.
- Classifier.
- Retrieval and grounding.
- Parsing.
- Similarity.
- Auth.
- Rate limits.
- Endpoints.

Supabase tests:

- Migrations apply.
- RLS isolates users.

Recent validation during this audit-related work:

- Extension `typecheck` passed.
- Extension `test` passed with 63 tests.
- Web `lint` and `typecheck` passed after landing page changes.

Known test warning:

- Extension tests currently emit a React `act(...)` warning in a controlled-field test, but tests pass.

## Operational Notes

Local development:

- Web: `pnpm --filter @ansly/web dev`
- API: `pnpm --filter @ansly/llm dev`
- Extension: `pnpm --filter @ansly/extension dev`
- All: `pnpm dev`

Extension build/reload:

- Source changes under `extension/src` are not visible in an already-loaded browser extension until WXT dev mode reloads it or the extension is rebuilt and reloaded.
- Production-style build: `pnpm --filter @ansly/extension build`
- Browser extension page: `chrome://extensions`

Environment variables:

- Web needs Supabase URL/key and API base URL.
- API needs Supabase URL/key and LLM provider keys.
- Extension needs Supabase URL/key, API URL, and web URL.

Deployment:

- Web targets Vercel.
- API targets Render/Railway-style Python hosting or Vercel-compatible setup depending on config.
- Extension targets Chrome Web Store zip packaging.
- Supabase redirect URLs must include local and production auth callback URLs.

## Current Product Gaps

Release gaps:

- Deploy web and API to production.
- Configure production Supabase redirect URLs.
- Build extension with production URLs.
- Produce Chrome Web Store zip.
- Create Chrome Web Store listing.
- Validate privacy policy against final listing copy.

Real-world QA gaps:

- Test on live LinkedIn, Indeed, Greenhouse, Lever, Ashby, Workday, and custom company forms.
- Track where generic detection over-includes or under-includes fields.
- Add site-specific adapters only after real failures are observed.
- Verify contenteditable fill behavior on rich editors used by ATS systems.

Product gaps:

- No job discovery feed.
- No saved searches.
- No alerts.
- No application tracker.
- No resume tailoring.
- No cover letter generation.
- No application package preparation.
- No automatic resume upload.
- No guarded multi-field automation.

UX gaps to consider:

- Popup and in-page popover still use plain CSS surfaces separate from the main web component library.
- Popover brand still uses sparkle text in current source while popup now uses the small icon.
- Extension disabled-site controls live only in popup.
- There is no in-web list of disabled sites.
- Saved-answer matching score is not exposed to users.
- User cannot tune saved-answer match threshold from UI.

Backend gaps to consider:

- Structured retrieval is intentionally simple and non-vector. This fits V1, but nuanced matching may need richer retrieval later.
- Daily generation limit exists in API logic but should be confirmed against final production env values.
- Provider availability and fallback should be monitored in production.

## Recommended Next Steps

1. Run full `pnpm check` before release.
2. Perform live ATS QA and record exact failures with screenshots and DOM snippets.
3. Align in-page popover branding with the small logo used in the popup and dashboard.
4. Add a short release checklist covering envs, Supabase redirects, extension build URLs, and Chrome reload/store packaging.
5. Add a "disabled sites" management surface in web settings if users frequently toggle sites off.
6. Add production monitoring around API health, provider fallback, rate limits, and Supabase errors.
7. Keep V2 features out of the V1 release branch until the application-answer loop is proven in real use.
