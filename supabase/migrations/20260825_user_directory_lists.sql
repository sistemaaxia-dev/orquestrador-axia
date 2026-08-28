-- Master lists used by user registration. The API keeps a compatibility
-- fallback until this migration is applied to the production project.
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  email citext,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.directorates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists trg_teams_updated_at on public.teams;
create trigger trg_teams_updated_at before update on public.teams
for each row execute function public.set_updated_at();

drop trigger if exists trg_directorates_updated_at on public.directorates;
create trigger trg_directorates_updated_at before update on public.directorates
for each row execute function public.set_updated_at();

alter table public.teams enable row level security;
alter table public.directorates enable row level security;

drop policy if exists "teams_read_active_or_admin" on public.teams;
create policy "teams_read_active_or_admin" on public.teams for select to authenticated
using (is_active or public.is_admin());
drop policy if exists "teams_admin_write" on public.teams;
create policy "teams_admin_write" on public.teams for all to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists "directorates_read_active_or_admin" on public.directorates;
create policy "directorates_read_active_or_admin" on public.directorates for select to authenticated
using (is_active or public.is_admin());
drop policy if exists "directorates_admin_write" on public.directorates;
create policy "directorates_admin_write" on public.directorates for all to authenticated
using (public.is_admin()) with check (public.is_admin());
