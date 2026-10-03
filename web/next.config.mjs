import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace packages are TypeScript source, compiled by Next.
  transpilePackages: ['@ansly/types', '@ansly/design'],
  experimental: {
    // Back/forward and revisits within 30s reuse the rendered page instead of a server round trip
    // (pages load their data client-side through a cache, so nothing goes stale).
    staleTimes: { dynamic: 30 },
  },
  // Trace server dependencies from the monorepo root (pnpm hoists into ../node_modules).
  outputFileTracingRoot: repoRoot,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'www.abrarahmed.pro',
        pathname: '/assets/devAbby-fulllogo-C9-MX7QK.png',
      },
    ],
  },
}

export default nextConfig
