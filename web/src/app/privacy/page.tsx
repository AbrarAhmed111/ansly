import { SiteFooter, SiteHeader } from '@/components/site'
import { Overline } from '@/components/ui'

export const metadata = { title: 'Privacy policy' }

const UPDATED = 'October 2, 2026'

export default function PrivacyPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-16 text-body-lg sm:px-6">
        <Overline tone="accent">Legal</Overline>
        <h1 className="mt-2 text-h1">Privacy policy</h1>
        <p className="mt-3 text-body text-muted">Last updated {UPDATED}</p>

        <div className="mt-10 space-y-5 text-fg/85 [&_h2]:!mt-12 [&_h2]:border-t [&_h2]:border-border [&_h2]:pt-8 [&_h2]:text-h3 [&_h2]:text-fg [&_li]:ml-5 [&_li]:list-disc [&_li]:pl-1 [&_li]:marker:text-subtle [&_ul]:space-y-2">
          <p>
            Ansly helps you answer job application questions using information
            you put in your Ansly profile. This page explains what the web app
            and the browser extension collect, why, and what you control.
          </p>

          <h2>What we store</h2>
          <ul>
            <li>
              Your account email and password (handled by our authentication
              provider, Supabase; we never see your password in plain text).
            </li>
            <li>
              The profile you enter: personal details, experience, projects,
              skills, education, achievements, links and application
              preferences.
            </li>
            <li>Answers you choose to save as preferred answers.</li>
            <li>
              Usage events: the type of action (for example &quot;generated an
              answer&quot; or &quot;filled a field&quot;), the question
              category, the AI provider used, and a timestamp. Usage events
              never contain question or answer text. They are used for daily
              usage limits and to show your own activity on the dashboard.
            </li>
          </ul>

          <h2>What the extension reads on web pages</h2>
          <ul>
            <li>
              The extension looks at form fields on the pages you visit to
              decide where to show the ✨ button. This happens in your browser
              and nothing is sent anywhere.
            </li>
            <li>
              When you click ✨ and generate an answer, it sends the question
              text, the field&apos;s character limit, and the company and role
              shown on the page to the Ansly API. It never sends the full page.
            </li>
            <li>
              The job description is sent only if you turn on &quot;Use job
              descriptions&quot; in the extension settings.
            </li>
            <li>
              The extension never reads or stores what you type into application
              forms, and never submits an application.
            </li>
          </ul>

          <h2>How answers are generated</h2>
          <p>
            To write an answer, the Ansly API sends the question, the relevant
            parts of your profile, and any job context to a third-party AI model
            provider (such as Google Gemini, Groq, OpenAI, Anthropic, Mistral,
            Cerebras or Cohere). These providers process the request to return
            an answer and do not receive your account details.
          </p>

          <h2>What we don&apos;t do</h2>
          <ul>
            <li>We don&apos;t sell your data or use it for advertising.</li>
            <li>
              We don&apos;t share your profile with employers. Answers go into
              an application only when you click Fill.
            </li>
          </ul>

          <h2>Your controls</h2>
          <ul>
            <li>
              Edit or delete any part of your profile or saved answers at any
              time in the web app.
            </li>
            <li>Export everything as JSON from Settings.</li>
            <li>
              Turn the extension off globally or for individual sites, or
              disconnect it, from the extension popup.
            </li>
            <li>
              To delete your account and all associated data, contact us at the
              address below.
            </li>
          </ul>

          <h2>Security</h2>
          <p>
            Data is stored in Supabase (PostgreSQL) with row-level security, so
            each account can only access its own rows. All traffic uses HTTPS.
          </p>

          <h2>Contact</h2>
          <p>
            Questions or deletion requests: privacy@ansly.app (replace with your
            support address before publishing).
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}
