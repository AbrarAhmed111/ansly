/** Build-time configuration from extension/.env (WXT_* variables). */

const trimSlash = (url: string) => url.replace(/\/+$/, '')

export const API_URL = trimSlash(import.meta.env.WXT_API_URL || 'http://localhost:8000')
export const WEB_URL = trimSlash(import.meta.env.WXT_WEB_URL || 'http://localhost:3000')
export const SUPABASE_URL = trimSlash(import.meta.env.WXT_SUPABASE_URL || '')
export const SUPABASE_PUBLISHABLE_KEY = import.meta.env.WXT_SUPABASE_PUBLISHABLE_KEY || ''
