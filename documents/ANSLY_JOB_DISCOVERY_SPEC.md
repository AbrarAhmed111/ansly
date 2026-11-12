# Ansly Job Discovery — Implementation-Ready Specification

## Document status

This document is a documentation-only specification for a future feature in the existing Ansly repository. It does not modify or implement application code.

This specification is grounded in the actual repository state inspected during this task.

Important verification note:
- The current repository contains a strong AI job-application assistant architecture: Next.js web app, WXT browser extension, FastAPI LLM service, Supabase/PostgreSQL schema, and shared TypeScript contracts.
- There is no concrete, live implementation of a separate Ansly Leads feature in the checked-in code at the time of this review.
- The repository also does not show a production-ready job-discovery or company-enrichment engine.
- Therefore, this design reuses the verified existing architecture patterns and explicitly calls out the code-level gaps where the feature must be implemented from new code rather than extended from existing classes or tables.

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
- a leads feature,
- a user-facing employer-contact enrichment system,
- a live email draft association model for jobs.

Therefore, this specification introduces new backend/frontend data and services in a way that is consistent with the existing architecture, while clearly labeling those parts as new work.

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
- shared email-generation integration if the Leads generator is implemented in the same codebase.

### 3.3 Important boundary

Job Discovery must not replace Leads, nor should it silently change existing lead behavior. The two features should remain separate product concepts and separate data models.

### 3.4 Verified repository reality

The repository currently shows a strong architecture for user profile retrieval, answer generation, and UI shell design, but not a concrete job-discovery engine or email-provisioning service. The specification therefore recommends the smallest viable extension pattern rather than a large “platform abstraction layer” that the repo does not yet justify.

---

## 4. Product goals and non-goals

### 4.1 Goals

- Discover relevant jobs from legitimate, supported sources.
- Normalize and deduplicate jobs from multiple providers.
- Match jobs against the user’s actual profile and preferences.
- Determine employer identity and official application route.
- Use a supported public search provider to research employers and recruitment contacts without creating a custom web-search crawler.
- Surface contact routes with evidence and confidence.
- Reuse the existing email-generation capability for application outreach.
- Allow the user to save, revisit, and manage discovered jobs.
- Keep all matching and generation grounded in verified user data.

### 4.2 Non-goals for v1

- Automated application submission.
- Automated bulk outreach or mass emailing.
- Unlicensed scraping of protected pages or anti-bot circumvention.
- Guessing or inventing employer contact information.
- Building a full ATS or job-board replacement.
- Unbounded crawling of the internet.
- Browser automation or scraping to bypass Google restrictions, CAPTCHAs, or anti-bot protections.
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

This is the right foundation for job matching and employer-contact reasoning, but with explicit validation and safe structured output.

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
- any existing email-generation flow if Leads is implemented separately in a future branch

### 7.3 New components required

These are genuinely new and not present in the repository:
- source adapters for job sources,
- job normalization service,
- job deduplication and uniqueness checks,
- job relevance scoring service,
- employer resolution and enrichment service,
- contact-route discovery and validation service,
- job detail UI,
- saved-job workflows,
- job discovery session and refresh process,
- job source health/status service,
- API/client types for the new feature.

### 7.4 Important unresolved point

The repo does not show an actual Leads email-generation implementation. The requirement says to reuse the existing Leads email-generation feature; if that feature is not yet implemented in this repository, the design must explicitly treat this as a dependency and integration contract, not as a currently available code path.

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

Prioritize sources in this order:
1. official API or legitimate public feed from a partner or supported source,
2. official company career page with a public jobs section,
3. job search aggregator with a documented API,
4. limited, user-authorized import or export flow,
5. manual link submission or user-selected import for a compliant flow.

This ordering is intentionally conservative.

### 9.2 Source categories

#### A. ATS platforms
Examples include:
- Greenhouse,
- Lever,
- Ashby,
- SmartRecruiters,
- Workday-based public career pages.

These are legitimate when supported with API or public-page parsing. A generic scraper should not be used for all ATS implementations.

#### B. Job boards with official APIs
Examples include:
- public search APIs that have documentation and legal terms,
- licensed feeds,
- partner APIs.

These are preferred over ad hoc scraping.

#### C. Official company career pages
Useful for the company identity and final application route. These are valuable for employer enrichment, but the implementation must restrict itself to public pages and safe extraction rules.

#### D. Search-based employer research
This is the recommended mechanism for employer identification and contact discovery. Instead of building a custom internet-wide crawler, the system should use a supported search provider to research the employer associated with each job.

Recommended provider pattern:
- Google Search through an officially supported API or licensed provider that returns Google-backed search results,
- a provider abstraction so Ansly can swap vendors without rewriting the job research workflow,
- strict quota tracking and caching,
- no browser automation, no CAPTCHA bypass, no scraping of protected pages.

This approach treats Google as the discovery engine and Ansly as the evaluator and contextualizer.

#### E. User-authorized imports
A user-uploaded list or a supported import flow may be used when the source cannot be integrated directly. This should require explicit user action and a clear consent boundary.

### 9.3 Google search integration and provider abstraction

The system should not independently recreate a generic web search engine. Instead, it should query a supported search provider with targeted employer research prompts and then evaluate the results.

Required design constraints:
- use an officially documented search API or an equivalent licensed provider; do not scrape the public Google search UI,
- keep provider credentials in backend environment variables only,
- treat all search snippets and result metadata as untrusted evidence,
- allow fallback providers only if they meet the same compliance and licensing requirements,
- keep a provider abstraction so the feature can switch vendors without rewriting the employer research workflow.

Recommended provider selection order:
1. official Google-backed search API or a documented partner provider with compliant terms,
2. a licensed search provider that returns Google Search results through a supported API contract,
3. a limited, user-authorized import route when no compliant search API is available.

This is intentionally narrower than a custom search crawler. Ansly should handle employer analysis and evidence validation, while the provider handles public web discovery.

### 9.4 Source adapter architecture

Each source should implement a common adapter contract:
- `platform_id`
- `name`
- `is_supported()`
- `discover_jobs(criteria)`
- `fetch_job_details(job_ref)`
- `normalize(raw_job)`
- `validate_source_permissions()`
- `extract_company_identity(raw_job)`
- `extract_application_urls(raw_job)`
- `handle_rate_limit()`

This is needed so that future sources can be added without rewriting the matching engine or UI.

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
- raw_payload (optional, kept as immutable source snapshot)

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

After a job is found and matched, the system should identify the hiring employer and determine whether there is a legitimate, publicly available recruitment or application route.

### 12.2 What to distinguish

The implementation must keep these separate:
- the job board (e.g. LinkedIn or Indeed)
- the original listing page
- the official company careers page
- the employer itself
- any recruitment agency or staffing company
- any public general company contact route

### 12.3 Workflow

For each job:
1. extract the company name and domain,
2. resolve the employer website,
3. check official career pages,
4. perform targeted employer research through a supported search provider,
5. evaluate result relevance against the identified employer and the specific job,
6. inspect promising public pages only when permitted,
7. validate whether an email looks like a recruitment or HR contact,
8. store the evidence and source URL,
9. keep the original job listing URL separately,
10. surface the best available contact route without fabricating anything.

### 12.3.1 Employer search workflow

The research workflow should be implemented in two stages.

Stage A: Search discovery
- generate a small number of high-value search queries from the company name and job context,
- query examples: `Company official website`, `Company careers email`, `Company HR contact`, `Company talent acquisition`, `Company recruitment page`, `Company careers page`,
- record query text, provider, timestamp, result title, URL, snippet, and domain,
- deduplicate repeated queries and reuse cached results for the same employer where appropriate.

Stage B: Evidence verification
- inspect promising public pages only when legally and technically permitted,
- verify that the page belongs to the employer or is an official careers page,
- extract recruiting emails, official application links, contact pages, or career pages,
- attach source URLs and evidence snippets to each discovered contact or route,
- keep unverified results labeled as such rather than treating a snippet alone as proof.

Important: search snippets, page titles, and result domains are not sufficient evidence by themselves. Only explicit public sources that support the contact claim should be treated as validated.

### 12.3.2 Query generation strategy

The search query generator should be reusable and deterministic.

Recommended behavior:
- build queries from a small set of employer and role-specific keywords,
- prioritize the employer name, domain, and recruitment-related terms,
- avoid excessive query bursts,
- keep the query set small and high-value,
- re-use cached employer data across multiple jobs from the same company,
- track provider rate limits and quotas.

This keeps the system economical while still providing useful employer discovery evidence.

### 12.4 Contact priority hierarchy

Priority order:
1. dedicated recruitment or HR email,
2. general company email,
3. official careers page or application route,
4. original listing URL.

Examples of priority 1 items:
- jobs@company.com
- careers@company.com
- recruiting@company.com
- talent@company.com

General company contact should be labeled separately as `general_company_contact`, not as recruitment-specific contact.

### 12.5 Provenance requirements

Every contact needs:
- email or URL,
- contact type,
- source_url,
- discovery_method,
- evidence snippet or page reference,
- verification_status,
- confidence,
- last_checked_at,
- associated_company_id.

Important rule: a generic domain match is not proof that the email belongs to recruiting or HR. This is especially important for general company addresses and domain-based heuristics.

### 12.6 Contact verification states

A discovered employer contact should be classified as one of the following:
- verified_public_contact: the email or URL appears on an accessible, relevant public page and is supported by the page text,
- search_result_only: the provider returned a candidate email or URL, but the source page was not verified,
- unverified: insufficient evidence to trust the contact route,
- invalid_or_rejected: the source is contradictory, irrelevant, or clearly not a recruitment pathway.

This distinction prevents the application from claiming a contact is trustworthy when it only appears in a snippet or shares the same domain.

---

## 13. Mandatory integration: reuse the existing email-generation flow

This is a core requirement and must be treated as a first-class integration requirement.

### 13.1 What exists in the repo

The repo currently shows a generalized AI answer-generation and user-knowledge retrieval flow, plus documentation for a future Leads email-generation feature. The actual codebase does not currently contain a working Leads draft editor. This means the Job Discovery implementation should integrate with the same user-knowledge and LLM-generation architecture, and maintain compatibility with any future Leads generator that is added later.

### 13.2 Reuse mandate

The Job Discovery feature must not introduce a second independent email-generation system. It must reuse the existing platform capability for:
- user knowledge retrieval,
- email drafting logic,
- validation,
- storage/model conventions,
- draft management if present,
- copy/regenerate/edit flows.

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

A generated draft should be associated with the discovered job and, when relevant, with the employer contact route used. If the app later adds leads and job drafts as separate models, the association should remain explicit and not implicitly merge records.

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

The following are new and required for implementation:

#### `job_discovery_profiles`
Purpose: user-configured saved search/filter profiles for jobs.
Fields:
- id
- user_id
- name
- description
- target_roles
- keywords
- excluded_keywords
- technologies
- industries
- locations
- remote_preferences
- employment_types
- seniority_levels
- created_at
- updated_at
- active

#### `job_sources`
Purpose: registry for legally supported source providers.
Fields:
- id
- name
- platform_type
- is_active
- api_enabled
- auth_required
- rate_limit_policy
- created_at

#### `jobs`
Purpose: canonical job record.
Fields:
- id
- user_id (if user-saved or discovered for them only, or it can be a globally shared job with user_scope filtering applied)
- source_id
- external_job_id
- canonical_url
- source_url
- official_application_url
- title
- company_name
- company_domain
- location
- work_mode
- employment_type
- description
- published_at
- first_seen_at
- last_seen_at
- last_verified_at
- status
- is_saved
- raw_payload
- created_at
- updated_at

#### `job_companies`
Purpose: employer-level reference.
Fields:
- id
- source_id
- company_name
- domain
- official_website_url
- careers_url
- company_profile_text
- created_at
- updated_at

#### `job_contacts`
Purpose: employer/public-contact evidence.
Fields:
- id
- job_id
- company_id
- contact_type
- email
- url
- source_url
- evidence_summary
- verification_status
- confidence
- discovered_at
- last_checked_at
- created_at
- updated_at

#### `employer_research_runs`
Purpose: tracks a run of employer research for a company or job.
Fields:
- id
- user_id
- job_id (nullable when company-level results are shared)
- company_id
- provider_name
- status
- queries_total
- queries_executed
- results_found
- started_at
- completed_at
- summary_json
- created_at

#### `employer_search_queries`
Purpose: stores the queries used to research a company.
Fields:
- id
- research_run_id
- company_id
- query_text
- created_at
- result_count

#### `employer_search_results`
Purpose: stores provider search results and provenance for a company.
Fields:
- id
- research_run_id
- company_id
- result_title
- result_url
- result_domain
- result_snippet
- provider_name
- raw_result_json
- created_at

#### `employer_contact_findings`
Purpose: stores a normalized employer contact route with evidence and confidence.
Fields:
- id
- job_id
- company_id
- contact_type
- email
- url
- source_url
- evidence_summary
- verification_status
- confidence
- is_primary
- discovered_at
- last_checked_at
- created_at
- updated_at

#### `job_matches`
Purpose: job-to-user fit scoring and explanation.
Fields:
- id
- job_id
- user_id
- overall_score
- match_category
- matched_skills
- missing_skills
- reason
- confidence
- generated_at
- created_at

#### `job_discovery_runs`
Purpose: a run/session for a discovery query or fetch.
Fields:
- id
- user_id
- profile_id
- source_id
- started_at
- completed_at
- status
- discovered_count
- matched_count
- duplicates_skipped
- errors_count
- summary_json

#### `saved_jobs`
Purpose: user-saved opportunities.
Fields:
- id
- user_id
- job_id
- saved_at
- notes
- status

#### `job_drafts` or association tables for drafts
Purpose: reuse or extend the existing draft model if the Leads email generator supports draft persistence.
Fields:
- id
- user_id
- job_id
- draft_id (if reusing a generic draft model)
- recipient_email
- subject
- body
- created_at
- updated_at

### 16.3 Relationships

Recommended relationships:
- one user has many discovery profiles,
- one user has many discovery runs,
- one user has many saved jobs,
- one job belongs to one source,
- one job has many job matches,
- one job has many contacts,
- one company has many jobs,
- one company has many contacts,
- one job may have one or more generated drafts.

### 16.4 Indexing and constraints

Recommended indexes:
- `jobs`: by user_id, status, updated_at, source_id, canonical_url, company_domain, published_at
- `job_contacts`: by job_id, company_id, email, verification_status
- `job_matches`: by job_id and user_id
- `saved_jobs`: by user_id, job_id
- `job_discovery_profiles`: by user_id and active state

Use a unique constraint on canonical job identity when available:
- `(source_id, external_job_id)`
- or `(canonical_url)` when the source provides a canonical page.

### 16.5 Row-level security

All job-related tables must be user-scoped and protected by RLS. Jobs and company contact records should be protected to the user who saved or created them, unless shared-by-source data is intentionally designed to be shared. The initial v1 should keep all job and discovery data user-owned.

---

## 17. Backend API design

The backend should be implemented using the existing FastAPI route pattern and route registration under [llm/src/app/api/router.py](../llm/src/app/api/router.py).

### 17.1 Proposed endpoints

- `GET /api/v1/jobs/discovery-profiles`
- `POST /api/v1/jobs/discovery-profiles`
- `PATCH /api/v1/jobs/discovery-profiles/{id}`
- `DELETE /api/v1/jobs/discovery-profiles/{id}`
- `POST /api/v1/jobs/discover`
- `GET /api/v1/jobs`
- `GET /api/v1/jobs/{id}`
- `POST /api/v1/jobs/{id}/save`
- `POST /api/v1/jobs/{id}/unsave`
- `GET /api/v1/jobs/{id}/matches`
- `POST /api/v1/jobs/{id}/generate-email`
- `GET /api/v1/jobs/{id}/contacts`
- `POST /api/v1/jobs/{id}/research-employer`
- `GET /api/v1/jobs/{id}/research-employer`
- `POST /api/v1/jobs/{id}/refresh`
- `GET /api/v1/jobs/saved`
- `GET /api/v1/companies/{company_id}/research`
- `POST /api/v1/companies/{company_id}/research/refresh` 

These endpoints should support both job-specific and company-level research runs. A company with multiple jobs should reuse cached employer research when the employer context is stable and the contact evidence remains valid.

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

Job discovery, refresh, matching, and employer enrichment can require several network calls and AI operations. Doing these synchronously in a normal request would be poor UX and would complicate rate-limit handling.

### 18.2 Recommended approach

Implement discovery and refresh as background jobs, but keep the design simple and compatible with the repository’s current architecture.

Recommended minimal pattern:
- create a job discovery run record,
- queue work per source or per run,
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
- personal email harvesting.

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

The feature must respect the same user-owned data model and deletion semantics as the rest of the app. Contact and job metadata should be deletable by the data owner and protected by RLS.

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
- limiting source requests per run,
- bounding the number of jobs sent to AI per phase,
- avoiding expensive enrichment for clearly irrelevant jobs,
- caching normalized source data and employer-domain results when appropriate,
- reusing employer search results across multiple jobs from the same company,
- tracking provider quotas and search costs for Google-backed or licensed search providers,
- supporting a user-defined source cap.

### 21.2 Token budget

The LLM should be used for:
- relevance scoring and explanation,
- contact validation and classification,
- drafting personalized application emails.

It should not be used for simple filtering when deterministic logic is sufficient.

### 21.3 Scale expectations

The initial implementation should assume modest, user-driven discovery runs rather than a large global crawl. This matches the current repository architecture and avoids introducing too much new infrastructure.

---

## 22. Testing strategy

### 22.1 Unit tests

Recommended unit test coverage:
- source adapter normalization,
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
- RLS enforcement,
- adapter fetch + normalization,
- save/unsave job flows,
- job detail retrieval,
- match result generation,
- contact-enrichment result persistence,
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
- email-generation flow remains compatible if the Leads feature later exists in the codebase.

---

## 23. Recommended implementation phases

### Phase 1 — foundation

Includes:
- database schema for jobs, companies, contacts, saved jobs, profile targets,
- new API route scaffolding,
- source adapter contract,
- basic normalization and dedupe,
- UI skeleton for discovery list and details.

Acceptance criteria:
- user can create a discovery profile,
- a job can be discovered and stored,
- duplicate jobs are prevented,
- job detail loads.

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
- company identification,
- official application URL resolution,
- public contact discovery,
- provenance and confidence handling.

Acceptance criteria:
- a job can include an official application route and a contact route,
- contact info is clearly labeled as recruitment vs general company contact,
- no fabricated email appears.

### Phase 4 — email generation integration

Includes:
- job-to-email context builder,
- reuse of the shared email-generation flow,
-ाजा association to the job,
- draft display and editing.

Acceptance criteria:
- a real job can generate a grounded email draft,
- the draft is associated with the right job and recipient,
- the feature does not create a second email-generation stack.

### Phase 5 — lifecycle and optimization

Includes:
- refresh logic,
- expiry handling,
- source health monitoring,
- performance tuning,
- cost review.

Acceptance criteria:
- stale jobs are labeled clearly,
- source failures do not incorrectly mark all jobs as expired,
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
- a supported adapter produces normalized job items,
- unsupported sources fail with clear messaging,
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
- company identity is stored separately from the listing,
- official application route is surfaced,
- contacts are labeled by type and provenance.

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
- source failures do not destroy the existing record, 
- status changes are explicit.

---

## 25. Risks, limitations, and unresolved decisions

### 25.1 Verified constraints in the repo

- there is no current implementation of a concrete job discovery engine,
- there is no verified Leads email-generation implementation in the checked-in code,
- there are no current job tables or discovery tables in the migration set,
- the repo favors conservative, user-controlled AI workflows.

### 25.2 Risks

- some source providers may not provide a compliant public feed,
- employer-contact enrichment may be low-confidence for some companies,
- job titles and descriptions are often noisy,
- AI explanation can drift without structured validation,
- scraping protected pages would be a compliance issue.

### 25.3 Open questions

The following should be confirmed before coding:
- which source or provider is officially approved first,
- whether discovery is extension-driven, API-driven, or both,
- whether the initial release supports a user-uploaded job list or only supported provider adapters,
- whether the existing Leads email-generation feature is implemented elsewhere or is strictly a future requirement,
- whether the app should support a saved-jobs list or only a discovery results page plus a save action.

---

## 26. Final implementation checklist

- [ ] Add Job Discovery route and nav item in the authenticated app shell.
- [ ] Add job-discovery profile CRUD flows.
- [ ] Define database schema for jobs, source, company, contact, match, and saved jobs.
- [ ] Add source adapter contract and first supported source.
- [ ] Add job normalization and duplicate detection.
- [ ] Add AI matching and structured output validation.
- [ ] Add employer identification and contact provenance.
- [ ] Add official application route and original listing model.
- [ ] Reuse the shared email-generation flow for job application drafts.
- [ ] Add saved-job UX and lifecycle status handling.
- [ ] Add background processing pattern for fetch and refresh runs.
- [ ] Add RLS and user safety checks.
- [ ] Add targeted testing and regression coverage.

---

## 27. Summary

Ansly Job Discovery should be a grounded, user-controlled job search and employer research layer built on top of the existing Ansly architecture. It should reuse the current authenticated dashboard, profile and knowledge retrieval model, LLM gateway, and API patterns. It must not introduce a second user profile system, must not bypass source restrictions, must not fabricate contact information, and must reuse the shared email-generation capability rather than duplicate it. The implementation remains deliberately narrow at v1: discover, normalize, qualify, enrich, save, and prepare grounded application drafts without replacing the existing Ansly application-assistant behavior or introducing autonomous job-applying logic.

This specification is designed to be implementation-ready for a coding agent in the current repository, while being explicit about which parts are verified and which parts are new work that must be added consistent with the existing architecture.
