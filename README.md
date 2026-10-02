# Ansly

AI job application assistant for filling application forms faster without inventing experience.

<p>
  <a href="https://www.abrarahmed.pro" target="_blank" rel="noreferrer">
    <img src="https://www.abrarahmed.pro/assets/devAbby-fulllogo-C9-MX7QK.png" alt="Built by DevAbby" height="36" />
  </a>
</p>

**Built by DevAbby.**

Ansly is a web app, FastAPI answer engine, Supabase database, and Chromium browser extension. You build a structured profile once, then the extension detects application questions, drafts grounded answers from your profile, lets you review/edit, and fills the field only when you approve.

> Status: V1 is implemented, with V1.1 fill-all / ask-and-learn work in progress. See [documents/ansly-product-plan.md](documents/ansly-product-plan.md), [documents/ansly-phases.md](documents/ansly-phases.md), and [documents/product-audit.md](documents/product-audit.md).

## What It Does

- Detects open-ended questions on job application forms.
- Drafts truthful, first-person answers from your profile.
- Refuses to guess when your profile does not support an answer.
- Lets you review, edit, regenerate, save, and fill answers.
- Reuses saved answers for similar questions.
- Supports optional job context: company, role, and job description when enabled.
- Supports personal use as an unpacked Chrome or Microsoft Edge extension, with no store publishing fee.

## How It Works

```text
Build profile
  -> open application form
  -> enable Ansly on the site
  -> click Ansly beside a question
  -> generate or use saved answer
  -> review / edit
  -> fill
  -> you submit manually
```

Ansly never auto-submits applications. It only fills after user approval.

## Architecture

```text
Browser extension
  - WXT + React
  - field detection
  - saved-answer matching
  - answer popover
  - fill / fill-all UI
  - own Supabase session

Web app
  - Next.js
  - auth
  - dashboard
  - profile editor
  - saved answers
  - settings
  - extension connection

LLM API
  - FastAPI
  - question classification
  - structured profile retrieval
  - grounded answer generation
  - provider fallback gateway
  - usage/rate limits

Supabase
  - Auth
  - PostgreSQL
  - RLS
  - profile sections
  - saved answers
  - usage events
```

The API reads profile data using the user's own JWT, so Supabase row-level security still applies. The extension receives a separate Supabase session from the web app because sharing the web session would conflict with refresh-token rotation.

## Repo Layout

```text
ansly/
  web/              Next.js web app
  extension/        WXT browser extension for Chrome and Edge
  llm/              FastAPI answer service and LLM gateway
  packages/types/   Shared TypeScript contracts
  packages/design/  Shared design tokens
  supabase/         Migrations, tests, seed profile
  documents/        Product plans and audits
```

## Prerequisites

- Node.js 20.9+
- pnpm 10
- Python 3.10+
- uv
- Supabase project
- At least one LLM provider API key

## Setup

Install dependencies:

```sh
pnpm install
uv --directory llm sync --group dev
```

Create env files:

```sh
cp web/.env.example web/.env
cp llm/.env.example llm/.env
cp extension/.env.example extension/.env
```

Set these values:

| File | Variables |
| --- | --- |
| `web/.env` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_BASE_URL` |
| `llm/.env` | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, provider keys such as `GOOGLE_API_KEY1`, `GROQ_API_KEY1`, `OPENAI_API_KEY1` |
| `extension/.env` | `WXT_SUPABASE_URL`, `WXT_SUPABASE_PUBLISHABLE_KEY`, `WXT_API_URL`, `WXT_WEB_URL` |

Only use the Supabase publishable key in app env files. Do not put the Supabase secret/service-role key in the web app, extension, or client bundle.

## Database

Apply migrations:

```sh
pnpm supabase login
pnpm supabase link --project-ref <your-project-ref>
pnpm supabase db push
```

Or paste the SQL files from `supabase/migrations/` into the Supabase SQL editor.

In Supabase Auth URL configuration, add:

```text
http://localhost:3000/auth/callback
https://YOUR-WEB-DOMAIN/auth/callback
```

## Run Locally

```sh
pnpm dev
```

Or run each app:

```sh
pnpm --filter @ansly/web dev          # http://localhost:3000
pnpm --filter @ansly/llm dev          # http://localhost:8000
pnpm --filter @ansly/extension dev    # Chrome dev browser
pnpm --filter @ansly/extension dev:edge
```

Then:

1. Sign up in the web app.
2. Build your profile.
3. Open `/extension` in the web app.
4. Connect the extension.
5. Visit a job application.
6. Enable Ansly on that site from the extension popup.

## Personal Extension Use

You do not need to publish the extension to use it yourself.

Chrome:

```sh
pnpm --filter @ansly/extension build
```

Open `chrome://extensions`, enable Developer mode, choose Load unpacked, and select:

```text
extension/.output/chrome-mv3
```

Microsoft Edge:

```sh
pnpm --filter @ansly/extension build:edge
```

Open `edge://extensions`, enable Developer mode, choose Load unpacked, and select:

```text
extension/.output/edge-mv3
```

For deployed personal use, make sure `extension/.env` points to deployed URLs before building:

```env
WXT_API_URL=https://YOUR-LLM-API-DOMAIN
WXT_WEB_URL=https://YOUR-WEB-DOMAIN
```

## Checks

```sh
pnpm check
pnpm test
```

Useful targeted checks:

```sh
pnpm --filter @ansly/web typecheck
pnpm --filter @ansly/web test
pnpm --filter @ansly/extension typecheck
pnpm --filter @ansly/extension test
pnpm --filter @ansly/llm test
pnpm --filter @ansly/supabase test
```

## Deployment

Web:

- Deploy `web/` to Vercel.
- Set `NEXT_PUBLIC_SUPABASE_URL`.
- Set `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- Set `NEXT_PUBLIC_BASE_URL` to the deployed LLM/API origin.

LLM API:

- Deploy `llm/` to your Python host.
- Set Supabase env values and provider keys.
- Confirm `GET /health` works.

Extension:

- Set production `WXT_API_URL` and `WXT_WEB_URL`.
- Build Chrome or Edge output.
- Load unpacked for personal use, or zip for store submission later.

## Privacy Notes

- Detection runs locally.
- Nothing is sent until you ask Ansly to generate, match, save, or fill.
- Job description sharing is opt-in.
- Usage analytics do not store question or answer text.
- Gender, race, veteran, and disability questions are intentionally not answered.
- Ansly never submits applications.

## License

See [LICENSE](LICENSE).
