# Ansly v1.2 — Resume Tailoring

> **Ansly detects the job you're viewing, tailors your master resume to that job using only your real experience, and gives you a ready-to-download version.**

| Version | Promise | Status |
|---|---|---|
| **V1** | "I found a job and I'm applying. Help me answer the questions." | Built |
| **v1.2** | "I found a job. Tailor my resume for it." | This plan |
| **V2** | "Find, prepare, manage and automate my job applications." | Later |

v1.2 replaces today's manual workflow of copying a job description into a chatbot, getting a tailored resume back, downloading it and returning to the application.

It is **not** job automation. It adds a resume-tailoring layer to the existing V1 product.

---

## Table of Contents

1. [Starting Point](#1-starting-point)
2. [User Journey](#2-user-journey)
3. [Core Principle: Tailor, Don't Fabricate](#3-core-principle-tailor-dont-fabricate)
4. [Sources of Truth](#4-sources-of-truth)
5. [Document Pipeline](#5-document-pipeline)
6. [Job Detection](#6-job-detection)
7. [Tailoring Pipeline](#7-tailoring-pipeline)
8. [What AI May and May Not Change](#8-what-ai-may-and-may-not-change)
9. [Validation Layer](#9-validation-layer)
10. [Data Model](#10-data-model)
11. [API Surface](#11-api-surface)
12. [Shared Types](#12-shared-types)
13. [Repository Changes](#13-repository-changes)
14. [Web App Changes](#14-web-app-changes)
15. [Extension Changes](#15-extension-changes)
16. [Privacy, Analytics and Limits](#16-privacy-analytics-and-limits)
17. [Error Handling](#17-error-handling)
18. [Scope Boundary](#18-scope-boundary)
19. [Development Phases](#19-development-phases)
20. [Dependency Map](#20-dependency-map)
21. [Open Decisions](#21-open-decisions)
22. [Success Criterion](#22-success-criterion)

---

## 1. Starting Point

v1.2 builds on infrastructure V1 already has:

| V1 capability | How v1.2 uses it |
|---|---|
| Structured profile (experience, projects, skills, education, achievements) with RLS | Primary evidence source for tailoring |
| FastAPI service with Supabase JWT auth, user-scoped reads, rate limits | Hosts the job-analysis, matching and tailoring pipeline |
| LLM gateway with provider fallback | Runs each pipeline step |
| Skill and logistics prechecks against the profile corpus | Reused for deterministic requirement matching |
| `extension/src/lib/job-context.ts` (company, role, opt-in description) | Extended into full job-page detection |
| Content script with Shadow DOM UI and background API client | Hosts the "Tailor resume?" card and states |
| Web-to-extension bridge and `openWebApp` | Sends the user to upload, review and preview screens |
| `usage_events` that store no question or answer text | Gets new tailoring event kinds under the same privacy rule |
| Settings export/import | Extended to include resumes metadata |

> **Precondition:** the V1 release gaps listed in the audit (production deploy, Supabase redirect URLs, Chrome Web Store listing, live ATS QA) should be closed or tracked separately, so v1.2 isn't built on an unreleased base.

---

## 2. User Journey

```text
1.  Upload master resume (web app, once)
        ↓
2.  Review parsed resume and resolve profile discrepancies
        ↓
3.  Browse LinkedIn / Indeed / a career page normally
        ↓
4.  Open a job → Ansly recognizes it
        ↓
5.  Small card: "Tailor your resume for this job?"
        ↓
6.  Click Tailor Resume
        ↓
7.  Ansly analyzes requirements
        ↓
8.  Ansly matches requirements against your real experience
        ↓
9.  Ansly builds a tailored copy (master untouched)
        ↓
10. Validation checks every change
        ↓
11. Review: what changed, what's unsupported
        ↓
12. Preview → Download PDF
        ↓
13. Upload resume to the application
        ↓
14. Ansly V1 answers application questions as before
        ↓
15. User reviews and submits manually
```

**Detected-job card:**

```text
┌─────────────────────────────────────┐
│ Ansly                               │
│                                     │
│ Senior Full Stack Engineer          │
│ Company X                           │
│                                     │
│ Tailor your resume for this job?    │
│ 14 requirements detected            │
│                                     │
│ [ Tailor Resume ]     [ Not now ]   │
└─────────────────────────────────────┘
```

**Result card:**

```text
┌──────────────────────────────────────────┐
│ Resume tailored                          │
│                                          │
│ Requirements analyzed:        18         │
│ Supported by your experience: 14         │
│ Partially supported:           2         │
│ No supporting evidence:        2         │
│                                          │
│ Changes:                                 │
│ • 3 experience bullets rewritten         │
│ • OnTask moved higher                    │
│ • TypeScript, PostgreSQL emphasized      │
│ • Summary updated                        │
│                                          │
│ [ Review & Preview ]  [ Download PDF ]   │
└──────────────────────────────────────────┘
```

No headline "92% match" score. Show counts and the actual requirements instead.

---

## 3. Core Principle: Tailor, Don't Fabricate

A job requirement is **never** permission to invent experience. This is the V1 grounding rule extended to whole documents.

| Job asks for | Candidate evidence | Ansly does |
|---|---|---|
| AWS | Present in profile | May emphasize |
| Docker | Present in profile | May emphasize |
| Kubernetes | No evidence | Does **not** add; lists it as unsupported |

**Good tailoring:**

- Master: *Built web applications using React and Node.js.*
- Evidence: React ✓, TypeScript ✓, PostgreSQL ✓, SaaS ✓
- Tailored: *Built scalable SaaS applications using React, TypeScript, Node.js and PostgreSQL, developing production-ready interfaces and backend services.*

**Forbidden tailoring:**

- Master: *Improved page load performance.*
- Job: *Experience improving performance by 40%+.*
- ✗ *Improved page performance by 40%.*

**Metric rule:** an existing metric may be preserved, but a new metric is never invented.

---

## 4. Sources of Truth

```text
                  Candidate
                     │
          ┌──────────┴──────────┐
          │                     │
   Structured Profile      Master Resume
   (facts, V1 tables)    (parsed → Structured Resume JSON)
          │                     │
          └──────────┬──────────┘
                     │
              Evidence Corpus
                     │
              Tailoring Engine
                     │
              Tailored Resume (copy)
```

- **Evidence corpus** is the profile rows plus the parsed master resume. A claim in the tailored resume must trace back to at least one evidence item.
- **The master resume is never modified.** Each tailoring produces a new record.
- **Conflicts are flagged, not resolved.** For example, the resume might say *Senior Software Engineer, Nizam LLC* while the profile says something different. Ansly shows the discrepancy, the user picks, and neither side is silently overwritten.
- **Master resume versions.** Replacing the master creates a new version. Old tailorings keep pointing at the version they were built from.

---

## 5. Document Pipeline

Never let the AI edit a binary PDF or DOCX.

```text
Upload (PDF / DOCX)
       ↓
Text extraction
       ↓
Section identification + LLM-assisted parse
       ↓
Structured Resume JSON  ← user reviews and corrects
       ↓
Tailoring operations on JSON
       ↓
Validation
       ↓
Renderer (Ansly template)
       ↓
PDF
```

| Stage | v1.2 choice |
|---|---|
| Input formats | PDF, DOCX |
| Internal format | Structured Resume JSON (versioned schema) |
| Output | PDF (required), DOCX (only if the renderer supports it cleanly) |
| Layout | One clean, ATS-friendly Ansly template. Mimicking the original document's styling is deferred. |
| Storage | Private Supabase Storage bucket, path-scoped per user |

---

## 6. Job Detection

V1's `job-context.ts` extracts company, role and an optional description from **application** pages. v1.2 extends it into a detector for **job posting** pages.

```ts
type JobContext = {
  title: string
  company: string
  location?: string
  employmentType?: string
  description: string        // required for tailoring
  url: string
  source: 'json-ld' | 'linkedin' | 'indeed' | 'generic' | 'manual'
}
```

**Detector order:**

```text
1. schema.org JobPosting JSON-LD   (many ATS and career pages ship it)
2. Site adapters: LinkedIn, Indeed
3. Generic heuristic detector (title + company + long description block)
4. Manual fallback: paste the job description in the web app
```

Rules:

- Only read the page the user is viewing, and only after they click **Tailor Resume**. There is no crawling or background collection.
- Respect the existing per-hostname disable setting, plus a new "Offer resume tailoring on job pages" toggle.
- A minimum description length is required before the card offers tailoring.
- This is the first place V1 adds site adapters. Keep them small and isolated, and don't let them become a scraping project.

---

## 7. Tailoring Pipeline

Use a pipeline of small structured steps, not one giant prompt. Each step's output is stored so failures can be debugged.

```text
STEP 1  JobContext            → JobAnalysis
STEP 2  Profile + Master      → Evidence corpus
STEP 3  Analysis + Evidence   → RequirementMatch[]   (deterministic first, LLM for semantics)
STEP 4  Matches + Master      → TailoringPlan
STEP 5  Plan                  → Tailored Structured Resume
STEP 6  Tailored resume       → Validation report
STEP 7  Validated resume      → Rendered PDF
```

**Step 1 — Job analysis**

```json
{
  "role": "Senior Full Stack Engineer",
  "company": "Company X",
  "mustHave": [
    { "requirement": "React", "type": "skill" },
    { "requirement": "5+ years experience", "type": "experience" }
  ],
  "niceToHave": [
    { "requirement": "Kubernetes", "type": "skill" }
  ],
  "responsibilities": ["..."]
}
```

**Step 3 — Requirement matching**

| Requirement | Evidence | Support |
|---|---|---|
| React | WebWhiz, OnTask | Strong |
| TypeScript | OnTask, projects | Strong |
| PostgreSQL | OnTask | Strong |
| Kubernetes | — | None |

Skill requirements are checked against the profile corpus first, reusing V1's skill precheck. The LLM only handles semantic matches such as "SaaS platforms" or "led small teams", and it must cite evidence IDs.

**Step 4 — Tailoring plan.** The plan is restricted to controlled operations:

| Operation | Meaning |
|---|---|
| `reorder` | Move relevant experience or projects up |
| `emphasize` | Make an existing skill more visible |
| `rewrite_bullet` | Reword an existing bullet to foreground a supported capability |
| `select` | Choose which projects appear |
| `reduce` | Shorten or drop less relevant content |
| `align_terms` | Use the job's terminology only where it accurately describes existing evidence |
| `update_summary` | Rewrite the summary from evidence |

```json
{
  "changes": [
    { "section": "experience", "item": "nizam-llc", "action": "rewrite_bullet",
      "evidenceIds": ["exp_12", "proj_3"], "reason": "TypeScript + SaaS requirements" },
    { "section": "projects", "item": "ontask", "action": "reorder",
      "position": 0, "reason": "Collaboration/SaaS match" }
  ]
}
```

Operations are applied to the JSON in code. The model proposes changes but never writes the final document directly.

---

## 8. What AI May and May Not Change

| Allowed | Not allowed |
|---|---|
| Rewrite an existing bullet | Invent a technology |
| Reorder projects, experience, skills | Invent employment or a project |
| Change emphasis, improve wording | Invent or inflate metrics |
| Combine redundant bullets | Change years of experience |
| Remove an irrelevant bullet | Change job titles, dates, company names |
| Adjust the summary | Claim an unsupported certification, responsibility or achievement |
| Use job terminology when factually supported | Change URLs or contact details |

---

## 9. Validation Layer

Validation runs after every tailoring, before anything is shown to the user. Deterministic checks come first and the LLM check comes last.

| Check | How | On failure |
|---|---|---|
| **Protected fields** | Titles, companies, dates, URLs and contact details must equal the source exactly | Revert the field and log it |
| **Metrics** | Every number or percentage in the output must exist in the evidence corpus | Remove the claim and warn |
| **Unsupported technology** | Every skill or technology token must exist in the evidence corpus | Remove it and warn |
| **Traceability** | Every rewritten bullet must cite evidence IDs that exist | Revert to the original bullet |
| **Keyword integrity** | No high-value skill from the master was dropped without a `reduce` reason | Restore it |
| **Hallucination review** | LLM pass: "does any sentence claim something not in evidence?" | Flag for user review |
| **Formatting** | Rendered page count within limit, no empty sections, no overflow | Re-render tighter or warn |

Unsupported requirements never fail the operation. The resume is generated, and the review screen lists those requirements clearly.

---

## 10. Data Model

New Supabase tables. All of them have RLS for owner-only read/write, matching V1 policy, and anon access is revoked.

### `resumes`

| Column | Notes |
|---|---|
| `id` | uuid |
| `user_id` | owner |
| `name` | display name |
| `file_path` | Storage path of the original upload |
| `file_type` | `pdf` / `docx` |
| `parsed_content` | Structured Resume JSON |
| `parse_status` | `pending` / `parsed` / `needs_review` / `failed` |
| `version` | increments on replace |
| `is_master` | one active master per user (partial unique index) |
| `created_at`, `updated_at` | |

### `job_contexts`

| Column | Notes |
|---|---|
| `id` | uuid |
| `user_id` | owner |
| `title`, `company`, `location`, `employment_type` | |
| `url` | |
| `description` | job description text only; never page HTML |
| `source` | `json-ld` / `linkedin` / `indeed` / `generic` / `manual` |
| `analysis` | JobAnalysis JSON |
| `created_at` | |

### `resume_tailorings`

| Column | Notes |
|---|---|
| `id` | uuid |
| `user_id` | owner |
| `resume_id` | master used |
| `resume_version` | master version at the time |
| `job_context_id` | |
| `match_analysis` | RequirementMatch[] |
| `tailoring_plan` | TailoringPlan |
| `tailored_content` | Structured Resume JSON |
| `validation_report` | checks, warnings, reverted changes |
| `output_file_path` | rendered PDF in Storage |
| `pipeline_version` | e.g. `1.1.0` |
| `status` | `queued` / `analyzing` / `matching` / `tailoring` / `validating` / `rendering` / `ready` / `failed` |
| `error` | user-safe failure reason |
| `created_at`, `updated_at` | |

### Storage

- Bucket `resumes` (private). Paths look like `{user_id}/masters/...` and `{user_id}/tailored/...`.
- Storage policies restrict each user to their own prefix. Downloads use short-lived signed URLs.

### Later (V2)

```text
application → job_context → resume_tailoring → application answers
```

---

## 11. API Surface

New FastAPI routes follow V1 conventions: `/api/v1`, Supabase JWT, user-scoped reads, rate limits and usage events.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/resumes` | Register an uploaded master (after the web app uploads to Storage) and start parsing |
| `GET` | `/api/v1/resumes/master` | Current master, parse status, discrepancies |
| `PATCH` | `/api/v1/resumes/{id}` | Save the user's corrections to the parsed content |
| `POST` | `/api/v1/jobs/analyze` | Store a JobContext and return a JobAnalysis |
| `POST` | `/api/v1/tailorings` | Start a tailoring (`jobContextId`, optional `resumeId`) and return `id` + `status` |
| `GET` | `/api/v1/tailorings/{id}` | Poll status; when ready, return the changes, match summary and warnings |
| `GET` | `/api/v1/tailorings` | History list |
| `GET` | `/api/v1/tailorings/{id}/download` | Signed URL for the PDF |
| `DELETE` | `/api/v1/tailorings/{id}` | Delete the record and its file |

Tailoring takes several LLM calls and will likely run for tens of seconds. It runs as a background job with status polling, not a single blocking request.

**Tailoring response (ready):**

```json
{
  "id": "...",
  "status": "ready",
  "summary": { "analyzed": 18, "supported": 14, "partial": 2, "unsupported": 2 },
  "changes": [
    { "section": "projects", "action": "reorder", "label": "OnTask moved higher" }
  ],
  "unsupportedRequirements": ["Kubernetes", "AWS EKS"],
  "warnings": ["1 metric removed: not found in your profile"],
  "pipelineVersion": "1.1.0"
}
```

---

## 12. Shared Types

New files in `packages/types/src/`, keeping web, extension and API aligned the way V1 does:

| File | Contents |
|---|---|
| `resume.ts` | `StructuredResume`, `ResumeRecord`, parse status |
| `job.ts` | `JobPosting` (the plan's JobContext; renamed because V1's answer `JobContext` already exists in `api.ts`), `JobAnalysis`, `JobRequirement` |
| `matching.ts` | `Evidence`, `RequirementMatch`, support levels |
| `tailoring.ts` | `TailoringPlan`, `TailoringChange`, `ValidationReport`, status enum, API request/response |

Update `database.ts` with the new row types and `api.ts` with the new endpoints.

---

## 13. Repository Changes

The new work stays isolated in the existing workspaces.

```text
web/src/app/(app)/resume/
├── page.tsx                  # master resume + tailored history
├── upload/                   # upload + parse review
├── discrepancies/            # profile ↔ resume conflicts
├── tailor/                   # manual JD paste fallback
└── [tailoringId]/            # review, preview, download

extension/src/lib/job/
├── detect.ts                 # detector orchestration
├── json-ld.ts                # schema.org JobPosting
├── adapters/linkedin.ts
├── adapters/indeed.ts
└── generic.ts
extension/src/components/content/
└── TailorCard.tsx            # detected-job card + states

llm/src/app/resume/
├── parsing/                  # PDF/DOCX text extraction + structuring
├── analysis/                 # JobContext → JobAnalysis
├── matching/                 # evidence corpus + RequirementMatch
├── tailoring/                # plan + apply operations
├── validation/               # protected fields, metrics, tokens, traceability
└── rendering/                # Structured Resume → PDF
llm/src/app/api/routes/
├── resumes.py
├── jobs.py
└── tailorings.py

supabase/migrations/
└── 2026xxxx_resume_tailoring.sql
```

---

## 14. Web App Changes

New **Resume** item in the app shell navigation.

```text
Ansly
├── Dashboard
├── Profile
├── Resume            ← new
│   ├── Master Resume
│   └── Tailored Resumes
├── Playground
├── Saved Answers
├── Extension
└── Settings
```

**Resume page**

```text
MASTER RESUME
Abrar_Ahmed_Resume.pdf · v3 · Updated Oct 2, 2026
[ View parsed ]  [ Replace ]
⚠ 2 differences from your profile → [ Review ]

────────────────────────────────

TAILORED RESUMES
Senior Full Stack Engineer · Company A · Oct 2   [Review] [Download]
Product Engineer · Company B · Oct 1             [Review] [Download]

[ + Tailor for a job description ]   ← manual paste fallback
```

**Review screen**

```text
Job: Senior Full Stack Engineer — Company X

Changes
Experience   ✓ 3 bullets rewritten        [show diff]
Projects     ✓ OnTask moved higher
             ✓ ToPrep moved lower
Skills       ✓ TypeScript, PostgreSQL emphasized
Summary      ✓ Updated

Unsupported requirements
○ Kubernetes   ○ AWS EKS          [ Add to profile ]

Warnings
! 1 metric removed: not found in your profile

[ Preview ]  [ Download PDF ]
```

Other web changes:

- Dashboard adds a tailored-resume count and a "Upload master resume" next step when there's no master yet.
- Settings export includes resume metadata and tailoring history. File contents are excluded unless the user explicitly opts in.
- The privacy page is updated to cover resume storage and job-description processing.

---

## 15. Extension Changes

**Heavy work stays on the backend.** The extension only detects, extracts, displays and hands off.

| Extension | Backend |
|---|---|
| Detect job page | Auth, resume retrieval |
| Extract JobContext on click | Job analysis |
| Show card and progress states | Evidence retrieval and matching |
| Send JobContext via background worker | Tailoring and validation |
| Show result summary | Rendering and storage |
| Open web review or trigger download | Usage events |

**New background handlers:** `analyzeJob`, `startTailoring`, `getTailoring` (poll), `downloadTailoring`.

**Card states**

| State | Copy |
|---|---|
| Job detected | *Tailor your resume for this job?* |
| No master resume | *Upload your master resume first.* [Upload Resume] |
| Analyzing | *Analyzing job…* |
| Matching | *Matching requirements with your experience…* |
| Tailoring | *Tailoring resume…* |
| Ready | *Your resume is ready.* [Review] [Download] |
| Warning | *Some requirements aren't supported by your profile. Review before downloading.* |
| Not enough job info | *There's not enough job information to tailor your resume.* [Paste description] |
| Error | *Resume tailoring failed. Your original resume has not been changed.* [Retry] |
| Not connected | Reuse V1's connect prompt |

**Popup** gets a new toggle, "Offer resume tailoring on job pages". The card never auto-expands; it starts as a small, dismissible pill.

---

## 16. Privacy, Analytics and Limits

**Privacy**, consistent with V1:

- Send only the JobContext fields (title, company, location, description, URL). Never send page HTML, cookies, browser history or unrelated page content.
- Extraction happens only when the user clicks.
- Resume files live in a private bucket, owner-only, with signed URLs for downloads.
- The API reads profile and resume data with the user's JWT, never a service role key.
- Deleting a tailoring deletes its file. Replacing a master keeps old versions until the user deletes them.

**Analytics:** new `usage_events` kinds. Resume or job text is never stored.

```text
resume_uploaded        resume_parse_failed
job_detected           tailoring_started
tailoring_completed    tailoring_failed
resume_previewed       resume_downloaded
tailoring_deleted
```

Track completion rate, download rate, failure rate, generation time and estimated cost per tailoring.

**Limits:** tailoring costs several times more than an answer generation, so it gets its own daily limit (separate from the V1 generation limit) plus the existing burst limiter. The limit values are set via env and confirmed before release.

---

## 17. Error Handling

| Case | Behavior |
|---|---|
| No job detected | *We couldn't identify this job.* Offer manual paste. |
| Description too short | *There's not enough job information to tailor your resume.* |
| No master resume | *Upload your master resume first.* Link to upload. |
| Parse failed | *We couldn't read this resume. Please upload another PDF or DOCX.* |
| Parse low-confidence | Mark the resume `needs_review` and require the user to confirm the parsed sections before first use |
| LLM / provider failure | Gateway fallback; if all fail: *Tailoring failed. Your original resume has not been changed.* |
| Validation reverted changes | Still deliver, and list the reverted items as warnings |
| Unsupported requirements | Never fail; list them on the review screen |
| Render overflow | Re-render tighter once; otherwise deliver with a page-count warning |
| Rate limit | Show when the user can try again |

---

## 18. Scope Boundary

**In v1.2**

- ✓ Upload, store, parse and version a master resume
- ✓ Review the parsed resume and resolve profile discrepancies
- ✓ Detect job pages (JSON-LD, LinkedIn, Indeed, generic) plus a manual paste fallback
- ✓ Job analysis: must-have, nice-to-have, responsibilities
- ✓ Requirement-to-evidence matching
- ✓ Controlled tailoring operations
- ✓ Validation that preserves factual accuracy
- ✓ Change review, preview and PDF download
- ✓ Tailoring history
- ✓ Extension card and states
- ✓ Analytics, limits, error handling, RLS

**Not in v1.2** (these belong to V2)

- ✗ Job search, scraping platform, recommendations
- ✗ Saved searches, job alerts
- ✗ Application tracking
- ✗ Auto-apply, automatic submission, automatic resume upload
- ✗ Autonomous browser agent
- ✗ Cover-letter platform
- ✗ Interview preparation
- ✗ Multi-job batch tailoring
- ✗ Reproducing the original resume's visual design

---

# 19. Development Phases

Each phase lists its tasks and an exit criterion. A phase counts as done when its exit criterion is met, not when every task is ticked.

## Overview

| # | Phase | Outcome |
|---|---|---|
| 1 | Foundations | Schema, storage, RLS, shared types in place |
| 2 | Master Resume Ingestion | Upload → parse → review → stored Structured Resume |
| 3 | Job Analysis & Matching | JobContext → JobAnalysis → evidence-backed matches (API) |
| 4 | Tailoring Engine | Matches → plan → tailored Structured Resume (API) |
| 5 | Validation & Rendering | Validated, rendered PDF stored and downloadable |
| 6 | Web Review & History | Manual JD → review → preview → download (**web MVP**) |
| 7 | Extension Job Detection & Card | Job page → Tailor → result in extension (**full v1.2**) |
| 8 | Hardening & Release | Evaluated, limited, monitored, released |

## Phase 1 — Foundations

**Tasks**

- [x] Migration: `resumes`, `job_contexts`, `resume_tailorings` with indexes and the one-master-per-user constraint
- [x] RLS policies (owner-only CRUD), anon revoked
- [x] Private Storage bucket `resumes` with per-user path policies
- [x] Extend `usage_events` allowed kinds
- [x] Shared types: `resume.ts`, `job.ts`, `matching.ts`, `tailoring.ts`; update `database.ts` and `api.ts`
- [x] Structured Resume JSON schema (versioned) with sample fixtures
- [x] Supabase migration tests, including RLS isolation for the new tables and storage
- [x] Separate daily tailoring limit config

**Exit criterion:** migrations apply cleanly, and RLS tests prove one user can't read another user's resumes, tailorings or files.

## Phase 2 — Master Resume Ingestion

**Tasks**

- [x] Web `Resume` nav item and page
- [x] Upload PDF/DOCX to Storage (size and type limits)
- [x] `POST /api/v1/resumes`: text extraction (PDF, DOCX)
- [x] Section identification and LLM-assisted parse into Structured Resume JSON
- [x] Parse confidence, with a `needs_review` state
- [x] Parsed-resume review/edit screen (`PATCH /api/v1/resumes/{id}`)
- [x] Replace master → new version; old versions retained
- [x] Profile ↔ resume discrepancy report (titles, companies, dates, skills), resolved by the user with no silent overwrite
- [x] Optional "add missing items to profile" from the resume, with explicit user confirmation per item
- [x] Parsing tests on a fixture set of real-world resume layouts

**Exit criterion:** your own master resume uploads, parses into correct sections, and its differences from your profile are shown and resolvable.

> Status: built and tested against PDF/DOCX fixtures in three layouts (`llm/tests/test_resume_parsing.py`). Confirm with your own resume.

## Phase 3 — Job Analysis & Matching

**Tasks**

- [x] `POST /api/v1/jobs/analyze`: store JobContext and produce JobAnalysis (must-have, nice-to-have, responsibilities, experience requirements)
- [x] Minimum-description guard
- [x] Evidence corpus builder (profile rows + parsed master, with stable evidence IDs)
- [x] Deterministic skill matching reusing V1's skill precheck
- [x] LLM semantic matching that must cite evidence IDs; uncited claims are rejected
- [x] Support levels: strong / partial / none
- [x] Summary counts (analyzed / supported / partial / unsupported)
- [x] Tests: a Kubernetes-style unsupported requirement is always `none`; cited evidence IDs always exist

**Exit criterion:** for 10 real job descriptions, every "supported" requirement points to real evidence and no unsupported skill is marked supported.

> Status: enforced in code (skills/certifications are deterministic; semantic matches must cite existing evidence) and tested. Run the evaluation on real job descriptions to close it.

## Phase 4 — Tailoring Engine

**Tasks**

- [x] TailoringPlan generation restricted to the controlled operations
- [x] Plan executor that applies operations to Structured Resume JSON in code
- [x] Bullet rewriting grounded in cited evidence
- [x] Summary rewrite from evidence
- [x] `POST /api/v1/tailorings` as a background job with status transitions
- [x] `GET /api/v1/tailorings/{id}` polling
- [x] Store every intermediate artifact (analysis, matches, plan, output)
- [x] `pipeline_version` stamping
- [x] Provider fallback through the existing gateway

**Exit criterion:** given a job and your master resume, the API returns a tailored Structured Resume and a human-readable change list, and the master record is unchanged.

> Status: met in `llm/tests/test_resume_api.py` (end to end with fakes).

## Phase 5 — Validation & Rendering

**Tasks**

- [x] Protected-field check (titles, companies, dates, URLs, contacts) with auto-revert
- [x] Metric check: no number in the output that isn't in evidence
- [x] Technology/skill token check against the evidence corpus
- [x] Traceability check on rewritten bullets
- [x] Keyword-integrity check on dropped skills
- [x] LLM hallucination review pass → warnings
- [x] Validation report stored on the tailoring
- [x] Resume renderer: Structured Resume → ATS-friendly PDF (one template)
- [x] Page-count/overflow check with one tighter re-render
- [x] Store the PDF in Storage; `GET /download` returns a signed URL
- [x] Adversarial test set: JDs demanding metrics, certifications and technologies the candidate lacks

**Exit criterion:** across the adversarial set, no invented metric, technology, title, date or company reaches the PDF, and every reverted change appears as a warning.

> Status: met — `test_adversarial_plan_never_reaches_the_pdf` extracts the rendered PDF's text and checks it.

## Phase 6 — Web Review & History (Web MVP)

**Tasks**

- [x] Manual "Tailor for a job description" form (paste JD, title, company, URL)
- [x] Progress UI driven by status polling
- [x] Review screen: changes by section, unsupported requirements, warnings
- [x] Bullet diff view
- [x] PDF preview
- [x] Download
- [x] Tailored resume history list; delete with confirmation (removes the file)
- [x] "Add to profile" link from unsupported requirements
- [x] Dashboard counts and "upload master resume" next step

**Exit criterion — Web MVP:** you can paste a real job description, review exactly what changed and why, and download a truthful tailored PDF without using the extension.

> Status: built (`web/src/app/(app)/resume/`). Needs a run against the deployed API.

## Phase 7 — Extension Job Detection & Card

**Tasks**

- [x] `extension/src/lib/job/`: JSON-LD JobPosting detector
- [x] LinkedIn and Indeed adapters
- [x] Generic heuristic detector
- [x] Detector tests on saved job-page fixtures
- [x] Respect the per-hostname disable setting and the new "Offer resume tailoring" toggle
- [x] `TailorCard.tsx` in the Shadow DOM: a small pill that expands on click
- [x] Background handlers: `analyzeJob`, `startTailoring`, `getTailoring`, `downloadTailoring`
- [x] All card states (no master, analyzing, matching, tailoring, ready, warning, not enough info, error, not connected)
- [x] "Review" opens the web review screen through `openWebApp`
- [x] Coexist with the V1 answer UI on pages that are both job and application pages (e.g. LinkedIn Easy Apply)
- [x] Host permissions reviewed and kept minimal

**Exit criterion — Full v1.2:** on live LinkedIn, Indeed and at least two career pages, you can click **Tailor Resume**, see progress, review the result and download the PDF.

> Status: built and tested on saved page fixtures (`extension/src/lib/__tests__/job-detect.test.ts`, `tailor-card.test.tsx`). Live-site QA is open.

## Phase 8 — Hardening & Release

**Tasks**

- [ ] Evaluation set: 20+ real job descriptions across your target roles, reviewed by hand for truthfulness and usefulness — *tooling ready (`llm/scripts/eval_tailoring.py`, `llm/evals/README.md`); needs your job descriptions and review*
- [x] Usage events wired end-to-end; dashboards for completion, failure, time and cost
- [ ] Daily tailoring limit values confirmed in production env — *`DAILY_TAILORING_LIMIT` (default 10)*
- [x] Monitoring: pipeline step failures, provider fallback rate, render failures
- [x] Error copy reviewed for every state
- [x] Settings export/import updated
- [x] Privacy policy updated for resume storage and job pages
- [ ] Chrome Web Store listing and privacy disclosures updated — *see release notes*
- [x] Root `pnpm check` green; extension, web, llm and Supabase tests extended
- [x] Extension version bump (0.2.0)
- [ ] Store resubmission
- [x] Release notes for v1.2

**Exit criterion:** v1.2 is live, and you've used it for your own real applications with no fabricated content reaching a downloaded resume.

---

## 20. Dependency Map

```text
Phase 1 ─► Phase 2 ─┐
                    ├─► Phase 4 ─► Phase 5 ─► Phase 6 (Web MVP) ─┐
Phase 1 ─► Phase 3 ─┘                                            ├─► Phase 8
                                                                 │
Phase 1 ─► Phase 7 (detectors only) ──────────► Phase 7 (card) ──┘
```

- Phases 2 and 3 can run in parallel after Phase 1.
- Phase 7's detectors can be built early against fixtures. The card waits on Phase 5's API.
- Ship the **Web MVP (Phase 6)** before extension integration. It proves the tailoring quality is good enough before more surface area is added.

---

## 21. Open Decisions

| Decision | Options | Lean |
|---|---|---|
| PDF renderer | HTML → PDF (WeasyPrint / headless Chromium), Typst, ReportLab | **Decided: ReportLab** — pure Python, so it runs on the serverless API without system libraries; the web app previews the rendered PDF itself |
| Background jobs | FastAPI background tasks, a queue (e.g. Redis/RQ), Supabase-driven polling | **Decided:** in-process background task + DB status, and a status poll that finds a stalled run executes its next step (so a host that stops background work can't strand a tailoring) |
| DOCX output | Skip / generate from the same JSON | Skip for v1.2 unless the renderer makes it trivial |
| Template count | One / several | One ATS-friendly template |
| Parse model | Rules + LLM / LLM only | Rules for sections, LLM for structuring, user confirms |
| Master ↔ profile sync | One-way / two-way with confirmation | Two-way, item-by-item confirmation, never automatic |
| Page limit | 1 / 2 pages / user setting | User setting, default 2 |

---

## 22. Success Criterion

Don't measure v1.2 by how many tailoring features it has.

> **Can Abrar open a real LinkedIn or Indeed job, click Tailor Resume, see exactly what changed and which requirements he doesn't meet, and download a resume where every claim traces back to his real experience, in under a minute?**

If yes, v1.2 works.

The progression stays clean:

| Version | Role |
|---|---|
| **V1** | Application Question Assistant: *"Help me answer this question."* |
| **v1.2** | Resume Tailoring: *"Help me tailor my resume for this job."* |
| **V2** | Job Application Platform: *"Help me find, prepare, manage and automate my applications."* |
