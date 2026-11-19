# Ansly Job Discovery — Implementation-Ready Specification

## Document status

This document is a documentation-only specification for a future feature in the existing Ansly repository. It does not modify or implement application code.

This specification is grounded in the actual repository state inspected during this task.

Important verification note:
- The current repository contains a strong AI job-application assistant architecture: Next.js web app, WXT browser extension, FastAPI LLM service, Supabase/PostgreSQL schema, and shared TypeScript contracts.
- Ansly Leads, including profile-grounded email drafting, role-based resume matching, and Gmail sending, is implemented in the checked-in code.
- The repository also does not show a production-ready job-discovery or company-enrichment engine.
- Therefore, this design reuses the verified existing architecture patterns and explicitly calls out the code-level gaps where the feature must be implemented from new code rather than extended from existing classes or tables.

Job-source design constraint:
- The initial design must not depend on paid search APIs, paid job feeds, or credentials from a third-party search provider.
- Public ATS endpoints are company-board scoped. They are useful only after a board identifier is known; they do not provide global job search.
- The source and access details below were checked against provider documentation linked in Section 9. Documentation does not itself grant a license to republish provider data, so terms and permitted use still require review before launch.

This document distinguishes between:
- implemented and verified repository behavior,
- proposed new feature behavior,
- existing patterns to reuse,
- required new services and data models,
- unresolved decisions that require confirmation before production implementation.

---

## 1. Product overview

### 1.1 Feature name

Ansly Job Discovery

### 1.2 Product purpose

Ansly Job Discovery is an AI-powered job discovery and employer research feature integrated into the existing Ansly platform. Its purpose is to help users discover relevant opportunities from legitimate, supported sources; evaluate how well those jobs fit their background; identify the actual employer; find publicly available recruitment or application routes; and prepare a grounded application or outreach message using the user's existing knowledge and the shared email-generation pipeline.

This is not a generic job board clone. It is a specialized discovery and qualification layer built atop the existing Ansly platform and user-profile grounding system.

### 1.3 Core workflow

1. Discover relevant jobs from supported sources.
2. Normalize each job into a common internal schema.
3. Identify the actual hiring company or employer.
4. Match the job against the user's profile, professional experience, skills, projects, and preferences.
5. Score and rank opportunities by fit.
6. Enrich the employer with publicly available company information and official application routes.
7. Surface contact routes and application links with provenance.
8. Allow the user to save and revisit jobs.
9. Reuse the existing Ansly email-generation flow to draft personalized application emails.
10. Keep the user in control: no automatic application submission, no fabricated claims, no background scraping that violates source terms.

---

## 2. What was actually inspected in the repository

The following repository evidence is verified and relevant to the design.

### 2.1 Web app

Verified files and patterns:
- [web/src/app/(app)/layout.tsx](../web/src/app/(app)/layout.tsx)
- [web/src/components/app-shell.tsx](../web/src/components/app-shell.tsx)
- [web/src/app/(app)/dashboard/page.tsx](../web/src/app/(app)/dashboard/page.tsx)
- [web/src/lib/api.ts](../web/src/lib/api.ts)
- [web/src/lib/sections.ts](../web/src/lib/sections.ts)

Observed architecture:
- authenticated Next.js dashboard under the `(app)` route group,
- app shell with a sidebar-based navigation model,
- route-based pages and dashboard cards,
- app-specific layout that requires authentication,
- shared UI primitives under [web/src/components/ui](../web/src/components/ui),
- profile editing via section-based metadata and reusable form patterns.

This is the correct integration point for a Job Discovery feature and likely a job list/detail page in the authenticated area.

### 2.2 Browser extension

Verified files:
- [extension/README.md](../extension/README.md)
- [extension/src/lib/sites.ts](../extension/src/lib/sites.ts)
- [extension/src/entrypoints/background.ts](../extension/src/entrypoints/background.ts)

Observed architecture:
- WXT + React extension,
- per-site enablement,
- site registration and host permission handling,
- content script injection only for enabled domains,
- background service worker calling the Ansly API,
- user session handling and source-specific site enablement.

This is relevant for discovery workflows that may need a user-initiated collection or manual source selection in a browser context, but it should not be used as a general-purpose scraper.

### 2.3 FastAPI backend

Verified files:
- [llm/src/app/main.py](../llm/src/app/main.py)
- [llm/src/app/api/router.py](../llm/src/app/api/router.py)
- [llm/src/app/schemas/answers.py](../llm/src/app/schemas/answers.py)
- [llm/src/app/api/routes/answers.py](../llm/src/app/api/routes/answers.py)

Observed architecture:
- FastAPI app with versioned `/api/v1` routes,
- JWT-authenticated access pattern,
- per-user profile retrieval,
- structured output validation,
- answer generation and saved-answer APIs,
- rate limiting and usage accounting patterns.

This is the correct backend architecture for Job Discovery endpoints and job matching services.

### 2.4 Supabase data model

Verified files:
- [supabase/migrations/20261002000000_profile_schema.sql](../supabase/migrations/20261002000000_profile_schema.sql)
- [supabase/migrations/20261003000000_profile_facts.sql](../supabase/migrations/20261003000000_profile_facts.sql)
- [supabase/migrations/20261011000000_candidate_evidence.sql](../supabase/migrations/20261011000000_candidate_evidence.sql)

Observed architecture:
- user-owned profile model with RLS,
- `profiles`, `experiences`, `projects`, `skills`, `education`, `achievements`, `saved_answers`, `profile_facts`, `usage_events`, `candidate_evidence`,
- row-level security for each user-owned set,
- deterministic retrieval + semantic evidence fallback integration.

This is the exact evidence model that Job Discovery must use for job fit evaluation.

### 2.5 Shared TypeScript contracts

Verified files:
- [packages/types/src/api.ts](../packages/types/src/api.ts)
- [packages/types/src/database.ts](../packages/types/src/database.ts)

These types define the existing API contract and are the right place to extend with Job Discovery-related types.

### 2.6 Existing docs and product direction

Verified docs:
- [README.md](../README.md)
- [documents/product-audit.md](../documents/product-audit.md)
- [documents/ansly-leads-prd.md](../documents/ansly-leads-prd.md)

These confirm that the product is user-controlled, grounded, and does not auto-submit applications. That philosophy should continue into Job Discovery.

### 2.7 Existing gap relative to the requested feature

At the time of inspection, the repository does not contain a concrete implementation of:
- a Job Discovery feature,
- a user-facing employer-contact enrichment system,
- a live email draft association model for jobs.

Ansly Leads and its email-drafting/sending flow do exist. Job Discovery-specific backend/frontend data, source adapters, matching, and employer research are new work and should integrate with the existing Leads and profile-grounding capabilities where appropriate.

---

## 3. Product separation: Ansly Leads vs Ansly Job Discovery

Ansly Leads and Ansly Job Discovery are conceptually related but distinct.

### 3.1 Relationship

- Ansly Leads: opportunity discovery and qualified lead management for networking/outreach, based on social or business-owner posts.
- Ansly Job Discovery: discovery and evaluation of legitimate job opportunities across supported sources, with employer/contact enrichment and application-path support.

These are separate record types and workflows.

### 3.2 Shared infrastructure to reuse

The implementation should share:
- authentication and RLS,
- user profile storage and retrieval,
- AI gateway and validation patterns,
- the general dashboard shell,
- LLM generation and grounding patterns,
- common UI patterns for cards, forms, dialogs, and tables,
- the existing Leads email-writing, role/resume matching, draft, and Gmail-sending services, without reusing Leads records as job records.

### 3.3 Important boundary

Job Discovery must not replace Leads, nor should it silently change existing lead behavior. The two features should remain separate product concepts and separate data models.

### 3.4 Verified repository reality

The repository includes a concrete Leads workflow, including email generation and sending, but not a Job Discovery engine or employer-research service. The specification therefore recommends the smallest viable extension pattern rather than a large “platform abstraction layer” that the repo does not yet justify.

---

## 4. Product goals and non-goals

### 4.1 Goals

- Discover relevant jobs from legitimate, supported sources.
- Normalize and deduplicate jobs from multiple providers.
- Match jobs against the user’s actual profile and preferences.
- Determine employer identity and official application route.
- Ground employer research in official ATS data and company-controlled career pages without requiring a paid search provider or building a general web crawler.
- Surface contact routes with evidence and confidence.
- Reuse the existing email-generation capability for application outreach.
- Allow the user to save, revisit, and manage discovered jobs.
- Keep all matching and generation grounded in verified user data.
- Build and maintain a modest, verified directory of company career boards; do not imply that this directory covers every employer.

### 4.2 Non-goals for v1

- Automated application submission.
- Automated bulk outreach or mass emailing.
- Unlicensed scraping of protected pages or anti-bot circumvention.
- Guessing or inventing employer contact information.
- Building a full ATS or job-board replacement.
- Unbounded crawling of the internet.
- Browser automation or scraping to bypass provider access controls, CAPTCHAs, or anti-bot protections.
- A full CRM or employer relationship tracker.
- Replacing the Ansly Leads feature with job-search logic.

---

## 5. User needs and use cases

Primary user personas include:
- active job seeker,
- career switcher,
- remote-first developer,
- freelancer wanting job opportunities,
- users wanting a private, grounded discovery system without a generic job-board experience.

Common use cases:
- A user wants to find remote senior frontend roles that match their experience.
- A user wants to discover official company career pages rather than a job board listing.
- A user wants to see whether a job is likely a good match before applying.
- A user wants to generate a tailored application email to the employer HR team or official contact route.
- A user wants to keep saved jobs and revisit them later.

---

## 6. Repository-grounded architecture analysis

### 6.1 Dashboard integration patterns

The app uses a route-based authenticated dashboard. The best fit is a new authenticated route under the `(app)` directory, with the navigation updated in the app shell.

Likely additions:
- `/jobs` or `/job-discovery` page,
- job results and details views,
- saved jobs page,
- filter/search state integrated into query parameters or local state.

The current product already uses `usePathname`, `Link`, and per-route app-shell navigation patterns. That should be reused.

### 6.2 Existing UI conventions to reuse

Use existing patterns from:
- [web/src/components/ui](../web/src/components/ui)
- [web/src/components/dialog.tsx](../web/src/components/dialog.tsx)
- [web/src/components/tag-input.tsx](../web/src/components/tag-input.tsx)
- [web/src/components/app-shell.tsx](../web/src/components/app-shell.tsx)

These are the existing design primitives for list pages, filter controls, cards, buttons, and modal confirmations.

### 6.3 Backend API patterns

The FastAPI service has a clear architecture: route modules under `llm/src/app/api/routes`, service logic under `src/app/...`, and JSON response models under `src/app/schemas`.

This should be reused for Job Discovery endpoints.

### 6.4 Profile and knowledge retrieval system

The repo already has a validated architecture for user knowledge: profile tables, project and experience evidence, skills, profile facts, and candidate evidence. The job-matching logic must not create a second user profile or duplicate knowledge system.

This means the new feature should read from the same `profiles`, `experiences`, `projects`, `skills`, `education`, `achievements`, and `profile_facts` source records already in the Supabase schema and use the same Retrieval/LLM pattern already used elsewhere.

### 6.5 LLM gateway and generation patterns

The repo already has:
- multi-provider gateway logic,
- strict output validation,
- user-scoped profile retrieval,
- `usedSources` patterns,
- usage accounting.

This is the right foundation for job matching, with explicit validation and safe structured output. Employer identity and contact routes should come from official-source evidence rather than LLM inference.

---

## 7. Shared infrastructure and reuse plan

### 7.1 Existing components to reuse directly

These should be reused without redesign:
- Authenticated dashboard navigation shell.
- Shared UI library and page structure.
- FastAPI router/service conventions.
- Supabase RLS and user ownership model.
- User profile retrieval and grounding logic.
- LLM gateway, provider selection, and validation patterns.
- Job-specific metadata handling patterns already used by existing `JobContext` models in [llm/src/app/schemas/answers.py](../llm/src/app/schemas/answers.py).

### 7.2 Existing components that require adaptation

These need to be extended rather than duplicated:
- API typing in [packages/types/src/api.ts](../packages/types/src/api.ts)
- backend schemas and route registration
- dashboard pages and navigation shell
- the existing Leads email-generation and sending services, with a Job Discovery context adapter and job-specific persistence rather than Leads-specific records

### 7.3 New components required

These are genuinely new and not present in the repository:
- company/ATS board directory and its verification workflow,
- source adapters for job sources,
- job normalization service,
- job deduplication and uniqueness checks,
- job relevance scoring service,
- official-source employer and application-route resolver,
- job detail UI,
- saved-job workflows,
- job discovery session and refresh process,
- job source health/status service,
- API/client types for the new feature.

### 7.4 Important unresolved point

The existing Leads generator is available and should be reused through its current profile-grounding, role/resume matching, and email-sending helpers. Job Discovery still needs its own orchestration, context mapping, and job-to-draft association; it should not create a second writer or bypass the existing send safeguards.

---

## 8. User-targeting model

A Job Discovery system needs a targeting model that is separate from the user profile itself but based on the same underlying user knowledge.

### 8.1 Recommended design

The implementation should use a saved target profile model, not a single hard-coded search configuration. This should be similar in spirit to a saved search state, but it must be structured and persistent.

A good design is:
- one or more saved job-discovery profiles,
- each profile can represent a job-hunting focus,
- each profile is user-owned and isolated by RLS,
- each profile stores search criteria and filters,
- the active profile is used for discovery runs and scoring.

### 8.2 Suggested fields

Proposed fields for a job-discovery profile:
- id
- user_id
- name
- description
- target_roles[]
- keywords[]
- excluded_keywords[]
- technologies[]
- industries[]
- locations[]
- remote_preferences
- employment_types[]
- seniority_levels[]
- salary_minimum / salary_maximum (if supported)
- minimum_experience_years
- work_authorization_preferences
- visa_sponsorship_required
- work_mode_preferences
- active bool
- created_at / updated_at

This is best modeled as a user-owned table, not added to the existing general profile row, because it is search-specific and can be multi-profile.

### 8.3 Why not hard-code a single job search state?

The repository already supports flexible profile data sections and saved-answer contexts, and the feature will likely evolve beyond one search mode. A saved profile is a better fit for future source adapters and user goals.

---

## 9. Job source strategy

The feature must not assume unrestricted access to the public internet. Source selection should be based on legitimate access, provider terms, and rate limits.

### 9.1 Recommended strategy

Use sources in this order:
1. official, publicly readable ATS job-board endpoints, once the company board identifier is known;
2. an official RSS/Atom, JSON, or other public feed published by the employer;
3. the employer's public career page, fetched only when its terms, robots instructions, and technical behavior permit the proposed access;
4. user-authorized import (for example, a pasted job ad or an uploaded list) and manual board submission.

The feature must work without a paid search provider or paid job-data subscription. There is no global ATS endpoint: discovery is bounded by the maintained company/board directory and by boards users explicitly add. Search and filtering apply to the postings Ansly has legitimately fetched, not to the entire internet.

### 9.2 Source categories

#### A. Public ATS job-board interfaces

The following documented read interfaces are suitable candidates for the first adapters. They are scoped to a known employer board and must not be presented as global search:

| Provider | Documented public read shape | Discovery and data limits |
| --- | --- | --- |
| Greenhouse | [Job Board API](https://docs.greenhouse.io/job-board.html): `GET https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs`; `?content=true` includes job descriptions, departments, and offices. The board token is company-specific. | The docs state that only the application-submission `POST` requires Basic Auth. The documented list endpoint has no pagination parameter. Board tokens must come from a verified company career-board URL or curated directory entry. |
| Lever | [Postings API](https://github.com/Lever/postings-api): `GET https://api.lever.co/v0/postings/{site}?skip={n}&limit={n}&mode=json`; an EU instance is also documented. | Returns published postings for a known company site and supports `skip`/`limit` pagination. Lever explicitly says the API does not provide full-text search over open jobs. The documented site name is company-specific. |
| Ashby | [Job Postings API](https://developers.ashbyhq.com/docs/public-job-posting-api): `GET https://api.ashbyhq.com/posting-api/job-board/{JOB_BOARD_NAME}`. | Returns currently published postings for a known job-board name, including job and application URLs. The documentation explains how to identify the name from the company's hosted board. It does not document pagination or a global search endpoint. |

Use the provider's canonical application URL and listing URL as source facts. These endpoints are for discovery and listing data, not permission to submit applications or republish full descriptions without reviewing provider terms.

#### B. Sources requiring credentials or partner access

Do not treat every ATS API as an unauthenticated public feed. SmartRecruiters' [Get job postings](https://developers.smartrecruiters.com/docs/get-job-postings.md) example uses an `X-SmartToken`; its [Job Board API](https://developers.smartrecruiters.com/docs/partners-job-board-api.md) documentation describes partner API-key authentication. It is not a no-credential MVP source. Add it only after Ansly has an explicitly authorized credential and the relevant commercial/data-use terms are reviewed. Apply the same gate to other APIs whose docs require credentials or partner approval.

#### C. Official company career pages and feeds

Use official career pages as a way to identify a company's ATS board URL, as a fallback when a documented public feed is unavailable, or as the source for explicit application/contact instructions. Fetch only known, public pages and observe site terms, robots instructions, domain limits, and conservative request rates. Do not build a generic scraper for arbitrary sites or bypass access controls.

An official page or feed can help verify a company's identity and route; it does not automatically make every page field reusable indefinitely. Keep source URLs and fetch timestamps, minimize stored content, and review the source's terms before production use.

#### D. User-authorized imports and manual board nominations

Allow users to paste a job ad or submit an official career-board URL when Ansly does not yet support that employer. Clearly distinguish user-provided content from data fetched by an Ansly adapter. Validate URLs and use the explicit submission as consent to process that content, not as authorization to crawl unrelated pages.

#### E. No paid web-search dependency

Do not require Google Custom Search, a licensed search-results reseller, or another paid web-search API for employer discovery. Do not scrape public search result pages. Employer and application-route research should use ATS payloads, the verified company domain, official career pages/feeds, and user-provided sources. If no official source establishes a contact route, show that no verified route was found rather than guessing.

No third-party open-source job-board directory is a required dependency in v1. If a directory is considered later, review its data provenance, license, attribution obligations, update policy, and ATS/provider terms before importing it; an open-source code license does not by itself grant rights to the directory's data.

### 9.4 Source adapter architecture

Each source should implement a common adapter contract:
- `platform_id`
- `name`
- `discover_board(board_ref)`
- `fetch_jobs(board_ref, cursor)`
- `fetch_job_details(job_ref)` when the provider exposes a separate detail endpoint
- `normalize(raw_job)`
- `validate_board_ref(board_ref)`
- `source_policy` / data-use review metadata
- `extract_company_identity(raw_job)`
- `extract_application_urls(raw_job)`
- `handle_rate_limit()`

The board directory, not the adapter, owns company-to-board discovery. Adapters only fetch a known, verified board. Provider limitations (including missing pagination, missing descriptions, or restricted CORS) must be explicit per adapter rather than hidden behind assumptions of a uniform global-search API.

---

## 10. Job normalization and deduplication

### 10.1 Required normalization

Every discovered job should be normalized to a common internal shape before scoring and storage.

Required fields:
- source_platform
- external_job_id
- canonical_url
- title
- company_name
- company_domain
- description
- employment_type
- work_mode
- location
- remote_policy
- salary_range
- published_at
- last_seen_at
- application_url
- original_listing_url
- seniority
- required_skills[]
- preferred_skills[]
- responsibilities[]
- requirements[]
- source_metadata (allowlisted fields; retain a full raw snapshot only when source terms and retention policy permit)

### 10.2 Deduplication logic

Two dedupe layers should be used:
- exact dedupe based on canonical job source ID or URL,
- fuzzy dedupe based on title/company/date similarity and normalized text.

Exact duplicates should be skipped.
Near-duplicate jobs with different listing URLs but effectively the same role should be flagged for review if uncertain.

### 10.3 Why this matters

The repository already places strong emphasis on deduplication and user-scope validation in profile and answer systems. The same principle should be applied to job discovery.

---

## 11. Matching architecture and scoring

### 11.1 Goal

The system should help the user decide whether a job is worth pursuing, not just whether the title contains a keyword.

### 11.2 Matching dimensions

The implementation should score against the user profile across:
1. technical skills,
2. professional experience,
3. years of experience,
4. previous roles,
5. relevant projects,
6. technologies,
7. education and certifications,
8. work authorization and location preferences,
9. remote/hybrid/onsite preferences,
10. seniority level,
11. salary expectation, where relevant,
12. target role and keywords,
13. position type and employment type.

### 11.3 Output structure

A job match result should produce:
- overall_relevance_score
- match_category (strong_match, partial_match, weak_match, no_match)
- matched_skills[]
- missing_skills[]
- relevant_experience[]
- relevant_projects[]
- missing_requirements[]
- important_qualifications[]
- explanation
- confidence
- warning_flags[]

This should be explainable and should not rely on a single LLM percentage alone.

### 11.4 Matching strategy

The recommended mixture is:
- deterministic checks first (required work authorization, geography, remote preference, employment type),
- structured profile matching based on skills and experience,
- semantic similarity for role and description interpretation,
- final LLM-based explanation with validation.

This is consistent with the repo's existing architecture: deterministic filters, then retrieval, then LLM reasoning.

### 11.5 Important rule

A job should not be rejected purely because the user lacks every preferred qualification. The system should distinguish between:
- required,
- preferred,
- optional,
- explicit eligibility restriction.

This is critical for avoiding false negatives.

---

## 12. Employer identification and contact enrichment

### 12.1 Requirement

After a job is found and matched, identify the employer and official application route from the ATS response, the employer's own career pages, or explicit user-provided job content. Do not depend on paid search APIs or conduct internet-wide contact discovery.

### 12.2 What to distinguish

The implementation must keep these separate:
- the ATS/provider,
- the original listing page
- the official company careers page
- the employer itself
- any recruitment agency or staffing company
- any explicitly published recruitment email or other contact route

### 12.3 Workflow

For each job:
1. take the company name, board identifier, job title, listing URL, and application URL from the normalized ATS result when available;
2. verify that the board belongs to the company using the official career URL and the maintained board-directory record;
3. if required fields are missing, inspect only the official company career page or source page associated with that record, subject to Sections 9.2 and 19.2;
4. preserve the original listing and official application URLs separately;
5. record the source URL and retrieval time for each employer, application, or contact claim;
6. show missing or uncertain facts as unknown and let the user provide a source when needed.

The company/ATS directory is a bounded, maintained index, not a promise of complete employer coverage. Seed it from verified company career links and administrator-reviewed nominations; verify board keys against the provider's hosted board before enabling refresh. Do not infer a board key by trying arbitrary company names against provider APIs.

### 12.3.1 Contact route evidence

Only retain a recruitment email or other contact route when it is explicitly present in an official listing, an official careers/contact page, or user-pasted job content. Store its `source_url`, evidence excerpt or field path, discovery method, verification state, and `last_checked_at`. Do not infer likely addresses such as `jobs@company.com` from a domain.

### 12.4 Contact priority hierarchy

Priority order:
1. dedicated recruitment or HR email,
2. general company email,
3. official application page or careers route,
4. original listing URL.

General company contact should be labeled separately as `general_company_contact`, not as recruitment-specific contact.

### 12.5 Provenance requirements

Every contact needs:
- email or URL,
- contact type,
- source_url,
- discovery_method,
- evidence excerpt or source field path,
- verification_status,
- confidence,
- last_checked_at,
- associated_company_id or board_id.

An ATS-supplied application URL is an application route, not a verified email address. A domain match alone is not evidence that an address belongs to recruiting or HR.

### 12.6 Contact verification states

A discovered employer contact should be classified as one of the following:
- verified_public_contact: the email or URL appears on an accessible, relevant public page and is supported by the page text,
- source_field_only: the ATS or user-pasted job content provided a route but it has not been independently checked against an official page,
- unverified: insufficient evidence to trust the contact route,
- invalid_or_rejected: the source is contradictory, irrelevant, or clearly not a recruitment pathway.

This distinction prevents the application from treating an application form, third-party listing, or matching email domain as verified recruitment contact information.

---

## 13. Mandatory integration: reuse the existing email-generation flow

This is a core requirement and must be treated as a first-class integration requirement.

### 13.1 What exists in the repo

The checked-in code includes the Leads email workflow in `llm/src/app/api/routes/lead_emails.py`, its grounded writer in `llm/src/app/leads/emails.py`, role detection and resume matching in `llm/src/app/leads/roles.py`, and shared Gmail sending in `llm/src/app/email/sending.py`. The workflow supports generated drafts, edits, resume selection, approval/version checks, and send-attempt claiming to prevent duplicate sends.

### 13.2 Reuse mandate

The Job Discovery feature must not introduce a second independent email-generation system. It must reuse the existing capabilities for:
- user knowledge retrieval,
- email drafting logic,
- validation,
- role detection and resume matching,
- Gmail connection and sending safeguards.

Add a job-specific context adapter and job-to-draft persistence/association as needed. Do not create a Leads record merely to reuse the writer, and do not bypass the existing confirmation, authorization, or duplicate-send protections.

### 13.3 Job-specific context

The job draft should include:
- recipient email or official application route,
- employer name,
- job title,
- job description,
- responsibilities,
- requirements,
- user-matched skills,
- relevant projects and experience,
- relevant user profile information,
- official application URL,
- original job listing URL,
- candidate-specific personalization generated from actual profile evidence.

### 13.4 Draft association

A generated draft should be associated with the discovered job and the specific application route used. Keep the job draft model separate from Leads drafts while sharing the writer, grounding, resume matching, and sender helpers.

### 13.5 Safety

Generated outreach must never invent skills, titles, or experience not present in the user profile. It must be grounded in verified profile context and the job description.

---

## 14. Job discovery and saved-job UX

### 14.1 Dashboard area

A new authenticated area should be added to the app shell and dashboard. Recommended route patterns:
- `/jobs`
- `/jobs/discovery`
- `/jobs/saved`
- `/jobs/[id]`

This should feel native to the existing Ansly dashboard and reuse current page layout patterns.

### 14.2 Search and filter experience

The main discovery page should include:
- target profile selector,
- search input,
- role/keyword filters,
- technology filters,
- location preferences,
- remote/hybrid/onsite filters,
- employment type filters,
- date filters,
- sorting by relevance, date, or source.

### 14.3 Result cards

Each discovered job card should show:
- job title,
- company,
- location,
- remote status,
- employment type,
- date published,
- source platform,
- relevance score,
- matched skills,
- missing skills,
- contact availability,
- official application availability,
- save/unsave action.

### 14.4 Job detail page

The detail view should include:
- job description,
- responsibilities and requirements,
- employer info,
- official application route,
- original listing link,
- match explanation,
- company/contact evidence,
- available actions:
  - save job,
  - open official application,
  - open original listing,
  - generate application email,
  - view draft history.

### 14.5 Saved jobs

The user should be able to revisit previously saved jobs and check whether the listing is still active or expired. The system can track stale status without becoming a CRM.

---

## 15. Job lifecycle and freshness management

### 15.1 Required lifecycle states

Recommended lifecycle states:
- discovered,
- active,
- updated,
- expired,
- removed,
- unverified,
- invalid_source,
- needs_review.

### 15.2 Data to track

Every job record should preserve:
- created_at,
- first_seen_at,
- last_seen_at,
- published_at,
- updated_at,
- last_verified_at,
- source_status,
- active_status,
- expiry_signal,
- raw_snapshot_hash.

### 15.3 Refresh model

A job can be refreshed by source-specific adapter runs. The feature must not claim a job is active merely because it was discovered once.

### 15.4 Recommended behavior

- a failed fetch should not mark the job invalid unless the source clearly confirms removal,
- a source outage should not set all jobs to expired,
- stale jobs should remain visible but labeled as needing verification,
- removal or expiry should be tracked separately from user-sourced save state.

---

## 16. Database design

### 16.1 Existing tables relevant to reuse

The following verified tables are the foundation:
- `profiles`
- `experiences`
- `projects`
- `skills`
- `education`
- `achievements`
- `profile_facts`
- `saved_answers`
- `usage_events`
- `candidate_evidence`

These support user profile retrieval and AI grounding. Job Discovery must not create a second profile or knowledge model.

### 16.2 Proposed new tables

Keep the initial schema small and separate shared public-source data from user-owned search data. Shared source rows are populated by backend adapters and are not directly exposed to end-user database roles.

#### `job_discovery_profiles`
Purpose: user-owned saved job criteria.
Fields:
- id
- user_id
- name
- target_roles
- keywords
- excluded_keywords
- technologies
- locations
- remote_preferences
- employment_types
- seniority_levels
- created_at
- updated_at
- active

#### `job_boards`
Purpose: shared, maintainable directory of verified employer career boards. One record identifies one employer's board on one ATS or official feed.
Fields:
- id
- company_name
- company_domain
- provider
- board_key
- official_careers_url
- directory_source_url
- verification_status
- access_reviewed_at
- is_enabled
- last_checked_at
- last_success_at
- last_error_at
- last_error_code
- next_check_at
- created_at / updated_at

The directory is shared source metadata, not a user-owned search result. Seed it from verified official career links and administrator-reviewed nominations. Store the source and verification state for each board. Do not represent it as a complete company universe or allow unauthenticated writes.

#### `job_postings`
Purpose: shared, normalized cache of a provider posting, keyed to its verified board.
Fields:
- id
- board_id
- external_job_id
- canonical_url
- listing_url
- official_application_url
- title
- company_name
- company_domain
- location
- work_mode
- employment_type
- description
- published_at
- source_updated_at
- first_seen_at
- last_seen_at
- last_verified_at
- listing_status
- content_hash
- source_metadata (allowlisted normalized fields only; avoid retaining full raw payloads by default)
- created_at
- updated_at

Do not store complete provider payloads unless a source-specific data review justifies retention. A successful empty response is distinct from a timeout, 429, or provider error and must not expire cached postings.

#### `job_matches`
Purpose: user-owned job fit result; recompute when the posting or profile changes.
Fields:
- id
- user_id
- job_posting_id
- profile_id
- overall_score
- match_category
- matched_skills
- missing_skills
- reason
- confidence
- generated_at
- created_at

#### `job_discovery_runs`
Purpose: user-owned discovery request and its progress/summary. Source health belongs on `job_boards`.
Fields:
- id
- user_id
- profile_id
- status
- started_at
- completed_at
- discovered_count
- matched_count
- duplicates_skipped
- errors_count
- summary_json

#### `saved_jobs`
Purpose: user-owned association with a shared cached posting.
Fields:
- id
- user_id
- job_posting_id
- saved_at
- notes
- status

Job application emails should use a job-specific draft or association compatible with the existing Leads writer and sender. Do not duplicate the writer or Gmail credentials/transport. Persist only the user-owned draft and source/job association needed by the existing draft lifecycle.

### 16.3 Relationships

Recommended relationships:
- one user has many discovery profiles,
- one user has many discovery runs,
- one user has many saved jobs,
- one ATS board belongs to one company and has many cached job postings,
- one user can have one match per profile/posting pair,
- one user can save a shared job posting independently of other users,
- one job posting may have one or more user-owned application drafts.

### 16.4 Indexing and constraints

Recommended indexes:
- `job_boards`: by provider, company_domain, is_enabled, next_check_at
- `job_postings`: by board_id, listing_status, last_seen_at, canonical_url, published_at
- `job_matches`: by user_id, profile_id, and job_posting_id
- `saved_jobs`: by user_id and job_posting_id
- `job_discovery_profiles`: by user_id and active state

Use a unique constraint on `(board_id, external_job_id)` and a suitable canonical-URL uniqueness rule when a provider lacks a stable ID. A user's saved-job row must be unique by user/posting, and a match row by user/profile/posting.

### 16.5 Row-level security

Enable RLS on every table in the exposed `public` schema.

- `job_discovery_profiles`, `job_discovery_runs`, `saved_jobs`, `job_matches`, and user-owned drafts use `user_id` ownership policies for `authenticated`, with `auth.uid() = user_id` in both `USING` and `WITH CHECK`.
- `job_boards` and `job_postings` are shared backend-managed source metadata/cache. Revoke direct `anon`/`authenticated` table privileges, enable RLS without user policies, and do not expose them directly. The authenticated FastAPI API validates the user's request and returns only the needed normalized fields; backend service credentials remain server-side.
- User-owned rows reference shared posting IDs, but that relationship must not allow one user to read another user's saves, matches, notes, profile criteria, or drafts.
- Apply the same user ownership checks to any job-email draft association. Do not rely on `TO authenticated` without an ownership predicate.

---

## 17. Backend API design

The backend should be implemented using the existing FastAPI route pattern and route registration under [llm/src/app/api/router.py](../llm/src/app/api/router.py).

### 17.1 Proposed endpoints

- `GET /api/v1/jobs/discovery-profiles`
- `POST /api/v1/jobs/discovery-profiles`
- `PATCH /api/v1/jobs/discovery-profiles/{id}`
- `DELETE /api/v1/jobs/discovery-profiles/{id}`
- `POST /api/v1/jobs/discover`
- `GET /api/v1/jobs/sources` (supported providers and freshness/status summary, without exposing internal credentials)
- `GET /api/v1/jobs/saved`
- `GET /api/v1/jobs`
- `GET /api/v1/jobs/{id}`
- `POST /api/v1/jobs/{id}/save`
- `POST /api/v1/jobs/{id}/unsave`
- `GET /api/v1/jobs/{id}/matches`
- `POST /api/v1/jobs/{id}/generate-email`
- `POST /api/v1/jobs/{id}/refresh`

Company and application-route evidence should be derived from the verified board record and its official source data. Any user-facing refresh endpoint must operate only on a known board or posting and honor that adapter's request policy.

### 17.2 Request/response conventions

Use existing patterns from current repository APIs:
- JSON responses with validation,
- 401/403 for auth issues,
- 404 for missing resources,
- 422 for invalid input,
- 429 for rate limit or provider quota,
- 502/503 for provider or downstream service failures.

### 17.3 Validation and error handling

Every endpoint must validate:
- required user auth context,
- source compatibility,
- query constraints,
- URL validity,
- company/contact provenance,
- draft generation eligibility.

---

## 18. Background processing and asynchronous work

### 18.1 Why async processing is needed

Discovery across multiple known boards, refresh, and profile matching can require several network calls and AI operations. Doing large runs synchronously in a normal request would be poor UX and would complicate rate-limit handling.

### 18.2 Recommended approach

Implement discovery and refresh as background jobs, but keep the design simple and compatible with the repository’s current architecture.

Recommended minimal pattern:
- create a job discovery run record,
- schedule bounded work per known board or run,
- process records in batches,
- update the job run status as each batch completes,
- surface partial progress to the user.

### 18.3 Keep it simple

The repo does not currently show a queue infrastructure such as Celery, Redis, or a full worker system. Before adding another service dependency, the implementation should prefer:
- background tasks under the existing application runtime if feasible,
- periodic fetch orchestration if the app environment supports it,
- simple DB-backed status tracking with per-source processing batches.

### 18.4 Do not add infrastructure without strong need

If the feature is small and source traffic is moderate, a simple internal processing model is enough. A more complicated queue system should only be introduced when the database and provider patterns justify it.

---

## 19. Security, privacy, and responsible collection

### 19.1 Authentication and authorization

Use the repository’s current auth model:
- Supabase auth,
- JWT validation in the FastAPI service,
- user-owned tables protected by RLS.

### 19.2 Source compliance

This is a critical requirement. Do not implement:
- hidden scraping,
- anti-bot circumvention,
- crawler bypasses,
- unauthorized profile harvesting,
- cross-user data leakage,
- personal email harvesting,
- paid-search-provider calls as an assumed source,
- attempts to discover board tokens by probing arbitrary company names.

Before enabling an adapter, record the official documentation URL, authentication requirements, supported fields, known pagination behavior, source terms/data-use review date, and conservative fetch policy. Treat missing provider rate-limit documentation as unknown; use internal per-board throttling, bounded concurrency, caching, timeouts, and backoff rather than assuming unlimited requests.

### 19.3 SSRF and URL safety

All URLs used for enrichment should be validated and constrained. The implementation must:
- allow only HTTP/HTTPS,
- reject unsafe or malformed URLs,
- require domain-limited fetch behavior where necessary,
- avoid treating user-provided URLs as trusted instructions.

### 19.4 HTML and text parsing

All external HTML or job description content must be treated as untrusted input. It must never be used to override the system prompt or user knowledge retrieval.

### 19.5 Contact data storage

Any discovered contact route or email should be stored with provenance and confidence, not as absolute truth.

### 19.6 Data retention and deletion

User-owned profiles, matches, saves, notes, and drafts must follow the app's deletion semantics and RLS. Shared board metadata and cached public postings are backend-managed records, not user-owned rows; retain and refresh them only under the applicable source terms and documented retention policy. Do not store personal contact data without an explicit source and retention rationale.

---

## 20. Error handling and edge cases

The implementation must explicitly cover the following failure modes:

- no jobs discovered,
- zero relevant jobs,
- no company identified,
- no employer domain found,
- advertised role is not clearly defined,
- no official application route exists,
- no recruitment email is available,
- only a general company email is available,
- source rates limit the request,
- provider outage during AI scoring,
- malformed job data from a provider,
- duplicate job with different URLs,
- expired or removed listing,
- bad contact email format,
- missing `company_name` or `company_domain`,
- conflict between source-listed title and official company title,
- AI match fails but raw job record remains saved,
- email generation fails without deleting the job or losing the source data.

The system should fail gracefully with an explicit user-facing explanation, and it must never silently overwrite the original record.

---

## 21. Performance and cost considerations

### 21.1 Cost-sensitive design

Keep costs controlled by:
- deterministic filtering before AI,
- fetching only enabled, verified boards and limiting boards per user run,
- bounding the number of jobs sent to AI per phase,
- avoiding expensive enrichment for clearly irrelevant jobs,
- caching normalized source data and company/board metadata,
- tracking fetch timestamps and source health per board,
- using conditional requests only when the provider documents support for them,
- applying per-board request intervals, bounded concurrency, timeouts, and exponential backoff for 429/5xx/network failures,
- supporting a user-defined source cap.

The design has no required paid search, job-feed, or enrichment-provider cost. Expected operating costs are backend compute, database/storage, bandwidth, and LLM usage for selected relevant jobs. Provider access is not assumed to be unrestricted or licensed for republication; source-specific terms must be reviewed.

### 21.2 Token budget

The LLM should be used for:
- relevance scoring and explanation,
- drafting personalized application emails.

Company identity, board validation, and official application URLs should come from source fields or deterministic validation, not LLM inference. It should not be used for simple filtering when deterministic logic is sufficient. Do not send complete job descriptions to an LLM until after inexpensive dedupe and filtering.

### 21.3 Scale expectations

The initial implementation should assume modest, user-driven refresh and discovery runs across a maintained, bounded directory rather than a global crawl. Use cached board results across users where source terms permit; keep user-specific profiles, scores, saves, and drafts isolated.

---

## 22. Testing strategy

### 22.1 Unit tests

Recommended unit test coverage:
- source adapter normalization,
- ATS fixture parsing for Greenhouse, Lever, and Ashby,
- Lever pagination and board-key validation,
- source-directory verification and provider-credential gating,
- duplicate detection,
- job scoring rules,
- employer/contact classification,
- URL validation,
- contact-email validation,
- match explanation schema validation,
- email-generation context creation,
- status lifecycle transitions.

### 22.2 Integration tests

Recommended integration tests:
- auth for job discovery endpoints,
- RLS enforcement for user-owned rows and denied direct access to shared source-cache tables,
- adapter fetch + normalization,
- source failure, 429/5xx, timeout, empty-board, and stale-cache behavior,
- save/unsave job flows,
- job detail retrieval,
- match result generation,
- provenance for official application/contact routes,
- application email generation via the shared email flow.

### 22.3 Frontend tests

Recommended UI tests:
- discovery page renders and filters,
- job details show description and match explanation,
- save/unsave works,
- email-generation action appears only when valid,
- expired or invalid jobs show the right state.

### 22.4 Regression tests

Because this task integrates with the existing job-application assistant, the following must be checked carefully:
- existing Ansly profile retrieval still works,
- existing Answer API still works,
- existing dashboard routes still work,
- existing browser extension still works,
- Leads email generation, resume matching, and Gmail sending continue to work unchanged,
- no job-source adapter requires a paid search API credential,
- unsupported or credential-gated sources are not reported as publicly accessible.

---

## 23. Recommended implementation phases

### Phase 1 — foundation

Includes:
- minimal RLS-separated schema for the shared board directory/posting cache and user-owned profiles, matches, saves, and drafts,
- initial verified directory entries from official company career URLs,
- new API route scaffolding,
- source adapter contract and source-policy metadata,
- basic normalization and dedupe,
- UI skeleton for discovery list and details,
- first public adapters for Greenhouse, Lever, and Ashby after source terms review.

Acceptance criteria:
- user can create a discovery profile,
- a verified board can be refreshed without a paid search API credential,
- a job can be discovered from its official ATS board and stored in the shared cache,
- duplicate jobs are prevented,
- job detail loads through an authenticated API,
- the directory clearly indicates verified/disabled/stale board state.

### Phase 2 — matching and filtering

Includes:
- profile matching,
- relevance scoring,
- saved search profiles,
- result filtering and sorting.

Acceptance criteria:
- jobs show match reason and score,
- user preferences influence result ranking,
- irrelevant jobs are not saved as strong matches.

### Phase 3 — employer enrichment and contacts

Includes:
- company identity and application route from ATS fields and official company sources,
- contact routes only when explicitly published in source content,
- source URLs, evidence, and confidence handling.

Acceptance criteria:
- an official application route is shown when present, and a contact route is shown only when explicitly published in source content,
- contact info is clearly labeled as recruitment vs general company contact,
- absence of a verified contact is represented explicitly,
- no fabricated email appears,
- the feature never depends on a paid search endpoint or general-purpose web crawler.

### Phase 4 — email generation integration

Includes:
- job-to-email context builder,
- reuse of the shared email-generation flow,
- draft association to the job,
- draft display and editing.

Acceptance criteria:
- a real job can generate a grounded email draft,
- the draft is associated with the right job and recipient,
- the feature does not create a second email-generation stack.

### Phase 5 — lifecycle and optimization

Includes:
- refresh logic,
- expiry handling,
- board-level source health monitoring and directory maintenance,
- performance tuning,
- cost review.

Acceptance criteria:
- stale jobs are labeled clearly,
- source failures do not incorrectly mark jobs expired,
- a verified empty response is distinguished from request failure,
- backoff and cache behavior prevent repeated failing requests,
- discovery remains responsive.

---

## 24. Requirements and testable acceptance criteria

### JD-001: user can define a job-discovery profile
Priority: P0
Description: A user can create and save a profile defining job criteria.
Acceptance criteria:
- user can create a profile with at least a name and target role or keyword,
- profile persists for the user,
- active profile can be switched,
- profile is used for discovery and matching.

### JD-002: job discovery can fetch legitimate public jobs
Priority: P0
Description: Supported job sources can be queried and normalized.
Acceptance criteria:
- Greenhouse, Lever, and Ashby adapters produce normalized records from verified company-board identifiers,
- adapter fixtures cover provider-specific fields and pagination/board-scope behavior,
- discovery is limited to enabled directory boards and never claims global ATS search,
- unsupported or credential-gated sources fail with clear messaging,
- no paid search API key is required,
- source terms/access-review status and fetch timestamps are recorded before refresh is enabled,
- job data is saved only after validation.

### JD-003: jobs are deduplicated
Priority: P0
Description: repeated discovery does not create duplicate job records.
Acceptance criteria:
- same canonical source URL is skipped,
- near-duplicate jobs are either merged or flagged for review,
- duplicates are counted in the discovery summary.

### JD-004: jobs are scored against the user's profile
Priority: P0
Description: jobs are evaluated against the user's actual background.
Acceptance criteria:
- the job result includes score, match explanation, and matched/missing skills,
- requirement differences are described clearly,
- no invented claims appear in the output.

### JD-005: employer and contact routes are enriched
Priority: P0
Description: job discovery identifies the actual employer and the best public route.
Acceptance criteria:
- company identity is associated with its verified ATS board,
- official application route is surfaced from source fields or an official company page,
- contact routes are included only when explicitly provided by an official or user-provided source,
- routes and contacts are labeled by type and provenance,
- no paid web-search API or general internet crawler is needed.

### JD-006: contact info is never fabricated
Priority: P0
Description: only explicit, verified public contact routes are stored.
Acceptance criteria:
- invalid or guessed emails are rejected,
- contact provenance is visible,
- no private personal employee data is used.

### JD-007: saved jobs are managed by the user
Priority: P0
Description: the user can save and revisit opportunities.
Acceptance criteria:
- saved jobs are visible in a dedicated saved list,
- unsave and reopen actions work,
- saved jobs retain job metadata and match explanation.

### JD-008: application email generation reuses the shared email flow
Priority: P0
Description: A discovered job can generate a grounded application email.
Acceptance criteria:
- job context and user profile context are passed into the same email-generation flow,
- no second independent generator is introduced,
- generated draft can be edited and copied.

### JD-009: lifecycle status is tracked
Priority: P1
Description: jobs can be marked active, updated, stale, or expired.
Acceptance criteria:
- stale jobs are visible but labeled,
- provider errors, rate limits, and timeouts do not expire cached jobs,
- a successful empty board response is distinguished from a failed fetch,
- status changes are explicit.

---

## 25. Risks, limitations, and unresolved decisions

### 25.1 Verified constraints in the repo

- there is no current implementation of a concrete job discovery engine,
- the Leads email-generation, role-based resume matching, and Gmail sending flow is implemented and should be reused,
- there are no current job tables or discovery tables in the migration set,
- the repo favors conservative, user-controlled AI workflows.

### 25.2 Risks

- some source providers may not provide a compliant public feed,
- public ATS endpoints are board-scoped, so directory coverage determines discovery coverage,
- providers can change endpoints, fields, access policies, or terms,
- employer contact routes may not be published or may be low-confidence,
- job titles and descriptions are often noisy,
- AI explanation can drift without structured validation,
- scraping protected pages would be a compliance issue,
- a public endpoint does not by itself grant rights to persist or republish its data.

### 25.3 Open questions

The following should be confirmed before coding:
- source-specific terms and data-use approval for each initial ATS adapter,
- how initial company/board directory entries will be curated and who will review user nominations,
- whether discovery is extension-driven, API-driven, or both,
- the maximum boards and refresh frequency for a user-initiated run,
- whether the app should support a saved-jobs list or only a discovery results page plus a save action.

---

## 26. Final implementation checklist

- [ ] Add Job Discovery route and nav item in the authenticated app shell.
- [ ] Add job-discovery profile CRUD flows.
- [ ] Define minimal RLS-separated tables for the shared board directory/postings cache and user-owned discovery data.
- [ ] Establish a verified, maintainable company/ATS board directory with health and fetch timestamps.
- [ ] Add source adapter contract and Greenhouse, Lever, and Ashby public-board adapters.
- [ ] Add job normalization and duplicate detection.
- [ ] Add AI matching and structured output validation.
- [ ] Add official-source employer identification and contact provenance without paid web search.
- [ ] Add official application route and original listing model.
- [ ] Reuse the shared email-generation flow for job application drafts.
- [ ] Add saved-job UX and lifecycle status handling.
- [ ] Add background processing pattern for fetch and refresh runs.
- [ ] Add RLS, backend-only source-cache access, and user ownership checks.
- [ ] Add adapter throttling, cache, backoff, and source-failure handling.
- [ ] Review provider terms and source-data retention before enabling each adapter.
- [ ] Add targeted testing and regression coverage.

---

## 27. Summary

Ansly Job Discovery should be a grounded, user-controlled discovery layer built on top of the existing Ansly architecture. It should reuse the authenticated dashboard, profile and knowledge retrieval model, LLM gateway, and implemented Leads email-generation, role/resume matching, and Gmail-sending capabilities. It must not introduce a paid search-provider dependency, imply global ATS coverage, bypass source restrictions, fabricate contact information, or duplicate the email-generation stack.

The initial source strategy is a verified company/ATS board directory with public Greenhouse, Lever, and Ashby adapters, official company career-page fallbacks where permitted, and user-authorized/manual imports. Keep shared source metadata/cache separate from user-owned profiles, matches, saved jobs, and drafts, with explicit RLS and freshness/error tracking. The v1 remains narrow: discover, normalize, qualify, enrich from official evidence, save, and prepare grounded application drafts without autonomous job applying.

This specification is designed to be implementation-ready for a coding agent in the current repository, while being explicit about which parts are verified and which parts are new work that must be added consistent with the existing architecture.
