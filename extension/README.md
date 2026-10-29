# Ansly extension

Chromium browser extension for Chrome and Microsoft Edge (Manifest V3, built
with [WXT](https://wxt.dev) + React) that
adds ✨ beside open-ended questions on job application forms, and fills whole
forms on request ("Fill all").

Ansly runs **only on sites you turn on**. Out of the box it does nothing: open
the popup on a job site and choose **Always run on linkedin.com** (or a
quick-enable chip), or **Scan this page** for a one-time scan. The browser asks
for permission per site; there is no `<all_urls>` content script.

## What's where

```text
src/
  entrypoints/
    background.ts          Session, token refresh, API client, shortcut, right-click menu, site registration
    content/index.tsx      Registered at runtime per enabled site (and iframes): mounts the UI in a shadow root
    web-bridge.content.ts  Runs only on the web app: session handoff, enabled-sites list
    popup/                 Status, enabled sites, settings, detection debug / diagnostics
  components/content/      ✨ buttons, answer popover, Fill all pill + panel, ask-for-missing-info form
  lib/
    sites.ts               Per-site enablement (optional host permissions + registered content scripts)
    detection/             Typed field detection (no per-site rules): open/short text, profile, choices, numbers, ignored
    fill.ts                Filling that React & rich editors notice; choices; undo snapshots
    diagnostics.ts         Sanitized detection report (no values) for "Copy diagnostics"
    job/                   JSON-LD, Indeed / LinkedIn adapters, and generic visible job-description extraction
    job-context.ts         Company / role / shared (opt-in) description for answer generation
    api.ts, session.ts     Background-only: API calls and the extension's own Supabase session
    settings.ts            Synced settings (on/off, length/tone defaults, review/overwrite, debug, analytics, theme)
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

## Job listings and application messages

Resume tailoring uses the existing JSON-LD and Indeed / LinkedIn paths first,
then a generic visible-content heuristic for compatible job pages. It ignores
hidden content and page controls. Description extraction runs locally to check
the offer, and the description is sent only after you choose **Tailor resume**.
The same generic description is available to answer generation when job
descriptions are enabled (cover and motivation letters include it
automatically). A Work at a Startup-style fixture exercises the generic path;
the automated tests use representative markup rather than a live-site
integration.

Conversational prompts such as **“Start a conversation with the team”** use the
normal answer engine and profile retrieval. The draft uses verified profile
evidence, is editable, and is never sent or submitted automatically.

To manually test the generic job path, enable Ansly for a Work at a Startup
listing, open a listing with a substantial description, and use **Tailor
resume**. Confirm that the company, role, and description match the page before
reviewing the preview. To test a conversational prompt, enable job descriptions
if you want role details included, open an application with a “Start a
conversation” field, generate a draft, and review/edit it before filling.

## Privacy

- Ansly runs only on sites you enabled (or the page you scanned).
- Detection runs locally; nothing is sent until you click ✨ or **Fill all**.
- **Fill all** fills name/email/links straight from your profile, and sends
  the questions (and choice options) in one request. It never clicks Next or
  Submit, and skips fields you've already filled unless you ask it to overwrite.
- Gender, race, veteran and disability questions are never answered.
- A generate request contains the question, the field's character limit, and
  the company/role from the page. The job description is sent only if you turn
  on **Use job descriptions**, except for cover and motivation letters, which
  need it to be tailored to the job.
- The extension never sends what you type into forms and never submits. Fill all
  looks at fields locally only to skip ones you've filled and to undo its own fills.

## Keyboard shortcut

`Alt+Shift+A` answers the focused field (on a site that isn't enabled, it
scans the page once). Change it at `chrome://extensions/shortcuts` in Chrome or
`edge://extensions/shortcuts` in Edge. Inside the popover, `Ctrl+Enter` fills
and `Esc` closes.

Right-click any text field → **Answer with Ansly** works even when detection
missed it. Missed fields are worth a fixture: turn on **Detection debug** in the
popup, then **Copy diagnostics** (structure only, never values).
