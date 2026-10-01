# LLM/RAG API

The Python backend for the Next.js + LLM/RAG monorepo starter. It provides a FastAPI chat API, rule-based intent detection, document retrieval, and a provider gateway with failover.

## Requirements

- Python 3.10 or newer
- [uv](https://docs.astral.sh/uv/)
- An API key for at least one configured LLM provider

## Setup

Run these commands from this directory:

```bash
uv sync
cp .env.example .env
```

On PowerShell, use `Copy-Item .env.example .env`. Edit `.env` and set at least one provider key. Available provider settings are for Google Gemini, Groq, OpenAI, Mistral, and Cerebras. Keep unused provider keys blank and never commit `.env`.

Start the API:

```bash
uv run python run.py
```

By default, the API listens on [http://localhost:8000](http://localhost:8000). Interactive documentation is at `/docs`, ReDoc is at `/redoc`, and the health endpoint is `/health`.

## API

### Chat

`POST /api/chat`

```json
{
  "messages": [
    { "role": "user", "content": "What does the guide say about getting started?" }
  ],
  "temperature": 0.7
}
```

Example with curl:

```bash
curl -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"What does the guide say about getting started?"}]}'
```

The response includes the assistant reply, provider and model, token usage, detected intent, retrieved sources, and provider status events.

### Other endpoints

- `GET /api/chat/fast-prompts` returns suggested prompts.
- `GET /health` returns service health.

There is no streaming chat endpoint in the current starter.

## Knowledge Base and Configuration

Place Markdown documents in `knowledge/documents/`. The RAG pipeline loads and indexes them during application startup. The sample guide can be replaced with your domain documents.

Configuration is documented in `.env.example`. Common settings include `KNOWLEDGE_BASE_PATH`, `RAG_TOP_K`, `RAG_CHUNK_SIZE`, `RAG_CHUNK_OVERLAP`, `ALLOWED_ORIGINS`, and provider-specific API keys and model names. By default, CORS allows the local frontend at `http://localhost:3000`.

## Tests

```bash
uv run pytest
```

## Source Layout

```text
src/app/
├── api/          # FastAPI routes
├── core/         # Settings and logging
├── gateway/      # Provider selection, failover, and status
├── intent/       # Rule-based intent detection
├── rag/          # Ingestion, chunking, retrieval, and context building
├── schemas/      # API request and response models
└── services/     # Chat orchestration
knowledge/        # Documents indexed by the RAG pipeline
tests/            # Backend tests
```