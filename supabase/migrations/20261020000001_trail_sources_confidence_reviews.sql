-- Official-source tracking, confidence and admin review for trails. Additive and idempotent: existing rows,
-- user data, saved trails and reviews are untouched.

alter table public.trails
  add column if not exists source_type text,
  add column if not exists source_url text,
  add column if not exists source_name text,
  add column if not exists source_last_checked timestamptz,
  add column if not exists source_verified boolean not null default false,
  add column if not exists confidence_status text,
  add column if not exists trail_status text not null default 'UNKNOWN',
  add column if not exists closure_source text,
  add column if not exists closure_date date,
  add column if not exists official_trail_id text,
  add column if not exists agency text,
  add column if not exists park text,
  add column if not exists forest text,
  add column if not exists blm_area text,
  add column if not exists ski_resort text,
  add column if not exists county text,
  add column if not exists trail_type text,
  add column if not exists distance_meters double precision,
  add column if not exists elevation_loss_ft integer,
  add column if not exists geometry_updated_at timestamptz;

do $$ begin
  alter table public.trails add constraint trails_source_type_check check (source_type is null or source_type in
    ('NPS_OFFICIAL','USFS_OFFICIAL','BLM_OFFICIAL','PARKS_CANADA_OFFICIAL','STATE_AGENCY','LOCAL_AGENCY','VERIFIED_ORGANIZATION','SKI_RESORT_OFFICIAL','USGS_NTD','OSM_REFERENCE','CURATED_GUIDE','USER_GPX'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.trails add constraint trails_confidence_status_check check (confidence_status is null or confidence_status in
    ('VERIFIED','OFFICIAL_GEOMETRY_VERIFIED','NEEDS_REVIEW','REJECTED'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.trails add constraint trails_trail_status_check check (trail_status in ('OPEN','CLOSED','SEASONAL','PERMIT_REQUIRED','RESTRICTED','UNKNOWN'));
exception when duplicate_object then null; end $$;

create index if not exists trails_source_type_idx on public.trails (source_type);
create index if not exists trails_confidence_status_idx on public.trails (confidence_status);
create index if not exists trails_official_trail_id_idx on public.trails (official_trail_id) where official_trail_id is not null;

-- Distance always comes from the full geometry and is recalculated whenever the geometry changes.
create or replace function public.trails_measure_geometry()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.geometry is not null and (tg_op = 'INSERT' or new.geometry is distinct from old.geometry) then
    new.distance_meters := ST_Length(new.geometry);
    new.geometry_updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trails_measure_geometry on public.trails;
create trigger trails_measure_geometry
  before insert or update of geometry on public.trails
  for each row execute function public.trails_measure_geometry();

update public.trails set distance_meters = ST_Length(geometry), geometry_updated_at = coalesce(geometry_updated_at, now())
 where geometry is not null and distance_meters is null;

-- Source record → trail, so re-imports update the same trail instead of creating duplicates.
create table if not exists public.trail_source_links (
  source_type text not null,
  source_id text not null,
  trail_id text not null,
  source_url text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (source_type, source_id)
);
create index if not exists trail_source_links_trail_idx on public.trail_source_links (trail_id);
alter table public.trail_source_links enable row level security;

-- Admin review of flagged trails. The latest decision per trail wins; 'reverse' undoes earlier ones.
create table if not exists public.trail_review_decisions (
  id uuid primary key default gen_random_uuid(),
  trail_id text not null,
  decision text not null check (decision in ('approve','reject','reverse')),
  note text check (note is null or length(note) <= 1000),
  reviewer text,
  created_at timestamptz not null default now()
);
create index if not exists trail_review_decisions_trail_idx on public.trail_review_decisions (trail_id, created_at desc);
alter table public.trail_review_decisions enable row level security;
-- No public policies: only the service role (server) reads and writes reviews and source links.

-- User data keyed to public catalog trails (ids like "usgs-{…}", "nps-…", "resort-…"), for frontends that
-- use the Hyked API for trails and Supabase for accounts. Each user reads and writes only their own rows.
alter table public.activities add column if not exists catalog_trail_id text;
create index if not exists activities_catalog_trail_idx on public.activities (catalog_trail_id) where catalog_trail_id is not null;

create table if not exists public.saved_trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  catalog_trail_id text,
  name text not null check (length(name) between 1 and 200),
  days integer check (days is null or days between 1 and 365),
  start_date date,
  max_carry_days integer check (max_carry_days is null or max_carry_days between 1 and 14),
  plan jsonb,          -- town-days plan returned by the API, kept for offline reference
  pack jsonb,          -- [{ name, quantity, weightOz, category, consumable }]
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists saved_trips_user_idx on public.saved_trips (user_id, created_at desc);
alter table public.saved_trips enable row level security;

create table if not exists public.favorite_trails (
  user_id uuid not null references auth.users(id) on delete cascade,
  catalog_trail_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, catalog_trail_id)
);
alter table public.favorite_trails enable row level security;

create table if not exists public.catalog_trail_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  catalog_trail_id text not null,
  rating integer not null check (rating between 1 and 5),
  difficulty text check (difficulty is null or difficulty in ('easy','moderate','hard','expert')),
  body text check (body is null or length(body) <= 4000),
  hiked_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (catalog_trail_id, user_id)
);
create index if not exists catalog_trail_reviews_trail_idx on public.catalog_trail_reviews (catalog_trail_id);
alter table public.catalog_trail_reviews enable row level security;

do $$ begin
  create policy "own saved trips" on public.saved_trips for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "own favorites" on public.favorite_trails for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "read trail reviews" on public.catalog_trail_reviews for select to anon, authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "write own trail reviews" on public.catalog_trail_reviews for insert to authenticated with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "edit own trail reviews" on public.catalog_trail_reviews for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "delete own trail reviews" on public.catalog_trail_reviews for delete to authenticated using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
