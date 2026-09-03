-- Confirmed client rules: workflows are created inactive; activation is final.
-- Status describes execution and is independent from the active notification flag.
alter table public.workflows
  add column if not exists is_active boolean not null default false;

alter table public.workflows
  alter column is_active set default false;
