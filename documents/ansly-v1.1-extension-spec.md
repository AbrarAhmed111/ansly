# Ansly V1.1 — Extension Fixes Spec

Date: 2026-10-02
Based on: `documents/product-audit.md` (2026-10-02)

This spec covers six problems with the current extension. File paths refer to the repository map in the audit.

| # | Problem | Fix in one line |
| --- | --- | --- |
| 1 | Extension runs on every website | Off by default; user enables per site from the popup |
| 2 | Many fields are missed | Typed field model, iframe + shadow DOM scanning, debug mode, right-click fallback |
| 3 | No way to answer all fields at once | Page panel: "8 fields detected → Fill all" with a batch API |
| 4 | Popover only has Regenerate and Fill | Length (Concise / Standard / Detailed) and Tone controls |
| 5 | Cover letters come out short | Category-based default length; cover letters default to Detailed |
| 6 | Missing info is a dead end | Ask inline, save the answer to the profile, regenerate |

Product guarantee stays the same: **Ansly fills only after a user click and never submits a form.**

---

## 1. Off by default, enabled per site

### Behaviour

- Fresh install: Ansly does nothing on any site.
- Popup shows the current site with two actions:
  - **Scan this page** — one-time scan of the current tab only. Nothing persists.
  - **Always run on linkedin.com** — permanently enables the site.
- Popup lists enabled sites with a remove (×) on each.
- Popup offers quick-enable chips for common ATS domains (not enabled by default): `linkedin.com`, `indeed.com`, `greenhouse.io`, `lever.co`, `ashbyhq.com`, `myworkdayjobs.com`, `smartrecruiters.com`, `workable.com`.
- Web `/settings` gets an "Enabled sites" section (this also closes the audit's "no in-web list of disabled sites" gap). Sync via the existing web bridge or `chrome.storage.sync`.
- The keyboard shortcut on a non-enabled site performs a one-time **Scan this page**.

### Implementation

Use Chrome's permission model rather than a settings flag over a match-all content script. This also helps Chrome Web Store review, since `<all_urls>` host permissions trigger extra scrutiny.

- `extension/wxt.config.ts` (manifest):
  - Remove the broad `matches` from the application content script (`entrypoints/content/index.tsx`). Mark it `registration: 'runtime'` so it is not declared statically.
  - Add `permissions: ['storage', 'activeTab', 'scripting', 'contextMenus']`.
  - Add `optional_host_permissions: ['https://*/*']`.
  - Keep `web-bridge.content.ts` statically matched to `WXT_WEB_URL` only.
- **Scan this page**: popup click → `chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: [contentScript] })`. `activeTab` grants this without a permanent permission.
- **Always run on site**: popup click (must be inside the user gesture) →
  1. `chrome.permissions.request({ origins: ['https://*.linkedin.com/*'] })`
  2. `chrome.scripting.registerContentScripts([{ id: 'ansly-linkedin.com', matches: [...], js: [...], allFrames: true, matchOriginAsFallback: true, runAt: 'document_idle', persistAcrossSessions: true }])`
  3. Inject into the current tab immediately so the user doesn't need to reload.
- **Remove site**: `unregisterContentScripts` + `chrome.permissions.remove`.
- Match by registrable domain with subdomains (`*://*.domain/*` and `*://domain/*`). Use a small public-suffix helper (e.g. `tldts`) to get the domain from the hostname.
- Store the list as `enabledSites: string[]` in extension settings; the registered scripts are the source of truth, the list is for display. On `runtime.onStartup`, reconcile the list with `getRegisteredContentScripts()`.

### Embedded application forms

Many company career pages embed Greenhouse, Lever or Ashby in an iframe. Enabling `acme.com` alone won't reach the form.

- Content script runs with `allFrames: true`.
- When a top frame contains an iframe from a known ATS domain that isn't enabled, the popup shows: "This form is hosted by greenhouse.io — enable it too?"

### Migration

- On update from V1, do **not** carry over "enabled everywhere". Open a one-time notice in the popup explaining the change, with the quick-enable chips.
- Replace `disabledHosts` with `enabledSites`; drop the "Disable on current hostname" toggle.

### Acceptance

- Fresh install: no Ansly buttons on any page, no content script in DevTools sources.
- Enable linkedin.com: buttons appear without reload; persist across browser restart.
- Remove it: buttons disappear on next load; permission removed in `chrome://extensions`.
- Scan this page on an un-enabled site works once and does not persist after navigation.

---

## 2. Detect more fields

### Likely causes of misses today

Check each against the live failures, but these are the usual ones given the current scanner:

1. **Strict question filter.** Fields are kept only if the label starts with Why / Describe / Tell us / etc. Real questions like "Years of experience with React?", "Expected salary", "Are you willing to relocate?", "Notice period" are dropped.
2. **Field kinds skipped entirely.** Selects, radios, checkboxes, and URL/number inputs are excluded, but many screening questions are radios or dropdowns.
3. **Custom controls.** `role="combobox"` (react-select on Greenhouse/Ashby), `role="radiogroup"`, `role="textbox"`, Workday `data-automation-id` widgets are not candidates.
4. **Iframes.** Content script not running in embedded ATS frames.
5. **Shadow DOM.** `querySelectorAll` does not enter open shadow roots.
6. **Label extraction gaps.** `aria-describedby`, labels in sibling/ancestor `div`s (Workday, LinkedIn Easy Apply), `data-automation-id` labels.
7. **Visibility timing.** Multi-step modals (LinkedIn Easy Apply) swap content; the observer must watch `childList` + `subtree`, not just attributes.

### New field model

Replace the include/exclude decision in `extension/src/lib/detection/classify.ts` with a typed classification. Every field gets a type; nothing is silently dropped unless it is genuinely irrelevant.

```ts
// packages/types/src/fields.ts
export type FieldKind =
  | 'open_text'      // essay / free-form textarea → LLM
  | 'short_text'     // short factual question → LLM, concise
  | 'profile'        // name, email, phone, LinkedIn, GitHub, portfolio, city → direct from profile, no LLM
  | 'choice_single'  // select, radio group, combobox → choose option
  | 'choice_multi'   // checkbox group, multi-select
  | 'number'         // years of experience, salary
  | 'ignored';       // search, password, file upload, captcha, consent checkboxes, hidden

export interface DetectedField {
  id: string;                 // stable per page session
  kind: FieldKind;
  question: string;
  options?: string[];         // for choice fields
  maxLength?: number;
  required: boolean;
  frameId?: number;
  profileKey?: ProfileKey;    // for kind 'profile'
  skipReason?: string;        // for kind 'ignored', shown in debug mode
}
```

Rules:

- `profile` fields are filled from profile values directly — no LLM call, instant, deterministic. (Today they are skipped; for "fill all" they should be filled.)
- `choice_single` / `choice_multi`: send the question **and** the option list to the API; the model must return one of the given options or `insufficient_information`. Logistics choices (sponsorship, relocation, work mode) are answered deterministically from profile preferences before any LLM call.
- `ignored`: file uploads (resume upload remains out of scope), passwords, search, captchas, EEO/demographic questions (see below), terms/consent checkboxes.
- **EEO / demographic questions** (gender, race, veteran, disability): classify as `ignored` with reason `eeo` and never auto-answer. These are voluntary and personal; the user answers them themselves.

### Scanner changes (`extension/src/lib/detection/scan.ts`)

- Candidates: `input, textarea, select, [contenteditable], [role=textbox], [role=combobox], [role=radiogroup], [role=listbox], fieldset` containing radios/checkboxes.
- Group radios/checkboxes by `name` (or by enclosing `fieldset` / `[role=radiogroup]`) into one field.
- Recursive walk into open shadow roots.
- Observer: `childList: true, subtree: true` plus the current attribute list; debounce ~300 ms.

### Question extraction (`extension/src/lib/detection/question.ts`)

Add to the extraction order:

- `aria-describedby` text (after `aria-labelledby`).
- Nearest preceding text block within the same field container (walk up max 4 ancestors, take the first text node that is not the field's own value/placeholder).
- `data-automation-id` / `data-testid` label conventions (Workday).
- For react-select comboboxes: the label linked to the hidden input, not the visible input.

### Debug mode and fallback

- **Detection debug** toggle in popup. When on, every candidate gets an outline: green = detected (with kind), grey = ignored (hover shows `skipReason`).
- **Copy diagnostics** button: copies a sanitized JSON of detected/ignored fields (question, kind, tag, role, attributes, skip reason — **no field values**) plus the hostname. This is the "record exact failures" step the audit recommends; paste it into a fixture.
- **Right-click → "Answer with Ansly"** (`contextMenus`, `contexts: ['editable']`) opens the popover for any field, detected or not. Misses are never a dead end.

### Tests

- Add fixtures to the existing detection tests from real pages: LinkedIn Easy Apply step, Greenhouse (classic + new job-boards), Lever, Ashby, Workday, Indeed. Each fixture asserts expected field count and kinds.
- Every diagnostics dump from a real miss becomes a new fixture.

### Acceptance

- On each fixture, all visible questions are detected with the right kind.
- Radios/selects for sponsorship, relocation and work mode are detected and filled from profile without an LLM call.
- EEO questions are detected as ignored and never filled.

---

## 3. Fill all fields

### Behaviour

When fields are detected, show a small floating pill in the page corner (shadow DOM, same as the popover):

> **Ansly · 8 fields** ▸

Clicking it opens the **page panel**:

```
Ansly found 8 fields on this page
  Profile (4)      Name, Email, Phone, LinkedIn          instant
  Questions (3)    Why this company? · Describe a project · Cover letter
  Needs you (1)    Notice period                          [ answer ]

  Length [Standard ▾]   Tone [Professional ▾]

  [ Fill all ]
```

**Fill all**:

1. Fills `profile` fields immediately.
2. Matches saved answers for all questions (batch).
3. Generates the rest in one batch request.
4. Fills each field as its answer arrives; panel rows show status (filled / low confidence / needs info / failed).
5. Fields that need information are not filled; they stay in "Needs you" (see §6).

After filling:

- Each filled field gets a subtle Ansly outline. Clicking the field's Ansly button opens the normal popover for that field (edit, regenerate with different length/tone, re-fill).
- **Undo** per row and **Undo all** restore the previous values.
- **Low-confidence** answers are filled but flagged amber in the panel so the user reads them first.
- Ansly never clicks Next or Submit. On a multi-step form (LinkedIn Easy Apply), after the user moves to the next step the pill updates its count and they click Fill all again.
- Already-filled fields (non-empty before Ansly) are skipped by default, with an option "Overwrite fields that already have text".

The review-before-fill guarantee becomes "review on the page before submit": the user still reads everything before submitting manually. Add a popup setting **Review answers before filling** (default off) for users who want the old per-answer review — when on, Fill all shows the answers in the panel first with one confirm.

### API

New endpoints in `llm/src/app/api/routes/answers.py` and `saved_answers.py`:

`POST /api/v1/answers/generate-batch`

```jsonc
{
  "job_context": { "company": "...", "role": "...", "description": "...", "url": "..." },
  "style": { "length": "standard", "tone": "professional" },  // page-level default
  "items": [
    { "id": "f1", "question": "...", "field": { "kind": "open_text", "maxLength": 1000 } },
    { "id": "f2", "question": "...", "field": { "kind": "choice_single", "options": ["Yes", "No"] } }
  ]
}
```

Response: `{ "results": [ { "id": "f1", ...AnswerResponse } ] }` — same per-item shape as `generate`.

`POST /api/v1/saved-answers/match-batch` — same idea for saved-answer matching.

Engine:

- Fetch profile context **once** for the batch.
- Run prechecks per item (deterministic answers for logistics/choice and missing-skill checks don't go to the model).
- Send remaining items in **one** LLM call with a JSON array output, so the model can avoid repeating the same story across answers. Prompt rule: "Do not reuse the same example or project in more than one answer unless the question asks for it."
- Cap at ~10 items per call; split larger batches. If parsing the array fails, fall back to per-item generation.
- Rate limits: one burst-limit hit per batch; daily limit counts each generated item. Reject the batch with a clear message if it would exceed the daily limit, saying how many remain.
- Usage events: one `generate` event per item (no text, as today) plus one `fill_all` event.

Extension:

- `background.ts`: add `generateBatch` and `matchSavedBatch` handlers.
- `extension/src/lib/fill.ts`: add `fillChoice` (native select: set value + `change`; radio/checkbox: `.click()`; react-select combobox: focus, type option text, dispatch `keydown Enter` — best-effort, verify, report failure) and `snapshotValue` / `restoreValue` for undo.

### Acceptance

- On a page with 4 profile fields and 3 questions, one click fills all 7 within one batch round-trip.
- No Next/Submit click ever happens.
- Undo all restores every field exactly.
- A batch that exceeds the daily limit fails cleanly with remaining count shown.

---

## 4. Length and tone controls

### Popover (`extension/src/components/content/Popover.tsx`)

Add above the answer textarea:

- **Length** (segmented): Concise · Standard · Detailed
- **Tone** (dropdown): Professional (default) · Friendly · Enthusiastic · Confident · Formal · Technical
- **Custom instruction** (small input, optional) — same as the playground.

Changing length or tone shows an **Apply** button (not auto-regenerate, to avoid burning generations on every click). Apply calls `regenerate` with the new style. Keep the existing Regenerate button for "same settings, new attempt".

Popup settings: **Default length** (Auto) and **Default tone** (Professional). "Auto" means use the category default from §5.

### Contract (`packages/types/src/api.ts`)

```ts
export type AnswerLength = 'auto' | 'concise' | 'standard' | 'detailed';
export type AnswerTone = 'professional' | 'friendly' | 'enthusiastic' | 'confident' | 'formal' | 'technical';

export interface AnswerStyle {
  length: AnswerLength;
  tone: AnswerTone;
  instruction?: string;
}
// add `style?: AnswerStyle` to generate, regenerate and generate-batch requests
```

Send length and tone as structured fields rather than folding them into the free-text instruction, so the API can apply word targets and the playground presets can map onto the same values.

### Prompt (`llm/src/app/answers/prompt.py`)

| Length | Target |
| --- | --- |
| Concise | 1–3 sentences, ~40–80 words |
| Standard | ~80–150 words |
| Detailed | ~180–300 words |
| Detailed (cover letter) | ~250–400 words, 3–4 paragraphs |

- The field's `maxLength` always wins; the target is clamped to it.
- Tone changes wording only. The grounding rules stay above the style rules in the prompt so a tone like "Enthusiastic" or "Confident" can never introduce facts.

### Acceptance

- Same question at Concise vs Detailed produces visibly different lengths within the targets.
- With `maxLength: 300`, Detailed still fits in 300 characters.
- Tone changes never introduce facts absent from the profile (add grounding tests per tone).

---

## 5. Cover letters default to Detailed

### Classification

Confirm or add a `cover_letter` category in the classifier (`llm/src/app/answers/` classifier and the extension's local classifier). Signals: label contains "cover letter", "motivation letter", "letter of motivation", or "covering letter"; or a large textarea with no `maxLength` whose label mentions "letter".

### Default length by category (when length is `auto`)

| Category | Default |
| --- | --- |
| cover_letter | Detailed (cover-letter target) |
| motivation / why this company / why this role | Standard |
| behavioural / describe a project | Standard |
| skill_check (yes/no, years) | Concise |
| logistics | Concise (usually deterministic) |
| other | Standard |

The user's explicit choice in the popover or panel always overrides the default. The popover shows the chosen default, e.g. "Detailed · auto for cover letters".

### Cover-letter prompt additions

- 3–4 paragraphs: opening tied to the role and company; 1–2 paragraphs of relevant experience/projects from the profile; closing.
- Use company and role from job context. If job description use is off, the popover shows a hint: "Cover letters are better with the job description — enable in settings."
- No greeting or signature unless the field label asks for a full letter; then use the profile full name as signature.

Note: the audit lists "cover letter generation" as out of V1. This is different — it's answering a cover-letter **field** on an application form, not a cover-letter product. Worth stating in the product doc so the scope line stays clear.

### Acceptance

- A "Cover letter" field with no user choice generates 250–400 words in paragraphs.
- Switching that field to Concise works.

---

## 6. Ask for missing information and learn it

### Behaviour

When an answer comes back `insufficient_information`, the popover (or the panel's "Needs you" row) asks inline instead of only linking to the web app:

```
Ansly doesn't have this yet
  What is your notice period?
  [ 1 month                    ]
  ☑ Save to my profile
  [ Save & answer ]
```

On **Save & answer**: write the information, then regenerate (or fill directly for deterministic fields) and continue. Next time a similar question appears, it's answered without asking.

### Structured missing information

Change `missingInformation` from free text to structured items:

```ts
export interface MissingInfo {
  key: string;            // e.g. 'notice_period', 'skill:kubernetes', 'fact:leadership_example'
  prompt: string;         // question shown to the user
  input: 'text' | 'textarea' | 'select' | 'boolean' | 'number' | 'skill';
  options?: string[];
  target:
    | { type: 'profile_field'; field: ProfileField }   // logistics → profiles table
    | { type: 'skill'; name: string }                   // → skills table
    | { type: 'fact'; category: string };               // → new profile_facts table
}
```

The prechecks already know what is missing for logistics and skill checks, so they produce exact targets. For model-reported gaps, the model returns `key` + `prompt` and the API maps it to `fact`.

### Where answers are saved

| Target | Example | Saved to |
| --- | --- | --- |
| profile_field | Notice period, salary, sponsorship, relocation, work mode | `profiles` (existing columns) |
| skill | "Do you have Kubernetes experience?" | `skills` row, quick form: years + level, or "I don't have this" |
| fact | "Describe a time you led a team" with no leadership in profile | New `profile_facts` table |

"I don't have this skill" is a valid answer: store it (`skills` row with `level = 'none'` or a fact) so the next answer is an honest "No" instead of asking again.

### New table: `profile_facts`

Migration `supabase/migrations/2026100300000_profile_facts.sql`:

- Columns: `id`, `user_id`, `category`, `prompt`, `answer`, `source` (`extension` | `web`), `created_at`, `updated_at`.
- RLS identical to the other section tables (own rows only, anon revoked).
- Included in `profile_context.py` retrieval as candidate facts.
- New web profile section **Additional details** (`/profile/additional`) to view, edit and delete these, and counted in completeness.

Facts vs saved answers: a **fact** is grounding material the model can use in any answer; a **saved answer** is verbatim text reused for similar questions. The ask dialog offers both: "Save to my profile" (fact, default on) and "Also reuse this exact answer for similar questions" (saved answer, default off).

### API

- `POST /api/v1/profile/missing` — body `{ items: [{ key, target, value }] }`; writes with the user's JWT under RLS (same pattern as profile reads), returns updated targets.
- The extension then calls `regenerate` (single) or re-runs the affected items in `generate-batch` (panel).

### Acceptance

- Notice-period question with blank preference: inline prompt → saved to `profiles` → filled. Next form with the same question fills without asking.
- Missing skill: "I don't have this" → next yes/no on that skill answers "No" without asking.
- Fact saved from the extension appears in `/profile/additional` and is used as grounding in a later different question.

---

## Build order

Each step is releasable on its own.

1. **Per-site enablement** (§1) — smallest change, biggest annoyance removed, and required for Chrome Web Store review anyway.
2. **Length/tone + category defaults** (§4, §5) — contract and prompt changes only; popover UI.
3. **Detection overhaul + debug mode + right-click fallback** (§2) — then do live ATS QA with diagnostics dumps and turn them into fixtures.
4. **Ask-and-learn** (§6) — migration, API endpoint, popover UI, web section.
5. **Fill all** (§3) — depends on 2–4: typed fields, choice filling, style, and the "Needs you" flow.

## Shared contract changes summary

`packages/types/src/`:

- `fields.ts` (new): `FieldKind`, `DetectedField`, `ProfileKey`.
- `api.ts`: `AnswerStyle`, `AnswerLength`, `AnswerTone`; `style` on generate/regenerate; batch request/response; `MissingInfo`; `options` on field context; `cover_letter` category.
- `database.ts`: `profile_facts` row type.
- `completeness.ts`: include additional details.
- Extension settings type: `enabledSites`, `defaultLength`, `defaultTone`, `reviewBeforeFill`, `overwriteFilled`, `detectionDebug`; remove `disabledHosts`.

## Risks to keep in view

- **LinkedIn terms.** LinkedIn's user agreement restricts browser extensions that automate activity on the site. Ansly's user-click-only, no-submit, no-scraping design is the right posture, but Fill all is closer to automation than single-field fill. Keep it user-initiated per step and never navigate.
- **Choice fields on custom widgets** (react-select, Workday dropdowns) are the most likely fill failures. Verify after fill and report "couldn't fill — select manually" rather than failing silently.
- **Batch answers are longer prompts** — watch provider latency and token limits; the per-item fallback must work.
- **Optional host permissions** change install UX; test the permission prompt flow on Chrome and Edge.
- **Daily limits** — Fill all can use 5–10 generations in one click. Confirm the production daily limit is sized for that.
