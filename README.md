# Next.js + LLM/RAG Monorepo Starter

Monorepo starter for AI-powered web apps: a Next.js frontend and a private
FastAPI backend that handles LLM provider routing, intent detection, and RAG
retrieval.

```text
nextjs_llm_monorepo/
  web/    Next.js frontend — UI, state, API client
  llm/    FastAPI backend — chat API, intent routing, RAG, LLM provider gateway
```

## How the pieces fit together

```text
                       owns the UI, client state, and user experience
  ┌──────────────────────────────────────────────────────────────┐
  │                             web                               │
  │   Next.js 15 App Router · React · Tailwind · Redux · Axios    │
  └───────────────────────────────┬───────────────────────────────┘
                                  │ POST /api/chat
                                  │ (NEXT_PUBLIC_BASE_URL → llm)
                                  ▼
  ┌──────────────────────────────────────────────────────────────┐
  │                             llm                               │
  │  intent detection → RAG retrieval → provider gateway          │
  │  Routes across Gemini/Groq/OpenAI/Mistral/Cerebras,           │
  │  falls back on failure, returns reply + sources + usage       │
  └──────────────────────────────────────────────────────────────┘
                  owns LLM provider credentials, routing, fallback,
                  prompting, and the knowledge base
```

`web` never talks to an LLM provider directly and never holds a provider API
key. `llm` owns all provider credentials and the knowledge base. Each app is
independently runnable, independently deployable, and has its own
dependencies, `.env`, and test suite — see [`web/README.md`](web/README.md)
and [`llm/README.md`](llm/README.md) for the full detail behind everything
summarized below.

The frontend is a minimal shell; it is not yet a finished chat application.
Connect the UI to the API as your product takes shape.

## Repo layout

```text
nextjs_llm_monorepo/
  package.json            Root dev tooling and cross-app scripts (concurrently)
  web/
    src/app               App Router pages and layouts
    src/components        Shared UI components
    src/store             Redux store, providers, sample slice
    src/utils             Shared utilities, including the Axios client
  llm/
    src/app/api/routes    chat, health endpoints
    src/app/gateway       Multi-provider routing, cooldown, fallback
    src/app/intent        Rule-based intent detection
    src/app/rag           Ingestion, chunking, retrieval, context building
    src/app/services      Chat orchestration
    knowledge/documents   Markdown documents indexed by the RAG pipeline
    tests                 Unit and API tests
```

## Prerequisites

- Node.js 20.9+ and npm — for `web` and the root tooling
- Python 3.10+ and [`uv`](https://docs.astral.sh/uv/) — for `llm`
- At least one LLM provider API key (Gemini, Groq, OpenAI, Mistral, or
  Cerebras) — for real chat responses from `llm`; not required for health
  checks or tests

## Setup

```sh
npm install                 # root dev tooling (concurrently)
npm run install:web         # npm ci for the web app
npm run install:llm         # uv sync --group dev for the llm backend
```

Copy each app's `.env.example` and fill in values:

```sh
cp web/.env.example web/.env.local
cp llm/.env.example llm/.env
```

On PowerShell, use `Copy-Item` instead of `cp`.

- `web/.env.local` — set `NEXT_PUBLIC_BASE_URL=http://localhost:8000`.
- `llm/.env` — set at least one provider key and leave unused ones blank.
  `ALLOWED_ORIGINS` must include the web app's origin
  (`http://localhost:3000` by default).

## Running locally

Run both apps together:

```sh
npm run dev
```

Or run them individually:

```sh
npm run dev:web   # Next.js app        → http://localhost:3000
npm run dev:llm   # FastAPI backend    → http://localhost:8000
```

`llm` also exposes interactive docs at `http://localhost:8000/docs` and a
health check at `http://localhost:8000/health`. It reloads on change while
`ENVIRONMENT=development`.

Without any provider key set, `llm` still starts and serves health checks,
but chat requests cannot be completed.

## The request flow

1. The browser calls `llm` through the Axios client in `web/src/utils/axios.ts`
   (`NEXT_PUBLIC_BASE_URL` + route path, e.g. `/api/chat`).
2. `llm` classifies the message's intent with rule-based detection.
3. Relevant chunks are retrieved from `llm/knowledge/documents/`, which is
   indexed at startup.
4. The gateway sends the grounded prompt to the first available provider and
   falls back to the next one on failure, with per-provider cooldowns.
5. The response returns the reply, provider/model, token usage, detected
   intent, retrieved sources, and provider status events.

Available endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/chat` | Chat completion with intent detection and RAG |
| `GET` | `/api/chat/fast-prompts` | Suggested prompts |
| `GET` | `/health` | Health, active deployments, RAG index stats |

To customize the knowledge base, add or replace Markdown files in
`llm/knowledge/documents/` and restart `llm`.

## Testing

```sh
npm test            # both suites
npm run test:web    # Jest (web)
npm run test:llm    # pytest (llm)
```

## Root scripts reference

| Command | Runs |
| --- | --- |
| `npm run dev` | `web` and `llm` dev servers together (via `concurrently`) |
| `npm run dev:web` | `web` only, at `:3000` |
| `npm run dev:llm` | `llm` only, at `:8000`, via `uv run python run.py` |
| `npm run install:web` | `npm ci --prefix web` |
| `npm run install:llm` | `uv sync --group dev` inside `llm` |
| `npm run install:all` | Both of the above |
| `npm test` | `test:web` then `test:llm` |
| `npm run test:web` | `web`'s Jest suite |
| `npm run test:llm` | `llm`'s pytest suite |
| `npm run build:web` | Production build of `web` |
| `npm run lint:web` | ESLint for `web` (applies fixes) |

Anything not listed here (format, start, etc.) is run from inside the
relevant app directory — see [`web/README.md`](web/README.md) and
[`llm/README.md`](llm/README.md).

## Security notes

- Provider API keys live only in `llm/.env`, never in `web`.
- Variables prefixed with `NEXT_PUBLIC_` are exposed to the browser and must
  never contain secrets.
- `.env` files are gitignored in both apps and at the repo root; never commit
  real secrets.
- Before deploying, restrict `ALLOWED_ORIGINS` to your production frontend and
  add authentication and rate limiting to `llm` as needed.

## Production deployment

The two apps deploy and scale independently. On Vercel, create a project
for `web` with **Root Directory** set to `web`, and set
`NEXT_PUBLIC_BASE_URL` to the deployed backend URL.

Deploy `llm` first, then copy its production URL into the web project.

For generic hosts:

- `web`: `npm ci` + `npm run build` + `npm start`.
- `llm`: `uv sync --frozen --no-dev` + `uv run uvicorn src.app.main:app
  --host 0.0.0.0 --port 8000` (no `--reload`), set `ENVIRONMENT=production`,
  provider keys, and `ALLOWED_ORIGINS`.

## Related docs

- [`web/README.md`](web/README.md) — frontend setup, scripts, source layout
- [`llm/README.md`](llm/README.md) — API contract, knowledge base,
  configuration, source layout

## License

See [llm/LICENSE](llm/LICENSE).
