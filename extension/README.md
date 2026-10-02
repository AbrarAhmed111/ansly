# Ansly extension

Chromium browser extension for Chrome and Microsoft Edge (Manifest V3, built
with [WXT](https://wxt.dev) + React) that
adds ✨ beside open-ended questions on job application forms.

## What's where

```text
src/
  entrypoints/
    background.ts          Session, token refresh, API client, keyboard shortcut
    content/index.tsx      Runs on every page (and iframe): mounts the ✨ UI in a shadow root
    web-bridge.content.ts  Runs only on the web app: receives the session handoff
    popup/                 Status, profile completeness, settings
  components/content/      ✨ buttons and the answer popover
  lib/
    detection/             Generic field detection (no per-site rules)
    fill.ts                Filling that React & rich editors notice
    job-context.ts         Company / role / (opt-in) description from the page
    api.ts, session.ts     Background-only: API calls and the extension's own Supabase session
    settings.ts            Synced settings (on/off, per-site, job descriptions, analytics, theme)
```

## Develop

```sh
cp .env.example .env      # Supabase URL + publishable key, API and web app URLs
pnpm dev                  # opens a Chrome window with the extension loaded, hot-reloads
pnpm dev:edge             # opens an Edge window with the extension loaded, hot-reloads
pnpm test                 # Vitest
pnpm build                # .output/chrome-mv3
pnpm build:edge           # .output/edge-mv3
pnpm zip                  # zip for the Chrome Web Store
pnpm zip:edge             # zip for Microsoft Edge Add-ons
```

To use it in your normal Chrome profile: `pnpm build`, open
`chrome://extensions`, turn on **Developer mode**, **Load unpacked**, and pick
`extension/.output/chrome-mv3`.

To use it in your normal Microsoft Edge profile: `pnpm build:edge`, open
`edge://extensions`, turn on **Developer mode**, **Load unpacked**, and pick
`extension/.output/edge-mv3`.

## Connecting

The popup's **Connect Ansly** opens the web app's `/extension` page. Confirming
your password there signs the extension into its own Supabase session, which
the page hands over through `web-bridge.content.ts`. The password is sent only
to Supabase.

## Privacy

- Detection runs locally; nothing is sent until you click ✨.
- A generate request contains the question, the field's character limit, and
  the company/role from the page. The job description is sent only if you turn
  on **Use job descriptions**.
- The extension never reads what you type into forms and never submits.

## Keyboard shortcut

`Alt+Shift+A` answers the focused field. Change it at
`chrome://extensions/shortcuts` in Chrome or `edge://extensions/shortcuts` in
Edge. Inside the popover, `Ctrl+Enter` fills and `Esc` closes.
