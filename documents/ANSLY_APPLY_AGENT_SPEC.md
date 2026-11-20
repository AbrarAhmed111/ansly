# Ansly Apply Agent — Implementation Specification

**Status:** Implementation-ready design

**Scope:** Agentic, authorized job application automation for the browser extension

**Repository baseline:** Ansly Next.js web app, WXT browser extension, FastAPI LLM API, and Supabase/PostgreSQL

**This specification is a design and research document. It does not authorize implementation itself.**

---

## 1. Executive Summary

Ansly Apply Agent extends the existing assisted-answer workflow into a transparent, per-application browser workflow. After a user explicitly authorizes one job application, Ansly may:

1. Detect and analyze the job.
2. Detect direct recruitment email instructions.
3. Prefer an existing Job Outreach workflow when a genuine application email is available.
4. Otherwise select a role resume from the existing Roles Resume Library.
5. Inspect and fill a supported application form.
6. Generate profile-grounded answers and optional cover-letter text.
7. Pause for CAPTCHA or unsupported human decisions.
8. Submit only when explicitly authorized and permitted.
9. Verify the resulting page, then record the outcome.

The implementation is browser-extension led, with FastAPI used for analysis and the existing provider fallback gateway used for LLM reasoning. Supabase remains the source of truth for profile data, saved answers, Application Memory, role resumes, job contexts, outreach drafts, send outcomes, and application runs.

Two execution routes are first-class:

```text
Path A — Direct employer email
Job detected → Authorization → Email detection → Existing Job Outreach
→ Existing resume matcher and Roles Resume Library → Gmail send
→ Verified send result → Record completed outreach

Path B — Website application
Job detected → Authorization → No valid direct recruitment email
→ Platform adapter or generic browser agent → Resume Library
→ Form completion → Optional cover letter → CAPTCHA/intervention
→ Authorized submit → Submission verification → Record result
```

No route may continue to another communication channel after an application has been successfully completed. Email sending and website submission are mutually exclusive successful outcomes for one application run.

---

## 2. Repository-Grounded Audit

### 2.1 Current architecture

| Area | Existing implementation |
|---|---|
| Web app | Next.js, React, Supabase SSR/auth, settings, profile, memory, saved answers, leads, role resumes, tailoring, Job Outreach |
| Browser extension | WXT + React, MV3 service worker, runtime-injected content scripts, shadow-DOM UI, opt-in host permissions |
| Content/UI | Field detection, answer popover, fill-all panel, job offers, LinkedIn lead collection, tailor offer |
| LLM API | FastAPI, multi-provider gateway, structured validators, retry/fallback, token and usage accounting |
| Data | Supabase Auth/PostgreSQL, RLS, private resume storage, profile data, memory, job contexts, outreach data |
| Email | Gmail OAuth with send-only scope, encrypted refresh tokens, attachment support, send-attempt and recipient-history records |

### 2.2 Reusable feature inventory

| Capability | Existing implementation | Status | Apply Agent change |
|---|---|---|---|
| Job detection | `extension/src/lib/job/detect.ts` | Reusable | Add application-platform and route state |
| Indeed posting detection | `extension/src/lib/job/adapters/indeed.ts` | Reusable | Add application workflow adapter |
| LinkedIn posting detection | `extension/src/lib/job/adapters/linkedin.ts` | Reusable | Add Easy Apply vs redirect detection |
| Generic job detection | `extension/src/lib/job/generic.ts` | Reusable | Reuse description/title extraction |
| Field scanning | `extension/src/lib/detection/scan.ts` | Reusable | Add stable field identity |
| Question classification | `llm/src/app/answers/classifier.py` | Reusable | Add material-declaration and cover-letter categories |
| Profile grounding | `llm/src/app/answers/profile_context.py` | Reusable | Pass application run context |
| Batch answer generation | `/api/v1/answers/generate-batch` | Reusable | Add agent-specific structured policy |
| Answer resolution | `/api/v1/answers/resolve` | Reusable | Reuse saved-answer-first behavior |
| Application Memory | `profile_facts`, `llm/src/app/memory/service.py` | Reusable | Add ask/confirm facts to run context |
| Fill values | `extension/src/lib/fill.ts` | Reusable | Generalize verification and undo |
| Choice controls | `fillChoice` | Reusable | Enhance verification |
| Job analysis | `/api/v1/jobs/analyze` | Reusable | Reuse or share with outreach |
| Role resume library | `resumes` with `role_label`, private storage | Reusable | Directly reuse |
| Resume matching | `llm/src/app/leads/roles.py::match_resume` | Reusable | Use for outreach and website routes |
| Resume parsing | `llm/src/app/resume/parsing` | Reusable | Use parsed content |
| Resume download | `/api/v1/resumes/{id}/download` | Needs enhancement | Add short-lived private-byte delivery for browser upload |
| Job Outreach | `/api/v1/job-outreach/*` | Reusable | Orchestrate existing logic; do not duplicate |
| Outreach history | `outreach_contact_history` | Reusable | Prevent duplicate email sends |
| Gmail sending | `llm/src/app/email/sending.py` | Reusable | Sole email sender |
| Tailoring progress | `packages/types/src/progress.ts` | Pattern reusable | Implement application event stream |
| Extension settings | `extension/src/lib/settings.ts` | Needs enhancement | Add behavior mode |
| Web settings | `web/src/app/(app)/settings/page.tsx` | Needs enhancement | Add mode control |
| Browser notifications | No existing implementation | Missing | Add notifications permission and UI fallback |
| Application tracking | `job_contexts` and usage events only | Missing | Add application run/outcome table |
| State persistence | Outreach draft persistence only | Missing | Add application runs/checkpoints |
| CAPTCHA detection | No implementation | Missing | Add deterministic detection and pause |
| Submission verification | No implementation | Missing | Add adapters plus generic evidence |

### 2.3 Existing workflow details

- The extension uses a typed background request protocol and one-time opt-in host permissions.
- `peekJob` and `extractJob` detect LinkedIn, Indeed, JSON-LD, and generic jobs locally.
- The field engine already uses native input setters, framework change events, choice controls, verification, snapshots, and undo.
- `/api/v1/answers/generate-batch` supports saved answers, profile facts, memory, and deterministic profile values.
- Role resumes are at `{user}/library/` in private storage and are represented by `role_label`, `role_note`, and `parsed_content`.
- `match_resume` uses clear role-label matching first, then structured LLM matching with high/medium/low/none confidence.
- Job Outreach analyzes recipient, subject, instructions, role/resume matching, duplicate recipient history, and Gmail send outcome.
- Job Outreach returns `outcome_unknown` instead of claiming uncertain email delivery succeeded.
- Usage events cover job analysis, fill, memory, tailoring, and lead activity, but not application completion.

---

## 3. Product Requirements

### 3.1 User authorization

Authorization is acquired once per detected application. It must explicitly state the route:

- Website: “Ansly may fill the form and submit this application.”
- Email: “Ansly found a direct recruitment email. It may generate and send an application email using Job Outreach and connected Gmail. It will not submit the website form if email is sent.”
- Unknown: it may choose only a genuinely validated direct email route or proceed to website automation.

Authorization must persist:

- Run ID and job key.
- Job URL/platform.
- User ID and behavior mode.
- Allowed route.
- Grant timestamp.
- Submission permissions.

Authorization never carries to a second job. Discovery must never auto-start or auto-submit.

Renew confirmation for a materially different employer/role, an unexpected final commitment, legal declaration, fee, contract, relocation commitment, or redirect to a different application.

### 3.2 Normal and Aggressive modes

Add `Application Agent Behavior` to existing settings.

**Normal Mode — recommended default**

- Select only a clearly dominant resume.
- Ask for resume choice when candidates are close.
- Use profile and knowledge sources first.
- Ask when mandatory evidence is missing.
- Ask for ambiguous choices and important instructions.
- Treat low-confidence answers as requiring review.

**Aggressive Mode**

- Minimize ordinary interruptions.
- Choose the highest-confidence resume or stop if no usable match exists.
- Resolve ordinary choices from strong evidence.
- Generate cover letters without a separate approval step.
- Leave unsupported optional fields unanswered.
- Stop for mandatory unsupported or potentially false information.

Both modes stop for CAPTCHA, login/security challenges, invalid recipients, missing mandatory evidence, unavailable confirmation, page/session changes, unsupported upload, and materially consequential actions.

### 3.3 Factual accuracy

Aggressive mode never fabricates:

- Employment history.
- Education.
- Years of experience.
- Certifications.
- Technical skills.
- Work authorization or visa status.
- Sponsorship status.
- Salary history.
- Achievements.
- Legal declarations.
- Any other personal fact.

Use only evidence from profile, confirmed memory, exact saved answers, or user confirmation. Leave optional fields empty when evidence is absent. Stop mandatory fields rather than guessing.

### 3.4 Mode persistence

Extend `Settings` in `extension/src/lib/settings.ts`:

```ts
export type ApplicationAgentMode = 'normal' | 'aggressive'

export interface Settings {
  applicationAgentMode: ApplicationAgentMode
}

export const DEFAULT_SETTINGS = {
  applicationAgentMode: 'normal',
}
```

Rules:

- New runs read current mode.
- Existing runs persist `mode_at_start`.
- Switching settings does not reset progress.
- UI shows the run's pinned mode and current setting separately.
- Explicitly switching an in-progress run changes only subsequent actions.

### 3.5 Confidence policy

Every AI decision should carry evidence:

```ts
interface DecisionEvidence {
  confidence: 'high' | 'medium' | 'low' | 'none'
  sources: string[]
  reason: string
  missing: string[]
  material: boolean
  userConfirmed: boolean
}
```

Deterministic policy:

- Exact profile field: high.
- Exact saved answer: high/medium from existing scoring.
- Confirmed, scope-compatible Application Memory: high.
- Clear role resume match: high.
- Contextual generation: medium/low.
- Legal/work-status/identity answer: no low-confidence fill.

---

## 4. Email-First Strategy

### 4.1 Email detection

Reuse `/api/v1/job-outreach/analyze` and `parse_application_details`, including explicit address validation, evidence verification, portal detection, recipient ambiguity, and requested subject extraction.

For browser jobs, pass the existing `extractJob` description to:

```text
POST /api/v1/job-outreach/analyze
{ id, job_text }
```

Accept direct email routing only when:

- `application_method === "email"`.
- Recipient is confident and unambiguous.
- Address is explicitly present.
- Instructions are confident.
- No portal instruction supersedes email.

Never construct an address or send to unrelated support/privacy text.

### 4.2 Existing workflow reuse

After valid recipient detection:

1. Analyze with the existing Job Outreach endpoint.
2. Compose with `/compose`.
3. Use existing `match_resume`.
4. Send with `/send`.
5. Use `send_gmail_email` and existing MIME/attachment handling.
6. Interpret send outcome:
   - `sent`: email route completed.
   - `needs_review`: preserve draft and apply mode rules.
   - `failed`: preserve evidence, do not claim sent.
   - `outcome_unknown`: stop and direct user to Gmail Sent.

Do not duplicate email generation, matching, storage, or Gmail sending.

### 4.3 Sending and fallback

Normal mode may ask for close resume choices or unrelated recipient review. Aggressive mode may select the best supported resume or stop if no usable match exists.

Continue to website only if:

- Initial authorization allowed `email_then_website`.
- Email sending result is definitively not sent.
- The address was unrelated/ambiguous and website route is appropriate.
- The website route is permitted.

If email is the required application method, never silently switch after generation or send failure.

### 4.4 Duplicate prevention

Reuse `outreach_contact_history` and advisory locking. Store `email_outreach_id` on the application run and call send once per run. Never retry `outcome_unknown`.

On `sent`, no website action executes. On `sending`, poll or recover under existing stale-send rules.

### 4.5 Email progress UI

Real event sequence:

1. Job detected.
2. Job description analyzed.
3. Direct recruitment email found or not found.
4. Preparing Job Outreach.
5. Matching role resume.
6. Generating application email.
7. Sending application email.
8. Verifying email result.
9. Outreach completed or failed.

---

## 5. Application State and Recovery

### 5.1 State machine

```text
DETECTED
AWAITING_AUTHORIZATION
AUTHORIZED
ANALYZING_JOB
EMAIL_ROUTE_CHECK
EMAIL_DRAFTING
EMAIL_SENDING
EMAIL_SENT
MATCHING_RESUME
INSPECTING_APPLICATION
FILLING_APPLICATION
UPLOADING_RESUME
GENERATING_COVER_LETTER
ANSWERING_QUESTIONS
NAVIGATING_STEPS
HUMAN_INTERVENTION
CAPTCHA_PAUSED
READY_TO_SUBMIT
SUBMITTING
VERIFYING_SUBMISSION
SUBMITTED
FAILED
CANCELLED
```

Terminal states are `EMAIL_SENT`, `SUBMITTED`, `FAILED`, and `CANCELLED`.

Every transition is append-only and stores timestamp/checkpoint. Every browser action stores `action_id`, kind, target identity, before/after fingerprint, and outcome.

### 5.2 Checkpoints

Store a checkpoint after:

- Job and route detection.
- Email eligibility.
- Resume selection.
- Existing attachment inspection.
- Resume upload verification.
- Field fill verification.
- Step navigation verification.
- Human/CAPTCHA revalidation.
- Submission initiation.
- Submission verification.

Do not store full page HTML or answer text unless a separate retention policy allows it.

### 5.3 Reload and worker recovery

On startup:

1. Restore nonterminal runs.
2. Verify the origin/tab.
3. Reinspect the page.
4. Compare URL and fingerprint.
5. Resume the next unverified checkpoint.

Never repeat an action solely because state was lost.

MV3 service workers must not own timers or workflow state. Use WXT/Supabase persistence and `browser.alarms` for bounded polling.

### 5.4 Duplicate prevention

- Job key: normalized URL plus title/company.
- Run ID: one active run per authorized job.
- Action ID: UUID plus run ID.
- Submission: one submit action per run.
- Reload in `SUBMITTING`: verify confirmation before restoring `READY_TO_SUBMIT`.
- If success evidence exists, mark submitted and stop.

---

## 6. Platform Architecture

### 6.1 Adapter contract

```ts
interface ApplicationAdapter {
  id: 'indeed' | 'linkedin' | 'greenhouse' | 'lever' | 'workday' | 'generic'
  matches(url: URL, doc: Document): boolean
  inspect(doc: Document): Promise<ApplicationPageSnapshot>
  getJob(doc: Document, url: URL): DetectedJob | null
  getPlan(snapshot: ApplicationPageSnapshot, context: ApplicationContext): Promise<ExecutionPlan>
  executeAction(action: BrowserAction): Promise<ActionResult>
  verifyStep(snapshot: ApplicationPageSnapshot): Promise<StepVerification>
  detectHumanIntervention(doc: Document): Intervention | null
  detectSubmission(doc: Document): SubmissionEvidence
}
```

### 6.2 Indeed adapter

Module: `extension/src/lib/apply/adapters/indeed.ts`

Support:

- Easy Apply and multi-step application processes.
- Personal information, employment, education, skills.
- Screening, yes/no, dropdown, radio, checkbox.
- Resume and cover-letter fields.
- Review, validation, submit, and confirmation.

Contain volatile Indeed selectors in this adapter. Detect entry with multiple visible/accessibility signals and verify each navigation.

### 6.3 LinkedIn adapter

Module: `extension/src/lib/apply/adapters/linkedin.ts`

Support:

- Easy Apply entry and modal.
- Contact, resume, screening, employment, education.
- Dropdown, checkbox, radio, cover-letter fields.
- Review and submit.

For external redirect:

- Stop LinkedIn adapter.
- Capture redirect origin/job context.
- Select another adapter or generic.
- Renew material authorization if employer/role changed.

### 6.4 Generic browser agent

Use:

1. Semantic labels and `aria-*`.
2. Input name/type/autocomplete/fieldset context.
3. Visible section headings.
4. Existing field scanner/fill engine.
5. Structured LLM interpretation only for ambiguity.

Never use fragile coordinates or unverified selectors.

### 6.5 Additional platforms

Add modules incrementally for Greenhouse, Lever, Workday, Ashby, SmartRecruiters, Workable, BambooHR, and company portals.

### 6.6 Cross-origin frames

- Content script is sole DOM actor.
- Attribute frame IDs.
- Request all-frame snapshots only after origin permission.
- Cross-origin file inputs are unsupported unless tested.
- Never read unrelated frame data.

---

## 7. Agentic AI Architecture

| Component | LLM? | Responsibility |
|---|---|---|
| Application Planner | Limited | Next safe action and route |
| Page Understanding | Optional fallback | DOM snapshot and semantic field mapping |
| Resume Matcher | Existing logic | Reuse role matching and confidence |
| Answer Engine | Yes | Existing profile/memory/saved-answer generation |
| Browser Executor | No | Controlled DOM actions |
| State Manager | No | Persistence, checkpoints, idempotency |
| Progress Manager | No | Real events |
| Intervention Manager | No | CAPTCHA/security detection |
| Submission Verifier | Limited | Deterministic page evidence |

Reuse `LLMGateway`; do not add Playwright or a remote computer-use service to the extension runtime. Playwright is appropriate for local/CI fixture testing.

Add apply stages to existing token accounting:

- `apply_page_understanding`
- `apply_answer_generation`
- `apply_cover_letter`
- `apply_submission_evidence`

The existing provider/fallback gateway is sufficient. It already supports Gemini, Groq, OpenAI, Anthropic, Mistral, Cerebras, Cohere, and OpenRouter through structured validator fallback.

### 7.1 Application Planner

Consumes job context, authorization, mode, snapshot, checkpoints, field inventory, manual edits, resume match, and intervention state.

Produces:

```ts
interface ExecutionPlan {
  runId: string
  route: 'email' | 'website'
  mode: ApplicationAgentMode
  nextAction: BrowserAction | 'pause' | 'stop' | 'submit'
  reason: string
  confidence: 'high' | 'medium' | 'low'
  evidence: DecisionEvidence
  retryable: boolean
}
```

Deterministic work precedes LLM planning.

### 7.2 Page snapshot

Include:

- URL origin and normalized path.
- Accessible labels.
- Input/select/textarea/combobox/radio/checkbox metadata.
- `autocomplete`, `inputmode`, `required`, `accept`, `multiple`.
- Headings and fieldsets.
- Dialog/modal identity.
- Existing values.
- Button accessible names.
- CAPTCHA/security markers.
- Validation messages.
- File input metadata.
- Stable fingerprint.

Exclude passwords and full sensitive values.

---

## 8. Roles Resume Library

### 8.1 Source of truth

Use:

- `GET /api/v1/resumes?library=true`.
- Existing `role_label`, `role_note`, `parsed_content`.
- Existing `match_resume`.
- Private Supabase `resumes` storage.

No local resume repository or browser file picker is added.

### 8.2 Matching

Reuse `match_resume` unchanged initially. Policy:

- High: auto-select in both modes.
- Medium: Normal asks; Aggressive may select highest supported match.
- Low/none: Normal asks from existing Library; Aggressive stops or manually handles.

Compare existing attachment filename and content fingerprint where available.

### 8.3 Secure upload

The browser must not assign a Supabase URL directly to `input.value`.

Flow:

1. Service worker calls `/api/v1/resumes/{id}/download`.
2. API validates ownership and returns a short-lived authenticated/signed download.
3. Service worker fetches once and verifies SHA-256/type/size.
4. A browser-compatible isolated `File`/blob transfer supplies the file input.
5. Content script verifies filename/UI/upload completion.

Enforce PDF/DOCX and 10 MB. Remove temporary bytes after use. Never expose private URLs/tokens to page scripts.

Before upload:

- Inspect attached filename.
- Keep correct resume.
- Replace only through clear supported controls.
- Pause if unsupported.

---

## 9. Answer and Cover-Letter Intelligence

### 9.1 Question routing

Reuse `resolve`, `generate-batch`, profile values, saved answers, memory, and missing information.

For each field:

1. Map profile key/saved answer/memory.
2. Confirm scope and recency.
3. Generate only with evidence.
4. Normal: review low confidence.
5. Aggressive: fill medium/high, leave optional low/none empty, stop mandatory low/none.
6. Verify and preserve manual edits.

Never silently answer work authorization, sponsorship, criminal history, compensation history, identity/disability declarations, or mandatory attestations without explicit evidence or confirmation.

### 9.2 Manual edits

A manual edit becomes `userConfirmed=true` for the run and is never overwritten unless the user chooses undo.

### 9.3 Cover letters

No dedicated implementation exists. Reuse existing answer generation, profile context, job context, and role resume.

Generate only if the form explicitly requires/offers a cover letter:

- Text field: insert grounded text.
- File field: requires a dedicated supported cover-letter file implementation.
- Optional: leave blank unless policy says otherwise.

Never invent qualifications or achievements.

---

## 10. Browser Execution

Reuse `fillField`, `fillChoice`, `fillContentEditable`, `snapshotValue`, `restoreValue`, and `verifyFilled`. Add stable field IDs, before/after fingerprints, bounded waits, and frame identity.

Action types:

```ts
type BrowserAction =
  | { type: 'fill_text'; target: FieldIdentity; value: string }
  | { type: 'fill_choice'; target: FieldIdentity; value: string }
  | { type: 'check'; target: FieldIdentity; checked: boolean }
  | { type: 'upload_resume'; target: FieldIdentity; resumeId: string }
  | { type: 'upload_file'; target: FieldIdentity; file: FileArtifact }
  | { type: 'click'; target: ControlIdentity }
  | { type: 'navigate'; url: string }
  | { type: 'wait_for_step'; targetFingerprint: string }
```

Every action requires:

- Enabled origin.
- Visible/correct control.
- Stable identity.
- Post-action verification.
- Bounded wait.

Submission is a separate confirmed action:

- Verify final review page.
- Do not click fees/contracts/unrelated controls.
- One submit action per run.
- Verify success evidence after submit.

---

## 11. CAPTCHA and Human Intervention

### 11.1 Detection

Detect provider iframe markers, reCAPTCHA/hCaptcha/Turnstile DOM/ARIA, challenge text, security verification, login, and 2FA.

On detection:

1. Transition to `CAPTCHA_PAUSED`.
2. Stop further actions.
3. Preserve checkpoint.
4. Send notification and visible UI alert.
5. Do not solve or bypass.

Add `notifications` permission. The notification should open the application tab. UI fallback remains available.

### 11.2 Resume

Require:

- Challenge gone.
- No challenge text/provider remains.
- Tab/origin active.
- Session valid.
- Expected form/step accessible.
- Last action not duplicated.
- No existing submission evidence.

Require explicit Resume after manual completion. Element disappearance alone is insufficient.

Use `HUMAN_INTERVENTION` for login/2FA, unsupported upload, unknown field, session expiry, ambiguous answer, or unexpected validation.

---

## 12. Progress and UI

Add shared types in `packages/types/src/application.ts`:

```ts
export type ApplicationRoute = 'email' | 'website'
export type ApplicationRunStatus =
  | 'detected' | 'awaiting_authorization' | 'authorized'
  | 'email_route' | 'email_draft' | 'email_sending' | 'email_sent'
  | 'matching_resume' | 'inspecting_application' | 'filling_application'
  | 'uploading_resume' | 'generating_cover_letter'
  | 'answering_questions' | 'navigating'
  | 'human_intervention' | 'captcha_paused'
  | 'ready_to_submit' | 'submitting' | 'verifying_submission'
  | 'submitted' | 'failed' | 'cancelled'

export interface ApplicationActivityEvent {
  id: string
  runId: string
  type: 'activity' | 'checkpoint' | 'intervention' | 'error'
  activity: string
  status: 'pending' | 'running' | 'completed'
    | 'needs_attention' | 'paused' | 'failed' | 'cancelled'
  occurredAt: string
  checkpointId?: string
  detail?: string
}
```

Use the existing shadow-DOM Tailor/Card patterns.

The card shows job, company, platform, route, mode, real events, current action, pause/resume/cancel, intervention, resume choice, and final result. Do not use fake percentages or timed simulated loading.

Website progress:

1. Job detected.
2. Job description analyzed.
3. No direct recruitment email found.
4. Matching resume.
5. Checking attachment.
6. Filling personal information.
7. Answering questions.
8. Cover letter.
9. Reviewing.
10. Submitting.
11. Verifying.

Email progress:

1. Job detected.
2. Job analyzed.
3. Direct recruitment email found.
4. Preparing Job Outreach.
5. Matching resume.
6. Generating email.
7. Sending email.
8. Verifying send.
9. Outreach completed.

---

## 13. Submission Verification and Tracking

### 13.1 Verification evidence

Accept:

- Verified success heading or confirmation text.
- Confirmation number tied to job/run.
- Known success URL/path.
- Explicit submitted/received/thank-you UI.

Reject:

- Review or Continue page.
- Submit button disappearing alone.
- Loading state alone.
- Navigation with no success evidence.

Ambiguity enters `VERIFYING_SUBMISSION` and requires user resolution. Never submit twice.

### 13.2 Application tracking

Add owner-RLS-protected tables:

```sql
create table public.application_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  job_key text not null,
  job_context_id uuid references public.job_contexts(id) on delete set null,
  job_outreach_id uuid,
  title text not null,
  company text,
  job_url text,
  platform text not null,
  route text not null check (route in ('email', 'website')),
  behavior_mode text not null check (behavior_mode in ('normal', 'aggressive')),
  resume_id uuid,
  status text not null,
  authorization jsonb not null,
  submission_evidence jsonb,
  selected_resume_name text,
  recipient_email text,
  email_subject text,
  provider_message_id text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  constraint application_runs_resume_fkey
    foreign key (user_id, resume_id) references public.resumes(user_id, id) on delete set null
);
```

Add `application_run_events` and `application_run_checkpoints`. Foreign key `job_outreach_id` must use the existing `(user_id, id)` pattern.

Outcome mapping:

- Email sent → `EMAIL_SENT`, completed.
- Website confirmation → `SUBMITTED`, completed.
- Unknown send → `FAILED`, outcome unknown.
- Submit without evidence → `VERIFYING_SUBMISSION`/failed, never submitted.
- User cancel → `CANCELLED`.
- CAPTCHA → `CAPTCHA_PAUSED`, not failed.

---

## 14. Database and API Changes

### 14.1 Database

- `application_runs`.
- `application_run_events`.
- `application_run_checkpoints`.
- Index `(user_id, job_key, status)`.
- Optional partial unique index for active run by job.
- RLS and owner checks.
- Usage-event kinds may be extended without storing answer text.

### 14.2 Recommended API

```text
POST /api/v1/applications/start
POST /api/v1/applications/{runId}/authorize
POST /api/v1/applications/{runId}/events
POST /api/v1/applications/{runId}/pause
POST /api/v1/applications/{runId}/resume
POST /api/v1/applications/{runId}/cancel
GET  /api/v1/applications/{runId}
GET  /api/v1/applications
POST /api/v1/applications/{runId}/checkpoint
POST /api/v1/applications/{runId}/plan
POST /api/v1/applications/{runId}/resolve-field
POST /api/v1/applications/{runId}/submission-evidence
```

Reuse existing endpoints:

- `/api/v1/jobs/analyze`.
- `/api/v1/answers/resolve`.
- `/api/v1/answers/generate-batch`.
- `/api/v1/saved-answers/match-batch`.
- `/api/v1/profile/missing`.
- `/api/v1/memory`.
- `/api/v1/resumes`.
- `/api/v1/resumes/{id}/download`.
- `/api/v1/job-outreach/analyze`.
- `/api/v1/job-outreach/{id}/compose`.
- `/api/v1/job-outreach/{id}/send`.
- `/api/v1/events`.

---

## 15. Extension Architecture

New modules:

```text
extension/src/lib/apply/
  types.ts
  state.ts
  service.ts
  snapshot.ts
  planner.ts
  executor.ts
  resume.ts
  interventions.ts
  verification.ts
  adapters/
    indeed.ts
    linkedin.ts
    greenhouse.ts
    lever.ts
    workday.ts
    generic.ts

extension/src/components/content/
  ApplyCard.tsx
  ApplyActivity.tsx
  ApplyIntervention.tsx
  ApplyResumeChoice.tsx
```

Add typed background requests for start/authorize/run/event/checkpoint/pause/resume/cancel, existing Job Outreach, role resume access, field resolution, and submission evidence.

Manifest:

- Add `notifications`.
- Reuse `storage`, `activeTab`, `scripting`, `contextMenus`.
- Reuse optional host permissions.
- Do not add `debugger`, remote debugging, or broad persistent host permissions.

---

## 16. Settings UI

Add to [web settings](/C:/TORRENT/Devwebies/ansly/web/src/app/(app)/settings/page.tsx):

```text
Application Agent Behavior

Normal Mode
"Ansly works independently but asks for help when it is unsure about answers,
resume selection, or important application decisions."

Aggressive Mode
"Ansly makes the best supported decisions and completes applications with
minimal interruptions. It never fabricates information or bypasses safeguards."
```

Web settings may mirror the WXT setting, but `sync:settings` remains the extension source for the user’s active preference.

---

## 17. Security and Compliance

The agent must never:

- Solve/bypass CAPTCHA.
- Evade bot detection or security restrictions.
- Circumvent login/2FA.
- Store website passwords.
- Submit fabricated facts.
- Submit after authorization cancellation.
- Construct or guess recipient emails.
- Retry uncertain sends.
- Continue to website after a successful email send.
- Interact outside enabled origins.

Sensitive data:

- Keep passwords out of snapshots.
- Do not send full profile records when relevant facts suffice.
- Keep resume bytes private.
- Never persist signed URLs or tokens.
- Protect application runs with RLS.
- Avoid storing full DOM, answer text, or private page data.

---

## 18. Error Handling

| Situation | State | Behavior |
|---|---|---|
| Insufficient job text | `FAILED` | Preserve partial and suggest paste |
| Ambiguous recipient | `HUMAN_INTERVENTION` | Normal asks; Aggressive skips website only if allowed |
| Unrelated recipient | `HUMAN_INTERVENTION`/website | Never send |
| Email failed | `FAILED` | Preserve draft |
| Email uncertain | `FAILED` | Direct to Gmail Sent |
| Low resume match | `HUMAN_INTERVENTION` | Existing Library choice or stop |
| Resume upload failed | `HUMAN_INTERVENTION` | Preserve state |
| CAPTCHA | `CAPTCHA_PAUSED` | Manual intervention |
| Login/2FA | `HUMAN_INTERVENTION` | Stop automation |
| Unknown mandatory field | `HUMAN_INTERVENTION` | Ask/stop according to mode |
| Page reload | Recovery | Reinspect checkpoint |
| Worker suspension | Recovery | Alarm/persisted state |
| Network failure | Retry/failed | No blind action repeat |
| Missing submission evidence | `VERIFYING_SUBMISSION` | No second submit |
| Already submitted | `SUBMITTED` | Verify and record |
| Session expires | `HUMAN_INTERVENTION` | Revalidate after login |

---

## 19. Testing and Acceptance

### 19.1 Unit tests

- Job extraction.
- Email route and recipient validity.
- Resume matching.
- Normal/Aggressive policy.
- Answer routing.
- Material declarations.
- State transitions.
- Checkpoint replay.
- CAPTCHA and duplicate prevention.
- Submission evidence.
- Mode switching.

### 19.2 Integration tests

- Existing Job Outreach analyze/compose/send.
- Role Library.
- Existing LLM gateway.
- Extension/background communication.
- Resume download/upload.
- Supabase RLS.
- Application event delivery.
- Mutually exclusive email/website outcomes.

### 19.3 Browser tests

Local realistic fixtures for:

- Indeed Easy Apply.
- LinkedIn Easy Apply.
- LinkedIn external redirect.
- Greenhouse.
- Lever.
- Workday.
- Generic form controls.
- Resume and cover-letter uploads.
- Validation and CAPTCHA.
- Login/security.
- Success and ambiguous submit outcomes.

Use Playwright for local fixtures. Live sites are smoke tests only.

### 19.4 Failure tests

- CAPTCHA halfway.
- CAPTCHA cleared/not cleared.
- Page reload.
- Worker suspension.
- Network disconnect.
- Upload failure.
- Wrong resume.
- Unknown field.
- AI uncertainty.
- Session expiry.
- User cancel.
- Missing submit confirmation.
- Already applied.

### 19.5 Acceptance criteria

- No fill/submission occurs before per-job authorization.
- Email authorization explicitly covers Gmail sending.
- Direct sent email stops website automation.
- Ambiguous/portal jobs do not email-send.
- Unknown send never retries.
- Role Library is the only resume source.
- Existing correct attachment is kept.
- Every fill is verified.
- Submission requires success evidence.
- Reload/resume never blindly repeats actions.
- Both modes stop for CAPTCHA/security.
- No fabricated facts or legal declarations.

---

## 20. Implementation Roadmap

### Phase 0 — Validation

- Verify private resume browser upload.
- Verify cross-origin frames and notifications.
- Create Playwright fixtures.
- Review migration and state model.

### Phase 1 — Foundation

- Run/event/checkpoint tables.
- Authorization.
- Mode setting.
- Apply card and progress.
- State machine and recovery.
- Notification support.

### Phase 2 — Email-first

- Integrate existing Job Outreach.
- Route state and duplicate prevention.
- Sent/failed/unknown handling.
- Email progress UI.

### Phase 3 — Generic engine

- Page snapshot.
- Fill engine.
- Answer integration.
- Resume upload.
- Navigation and verification.
- CAPTCHA/human intervention.

### Phase 4 — Resume and cover letter

- Existing role matcher.
- Attachment inspection.
- Secure upload.
- Grounded cover letter.
- Normal/Aggressive policy.

### Phase 5 — Indeed

- Dedicated Easy Apply workflow.
- Dynamic forms and validation.
- Resume/cover letter.
- Submit and confirmation.

### Phase 6 — LinkedIn

- Dedicated Easy Apply workflow.
- External redirect.
- Modal and dynamic controls.
- Submit and confirmation.

### Phase 7 — Additional platforms

- Greenhouse.
- Lever.
- Workday.
- Ashby.
- SmartRecruiters.
- Workable.
- BambooHR.
- Company portals.

### Phase 8 — Production readiness

- Browser test matrix.
- Retry and duplicate hardening.
- Privacy telemetry.
- Tracking dashboard.
- Security and terms review.

---

## 21. Core Pseudocode

```ts
async function runApplication(runId: string) {
  const run = await loadRun(runId)
  if (!run.authorization || run.status === 'cancelled') return

  emitActivity(run, 'Analyzing job description')
  const job = await extractVerifiedJob()
  const email = await analyzeWithExistingJobOutreach(job.description)

  if (isValidDirectRecruitmentEmail(email)) {
    emitActivity(run, 'Direct recruitment email found')
    const outreach = await composeWithExistingJobOutreach(email.id)
    const sent = await sendWithExistingJobOutreach(outreach.id)
    if (sent.status === 'sent') {
      await completeEmailRun(run, sent)
      return
    }
    if (emailRouteIsRequired(job) || sendOutcomeUnknown(sent)) {
      await failPreservingDraft(run, sent)
      return
    }
  } else {
    emitActivity(run, 'No direct recruitment email found')
  }

  if (!run.authorization.websiteAllowed) return

  let snapshot = await inspectPage()
  if (detectCaptcha(snapshot)) return pauseForCaptcha(run, snapshot)

  const resume = await selectRoleResume(job)
  await verifyExistingAttachmentOrUpload(run, resume)

  while (!isTerminal(run.status)) {
    snapshot = await inspectPage()
    const intervention = detectIntervention(snapshot)
    if (intervention) return pauseForHuman(run, intervention)

    const plan = await planNextAction(run, snapshot)
    if (plan.nextAction === 'pause') return pauseForHuman(run, plan)
    if (plan.nextAction === 'submit') {
      await submitOnce(run)
      await verifySubmissionEvidence(run)
      return
    }
    await executeVerifiedAction(run, plan.nextAction)
  }
}

async function recover(runId: string) {
  const run = await loadRun(runId)
  if (isTerminal(run.status)) return

  const tab = await findRunTab(run)
  if (!tab) return humanIntervention(run, 'open_application_tab')

  const snapshot = await inspectRunPage(tab)
  if (!snapshotMatchesRun(snapshot, run)) {
    return humanIntervention(run, 'page_changed')
  }
  if (detectCaptcha(snapshot)) return pauseForCaptcha(run, snapshot)

  const next = await getNextUnverifiedCheckpoint(run)
  if (next) await resumeAtCheckpoint(run, snapshot, next)
  else await replanFromVerifiedState(run, snapshot)
}
```

---

## 22. Risks and Limitations

1. ATS markup and custom fields vary substantially.
2. LinkedIn and Indeed UI changes can invalidate selectors.
3. CAPTCHA and security challenges always require humans.
4. Browser file upload APIs vary across Chromium versions.
5. Success confirmation can be ambiguous.
6. External redirect permissions require explicit opt-in.
7. Aggressive mode cannot eliminate missing evidence.
8. LLM interpretation requires verification.
9. Email ambiguity may require manual review.
10. Automated submission may conflict with platform restrictions.
11. MV3 workers cannot provide a persistent running process.
12. Uncertain state must never claim success.

---

## 23. Unresolved Decisions

- Whether application settings are mirrored in Supabase or remain extension-only.
- Resume confidence thresholds for Normal/Aggressive.
- Cover-letter file format and generator availability.
- Real-time events vs polling for MVP.
- Web dashboard presentation.
- OS-specific notification behavior.
- Additional platform scope before generic fallback.

---

## 24. Key Reuse Map

| Concern | Reuse |
|---|---|
| Job detection | `extension/src/lib/job/detect.ts` |
| Indeed metadata | `extension/src/lib/job/adapters/indeed.ts` |
| LinkedIn metadata | `extension/src/lib/job/adapters/linkedin.ts` |
| Generic metadata | `extension/src/lib/job/generic.ts` |
| Field detection | `extension/src/lib/detection/*` |
| Fill controls | `extension/src/lib/fill.ts` |
| Answer API | `llm/src/app/api/routes/answers.py` |
| Profile/Memory | `llm/src/app/answers/profile_context.py`, `llm/src/app/memory/service.py` |
| Role matching | `llm/src/app/leads/roles.py::match_resume` |
| Resume library | `/api/v1/resumes`, resume migrations |
| Job analysis | `/api/v1/jobs/analyze` |
| Email route | `llm/src/app/api/routes/job_outreach.py` |
| Gmail | `llm/src/app/email/sending.py` |
| Outreach history | `llm/src/app/email/outreach_history.py` |
| Settings | `extension/src/lib/settings.ts`, web settings |
| Progress pattern | `packages/types/src/progress.ts`, Tailor card |
| Session/API | `extension/src/entrypoints/background.ts`, `extension/src/lib/api.ts` |
| Storage | Supabase migrations/RLS |

No Apply Agent implementation should introduce a replacement profile API, resume repository, answer engine, Job Outreach flow, or Gmail sender.
