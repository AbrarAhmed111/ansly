# Ansly

AI job application assistant. A Chrome extension detects open-ended questions
on job application forms, drafts truthful, personalized answers from your
structured profile, and fills them in after you review them.

> **Status:** V1 (Phases 1–8) implemented. See
> [`documents/ansly-phases.md`](documents/ansly-phases.md) for the roadmap and
> [`documents/ansly-product-plan.md`](documents/ansly-product-plan.md) for the
> product plan.

## How it works

```text
Application page → ✨ beside a question → Generate → Review / edit → Fill
```

Answers come only from your profile. If the profile doesn't support an answer
(say, a question about Kubernetes when you've never listed it), Ansly tells you
what to add instead of inventing one.

## Architecture

```text
   Browser                                Web app (Next.js)
 ┌──────────────────────┐               ┌──────────────────────────────┐
 │ extension (WXT)      │◄── session ───│ Profile · Saved answers ·    │
 │ content: detect, ✨, │   handoff     │ Settings · Auth · Connect    │
 │   popover, fill      │               └──────────────┬───────────────┘
 │ background: session, │                              │ supabase-js (RLS)
 │   API client         │                              ▼
 └──────────┬───────────┘               ┌──────────────────────────────┐
            │ question + minimal        │ Supabase                     │
            │ job context               │ PostgreSQL · Auth · RLS      │
            ▼                           └──────────────▲───────────────┘
 ┌──────────────────────┐   user's own JWT (RLS)       │
 │ llm (FastAPI)        │──────────────────────────────┘
 │ classify → retrieve  │
 │ → ground → generate  │──► LLM gateway: Gemini, Groq, OpenAI, Anthropic,
 └──────────────────────┘    Mistral, Cerebras, Cohere, OpenRouter (fallback)
```

- `llm` owns all LLM provider keys. It reads profiles with the **user's own
  token**, so row-level security applies and the server never holds a key that
  can read other users' data.
- The extension gets its **own** Supabase session from the web app's Connect
  page (sharing the web session would break with refresh-token rotation).

## Repo layout

```text
ansly/
  web/              Next.js app — auth, profile editor, saved answers, settings, extension connect
  extension/        WXT browser extension (Manifest V3) — field detection, ✨ UI, fill
  llm/              FastAPI service — question analysis, retrieval, grounded generation, LLM gateway
  packages/types/   Shared TypeScript types (DB rows, API contracts, bridge protocol, completeness)
  packages/design/  Design tokens: colour palette, light/dark themes, type scale (see its README)
  supabase/         Migrations, migration tests (PGlite), and a seed profile
  documents/        Product plan and development phases
```

## Prerequisites

- Node.js 20.9+ and [pnpm](https://pnpm.io) 10 (`npm i -g pnpm`)
- Python 3.10+ and [`uv`](https://docs.astral.sh/uv/)
- A [Supabase](https://supabase.com) project
- At least one LLM provider API key

## Setup

```sh
pnpm install                      # all JS workspaces
uv --directory llm sync --group dev
```

Create each app's env file from its example (PowerShell: `Copy-Item`):

```sh
cp web/.env.example web/.env
cp llm/.env.example llm/.env
cp extension/.env.example extension/.env
```

| File | What to set |
| --- | --- |
| `web/.env` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_BASE_URL` (the API) |
| `llm/.env` | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, provider keys (`GOOGLE_API_KEY1`, `GROQ_API_KEY1`, … any number per provider) |
| `extension/.env` | `WXT_SUPABASE_URL`, `WXT_SUPABASE_PUBLISHABLE_KEY`, `WXT_API_URL`, `WXT_WEB_URL` |

Supabase values are under **Project Settings → API Keys**. Only the
**publishable** key is used anywhere; never put the secret key in any app.

### Database

Apply the migrations to your Supabase project once:

```sh
pnpm supabase login
pnpm supabase link --project-ref <your-project-ref>
pnpm supabase db push
```

(Or paste `supabase/migrations/*.sql` into the Supabase SQL editor.) In
**Authentication → URL Configuration**, add `http://localhost:3000/auth/callback`
to the redirect URLs.

To start your profile quickly, fill in `supabase/seed/profile.seed.json` and
import it from **Settings → Import profile** in the web app.

## Running locally

```sh
pnpm dev                                  # web, extension (dev browser) and llm together
pnpm --filter @ansly/web dev              # web       → http://localhost:3000
pnpm --filter @ansly/llm dev              # llm       → http://localhost:8000 (/docs, /health)
pnpm --filter @ansly/extension dev        # extension → opens Chrome with it loaded
```

Then sign up in the web app, open **Extension → Connect**, and visit any job
application. See [`extension/README.md`](extension/README.md) for loading the
extension in your own Chrome profile.

## Checks

```sh
pnpm check        # lint, type-check, test and build everything (same as CI)
pnpm test         # tests only
```

| Workspace | Tests |
| --- | --- |
| `llm` | pytest: gateway fallback, classifier, retrieval, grounding, parsing, similarity, auth, rate limits, endpoints |
| `extension` | Vitest + happy-dom: field detection on LinkedIn/Indeed/Greenhouse/Lever/Workday markup, React-controlled fill, job context, popover flows, API client |
| `web` | Jest: form conversion, profile import, completeness, redirect safety |
| `supabase` | Node test runner + PGlite: migrations apply, RLS isolates users |

`llm` also has live checks that spend a few real provider calls:

```sh
uv --directory llm run python -m scripts.check_providers   # which keys/models work
uv --directory llm run python -m scripts.smoke_answers     # real answers for a sample profile
```

## Deployment

- **web** → Vercel, root directory `web`, with the three `NEXT_PUBLIC_*` variables.
- **llm** → Render / Railway: `uv sync --frozen --no-dev` then
  `uv run uvicorn src.app.main:app --host 0.0.0.0 --port $PORT`, with
  `ENVIRONMENT=production`, Supabase values, provider keys, and
  `ALLOWED_ORIGINS` set to the web app's URL.
- **extension** → set the production `WXT_API_URL` / `WXT_WEB_URL`, run
  `pnpm --filter @ansly/extension zip`, and upload the zip to the Chrome Web
  Store. The privacy policy lives at `/privacy` on the web app.
- Add the production web URL to Supabase's redirect URLs.

## License

See [LICENSE](LICENSE).
