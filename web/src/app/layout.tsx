import '../assets/css/globals.css'
import { light, dark } from '@ansly/design'
import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import type { ReactNode } from 'react'
import { themeScript } from '@/components/theme'
import { Toaster } from '@/components/toaster'

const origin = (url: string | undefined) => {
  try {
    return url ? new URL(url).origin : null
  } catch {
    return null
  }
}
const ORIGINS = [process.env.NEXT_PUBLIC_BASE_URL, process.env.NEXT_PUBLIC_SUPABASE_URL]
  .map(origin)
  .filter((o): o is string => Boolean(o))

const sans = Geist({ subsets: ['latin'], variable: '--font-sans' })
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono' })

export const metadata: Metadata = {
  title: { default: 'Ansly — truthful answers for job applications', template: '%s · Ansly' },
  description: 'AI job application assistant — truthful, personalized answers from your own profile.',
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: light.bg },
    { media: '(prefers-color-scheme: dark)', color: dark.bg },
  ],
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {/* Open the connections every page's first request needs (API calls, auth, resume files) early. */}
        {ORIGINS.map((origin) => (
          <link key={origin} rel="preconnect" href={origin} crossOrigin="anonymous" />
        ))}
      </head>
      <body suppressHydrationWarning className="min-h-screen">
        <Toaster />
        {children}
      </body>
    </html>
  )
}
