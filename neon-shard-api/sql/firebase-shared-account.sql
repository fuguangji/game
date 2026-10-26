-- Applied to the Neon-shard Supabase project (ivsrwkibgqzuxoqhnfiy) on 2026-10-26.
-- New Firebase UID-keyed tables are additive; legacy Supabase UUID tables remain intact.

create table if not exists public.firebase_identities (
  firebase_uid text primary key
    constraint firebase_identities_uid_length check (char_length(firebase_uid) between 1 and 128),
  email text,
  display_name text,
  email_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint firebase_identities_display_name_length
    check (display_name is null or char_length(btrim(display_name)) between 1 and 24)
);

comment on table public.firebase_identities is
  'Server-verified Firebase identities. Only the Render service role may read or write this table.';
alter table public.firebase_identities enable row level security;
revoke all on table public.firebase_identities from public, anon, authenticated;
grant all on table public.firebase_identities to service_role;

create table if not exists public.firebase_profiles (
  firebase_uid text primary key
    references public.firebase_identities(firebase_uid) on delete cascade,
  display_name text not null
    constraint firebase_profiles_display_name_length
      check (char_length(btrim(display_name)) between 1 and 24),
  kdf_version integer,
  kdf_salt text,
  key_bundle_ciphertext text,
  key_bundle_iv text,
  encryption_public_key text,
  signing_public_key text,
  key_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists firebase_profiles_display_name_lower_unique
  on public.firebase_profiles (lower(display_name));

create table if not exists public.firebase_player_data (
  firebase_uid text primary key
    references public.firebase_identities(firebase_uid) on delete cascade,
  save_data jsonb not null
    constraint firebase_player_data_save_object check (jsonb_typeof(save_data) = 'object'),
  sensitive_ciphertext text not null
    constraint firebase_player_data_ciphertext_length check (char_length(sensitive_ciphertext) between 1 and 65536),
  crypto_version integer not null check (crypto_version > 0),
  key_id text not null check (char_length(btrim(key_id)) between 1 and 128),
  schema_version integer not null check (schema_version > 0),
  revision bigint not null default 1 check (revision >= 1),
  updated_at timestamptz not null default now()
);

comment on table public.firebase_profiles is
  'Firebase UID keyed profile and encrypted key metadata for the shared account system.';
comment on table public.firebase_player_data is
  'Firebase UID keyed encrypted save data for the shared account system.';
alter table public.firebase_profiles enable row level security;
alter table public.firebase_player_data enable row level security;
revoke all on table public.firebase_profiles, public.firebase_player_data from public, anon, authenticated;
grant all on table public.firebase_profiles, public.firebase_player_data to service_role;
