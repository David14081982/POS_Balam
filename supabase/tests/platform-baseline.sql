-- Bootstrap exclusivo para probar las migraciones POS sobre PostgreSQL limpio.
-- Simula únicamente objetos que la plataforma Supabase crea antes del esquema
-- de la aplicación; ninguna tabla o función pos se define aquí.

do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;

create schema auth;
create schema storage;
create schema extensions;
create extension if not exists pgcrypto with schema extensions;

create function auth.jwt() returns jsonb
language sql stable
as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;

create function auth.uid() returns uuid
language sql stable
as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;

create table auth.users (
  instance_id uuid,
  id uuid primary key,
  aud text,
  role text,
  email text unique,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create table auth.identities (
  id uuid primary key,
  provider_id text,
  user_id uuid references auth.users(id) on delete cascade,
  identity_data jsonb,
  provider text,
  last_sign_in_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
);

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false
);

create table storage.objects (
  id uuid primary key default extensions.gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text
);
alter table storage.objects enable row level security;
