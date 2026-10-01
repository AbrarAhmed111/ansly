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

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  // Keep the dev server off port 3000, which belongs to the web app (Next.js).
  dev: { server: { port: 3100, origin: 'http://localhost:3100' } },
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Ansly',
    description: 'AI job application assistant — truthful, personalized answers from your own profile.',
    permissions: ['storage', 'activeTab'],
    // The background calls the Ansly API and Supabase; nothing else.
    host_permissions: [
      ...new Set([originPattern(apiUrl), 'http://localhost/*', 'http://127.0.0.1/*', 'https://*.supabase.co/*']),
    ],
    commands: {
      'generate-answer': {
        suggested_key: { default: 'Alt+Shift+A', mac: 'Alt+Shift+A' },
        description: 'Answer the focused field with Ansly',
      },
    },
  },
})
