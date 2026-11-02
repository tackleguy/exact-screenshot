-- "Report a problem with this trail": anyone (guest or signed in) may file a report about a catalog trail; nobody
-- can read reports through the public API (review them in the dashboard). Safe to run more than once.

create table if not exists public.trail_problem_reports (
  id uuid primary key default gen_random_uuid(),
  catalog_trail_id text not null check (length(catalog_trail_id) <= 200),
  trail_name text check (trail_name is null or length(trail_name) <= 300),
  problem text not null check (problem in ('name','location','stats','description','access','duplicate','other')),
  details text check (details is null or length(details) <= 2000),
  contact text check (contact is null or length(contact) <= 200),
  page_url text check (page_url is null or length(page_url) <= 500),
  user_id uuid references auth.users(id) on delete set null,
  status text not null default 'new' check (status in ('new','reviewed','fixed','dismissed')),
  created_at timestamptz not null default now()
);
create index if not exists trail_problem_reports_trail_idx on public.trail_problem_reports (catalog_trail_id);
create index if not exists trail_problem_reports_status_idx on public.trail_problem_reports (status, created_at desc);
alter table public.trail_problem_reports enable row level security;

do $$ begin
  create policy "file trail reports" on public.trail_problem_reports for insert to anon, authenticated
    with check (status = 'new' and (user_id is null or user_id = auth.uid()));
exception when duplicate_object then null; end $$;

grant insert on public.trail_problem_reports to anon, authenticated;
