# Web App

The frontend for the Next.js + LLM/RAG monorepo starter. It uses Next.js 15 App Router, React, TypeScript, Tailwind CSS, and Redux Toolkit. The home page is a minimal starting point; connect it to the API as you build your application.

## Requirements

- Node.js 18.18 or newer (Node.js 20 LTS recommended)
- npm

## Setup

From this directory:

```bash
npm ci
```

Create a local environment file and set the backend URL:

```bash
cp .env.example .env.local
```

On PowerShell, use `Copy-Item .env.example .env.local`. The Axios client in `src/utils/axios.ts` reads `NEXT_PUBLIC_BASE_URL`; for local development set it to `http://localhost:8000`.

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Start the FastAPI app separately from `../llm`; see the [monorepo guide](../README.md).

## Scripts

- `npm run dev` starts the development server.
- `npm run build` creates a production build.
- `npm run start` serves the production build.
- `npm run lint` runs ESLint and applies automatic fixes.
- `npm run format` formats files with Prettier.
- `npm test` runs Jest.

## Source Layout

```text
src/
├── app/          # Next.js App Router pages and layouts
├── assets/       # Global styles and image assets
├── components/   # Shared UI components
├── store/        # Redux store, providers, and sample state
└── utils/        # Shared utilities, including the Axios client
```

Keep browser-exposed configuration in `.env.local` and do not put secrets in `NEXT_PUBLIC_` variables.