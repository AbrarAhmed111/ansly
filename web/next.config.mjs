import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace packages are TypeScript source, compiled by Next.
  transpilePackages: ['@ansly/types'],
  // Trace server dependencies from the monorepo root (pnpm hoists into ../node_modules).
  outputFileTracingRoot: repoRoot,
}

export default nextConfig
