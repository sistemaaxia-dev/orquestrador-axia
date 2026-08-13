create extension if not exists "pgcrypto";

create table if not exists public.app_users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  area text,
  role_name text,
  is_active boolean not null default true,
  is_online boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workflows (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  routine text not null check (routine in ('Mensal', 'Trimestral')),
  period text not null,
  description text,
  start_at timestamptz not null,
  due_at timestamptz not null,
  status text not null default 'Nao iniciado' check (status in ('Em andamento', 'Nao iniciado', 'Concluido')),
  created_by uuid not null references public.app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workflow_participants (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  access_level text not null default 'viewer' check (access_level in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  unique (workflow_id, user_id)
);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  company_name text not null,
  name text not null,
  stage text not null,
  activity_type text not null check (activity_type in ('Execucao', 'Validacao', 'Aprovacao', 'Liberacao', 'Envio')),
  order_index integer not null,
  due_at timestamptz not null,
  responsible_user_email text not null,
  reviewer_user_email text,
  approver_user_email text,
  requires_approval boolean not null default false,
  requires_attachment boolean not null default false,
  status text not null default 'Bloqueada' check (status in ('Liberada', 'Bloqueada', 'Concluida', 'Reprovada')),
  result text not null default '' check (result in ('', 'Feito', 'Aprovado', 'Reprovado', 'Nao Feito')),
  sharepoint_file_name text,
  sharepoint_file_url text,
  sharepoint_item_id text,
  created_by uuid not null references public.app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workflow_id, order_index)
);

create table if not exists public.activity_history (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  activity_id uuid references public.activities(id) on delete cascade,
  activity_name text not null,
  action text not null,
  notes text,
  old_status text,
  new_status text,
  performed_by uuid references public.app_users(id),
  performed_by_email text,
  performed_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_app_users_updated_at on public.app_users;
create trigger trg_app_users_updated_at
before update on public.app_users
for each row
execute function public.set_updated_at();

drop trigger if exists trg_workflows_updated_at on public.workflows;
create trigger trg_workflows_updated_at
before update on public.workflows
for each row
execute function public.set_updated_at();

drop trigger if exists trg_activities_updated_at on public.activities;
create trigger trg_activities_updated_at
before update on public.activities
for each row
execute function public.set_updated_at();

create or replace view public.workflow_dashboard
with (security_invoker = true)
as
select
  w.id,
  w.name,
  w.routine,
  w.period,
  w.description,
  w.start_at,
  w.due_at,
  w.status,
  creator.full_name as created_by_name,
  participant.email as participant_email,
  count(a.id) as total_activities,
  count(a.id) filter (where a.status = 'Concluida') as completed_activities,
  count(a.id) filter (where a.status = 'Liberada') as released_activities,
  min(a.order_index) filter (where a.status = 'Liberada') as next_order
from public.workflows w
join public.app_users creator on creator.id = w.created_by
join public.workflow_participants wp on wp.workflow_id = w.id
join public.app_users participant on participant.id = wp.user_id
left join public.activities a on a.workflow_id = w.id
group by w.id, creator.full_name, participant.email;

create or replace view public.activities_my_queue
with (security_invoker = true)
as
select
  a.*,
  w.name as workflow_name,
  queue_user.email as user_email
from public.activities a
join public.workflows w on w.id = a.workflow_id
join public.app_users queue_user
  on queue_user.email in (a.responsible_user_email, coalesce(a.reviewer_user_email, ''), coalesce(a.approver_user_email, ''));

alter table public.app_users enable row level security;
alter table public.workflows enable row level security;
alter table public.workflow_participants enable row level security;
alter table public.activities enable row level security;
alter table public.activity_history enable row level security;

create policy "users_can_view_active_directory"
on public.app_users
for select
to authenticated
using (is_active = true or id = auth.uid());

create policy "users_can_update_themselves"
on public.app_users
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy "participants_can_view_workflows"
on public.workflows
for select
to authenticated
using (
  created_by = auth.uid()
  or exists (
    select 1
    from public.workflow_participants wp
    where wp.workflow_id = workflows.id
      and wp.user_id = auth.uid()
  )
);

create policy "owners_can_insert_workflows"
on public.workflows
for insert
to authenticated
with check (created_by = auth.uid());

create policy "owners_can_update_workflows"
on public.workflows
for update
to authenticated
using (created_by = auth.uid())
with check (created_by = auth.uid());

create policy "participants_can_view_participants"
on public.workflow_participants
for select
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.workflow_participants wp
    where wp.workflow_id = workflow_participants.workflow_id
      and wp.user_id = auth.uid()
  )
);

create policy "owners_manage_participants"
on public.workflow_participants
for all
to authenticated
using (
  exists (
    select 1
    from public.workflows w
    where w.id = workflow_participants.workflow_id
      and w.created_by = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.workflows w
    where w.id = workflow_participants.workflow_id
      and w.created_by = auth.uid()
  )
);

create policy "participants_can_view_activities"
on public.activities
for select
to authenticated
using (
  exists (
    select 1
    from public.workflow_participants wp
    where wp.workflow_id = activities.workflow_id
      and wp.user_id = auth.uid()
  )
  or responsible_user_email = auth.jwt()->>'email'
  or coalesce(reviewer_user_email, '') = auth.jwt()->>'email'
  or coalesce(approver_user_email, '') = auth.jwt()->>'email'
);

create policy "owners_insert_activities"
on public.activities
for insert
to authenticated
with check (
  exists (
    select 1
    from public.workflows w
    where w.id = activities.workflow_id
      and w.created_by = auth.uid()
  )
);

create policy "assigned_users_update_activities"
on public.activities
for update
to authenticated
using (
  responsible_user_email = auth.jwt()->>'email'
  or coalesce(reviewer_user_email, '') = auth.jwt()->>'email'
  or coalesce(approver_user_email, '') = auth.jwt()->>'email'
  or exists (
    select 1
    from public.workflows w
    where w.id = activities.workflow_id
      and w.created_by = auth.uid()
  )
)
with check (
  responsible_user_email = auth.jwt()->>'email'
  or coalesce(reviewer_user_email, '') = auth.jwt()->>'email'
  or coalesce(approver_user_email, '') = auth.jwt()->>'email'
  or exists (
    select 1
    from public.workflows w
    where w.id = activities.workflow_id
      and w.created_by = auth.uid()
  )
);

create policy "participants_can_view_history"
on public.activity_history
for select
to authenticated
using (
  exists (
    select 1
    from public.workflow_participants wp
    where wp.workflow_id = activity_history.workflow_id
      and wp.user_id = auth.uid()
  )
);

create policy "assigned_users_insert_history"
on public.activity_history
for insert
to authenticated
with check (
  performed_by = auth.uid()
  or exists (
    select 1
    from public.workflows w
    where w.id = activity_history.workflow_id
      and w.created_by = auth.uid()
  )
);
