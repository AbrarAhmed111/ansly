// Applies every migration to an in-process Postgres (PGlite) with a minimal
// stand-in for the parts of Supabase the migrations rely on.
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

export const ALICE = '00000000-0000-0000-0000-00000000000a'
export const BOB = '00000000-0000-0000-0000-00000000000b'

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  -- Like Supabase's service_role: used by the ingestion worker, bypasses RLS.
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (
    id uuid primary key,
    email text,
    raw_user_meta_data jsonb default '{}'::jsonb
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text not null, public boolean default false);
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets (id),
    name text not null,
    owner uuid
  );
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
  $$;
  grant usage on schema public, auth, storage to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant select, insert, update, delete on storage.objects to authenticated;
  alter default privileges in schema public grant all on tables to service_role;
`

/** A fresh database with every migration applied and two users, Alice and Bob. */
export async function createDb() {
  const db = new PGlite()
  await db.exec(SUPABASE_STUB)
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort()
  assert.ok(files.length > 0, 'no migrations found')
  for (const file of files) {
    await db.exec(await readFile(join(migrationsDir, file), 'utf8'))
  }
  await db.query(
    `insert into auth.users (id, email, raw_user_meta_data) values
       ($1, 'alice@example.com', '{"full_name": "Alice"}'),
       ($2, 'bob@example.com', '{}')`,
    [ALICE, BOB],
  )
  return db
}

/** Runs `fn` as a signed-in user, the way PostgREST does. */
export function asUser(db, userId, fn) {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId])
    await tx.exec('set local role authenticated')
    return fn(tx)
  })
}

/** Runs `fn` as the service role (the ingestion worker). */
export function asService(db, fn) {
  return db.transaction(async (tx) => {
    await tx.exec('set local role service_role')
    return fn(tx)
  })
}

/** Runs `fn` as an anonymous visitor. */
export function asAnon(db, fn) {
  return db.transaction(async (tx) => {
    await tx.exec('set local role anon')
    return fn(tx)
  })
}
