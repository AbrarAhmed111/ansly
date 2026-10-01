# Ansly web app

Next.js app for signing in, building the structured profile Ansly answers
from, managing saved answers, and connecting the browser extension.

| Route | |
| --- | --- |
| `/` | Landing page with system status |
| `/login` | Sign in / sign up (Supabase Auth, email + password) |
| `/dashboard` | Profile completeness, last 7 days of usage |
| `/profile/personal` | Details, summary, links, application preferences |
| `/profile/{experience,projects,skills,education,achievements}` | Add, edit, reorder, delete |
| `/saved-answers` | Search, edit and delete preferred answers |
| `/settings` | Export / import profile JSON, sign out |
| `/extension` | Detects the extension and connects it |
| `/privacy` | Privacy policy (needed for the Chrome Web Store) |

All data access goes through `supabase-js` with the user's session; row-level
security limits every query to the user's own rows. `src/middleware.ts`
refreshes the session cookie and redirects signed-out visitors.

## Develop

```sh
cp .env.example .env
pnpm dev          # http://localhost:3000
pnpm test         # Jest
pnpm typecheck
pnpm lint
pnpm build
```

Profile sections are defined once in `src/lib/sections.ts`; the editor in
`src/components/section-editor.tsx` renders forms from those definitions.
