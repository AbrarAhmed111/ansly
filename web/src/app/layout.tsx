import '../assets/css/globals.css'
import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Toaster } from 'react-hot-toast'
import { ReactNode } from 'react'
import { themeScript } from '@/components/theme'

const sans = Geist({ subsets: ['latin'], variable: '--font-sans' })
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono' })

export const metadata: Metadata = {
  title: { default: 'Ansly — truthful answers for job applications', template: '%s · Ansly' },
  description: 'AI job application assistant — truthful, personalized answers from your own profile.',
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafafb' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0d' },
  ],
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body suppressHydrationWarning className="min-h-screen">
        <>
          <Toaster
            position="bottom-right"
            toastOptions={{
              style: {
                background: 'rgb(var(--surface))',
                color: 'rgb(var(--fg))',
                border: '1px solid rgb(var(--border))',
                boxShadow: '0 8px 24px -6px rgb(0 0 0 / 0.15)',
                borderRadius: '12px',
                fontSize: '14px',
                padding: '10px 14px',
              },
              success: { iconTheme: { primary: 'rgb(var(--success))', secondary: 'rgb(var(--surface))' } },
              error: { iconTheme: { primary: 'rgb(var(--danger))', secondary: 'rgb(var(--surface))' } },
            }}
          />
          {children}
        </>
      </body>
    </html>
  )
}
