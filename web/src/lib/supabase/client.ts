import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseKey, supabaseUrl } from './env'

let client: SupabaseClient | undefined

/** Supabase client for client components. Session lives in cookies shared with the server. */
export function createClient(): SupabaseClient {
  client ??= createBrowserClient(supabaseUrl(), supabaseKey())
  return client
}
