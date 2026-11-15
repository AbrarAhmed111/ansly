import type { SupabaseClient } from '@supabase/supabase-js'

/** Private bucket holding profile pictures under {user_id}/ (see the profile_avatars migration). */
export const AVATAR_BUCKET = 'avatars'
/** Same limit as the bucket's file_size_limit. */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024
export const AVATAR_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
} as const
export const AVATAR_ACCEPT = Object.keys(AVATAR_TYPES).join(',')
/** Signed URLs outlive a typical session; a broken one falls back to initials. */
const SIGNED_URL_SECONDS = 60 * 60 * 12

type AvatarType = keyof typeof AVATAR_TYPES

/** Why `file` can't be a profile picture, or null when it can. */
export function avatarFileError(
  file: Pick<File, 'type' | 'size'>,
): string | null {
  if (!(file.type in AVATAR_TYPES)) return 'Choose a PNG, JPEG or WebP image.'
  if (file.size > AVATAR_MAX_BYTES) return 'Choose an image under 2 MB.'
  if (file.size === 0) return 'That file is empty.'
  return null
}

/** A fresh object path per upload, so a replaced picture never shows a cached old one. */
export function avatarPath(
  userId: string,
  type: string,
  now = Date.now(),
): string {
  const ext = AVATAR_TYPES[type as AvatarType] ?? 'png'
  return `${userId}/avatar-${now.toString(36)}.${ext}`
}

/** Display name: the profile's name, else the email, else a generic label. */
export function displayName(
  name: string | null | undefined,
  email: string | null | undefined,
): string {
  return name?.trim() || email?.trim() || 'Your account'
}

export async function signedAvatarUrl(
  supabase: SupabaseClient,
  path: string | null | undefined,
): Promise<string | null> {
  if (!path) return null
  const { data, error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .createSignedUrl(path, SIGNED_URL_SECONDS)
  return error ? null : data.signedUrl
}

/**
 * Uploads `file` as the user's picture, points the profile at it, then removes the previous file.
 * Returns the new object path. The old file is only removed once the profile no longer references it.
 */
export async function uploadAvatar(
  supabase: SupabaseClient,
  userId: string,
  file: File,
  previousPath: string | null,
): Promise<string> {
  const problem = avatarFileError(file)
  if (problem) throw new Error(problem)
  const path = avatarPath(userId, file.type)
  const bucket = supabase.storage.from(AVATAR_BUCKET)
  const { error: uploadError } = await bucket.upload(path, file, {
    contentType: file.type,
    cacheControl: '31536000',
  })
  if (uploadError) throw new Error(uploadError.message)
  const { error } = await supabase
    .from('profiles')
    .update({ avatar_path: path })
    .eq('id', userId)
  if (error) {
    await bucket.remove([path])
    throw new Error(error.message)
  }
  if (previousPath && previousPath !== path) await bucket.remove([previousPath])
  return path
}

/** Clears the profile picture and deletes its file. */
export async function removeAvatar(
  supabase: SupabaseClient,
  userId: string,
  path: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ avatar_path: null })
    .eq('id', userId)
  if (error) throw new Error(error.message)
  if (path) await supabase.storage.from(AVATAR_BUCKET).remove([path])
}
