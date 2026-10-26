-- Trail reviews and saved trails ("Save to list" hearts) for catalog trails. Self-contained: creates the tables
-- if an earlier migration (20261020000001) wasn't applied, adds the row-level security policies, and grants the
-- table privileges the policies need (without them every request answers "permission denied").
-- Anyone may read reviews; signed-in people write, edit and delete their own; saved trails are owner-only.
-- Safe to run more than once.

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

grant select on public.catalog_trail_reviews to anon, authenticated;
grant insert, update, delete on public.catalog_trail_reviews to authenticated;
grant select, insert, update, delete on public.favorite_trails to authenticated;
