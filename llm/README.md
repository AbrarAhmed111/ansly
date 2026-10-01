# Ansly answer engine (llm)

FastAPI service that turns an application question into a grounded,
first-person answer from the user's profile.

```text
question → classify (category, intent, skills asked about)
         → fetch only the needed profile sections (Supabase, as the user)
         → deterministic checks (skill not in profile? preference not set? → insufficient_information)
         → LLM via the gateway (ordered fallback across providers and keys)
         → validated JSON: status, answer, confidence, usedSources
```

## Setup

```sh
uv sync --group dev
cp .env.example .env    # Supabase URL + publishable key, provider keys
uv run python run.py    # http://localhost:8000 — docs at /docs
```

## API

All `/api/v1` routes need `Authorization: Bearer <Supabase access token>`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Status, Supabase connectivity, gateway deployments |
| `POST` | `/api/v1/answers/generate` | `{question, job_context?, field?}` → answer |
| `POST` | `/api/v1/answers/regenerate` | Same plus `previous_answer`, optional `instruction` |
| `POST` | `/api/v1/saved-answers/match` | Best saved answer for a similar question |
| `POST` | `/api/v1/saved-answers` | Save a preferred answer |
| `POST` | `/api/v1/saved-answers/{id}/use` | Count a reuse |
| `POST` | `/api/v1/events` | Usage event (`fill`, `use_saved_answer`) — no text |

Answer response:

```json
{
  "status": "answered",
  "answer": "One project I'm proud of is …",
  "confidence": "high",
  "usedSources": [{ "type": "project", "id": "…", "label": "OnTask" }],
  "missingInformation": null,
  "category": "project",
  "intent": "favorite_project",
  "provider": "Gemini #1",
  "model": "gemini-…"
}
```

`status: "insufficient_information"` comes with an empty answer and a
`missingInformation` sentence telling the user what to add.

## Auth

Supabase JWTs are verified locally against the project's JWKS (ES256/RS256).
Projects still on the legacy HS256 secret can set `SUPABASE_JWT_SECRET`;
without it the token is checked with Supabase Auth. Profile reads use the
user's own token, so row-level security applies.

## LLM gateway

`src/app/gateway/` tries deployments in `GATEWAY_PROVIDER_ORDER`. Every key is
its own deployment (`GROQ_API_KEY1..N`, `GOOGLE_API_KEY1..N`, …), followed by
the provider's `*_FALLBACK_MODEL`. On failure it moves to the next deployment:

| Failure | What happens to that deployment |
| --- | --- |
| 429, 5xx, timeout, network, 400 | cooldown (`GATEWAY_COOLDOWN_SECONDS`) |
| 401/403 bad key, 402 billing, 404 model | disabled until restart |
| output not valid JSON / refused | skipped for this request only |

OpenAI-compatible providers (Gemini, Groq, OpenAI, Mistral, Cerebras, Cohere,
OpenRouter) use the `openai` SDK; Anthropic uses the `anthropic` SDK. To add a
provider, add a `ProviderSpec` in `gateway/providers.py` and a `*_MODEL` setting.

## Limits

`RATE_LIMIT_PER_MINUTE` (per user, in memory) and `DAILY_GENERATION_LIMIT`
(per user, counted from `usage_events`). Both return 429.

## Tests

```sh
uv run python -m pytest                       # all mocked, no tokens spent
uv run ruff check .
uv run python -m scripts.check_providers      # live: one tiny call per deployment
uv run python -m scripts.smoke_answers        # live: real answers for a sample profile
```

## Leftover starter code

`src/app/rag/`, `src/app/intent/`, `src/app/services/`, `src/app/schemas/chat.py`,
`src/app/schemas/rag.py`, `knowledge/`, `tests/test_rag.py` and
`tests/test_intent_detector.py` belong to the original chat/RAG starter. Nothing
imports them anymore; they can be deleted.
