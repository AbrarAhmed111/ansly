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

## UI conventions

- Colours and text sizes come from `@ansly/design` (`packages/design/README.md`).
  Use semantic tokens (`bg-surface`, `text-muted`, `border-border`) and the type
  scale (`text-h2`, `text-title`, `text-body-sm`, `text-caption`). Tailwind's
  default `text-sm`/`text-lg` and arbitrary sizes are disabled.
- Reusable components live in `src/components/ui/` and are imported from
  `@/components/ui`. Reach for them before writing markup by hand: `Button`
  (with `icon`/`loading`), `IconButton`, `CopyButton`, `Field` + `Input` /
  `PasswordInput` / `SearchInput` / `Textarea` / `Select` / `Checkbox`,
  `CharCount`, `SegmentedControl`, `Chip`, `Card` / `CardHeader` / `PageHeader`,
  `Overline`, `Badge`, `Alert`, `EmptyState`, `Stat`, `Steps`, `StatusDot`,
  `KeyHint`, `Skeleton`.
- Small helpers in `src/lib/format.ts`: `errorMessage`, `plural`, `humanize`.
