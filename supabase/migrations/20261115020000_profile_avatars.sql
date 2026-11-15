-- Profile pictures.
--
-- - profiles.avatar_path: the object path of the user's picture in the `avatars` bucket, or null. It must sit
--   under the owner's own prefix ({user_id}/...), so a row can never point at someone else's file.
-- - Storage: private `avatars` bucket, images only (PNG, JPEG, WebP), up to 2 MB. Each user can only read and
--   write objects under their own prefix; the web app shows the picture through short-lived signed URLs.

alter table public.profiles
  add column if not exists avatar_path text;

alter table public.profiles drop constraint if exists profiles_avatar_path_check;
alter table public.profiles
  add constraint profiles_avatar_path_check check (
    avatar_path is null
    or (avatar_path like id::text || '/%' and length(avatar_path) <= 200 and avatar_path not like '%..%')
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users read own avatar files" on storage.objects;
drop policy if exists "Users upload own avatar files" on storage.objects;
drop policy if exists "Users update own avatar files" on storage.objects;
drop policy if exists "Users delete own avatar files" on storage.objects;

create policy "Users read own avatar files" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users upload own avatar files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users update own avatar files" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users delete own avatar files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
