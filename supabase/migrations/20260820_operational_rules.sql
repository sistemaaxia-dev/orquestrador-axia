-- Operational master data and scheduling rules.
alter table public.user_profiles drop constraint if exists user_profiles_role_check;
alter table public.user_profiles add constraint user_profiles_role_check
  check (role in ('consulta', 'usuario', 'usuario_chave', 'admin', 'user'));
alter table public.user_profiles add column if not exists team_name text;
alter table public.user_profiles add column if not exists team_email citext;

alter table public.workflows add column if not exists is_active boolean not null default true;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.company_holidays (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  holiday_date date not null,
  description text,
  created_at timestamptz not null default timezone('utc', now()),
  unique(company_id, holiday_date)
);

alter table public.activity_templates add column if not exists deadline_type text not null default 'fixed_date'
  check (deadline_type in ('business_days', 'fixed_date'));
alter table public.activity_templates add column if not exists deadline_days integer;
alter table public.activity_templates add column if not exists notify_team boolean not null default false;
alter table public.activity_templates add column if not exists team_email_snapshot citext;
alter table public.workflow_activities add column if not exists deadline_type text not null default 'fixed_date'
  check (deadline_type in ('business_days', 'fixed_date'));
alter table public.workflow_activities add column if not exists deadline_days integer;
alter table public.workflow_activities add column if not exists notify_team boolean not null default false;
alter table public.workflow_activities add column if not exists team_email_snapshot citext;
alter table public.workflow_activities add column if not exists approval_notification_sent_at timestamptz;
alter table public.workflow_activities add column if not exists rejection_notification_sent_at timestamptz;
alter table public.workflow_activities add column if not exists reminder_notification_sent_at timestamptz;

create index if not exists idx_company_holidays_company_date on public.company_holidays(company_id, holiday_date);
drop trigger if exists trg_companies_updated_at on public.companies;
create trigger trg_companies_updated_at before update on public.companies for each row execute function public.set_updated_at();
