You are a senior product designer, UX engineer, browser-extension engineer, Next.js engineer, React engineer, FastAPI engineer, and AI product architect.

I am improving **Ansly**, an AI job-application assistant.

The product already has:

- structured candidate profile
- profile facts
- saved answers
- Ask-and-Learn for missing information
- browser-extension answer popovers
- Fill All
- answer editing
- regeneration
- resume tailoring
- job context
- deterministic answers
- application usage tracking
- strict truthfulness / no-invention behavior

The next phase is NOT mainly about token optimization.

The next phase is about making Ansly feel polished, intelligent, trustworthy, fast, and easy to use.

Focus on these six areas:

1. Turn Ask-and-Learn into a killer feature
2. Build Application Memory that works reliably
3. Replace unnecessary full regeneration with lightweight rewrite controls
4. Add excellent character-limit intelligence
5. Dramatically improve onboarding
6. Fully improve the extension UI and overall user experience

Do not do a broad rewrite.

Inspect the current implementation and improve it incrementally while preserving:

- truthfulness
- user control
- privacy
- RLS
- current API compatibility where practical
- low token usage
- fast response times

---

# PART 1 — ASK-AND-LEARN SHOULD BECOME A CORE PRODUCT FEATURE

Current behavior:

When Ansly lacks enough information, it can ask the user for missing information and save it through the profile/missing flow.

This is good technically, but it should feel like the product is intelligently learning from the user.

The UX should make this obvious.

## Goal

When Ansly does not know something, instead of simply failing or saying "insufficient information", show a compact contextual learning flow.

Example:

```text
Ansly needs one detail

This application asks:

"Are you willing to relocate to Austin?"

Your profile doesn't have a relocation preference for this case.

○ Yes
○ No
○ Depends on the role

☑ Remember this for future applications

[Save & Continue]
```

After save:

```text
Saved to your Application Memory

Ansly can now answer similar questions automatically.
```

Then immediately retry the original answer.

The user should NOT need to:

```text
leave the page
open profile
find settings
edit profile
return to application
generate again
```

Everything should happen inline.

---

# 2. SUPPORT MULTIPLE MISSING FACTS IN ONE FLOW

If a job application reveals multiple missing facts, do not interrupt the user repeatedly.

Instead show:

```text
Ansly needs 3 details

1. Are you willing to relocate?
   [Yes] [No] [Depends]

2. Do you require visa sponsorship?
   [Yes] [No]

3. Expected salary?
   [____________]

☑ Remember these answers

[Save 3 details & Continue]
```

Save all compatible facts in one request if possible.

Then regenerate all blocked answers automatically.

---

# 3. GROUP MISSING INFORMATION BY TYPE

Create clear categories:

```text
Personal
Work authorization
Availability
Relocation
Compensation
Skills
Experience
Education
Preferences
Other
```

Use the category to determine UI.

Examples:

## Boolean

```text
Do you require sponsorship?
[Yes] [No]
```

## Number

```text
Years of Kubernetes experience
[  3  ]
```

## Choice

```text
Preferred work arrangement
[Remote] [Hybrid] [On-site]
```

## Text

```text
Notice period
[2 weeks]
```

## Skill state

```text
Do you have Terraform experience?

[Yes]
[No]
[Some exposure]
```

Do not use one generic text input for every fact.

---

# 4. DISTINGUISH FACTS FROM JOB-SPECIFIC PREFERENCES

Not everything should become permanent memory.

Before saving, determine whether a fact is:

```text
GLOBAL
JOB_SPECIFIC
TEMPORARY
```

Examples:

### Global

```text
work authorization
degree
years of Python experience
notice period
location
```

### Preference that may vary

```text
salary expectation
relocation
willingness to travel
remote/on-site preference
```

### Job-specific

```text
Why are you interested in Acme?
Availability for this interview date
Desired salary for this particular role
```

Do NOT permanently store job-specific answers as universal user facts.

---

# 5. ADD MEMORY SCOPE

Every learned fact should have a scope.

Conceptually:

```text
scope = global
scope = category
scope = company
scope = job
```

Examples:

```text
"I require sponsorship"
→ global

"I would relocate for a senior role"
→ preference/category

"My expected salary for this role is $120k"
→ job-specific
```

This prevents memory from becoming incorrect over time.

---

# PART 2 — APPLICATION MEMORY

Build an explicit **Application Memory** feature.

This should be the user's source of truth for everything Ansly has learned outside of the structured resume/profile sections.

The user should be able to view and edit it.

---

# 6. APPLICATION MEMORY PAGE

Create a dedicated page such as:

```text
/application-memory
```

or:

```text
/profile/memory
```

Show:

```text
Application Memory

Work authorization
✓ Authorized to work in Pakistan
✓ Sponsorship preference known

Availability
✓ Notice period: 30 days

Work preferences
✓ Remote preferred
✓ Open to hybrid
✓ Relocation depends on role

Skills
✓ Kubernetes: 2 years
✓ Terraform: no professional experience

Learned facts
12

Saved application preferences
8
```

---

# 7. MEMORY SHOULD SHOW WHERE EACH FACT CAME FROM

Every fact should show provenance.

Example:

```text
Open to relocation

Source:
Asked during an application to Acme
October 5, 2026
```

or:

```text
Python: 4 years

Source:
Profile → Skills
```

or:

```text
Work authorization: Yes

Source:
You answered this during a job application
```

This dramatically increases trust.

---

# 8. MEMORY CONFIDENCE / SOURCE PRIORITY

Create a deterministic priority model.

For example:

```text
1. Explicit structured profile
2. User-confirmed learned fact
3. Saved answer
4. Resume evidence
5. Inferred job-specific context
```

Never let an old saved answer silently override a newer explicit profile fact.

Memory resolution should always be deterministic.

---

# 9. MEMORY VERSIONING / LAST UPDATED

Facts should track:

```text
created_at
updated_at
source_type
source_id
scope
```

Display:

```text
Last updated 12 days ago
```

For potentially stale preferences, optionally show:

```text
Still accurate?

Remote preferred
Last confirmed 8 months ago

[Yes] [Update]
```

Do not annoy users frequently.

Only surface this for facts likely to change.

---

# 10. MEMORY CONFLICT DETECTION

If two sources disagree:

```text
Resume:
3 years Python

Profile:
4 years Python
```

or:

```text
Old learned fact:
Requires sponsorship

Profile:
Does not require sponsorship
```

Do not silently choose.

Use a clear resolution rule and optionally surface:

```text
Ansly found conflicting information

Work authorization

Profile:
Does not require sponsorship

Older application memory:
Requires sponsorship

[Use profile]
[Update memory]
```

Structured profile should generally win unless the user explicitly changes it.

---

# 11. MEMORY SHOULD POWER ANSWERS DIRECTLY

Application Memory should be part of deterministic answer resolution.

Ideal path:

```text
Question
↓
Structured profile
↓
Application Memory
↓
Saved answers
↓
Relevant evidence
↓
LLM only if needed
```

This should increase:

```text
0-token answer rate
```

and reduce unnecessary generation.

---

# 12. MEMORY SHOULD BE EDITABLE INLINE

From an answer popover, allow:

```text
Used memory:
Relocation → Yes

[Edit]
```

Clicking opens:

```text
Relocation preference

● Yes
○ No
○ Depends

☑ Save globally

[Update]
```

No need to leave the application page.

---

# 13. ADD MEMORY CONTROLS

Users should be able to:

```text
Edit
Delete
Change scope
Mark outdated
Confirm
```

Do not create memory users cannot control.

---

# PART 3 — REWRITE CONTROLS INSTEAD OF FULL REGENERATION

Currently users can regenerate answers.

Full regeneration is often unnecessary, slower, and more expensive.

Add lightweight transformations.

---

# 14. REWRITE TOOLBAR

For generated text answers, show:

```text
Shorter
Longer
More natural
More professional
More concise
More technical
More confident
Simpler
```

Keep the default toolbar small.

For example:

```text
[Shorter] [Natural] [Professional] [More ▾]
```

---

# 15. REWRITE SHOULD USE EXISTING ANSWER AS SOURCE

Do NOT rebuild the answer from the full candidate profile unless necessary.

Rewrite request should contain:

```text
original answer
rewrite instruction
field character limit
small job context only if needed
```

Target very low token usage.

The rewrite must preserve facts.

---

# 16. DO NOT ALLOW REWRITE TO INVENT FACTS

Before accepting rewritten output, validate:

- names
- employers
- years
- numbers
- technologies
- metrics
- degrees
- work authorization
- salary
- dates

If the rewrite introduces unsupported claims:

reject it and preserve the original answer.

---

# 17. CUSTOM REWRITE

Add:

```text
Rewrite...
```

Then a small input:

```text
"Make this more direct and emphasize backend experience."
```

Keep this contextual.

Do not require a full chat interface.

---

# 18. EDIT-FIRST UX

Users may manually edit text.

Preserve their edits.

If they click:

```text
Shorter
```

after manually editing:

rewrite the user's latest edited version, NOT the old generated version.

---

# PART 4 — CHARACTER-LIMIT INTELLIGENCE

This should feel excellent.

---

# 19. ALWAYS DETECT FIELD LIMITS

Use:

```text
maxlength
visible helper text
aria descriptions
nearby text
question text
```

Examples:

```text
Maximum 500 characters
Max 250 words
Minimum 100 characters
```

Store constraint metadata with the detected field.

---

# 20. SHOW LIVE COUNT

For text answers:

```text
423 / 500 characters
```

For word-limited fields:

```text
178 / 250 words
```

Use clear states:

```text
382 / 500
```

```text
492 / 500 — near limit
```

```text
531 / 500 — 31 over
```

---

# 21. FIT TO LIMIT

If the answer is too long:

```text
31 characters over

[Fit to limit]
```

Do not automatically truncate.

Use rewrite/compression logic.

Preserve important evidence and meaning.

---

# 22. GENERATE TO TARGET LENGTH

When generating from scratch, the prompt should know:

```text
field max chars
field max words
desired length
```

Generate inside the target where possible.

Example:

```text
Target:
350–450 characters

Hard max:
500
```

Avoid generating 900 characters and then shortening.

---

# 23. SMART LENGTH PRESETS

For unrestricted fields:

```text
Short
Standard
Detailed
```

Map them to approximate output budgets.

For example:

```text
Short:
50–90 words

Standard:
100–160 words

Detailed:
180–250 words
```

Adapt by question type.

---

# PART 5 — ONBOARDING

The current onboarding requires users to understand profile sections, resume upload, extension connection, permissions, etc.

Make it dramatically simpler.

---

# 24. NEW ONBOARDING PRINCIPLE

Do not ask users to manually fill a full profile before getting value.

Ideal flow:

```text
Create account
↓
Upload resume
↓
Ansly extracts profile
↓
Review important facts
↓
Answer 4–6 application preferences
↓
Install/connect extension
↓
Test one example
↓
Ready
```

---

# 25. RESUME-FIRST ONBOARDING

Step 1:

```text
Let's build your profile

Upload your resume and Ansly will extract:

✓ experience
✓ skills
✓ projects
✓ education
✓ contact details

[Upload resume]
```

Then parse.

---

# 26. PROFILE REVIEW

After parsing:

```text
We found:

4 experiences
23 skills
5 projects
1 degree

[Review profile]
```

Do not show users a giant form immediately.

Use section cards.

---

# 27. ASK ONLY WHAT A RESUME DOESN'T CONTAIN

Then ask:

```text
Work authorization
Sponsorship
Notice period
Relocation
Preferred work mode
Salary preference
```

Use quick choices.

---

# 28. ONBOARDING PROGRESS

Show:

```text
Get Ansly ready

████████░░ 80%

✓ Account
✓ Resume
✓ Profile
✓ Preferences
○ Connect extension
○ Try your first answer
```

Avoid making users feel blocked.

---

# 29. ALLOW SKIP

Every non-essential onboarding step should support:

```text
Skip for now
```

Then Ask-and-Learn can collect missing information later.

---

# 30. FIRST VALUE MOMENT

After extension connection, immediately give the user something useful.

Example:

```text
Try Ansly

Question:
"Why are you interested in this role?"

[Generate sample answer]
```

or open the Playground preconfigured.

The user should understand the product within 2–3 minutes.

---

# PART 6 — FULL EXTENSION UI REDESIGN

The extension is the core daily experience.

Improve it substantially.

Do not make it visually noisy.

---

# 31. ONE GLOBAL ANSLY WIDGET

Instead of many disconnected interactions, create a compact page-level widget.

Example:

```text
Ansly

9 fields detected

5 ready instantly
3 need AI
1 needs information

[Review & Fill]
```

Keep it collapsed by default.

---

# 32. FIELD-LEVEL BUTTONS SHOULD BE QUIET

Use a small subtle icon beside eligible fields.

States:

```text
sparkle → available
spinner → generating
check → ready
warning → needs review
question → missing info
```

Avoid large floating buttons beside every field.

---

# 33. POPOVER STRUCTURE

Redesign answer popover:

```text
Ansly
────────────────

Question
Why do you want to work here?

Answer
[editable textarea]

382 / 500 characters

Based on
• Job description
• Nizam LLC experience
• OnTask project

[Shorter] [Natural] [More ▾]

[Fill answer]
```

Secondary actions:

```text
Save
Regenerate
Edit memory
```

Keep primary action obvious.

---

# 34. SHOW ANSWER SOURCE

Use simple status:

```text
Instant
From your profile
```

```text
Saved answer
Adapted for this job
```

```text
AI generated
Grounded in 3 profile records
```

Do not expose internal model names by default.

That belongs in debug/details.

---

# 35. LOW CONFIDENCE UX

Use clear language.

Good:

```text
Review recommended

Ansly found limited supporting information.
```

Bad:

```text
Confidence: 0.63
```

Users understand explanations better than model-style numbers.

---

# 36. MISSING INFORMATION UX

Inline:

```text
Ansly needs one detail

How many years of Docker experience do you have?

[____ years]

☑ Remember this

[Save & continue]
```

This is where Ask-and-Learn and Application Memory should feel seamless.

---

# 37. FILL ALL PANEL REDESIGN

Structure:

```text
Application Assistant

9 questions

Ready              6
Review              2
Need info           1
```

Then cards:

```text
✓ Work authorization
Ready instantly

✓ Python experience
Ready instantly

⚠ Why this company?
Review recommended

? Willing to relocate?
Needs information
```

---

# 38. REVIEW BEFORE FILL

The user should be able to:

```text
Select all ready
```

and:

```text
Review only warnings
```

Do not force users to open every good answer.

---

# 39. FILL ALL FINAL ACTION

Example:

```text
7 answers ready
1 needs review
1 needs info

[Fill 7 ready answers]
```

After fill:

```text
7 fields filled

[Undo all]
```

---

# 40. GENERATE REST TOGETHER

Keep the successful batching UX.

If multiple generative questions remain:

```text
5 longer questions remain

Answer them together for faster generation.

[Answer the rest together]
```

This should remain prominent.

---

# 41. PAGE-LEVEL STATUS

At the bottom/corner:

```text
Ansly

✓ 8 answered
⚠ 1 review
? 1 missing

[Open]
```

Users should always know application state.

---

# 42. JOB DETECTION UI

On a job page:

```text
Ansly found this job

Software Engineer
Acme

12 requirements analyzed

[Prepare application]
```

Do not immediately run expensive actions.

User initiates preparation.

---

# PART 7 — FULL USER EXPERIENCE IMPROVEMENTS

---

# 43. CONSISTENT STATUS LANGUAGE

Use the same states everywhere:

```text
Ready
Generating
Review
Needs info
Saved
Filled
Failed
```

Do not use different terminology between:

- extension
- web
- resume workflow
- playground

---

# 44. USER-FRIENDLY ERRORS

Never show:

```text
500
validation_error
generation_failed
```

Show:

```text
Ansly couldn't generate this answer.

Your profile information is safe.

[Try again]
```

If provider issue:

```text
AI service is temporarily busy.

[Retry]
```

If data missing:

```text
Ansly needs more information from you.
```

---

# 45. OPTIMISTIC UI

When the user clicks Generate:

popover should react instantly:

```text
Generating answer...
```

Do not leave the UI unchanged waiting for network response.

---

# 46. SKELETONS INSTEAD OF SPINNERS WHERE USEFUL

For:

- dashboard
- resume lists
- tailoring review
- application memory

use lightweight skeleton content.

---

# 47. PRESERVE USER WORK

If user edits an answer and accidentally closes/reopens the popover:

preserve draft locally for that field/session.

Do not lose their edits.

---

# 48. LOCAL DRAFT CACHE

Key conceptually by:

```text
job URL
field identifier
question hash
```

Short-lived.

Clear after fill or explicit discard.

---

# 49. KEYBOARD EXPERIENCE

Support:

```text
Enter → primary action where safe
Esc → close
Cmd/Ctrl + Enter → Fill
```

Do not interfere with text editing.

---

# 50. ACCESSIBILITY

Audit:

- focus order
- keyboard navigation
- aria labels
- screen reader status
- contrast
- focus traps in popovers/panels
- tooltip accessibility

The shadow-DOM extension UI must remain accessible.

---

# 51. REDUCE VISUAL CLUTTER

Do not show:

```text
provider
model
tokens
retrieval mode
confidence numeric score
debug IDs
```

in normal UI.

Move those into:

```text
Details
```

or developer diagnostics.

---

# 52. TRUST UI

Make these visible:

```text
Uses your profile only
Never submits automatically
Review before fill
```

Especially during onboarding and first use.

---

# 53. MEMORY UX SHOULD FEEL SMART, NOT CREEPY

Use explicit feedback:

```text
Remembered because you chose "Remember this".
```

Do not silently create broad personal facts from generated text.

Only save:

- explicit user input
- explicitly confirmed information
- structured profile edits

---

# PART 8 — DATA MODEL / BACKEND FOR MEMORY

Inspect current:

```text
profile_facts
profiles
skills
saved_answers
```

Do not duplicate data unnecessarily.

Create a clean memory abstraction around existing data if possible.

If extending `profile_facts`, consider fields such as:

```text
id
user_id
key
value
value_type
category
scope
company
job_key
source_type
source_id
confidence
confirmed
created_at
updated_at
last_used_at
```

Do not store raw question text unless required.

Prefer normalized keys.

Examples:

```text
relocation_preference
notice_period
years_kubernetes
travel_willingness
```

---

# 54. MEMORY RESOLUTION SERVICE

Create one backend service/helper responsible for:

```text
resolve_fact(...)
save_fact(...)
update_fact(...)
delete_fact(...)
find_conflicts(...)
```

Do not scatter memory resolution logic across many endpoints.

---

# 55. MEMORY PRECEDENCE

Implement explicit precedence.

Suggested:

```text
explicit current profile field
>
explicit confirmed memory
>
structured skill/experience evidence
>
saved answer
>
generated answer
```

Generated answers should NEVER automatically become factual memory.

---

# 56. MEMORY INVALIDATION

When the user changes:

```text
profile
skill
experience
preference
```

invalidate or mark conflicting learned memory as superseded where appropriate.

---

# PART 9 — ANALYTICS

Track only non-sensitive product events.

Examples:

```text
ask_and_learn_shown
ask_and_learn_completed
memory_fact_saved
memory_fact_edited
memory_fact_deleted
rewrite_used
fit_to_limit_used
answer_filled
fill_all_completed
undo_used
```

Do NOT store answer/question text.

---

# 57. UX SUCCESS METRICS

Track:

```text
% answers resolved without generation
% missing-info prompts completed
% missing-info prompts abandoned
% learned facts reused
% rewrites vs regenerations
% answers filled without editing
% answers edited before fill
% Fill All completion
% undo rate
```

Important:

```text
regeneration rate
```

should go DOWN if rewrite controls improve UX.

---

# 58. ONBOARDING METRICS

Track:

```text
signup → resume uploaded
signup → profile ready
signup → extension connected
signup → first answer
signup → first Fill All
```

Measure drop-off.

Do not just count signups.

---

# PART 10 — IMPLEMENTATION ORDER

Do this incrementally.

## P0 — Core memory

1. Audit `profile_facts` and Ask-and-Learn
2. Create memory resolver
3. Add scopes/provenance/conflict handling
4. Add Application Memory page
5. Connect memory directly to deterministic answers

## P0 — Ask-and-Learn

6. Redesign inline missing-info form
7. Support multiple missing facts
8. Save and automatically retry
9. Add "Remember this" behavior
10. Add inline memory editing

## P0 — Extension UX

11. Redesign answer popover
12. Redesign Fill All panel
13. Add page-level status widget
14. Simplify field-level buttons
15. Add clear Ready / Review / Need info states

## P1 — Rewrite controls

16. Add Shorter/Natural/Professional/etc.
17. Add custom rewrite
18. Preserve manual edits
19. Validate rewritten facts
20. Reduce full regenerations

## P1 — Character limits

21. Detect char/word limits
22. Add live counts
23. Add Fit to limit
24. Pass limits into initial generation

## P1 — Onboarding

25. Resume-first setup
26. Parsed profile review
27. Ask only missing preferences
28. Add setup checklist
29. Connect extension
30. Give first-value example

## P2 — UX polish

31. Local draft preservation
32. Keyboard shortcuts
33. Accessibility audit
34. Better errors
35. Loading skeletons
36. Consistent status language

---

# PART 11 — TESTING

Add tests for:

## Memory

- save global fact
- save job-scoped fact
- profile overrides memory
- conflict detection
- delete fact
- edit fact
- stale fact behavior
- fact reuse
- no cross-user access

## Ask-and-Learn

- one missing fact
- several missing facts
- save and retry
- skip
- invalid value
- field limit
- skill = none

## Rewrite

- shorter
- more natural
- professional
- custom rewrite
- preserves facts
- rejects invented numbers
- respects character limit
- uses latest edited text

## Extension

- popover states
- Fill All states
- undo
- missing info
- memory edit
- draft preservation
- keyboard navigation

## Onboarding

- resume upload
- parse success
- parse failure
- skip
- extension connection
- setup completion

---

# PART 12 — FINAL REPORT

When complete, report:

## Ask-and-Learn

Before:
...

After:
...

## Application Memory

Data model:
...

Resolution precedence:
...

Conflict behavior:
...

## Rewrite

Old:
full regeneration

New:
lightweight transformation

Token/latency impact:
...

## Character limits

Detection coverage:
...

Generation behavior:
...

## Onboarding

Old steps:
...

New steps:
...

## Extension UI

List every major visual/interaction change.

## UX metrics

List events and success metrics.

## Tests

List test/build/typecheck results.

## Remaining gaps

Be specific.

---

# PRIMARY SUCCESS CRITERIA

The phase succeeds if:

1. Missing information can be answered inline without leaving the job page.
2. New facts are saved only when the user explicitly confirms them.
3. Application Memory has clear provenance and scope.
4. Memory conflicts never silently produce incorrect answers.
5. Structured profile always has clear precedence.
6. Users can edit/delete memory.
7. Similar future questions reuse memory automatically.
8. Rewrite controls replace many full regenerations.
9. Rewrite preserves factual grounding.
10. Character-limited fields are handled intelligently.
11. Onboarding is resume-first and significantly shorter.
12. The extension feels like one cohesive assistant rather than scattered buttons.
13. Ready / Review / Need info states are consistent everywhere.
14. User edits are not accidentally lost.
15. No automatic submission is introduced.
16. Privacy and RLS remain intact.
17. Normal UI hides technical implementation details.
18. Ansly feels faster, calmer, and more trustworthy.

The guiding product principle is:

**Ansly should know what it knows, clearly ask when it doesn't know, remember only what the user explicitly teaches it, and make every future application easier because of that learning.**

Start by inspecting the current Ask-and-Learn, profile facts, popover, Fill All, onboarding, and profile architecture.

Then implement this plan incrementally without breaking existing answer generation or resume tailoring.