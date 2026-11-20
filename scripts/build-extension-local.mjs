import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const extensionDir = resolve(root, 'extension')

async function loadEnv(path) {
  const env = {}
  try {
    for (const line of (await readFile(path, 'utf8')).split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const separator = trimmed.indexOf('=')
      if (separator < 1) continue
      const key = trimmed.slice(0, separator).trim()
      const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, '')
      env[key] = value
    }
  } catch {
    // The Supabase values are optional when building for a fresh local setup.
  }
  return env
}

const baseEnv = await loadEnv(resolve(extensionDir, '.env'))
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const child = spawn(pnpm, ['exec', 'wxt', 'build'], {
  cwd: extensionDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    ...baseEnv,
    WXT_API_URL: 'http://localhost:8000',
    WXT_WEB_URL: 'http://localhost:3000',
  },
})

child.on('exit', (code, signal) => {
  if (signal) process.exit(1)
  process.exit(code ?? 1)
})
