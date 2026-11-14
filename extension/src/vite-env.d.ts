interface ImportMetaEnv {
  readonly WXT_API_URL?: string
  readonly WXT_WEB_URL?: string
  readonly WXT_SUPABASE_URL?: string
  readonly WXT_SUPABASE_PUBLISHABLE_KEY?: string
}

/** Set at build time (wxt.config.ts); compared with build.json on disk to detect a newer local build. */
declare const __ANSLY_BUILD_ID__: string
