# Ansly — Development Phases

Phased delivery plan for **V1 (AI Job Application Assistant)** and **V2 (Job Search & Application Platform)**.

Each phase lists its tasks and an exit criterion. A phase is done only when its exit criterion is met, not when its tasks are ticked.

---

## Overview

| # | Phase | Version | Outcome |
|---|---|---|---|
| 1 | Project Foundation | V1 | Monorepo, extension, web, API and database running |
| 2 | Extension Field Detection | V1 | ✨ appears on eligible fields across sites |
| 3 | Profile System | V1 | Structured profile stored and editable |
| 4 | AI Answer Engine | V1 | Question in → grounded answer out (API only) |
| 5 | Extension ↔ AI | V1 | ✨ → Generate → Answer |
| 6 | Review & Fill | V1 | ✨ → Generate → Review → Fill — **MVP** |
| 7 | Job Context & Saved Answers | V1 | Role-aware answers; reusable preferred answers |
| 8 | V1 Polish & Release | V1 | Chrome Web Store release |
| 9 | Job Ingestion | V2 | Jobs collected, normalized, deduplicated |
| 10 | Job Matching | V2 | Explainable profile-to-job alignment |
| 11 | Job Feed, Saved Searches & Alerts | V2 | Personalized feed and notifications |
| 12 | Application Workspace | V2 | Application tracking pipeline |
| 13 | Application Preparation | V2 | Resume, cover letter and answers prepared per job |
| 14 | Context-Aware Extension | V2 | Extension knows the job it's filling for |
| 15 | Guarded Application Automation | V2 | Assisted autofill with review checkpoint |

---

# Version 1 — AI Job Application Assistant

**Goal:** Make filling out job applications dramatically faster. V1 assumes the user has already found a job.

## Phase 1 — Project Foundation

**Tasks**

- [x] Configure pnpm workspaces (`web`, `extension`, `llm`, `packages/*`)
- [x] Configure Turborepo
- [x] Adapt existing Next.js app (`web`) to the workspace
- [x] Scaffold WXT extension (`extension`, Manifest V3)
- [x] Adapt existing FastAPI service (`llm`) to the workspace
- [x] Create Supabase project and migrations folder (`supabase/migrations`)
- [x] Set up shared TypeScript types (`packages/types`)
- [x] Configure environment variables per app
- [x] Basic CI (lint, type-check, build)

**Exit criterion:** All three apps run locally from the monorepo and connect to Supabase.

## Phase 2 — Extension Field Detection

**Tasks**

- [x] Scan `input`, `textarea`, `select`, `[contenteditable]`
- [x] Extract question text from label, placeholder, `aria-label`, `aria-labelledby`, `name`, `id`
- [x] Find surrounding question text (parent container, preceding text, headings)
- [x] Classify fields: skip name, email, phone, address, password, date, number
- [x] Flag long-answer fields ("Why…", "Describe…", "Tell us…", "Explain…", "How…")
- [x] MutationObserver for dynamically loaded fields
- [x] Shadow DOM root for injected UI
- [x] Inject ✨ button beside eligible fields
- [x] Keep detection generic — no per-site branching

**Exit criterion:** On LinkedIn, Indeed, Greenhouse and Lever forms, ✨ appears on open-ended questions and not on basic personal fields. No AI yet.

## Phase 3 — Profile System

**Tasks**

- [x] Supabase Auth (web login)
- [x] Tables: `profiles`, `experiences`, `projects`, `skills`, `education`, `achievements`, `saved_answers`
- [x] Row-level security policies
- [x] CRUD screens for each profile section
- [x] Profile completeness indicator on dashboard
- [ ] Seed own profile (WebWhiz, Nizam LLC, OnTask, ToPrep, Growducts, core skills) — template in `supabase/seed/profile.seed.json`; needs your real details, then import from Settings

**Exit criterion:** A logged-in user can build and edit a complete structured profile.

## Phase 4 — AI Answer Engine

**Tasks**

- [x] Validate Supabase JWT in FastAPI
- [x] Question classification (category + intent)
- [x] Structured profile retrieval by category (no embeddings)
- [x] System prompt with strict grounding rules
- [x] LLM provider integration (OpenAI / Anthropic / Gemini)
- [x] Structured output: `status`, `answer`, `confidence`, `usedSources`
- [x] `insufficient_information` handling — never invent facts
- [x] Error handling and logging
- [x] Endpoints: `GET /health`, `POST /api/v1/answers/generate`, `POST /api/v1/answers/regenerate`

**Exit criterion:** Posting a question returns a first-person, grounded answer; questions outside the profile (e.g. Kubernetes) return `insufficient_information`.

## Phase 5 — Extension ↔ AI

**Tasks**

- [x] Extension authentication (session handoff from web app)
- [x] API client via background service worker
- [x] Send question + minimal context (never full page HTML)
- [x] Loading state in popover
- [x] Answer popover UI
- [x] Insufficient-information state with "Add information" link
- [x] Error states and retry

**Exit criterion:** Clicking ✨ on a real application shows a generated answer in the popover.

## Phase 6 — Review & Fill (MVP)

**Tasks**

- [x] Editable answer before filling
- [x] Regenerate
- [x] Fill `textarea` and text inputs
- [x] Fill React-controlled fields (native setter + `input`/`change` events)
- [x] Fill `contenteditable` fields
- [x] Verify the field contains the answer after filling

**Exit criterion — MVP:** The user can open a real LinkedIn/Indeed application, click ✨, get a truthful personalized answer, edit it, and fill the field in a few seconds.

## Phase 7 — Job Context & Saved Answers

**Tasks**

- [x] Extract company and role from the application page
- [x] Optional job-description context (explicit user opt-in)
- [x] "Save as preferred answer" after edits
- [x] Similar-question detection
- [x] "Use saved answer / Generate new answer" choice
- [x] Saved answers page in web app (view, edit, delete)

**Exit criterion:** "Why are you interested in this role?" produces role-specific answers, and a previously saved answer is offered for a similar question.

## Phase 8 — V1 Polish & Release

**Tasks**

- [x] Better icon positioning
- [x] Keyboard shortcut
- [x] Dark / light theme
- [x] Network error handling
- [x] Rate limiting and usage limits
- [x] Analytics
- [x] Extension settings and privacy controls
- [ ] Site-specific adapters only where real issues were found — none yet; add after real-world use
- [ ] Deploy web (Vercel) and API (Render / Railway) — needs your accounts; steps in README
- [ ] Chrome Web Store listing and privacy policy — privacy page at `/privacy` done; listing needs your developer account

**Exit criterion:** Ansly is published and has been used reliably across a meaningful number of real applications.

### V1 Timeline

| Week | Focus |
|---|---|
| Week 1 | Phases 1–2: monorepo, extension, field detection, ✨ injection |
| Week 2 | Phases 3–4: Supabase, profile, FastAPI, LLM |
| Week 3 | Phases 5–6: extension ↔ API, generate, edit, fill — **MVP** |
| After MVP | Phases 7–8 |

### V1 Out of Scope

Job search, job board scraping, recommendations, alerts, application tracking, resume builder, cover letter platform, automated applications, auto-submit, autonomous browser agent, interview prep, complex RAG.

---

# Version 2 — Job Search & Application Platform

**Goal:** Help the user find relevant jobs and handle almost all of the repetitive work around applying.

**Start condition:** V1's `detect → generate → edit → fill` loop is reliable in real use.

## Phase 9 — Job Ingestion

**Tasks**

- [ ] Identify legitimate sources: public APIs, feeds, ATS job boards, employer career pages where permitted
- [ ] Source adapters with per-source terms recorded
- [ ] Ingestion scheduler
- [ ] Normalization into a common job schema
- [ ] Deduplication across sources
- [ ] Tables: `jobs`, `job_sources`
- [ ] Do **not** make LinkedIn/Indeed scraping the foundation

**Exit criterion:** A steady stream of normalized, deduplicated jobs lands in the database.

## Phase 10 — Job Matching

**Tasks**

- [ ] Extract requirements from job descriptions (skills, experience, workplace, location, salary)
- [ ] Compare requirements to the user profile
- [ ] Explainable alignment: matched skills, experience fit, potential gaps
- [ ] Alignment tiers (strong / good / potential)
- [ ] `job_matches` table
- [ ] Introduce pgvector only if structured matching proves insufficient

**Exit criterion:** Each job shows why it matches and where the gaps are — no unexplained scores.

## Phase 11 — Job Feed, Saved Searches & Alerts

**Tasks**

- [ ] "For You" personalized feed in the web app
- [ ] Saved searches from natural language ("remote Full Stack roles with AI, Next.js, TypeScript")
- [ ] `saved_searches` table
- [ ] Detect new jobs matching saved searches
- [ ] In-app alerts grouped by match strength
- [ ] Email / browser notifications (later)

**Exit criterion:** New matching jobs surface automatically without manual searching.

## Phase 12 — Application Workspace

**Tasks**

- [ ] Pipeline stages: Interested → Preparing → Applied → Interview → Offer / Rejected
- [ ] `applications` and `application_events` tables
- [ ] Per-application record: company, role, URL, resume used, answers, cover letter, date, status, notes, interview events
- [ ] Pipeline dashboard

**Exit criterion:** Every application the user starts is tracked from interest to outcome.

## Phase 13 — Application Preparation

**Tasks**

- [ ] "Prepare application" action on a job
- [ ] Resume selection / tailoring from profile
- [ ] Cover letter generation (grounded in profile)
- [ ] Pre-generated answers to likely questions, reusing the V1 engine
- [ ] Relevant projects highlighted
- [ ] Potential interview questions

**Exit criterion:** One click produces a reviewable application package for a chosen job.

## Phase 14 — Context-Aware Extension

**Tasks**

- [ ] Hand off application context from web app to extension
- [ ] Extension recognizes which tracked job the page belongs to
- [ ] Answers use company, role, description, requirements, selected resume and previous answers
- [ ] Answers written back to the application record

**Exit criterion:** Answers on an application page reflect the specific job and stay consistent across the whole application.

## Phase 15 — Guarded Application Automation

**Tasks**

- [ ] Fill known personal data automatically
- [ ] Detect and answer questions in sequence
- [ ] Upload the selected resume
- [ ] Mandatory review checkpoint before submission
- [ ] User submits by default
- [ ] Additional automation only on sites where it is permitted and reliable
- [ ] Stop and hand control back on CAPTCHA, unusual verification, or sites that prohibit automation
- [ ] Never attempt to bypass site protections

**Exit criterion:** On supported sites, an application is filled end-to-end up to a review checkpoint, with the user in control of submission.

---

## Dependency Map

```text
V1
Phase 1 ─► Phase 2 ─┐
                    ├─► Phase 5 ─► Phase 6 (MVP) ─► Phase 7 ─► Phase 8
Phase 3 ─► Phase 4 ─┘

V2
Phase 9 ─► Phase 10 ─► Phase 11
                 │
                 └─► Phase 12 ─► Phase 13 ─► Phase 14 ─► Phase 15
```

Phases 2 and 3–4 can run in parallel once Phase 1 is done.
