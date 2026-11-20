import { readFileSync } from 'node:fs'
import { defineConfig } from 'wxt'

/** WXT_* values from extension/.env (for manifest fields computed at build time). */
function env(name: string): string | undefined {
  if (process.env[name]) return process.env[name]
  for (const file of ['.env.local', '.env']) {
    try {
      const line = readFileSync(file, 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${name}=`))
      if (line) return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '')
    } catch {
      // File doesn't exist.
    }
  }
  return undefined
}

/** "https://api.example.com/v1" -> "https://api.example.com/*" */
const originPattern = (url: string) => `${new URL(url).origin}/*`

const apiUrl = env('WXT_API_URL') || 'http://localhost:8000'

/**
 * Pins the extension ID (cjnojgpppiaijdggoamcnoipagoincmm) for unpacked installs, so its storage (settings,
 * session, enabled sites) survives loading a build from any folder. Public key only; nothing to keep secret.
 * Left out of `wxt zip`: store packages get their ID from the store, which rejects a `key` field.
 */
const UNPACKED_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAsMciqZLhTuA14MYFMBKipHViy21yP1elGz7gCTBhEfS5VhpVr4FulNlpxSznzEfGi7SrleK4V8LuEKZ8TE6++AWAA9HSiuNSjycE34kK9gNNdnuxi7H+zQlyiLkV6bU5WYMY0XvzlfvrQehmRVIkA3QIe060/Idw1yeds9WsF2yzdtNVZS+Vl6oHj3CmcDZYpxqCe6fafxRpd/O1wi2kB6QIToRKXsDcaUWoF1FrzypiA0qgTFOm/uk1ZaatkewAZ8W4kZy1PuINORCjjj7hZnbk21OnFJOU6V6stLvIjo+nYqfDk7tD+AOSvnNF2P8ETYY3uQFWx3IROzDeA9zJ6QIDAQAB'
const zipping = process.argv.includes('zip')

/** Written into the build: the running extension compares it with build.json on disk to offer a reload. */
const BUILD_ID = new Date().toISOString()

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  publicDir: 'src/public',
  // Keep the dev server off port 3000, which belongs to the web app (Next.js).
  dev: { server: { port: 3100, origin: 'http://localhost:3100' } },
  modules: ['@wxt-dev/module-react'],
  // Store packages build into their own folder, so `wxt zip` never overwrites the unpacked install you load daily.
  ...(zipping ? { outDirTemplate: '{{browser}}-mv{{manifestVersion}}-store' } : {}),
  vite: () => ({ define: { __ANSLY_BUILD_ID__: JSON.stringify(BUILD_ID) } }),
  hooks: {
    'build:publicAssets': (_wxt, files) => {
      files.push({ relativeDest: 'build.json', contents: JSON.stringify({ buildId: BUILD_ID }) })
    },
  },
  manifest: ({ manifestVersion }) => ({
    name: 'Ansly',
    ...(zipping ? {} : { key: UNPACKED_KEY }),
    description: 'Prepare truthful job application answers grounded in your profile.',
    // activeTab + scripting: one-time "Scan this page" without a permanent permission.
    // contextMenus: right-click → "Answer with Ansly" on any field.
    permissions: ['storage', 'activeTab', 'scripting', 'contextMenus', 'notifications'],
    // The background calls the Ansly API and Supabase; nothing else.
    host_permissions: [
      ...new Set([originPattern(apiUrl), 'http://localhost/*', 'http://127.0.0.1/*', 'https://*.supabase.co/*']),
    ],
    // Sites are opt-in: the popup requests one origin at a time (lib/sites.ts).
    // MV2 (Firefox) has no optional_host_permissions; host patterns go in optional_permissions.
    ...(manifestVersion === 3
      ? { optional_host_permissions: ['https://*/*'] }
      : { optional_permissions: ['https://*/*'] }),
    commands: {
      'generate-answer': {
        suggested_key: { default: 'Alt+Shift+A', mac: 'Alt+Shift+A' },
        description: 'Answer the focused field with Ansly',
      },
    },
  }),
})
