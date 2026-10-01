// Referenced as literals so Next.js inlines them into the browser bundle.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

const missing = (name: string) =>
  new Error(`Missing ${name} — copy web/.env.example to web/.env and fill it in.`)

export function supabaseUrl(): string {
  if (!URL) throw missing('NEXT_PUBLIC_SUPABASE_URL')
  return URL
}

export function supabaseKey(): string {
  if (!KEY) throw missing('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
  return KEY
}
