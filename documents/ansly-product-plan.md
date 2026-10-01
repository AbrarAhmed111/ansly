# Ansly — Product Plan

Ansly is defined as **two clear product versions**, not a long list of features.

| Version | Product | User's need |
|---|---|---|
| **V1** | AI Job Application Assistant | "I already found a job. Help me apply." |
| **V2** | Job Search & Application Platform | "Find jobs I should apply to and help me apply." |

---

# Part 1 — Version 1: AI Job Application Assistant

**Goal:** Make filling out job applications dramatically faster.

V1 does **not** search for jobs. It assumes the user has already found a job and is on the application page.

## 1. Core Experience

```text
User finds a job
      ↓
Opens application
      ↓
Ansly detects questions
      ↓
✨ appears beside eligible fields
      ↓
User clicks ✨
      ↓
Ansly understands the question
      ↓
Retrieves relevant profile information
      ↓
AI generates personalized answer
      ↓
User reviews / edits
      ↓
Click "Fill"
      ↓
Application field is populated
```

That is the entire product loop.

## 2. Install the Extension

The user installs the Ansly Chrome extension. After authentication:

```text
✓ Ansly is ready

Your profile:
Abrar Ahmed

Profile completeness:
92%
```

The extension runs in the background while the user browses job applications.

## 3. Detect Application Fields

Ansly monitors the page for:

```text
<input>
<textarea>
<select>
[contenteditable]
```

It does not blindly put an icon everywhere. It determines whether a field is likely to need an AI-generated answer.

```text
First name
[ Abrar ]

Last name
[ Ahmed ]

Email
[ ... ]

Why are you interested in this position?
[                                      ] ✨

Tell us about a project you're proud of.
[                                      ] ✨

Describe your experience with React.
[                                      ] ✨
```

The first three fields don't need AI. The last three do.

## 4. Work Across Application Websites

V1 should be **website-agnostic**. The extension should not branch per site:

```text
if LinkedIn:
   do LinkedIn thing
else:
   ...
```

Instead:

```text
Generic DOM detector
        ↓
Question extraction
        ↓
Field classification
        ↓
Ansly UI
```

This allows it to work with:

- LinkedIn applications
- Indeed applications
- Greenhouse
- Lever
- Ashby
- Workday
- Company career pages
- Other ATS systems
- Custom application forms

Some sites will need special handling later, but the initial architecture should be generic.

## 5. Inline UI

The visual identity should be extremely simple:

```text
Why are you interested in this role?   ✨
```

Clicking it opens:

```text
┌──────────────────────────────────────┐
│ ✨ Ansly                             │
├──────────────────────────────────────┤
│                                      │
│ I'm interested in this role because  │
│ it combines my experience building   │
│ full-stack products with my work     │
│ in AI-powered applications...        │
│                                      │
├──────────────────────────────────────┤
│ Regenerate    Edit              Fill │
└──────────────────────────────────────┘
```

The extension should feel like **Grammarly for job applications**, not another dashboard users must constantly interact with.

## 6. Question Understanding

Ansly should not simply send `question → LLM`. It should understand what the question is asking.

For: *"Tell us about a technically challenging project you worked on."*

```text
Category:
Project

Intent:
Technical challenge

Relevant profile:
Projects
Experience
Technical skills
Achievements
```

It then retrieves only the relevant information.

## 7. Professional Profile

The user's profile is the foundation of V1. The web app provides a structured profile:

```text
Profile
│
├── Personal information
├── Professional summary
├── Experience
├── Projects
├── Skills
├── Education
├── Achievements
└── Links
```

Example seed profile:

```text
Experience
├── WebWhiz
└── Nizam LLC

Projects
├── OnTask
├── ToPrep
└── Growducts Acquisition Platform

Skills
├── React
├── Next.js
├── TypeScript
├── Node.js
├── Python
├── FastAPI
├── PostgreSQL
├── Supabase
└── AI / LLM
```

This information is the **source of truth** for generated answers.

## 8. Anti-Hallucination Behavior

One of the most important V1 requirements. Ansly must only use information that exists in the profile — never "this sounds like something the user probably knows."

**Question:** *Do you have experience with Kubernetes?*

If Kubernetes isn't in the profile, Ansly responds:

```text
I don't have enough information in your profile
to answer this accurately.
```

Not: *"Yes, I have worked with Kubernetes…"*

This matters because Ansly is used for real employment applications.

## 9. Answer Generation

The backend receives:

```json
{
  "question": "Tell us about a project you're proud of.",
  "job_context": {
    "company": "Example",
    "role": "Product Engineer"
  }
}
```

It retrieves relevant profile information and generates:

```text
One project I'm particularly proud of is OnTask, an
open-source work execution and collaboration platform...
```

Answers should be:

- First person
- Natural
- Personalized
- Relevant to the question
- Concise by default
- Factually grounded

## 10. Job Context

V1 can optionally use limited context from the current application:

```text
Company:
Example AI

Position:
Senior Product Engineer
```

The job description can also be used if the user explicitly enables it. Then *"Why are you interested in this role?"* is answered from both:

```text
Candidate profile
        +
Job description
        ↓
Personalized answer
```

## 11. Edit Before Filling

Ansly never forces an AI answer directly into the application.

```text
Generate
   ↓
Review
   ↓
Edit if necessary
   ↓
Fill
```

The user stays in control of the application.

## 12. Intelligent Field Filling

V1 supports:

- `textarea`
- Text inputs
- `contenteditable`
- React-controlled fields

It must trigger the right browser events so frameworks like React recognize the change:

```text
Generated answer
       ↓
Fill
       ↓
textarea.value
       ↓
input/change events
       ↓
Website recognizes value
```

## 13. Saved Answers

V1 learns from the user's corrections.

```text
Question:
Tell us about a project you're proud of.

AI answer:
...

User edits answer:
...

[Save as preferred answer]
```

When a similar question appears later (*"What's the project you've enjoyed building most?"*):

```text
A similar saved answer was found.

[Use saved answer]
[Generate new answer]
```

This makes the system increasingly personalized without complicated AI infrastructure.

## 14. Web App

The web app is primarily the **profile management interface**. It does not need to be a job board yet.

```text
Ansly
│
├── Dashboard
├── Profile
│   ├── Personal
│   ├── Experience
│   ├── Projects
│   ├── Skills
│   ├── Education
│   └── Achievements
│
├── Saved Answers
│
└── Settings
```

## 15. Technical Architecture

```text
                    Browser
                       │
                       ▼
              ┌─────────────────┐
              │ Ansly Extension │
              │                 │
              │ WXT             │
              │ TypeScript      │
              │ React           │
              │ Content Script  │
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │    FastAPI      │
              │                 │
              │ Question        │
              │ Analysis        │
              │ Retrieval       │
              │ Generation      │
              └────────┬────────┘
                       │
              ┌────────┴────────┐
              ▼                 ▼
       ┌──────────────┐  ┌───────────────┐
       │  Supabase    │  │ LLM Provider  │
       │ PostgreSQL   │  │ OpenAI/etc.   │
       └──────────────┘  └───────────────┘
```

Plus:

```text
Next.js
   │
   └── Profile / Settings / Auth
```

## 16. Repository

```text
ansly/
│
├── apps/
│   ├── extension/
│   │   ├── src/
│   │   │   ├── content/
│   │   │   ├── background/
│   │   │   ├── components/
│   │   │   └── lib/
│   │   └── wxt.config.ts
│   │
│   └── web/
│       ├── app/
│       ├── components/
│       └── lib/
│
├── services/
│   └── llm/
│       ├── app/
│       │   ├── api/
│       │   ├── services/
│       │   ├── models/
│       │   └── core/
│       └── requirements.txt
│
├── packages/
│   ├── types/
│   └── ui/
│
├── supabase/
│   └── migrations/
│
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

## 17. Technology Stack

| Area | Technology |
|---|---|
| Extension | WXT |
| Extension UI | React + TypeScript |
| Styling | Tailwind |
| Browser | Manifest V3 |
| Web app | Next.js |
| Backend AI | FastAPI |
| AI language | Python |
| Database | Supabase PostgreSQL |
| Auth | Supabase Auth |
| LLM | OpenAI / Anthropic / Gemini |
| JS monorepo | pnpm + Turborepo |
| Web hosting | Vercel |
| Python hosting | Render / Railway |
| Extension distribution | Chrome Web Store |

Not required initially:

- No vector database
- No agent framework
- No RAG system

## 18. V1 Scope Boundary

This boundary is important.

**In V1:**

- ✓ Detect application questions
- ✓ Generate answers
- ✓ Personalize answers
- ✓ Use profile
- ✓ Use job context
- ✓ Edit answers
- ✓ Regenerate answers
- ✓ Fill fields
- ✓ Save answers
- ✓ Work across application websites

**Not in V1:**

- ✗ Find jobs
- ✗ Scrape job boards
- ✗ Job recommendations
- ✗ Job alerts
- ✗ Application tracking
- ✗ Resume builder
- ✗ Cover letter platform
- ✗ Automated job applications
- ✗ Auto-submit
- ✗ Autonomous browser agent
- ✗ Interview preparation
- ✗ Complex RAG

---

# Part 2 — Version 2: Job Search & Application Platform

Once V1 is proven, Ansly becomes a much bigger product. The goal changes from *"Help me answer application questions"* to:

> **"Help me find relevant jobs and handle almost all of the repetitive work around applying."**

## 19. Job Discovery

Ansly gains a job ingestion system:

```text
                    Job Sources
                         │
       ┌─────────────────┼─────────────────┐
       │                 │                 │
       ▼                 ▼                 ▼
      APIs             Feeds              ATS
       │                 │                 │
       └─────────────────┼─────────────────┘
                         ▼
                 Job Ingestion Engine
                         │
                         ▼
                    Normalization
                         │
                         ▼
                    Deduplication
                         │
                         ▼
                     Job Database
```

Rather than making LinkedIn or Indeed scraping the foundation, use a mix of legitimate/public sources, ATS feeds, employer career pages where appropriate, and other supported integrations.

## 20. Job Database

A new database domain:

- `jobs`
- `job_sources`
- `job_matches`
- `saved_searches`
- `applications`
- `application_events`

A normalized job record:

```text
Senior Full Stack Engineer

Company:     Example AI
Location:    Remote
Workplace:   Remote
Salary:      $100k–140k
Skills:      Next.js, TypeScript, Python, PostgreSQL, AI
Experience:  4+ years
Apply:       https://...
```

## 21. AI Job Matching

The existing profile becomes useful for discovering jobs:

```text
                   Job
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
    Requirements          Job context
          │                   │
          └─────────┬─────────┘
                    ▼
               Your profile
                    │
                    ▼
              Match analysis
```

Instead of an unexplained score, show the reasoning:

```text
Profile alignment

Skills
✓ Next.js
✓ TypeScript
✓ Python
✓ PostgreSQL
✓ AI

Experience
✓ 4+ years

Potential gap
• Kubernetes
```

## 22. Personalized Job Feed

```text
For You

Senior Full Stack Engineer
Example AI
Remote
$100k–140k

Strong alignment

[View] [Prepare]

────────────────────────────

Product Engineer
Startup XYZ
Remote

Good alignment

[View] [Prepare]
```

The user no longer searches manually through hundreds of listings.

## 23. Saved Searches

The user tells Ansly: *"Find remote Full Stack/Product Engineering roles involving AI, Next.js and TypeScript."*

```text
Saved Search
────────────────────
Roles:       Full Stack Engineer, Product Engineer
Skills:      Next.js, TypeScript, AI
Experience:  4+ years
Workplace:   Remote
Location:    Worldwide
```

New matching jobs are detected automatically.

## 24. Job Alerts

```text
New jobs found

12 new jobs match your saved searches.

3 strong profile matches
5 reasonable matches
4 potential matches

[View]
```

Email, browser notifications, and other channels can come later.

## 25. Application Workspace

Ansly tracks the application process:

```text
Applications

Interested       24
Preparing         6
Applied          31
Interview         5
Offer             1
Rejected         18
```

Each application stores:

- Company
- Role
- Job URL
- Resume used
- Answers
- Cover letter
- Application date
- Status
- Notes
- Interview events

## 26. AI Application Preparation

Clicking **Prepare application** produces:

- Resume
- Cover letter
- Application answers
- Relevant projects
- Potential interview questions

The V1 answer engine is the foundation.

## 27. Context-Aware Extension

The V2 extension receives application context from the web app:

```text
Job
 ↓
Ansly knows:
 ├── Company
 ├── Role
 ├── Description
 ├── Requirements
 ├── Your profile
 ├── Selected resume
 └── Previous answers
       ↓
Application page
       ↓
Extension
```

Instead of *"Answer this question,"* it understands *"This is the Senior Product Engineer application at Company X, with this profile, resume, and previous context"* — producing much better answers.

## 28. Application Automation

Ansly can eventually automate a large portion of the process **where the target site and its rules permit it**.

```text
        Open application
               ↓
        Detect application
               ↓
         Fill known data
               ↓
       Detect questions
               ↓
        Generate answers
               ↓
   Upload appropriate resume
               ↓
        Review checkpoint
               ↓
         User submits
```

For sites where automated interaction is permitted and technically reliable, more automation can be considered. For sites that prohibit bots/extensions, or that use CAPTCHA or unusual verification steps, Ansly stops and hands control back to the user rather than attempting to bypass them.

## 29. Long-Term Architecture

```text
                         ANSLY
                           │
             ┌─────────────┴─────────────┐
             │                           │
          DISCOVER                    APPLY
             │                           │
       Job ingestion               Application AI
       Job normalization           Resume selection
       Deduplication               Question answering
       Job analysis                Autofill
       Profile matching            Review
       Saved searches              Submission*
       Job alerts                  Tracking
             │                           │
             └─────────────┬─────────────┘
                           ▼
                     USER PROFILE
              ┌────────────┼────────────┐
          Experience     Projects      Skills
              └────────────┼────────────┘
                           ▼
                       AI ENGINE
```

\* Submission only where permitted; otherwise the user submits.

---

# Part 3 — How V1 and V2 Fit Together

## 30. Shared Foundation

Building V1 properly matters because V2 builds on it — no V1 work is thrown away.

| V1 creates | V2 adds |
|---|---|
| User profile | Job ingestion |
| AI answer engine | Job database |
| Browser extension | Job matching |
| Application field detection | Saved searches |
| Application filling | Application tracking |
| Saved answers | Advanced application preparation |

## 31. Product Evolution

**V1 — "I already found a job. Help me apply."**

```text
Job application
       ↓
Ansly
       ↓
Answer
       ↓
Fill
```

**V2 — "Find jobs I should apply to and help me apply."**

```text
My profile
     ↓
Find jobs
     ↓
Analyze jobs
     ↓
Match jobs
     ↓
Choose jobs
     ↓
Prepare applications
     ↓
Ansly extension
     ↓
Fill + review
     ↓
Apply
```

## 32. Guiding Principle

Keep the **V1 codebase and scope firmly centered on the browser extension + profile + AI answer engine**.

Once the `detect → generate → edit → fill` loop is reliable across a meaningful number of real applications, job discovery becomes an informed V2 — not a huge project built on assumptions.
