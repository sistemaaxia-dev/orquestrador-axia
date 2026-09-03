create extension if not exists "pgcrypto";
create extension if not exists "citext";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email citext not null unique,
  name text not null,
  role text not null default 'user' check (role in ('admin', 'user')),
  area text,
  is_active boolean not null default true,
  first_login_required boolean not null default true,
  temporary_password_sent_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.workflows (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  routine text not null check (routine in ('mensal', 'trimestral', 'semestral', 'anual')),
  month integer not null check (month between 1 and 12),
  year integer not null check (year between 2000 and 2100),
  start_date date not null,
  expected_end_date date not null,
  created_by uuid not null references public.user_profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.workflow_participants (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  access_level text not null default 'viewer' check (access_level in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default timezone('utc', now()),
  unique (workflow_id, user_id)
);

create table if not exists public.activity_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  stage text not null check (stage in ('Recebimento', 'Contabilizacao', 'Apuracao', 'Consolidacao')),
  routine text not null check (routine in ('mensal', 'trimestral', 'semestral', 'anual')),
  responsible_user_id uuid references public.user_profiles(id),
  responsible_backup_user_id uuid references public.user_profiles(id),
  requires_attachment boolean not null default false,
  requires_approval boolean not null default false,
  approver_user_id uuid references public.user_profiles(id),
  start_date date,
  expected_end_date date,
  company text,
  created_by uuid not null references public.user_profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.activity_template_dependencies (
  id uuid primary key default gen_random_uuid(),
  activity_template_id uuid not null references public.activity_templates(id) on delete cascade,
  depends_on_template_id uuid not null references public.activity_templates(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  unique (activity_template_id, depends_on_template_id),
  check (activity_template_id <> depends_on_template_id)
);

create table if not exists public.workflow_activities (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  activity_template_id uuid references public.activity_templates(id) on delete set null,
  name_snapshot text not null,
  stage_snapshot text not null check (stage_snapshot in ('Recebimento', 'Contabilizacao', 'Apuracao', 'Consolidacao')),
  routine_snapshot text not null check (routine_snapshot in ('mensal', 'trimestral', 'semestral', 'anual')),
  responsible_user_id uuid references public.user_profiles(id),
  responsible_backup_user_id uuid references public.user_profiles(id),
  requires_attachment_snapshot boolean not null default false,
  requires_approval_snapshot boolean not null default false,
  approver_user_id uuid references public.user_profiles(id),
  start_date date not null,
  expected_end_date date not null,
  company_snapshot text,
  status text not null default 'Bloqueada' check (status in ('Bloqueada', 'Nao iniciada', 'Atrasada', 'Pendente de aprovacao', 'Concluida', 'Reprovada')),
  approval_status text not null default 'Nao aplicavel' check (approval_status in ('Nao aplicavel', 'Pendente', 'Aprovada', 'Reprovada')),
  released_at timestamptz,
  notification_sent_at timestamptz,
  completed_at timestamptz,
  completed_by uuid references public.user_profiles(id),
  rejected_at timestamptz,
  rejected_by uuid references public.user_profiles(id),
  overdue_logged_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.workflow_activity_dependencies (
  id uuid primary key default gen_random_uuid(),
  workflow_activity_id uuid not null references public.workflow_activities(id) on delete cascade,
  depends_on_workflow_activity_id uuid not null references public.workflow_activities(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  unique (workflow_activity_id, depends_on_workflow_activity_id),
  check (workflow_activity_id <> depends_on_workflow_activity_id)
);

create table if not exists public.workflow_activity_attachments (
  id uuid primary key default gen_random_uuid(),
  workflow_activity_id uuid not null references public.workflow_activities(id) on delete cascade,
  provider text not null default 'supabase_storage',
  file_name text not null,
  file_url text,
  external_id text,
  storage_path text,
  uploaded_by uuid not null references public.user_profiles(id),
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.stage_responsibility_settings (
  id uuid primary key default gen_random_uuid(),
  stage_name text not null unique check (stage_name in ('Recebimento', 'Contabilizacao', 'Apuracao', 'Consolidacao')),
  default_responsible_user_id uuid references public.user_profiles(id),
  default_backup_user_id uuid references public.user_profiles(id),
  updated_by uuid references public.user_profiles(id),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.user_profiles(id),
  workflow_id uuid references public.workflows(id) on delete cascade,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_workflow_participants_workflow on public.workflow_participants(workflow_id);
create index if not exists idx_workflow_participants_user on public.workflow_participants(user_id);
create index if not exists idx_workflow_activities_workflow on public.workflow_activities(workflow_id);
create index if not exists idx_workflow_activities_responsible on public.workflow_activities(responsible_user_id);
create index if not exists idx_workflow_activity_dependencies_activity on public.workflow_activity_dependencies(workflow_activity_id);
create index if not exists idx_workflow_activity_dependencies_depends on public.workflow_activity_dependencies(depends_on_workflow_activity_id);
create index if not exists idx_audit_logs_workflow on public.audit_logs(workflow_id, created_at desc);
create index if not exists idx_audit_logs_entity on public.audit_logs(entity_type, entity_id, created_at desc);

-- Operational master data. Kept idempotent for installations that use schema.sql directly.
alter table public.user_profiles add column if not exists team_name text;
alter table public.user_profiles add column if not exists team_email citext;
alter table public.workflows add column if not exists is_active boolean not null default false;
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(), name text not null unique,
  is_active boolean not null default true, created_at timestamptz not null default timezone('utc', now()), updated_at timestamptz not null default timezone('utc', now())
);
create table if not exists public.company_holidays (
  id uuid primary key default gen_random_uuid(), company_id uuid references public.companies(id) on delete set null,
  holiday_date date not null unique, description text, created_at timestamptz not null default timezone('utc', now())
);
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(), name text not null unique, email citext,
  is_active boolean not null default true, created_at timestamptz not null default timezone('utc', now()), updated_at timestamptz not null default timezone('utc', now())
);
create table if not exists public.directorates (
  id uuid primary key default gen_random_uuid(), name text not null unique,
  is_active boolean not null default true, created_at timestamptz not null default timezone('utc', now()), updated_at timestamptz not null default timezone('utc', now())
);
alter table public.activity_templates add column if not exists deadline_type text not null default 'fixed_date';
alter table public.activity_templates add column if not exists deadline_days integer;
alter table public.activity_templates add column if not exists notify_team boolean not null default false;
alter table public.activity_templates add column if not exists team_email_snapshot citext;
alter table public.workflow_activities add column if not exists deadline_type text not null default 'fixed_date';
alter table public.workflow_activities add column if not exists deadline_days integer;
alter table public.workflow_activities add column if not exists notify_team boolean not null default false;
alter table public.workflow_activities add column if not exists team_email_snapshot citext;

drop trigger if exists trg_user_profiles_updated_at on public.user_profiles;
create trigger trg_user_profiles_updated_at
before update on public.user_profiles
for each row
execute function public.set_updated_at();

drop trigger if exists trg_workflows_updated_at on public.workflows;
create trigger trg_workflows_updated_at
before update on public.workflows
for each row
execute function public.set_updated_at();

drop trigger if exists trg_activity_templates_updated_at on public.activity_templates;
create trigger trg_activity_templates_updated_at
before update on public.activity_templates
for each row
execute function public.set_updated_at();

drop trigger if exists trg_workflow_activities_updated_at on public.workflow_activities;
create trigger trg_workflow_activities_updated_at
before update on public.workflow_activities
for each row
execute function public.set_updated_at();

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.user_profiles up
    where up.id = auth.uid()
      and up.is_active = true
      and up.role = 'admin'
  );
$$;

create or replace function public.is_active_user()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.user_profiles up
    where up.id = auth.uid()
      and up.is_active = true
  );
$$;

create or replace function public.can_access_workflow(target_workflow_id uuid)
returns boolean
language sql
stable
as $$
  select
    public.is_admin()
    or exists (
      select 1
      from public.workflows w
      where w.id = target_workflow_id
        and w.created_by = auth.uid()
    )
    or exists (
      select 1
      from public.workflow_participants wp
      where wp.workflow_id = target_workflow_id
        and wp.user_id = auth.uid()
    )
    or exists (
      select 1
      from public.workflow_activities wa
      where wa.workflow_id = target_workflow_id
        and auth.uid() in (
          wa.responsible_user_id,
          wa.responsible_backup_user_id,
          wa.approver_user_id
        )
    );
$$;

create or replace function public.can_edit_workflow(target_workflow_id uuid)
returns boolean
language sql
stable
as $$
  select
    public.is_admin()
    or exists (
      select 1
      from public.workflows w
      where w.id = target_workflow_id
        and w.created_by = auth.uid()
    )
    or exists (
      select 1
      from public.workflow_participants wp
      where wp.workflow_id = target_workflow_id
        and wp.user_id = auth.uid()
        and wp.access_level in ('owner', 'editor')
    );
$$;

create or replace function public.can_access_workflow_activity(target_activity_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.workflow_activities wa
    where wa.id = target_activity_id
      and (
        public.can_edit_workflow(wa.workflow_id)
        or auth.uid() in (
          wa.responsible_user_id,
          wa.responsible_backup_user_id,
          wa.approver_user_id
        )
      )
  );
$$;

alter table public.user_profiles enable row level security;
alter table public.workflows enable row level security;
alter table public.workflow_participants enable row level security;
alter table public.activity_templates enable row level security;
alter table public.activity_template_dependencies enable row level security;
alter table public.workflow_activities enable row level security;
alter table public.workflow_activity_dependencies enable row level security;
alter table public.workflow_activity_attachments enable row level security;
alter table public.stage_responsibility_settings enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists "profiles_readable_to_active_users" on public.user_profiles;
create policy "profiles_readable_to_active_users"
on public.user_profiles
for select
to authenticated
using (is_active = true or id = auth.uid() or public.is_admin());

drop policy if exists "profiles_manageable_by_admin" on public.user_profiles;
create policy "profiles_manageable_by_admin"
on public.user_profiles
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "profile_self_update" on public.user_profiles;
create policy "profile_self_update"
on public.user_profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "workflow_access" on public.workflows;
create policy "workflow_access"
on public.workflows
for select
to authenticated
using (public.can_access_workflow(id));

drop policy if exists "workflow_insert" on public.workflows;
create policy "workflow_insert"
on public.workflows
for insert
to authenticated
with check (created_by = auth.uid() or public.is_admin());

drop policy if exists "workflow_update" on public.workflows;
create policy "workflow_update"
on public.workflows
for update
to authenticated
using (created_by = auth.uid() or public.is_admin())
with check (created_by = auth.uid() or public.is_admin());

drop policy if exists "participants_access" on public.workflow_participants;
create policy "participants_access"
on public.workflow_participants
for select
to authenticated
using (public.can_access_workflow(workflow_id));

drop policy if exists "participants_manage" on public.workflow_participants;
create policy "participants_manage"
on public.workflow_participants
for all
to authenticated
using (
  public.is_admin()
  or exists (
    select 1 from public.workflows w
    where w.id = workflow_participants.workflow_id
      and w.created_by = auth.uid()
  )
)
with check (
  public.is_admin()
  or exists (
    select 1 from public.workflows w
    where w.id = workflow_participants.workflow_id
      and w.created_by = auth.uid()
  )
);

drop policy if exists "templates_read" on public.activity_templates;
create policy "templates_read"
on public.activity_templates
for select
to authenticated
using (true);

drop policy if exists "templates_manage_admin" on public.activity_templates;
create policy "templates_manage_admin"
on public.activity_templates
for all
to authenticated
using (public.is_active_user())
with check (public.is_active_user());

drop policy if exists "template_dependencies_read" on public.activity_template_dependencies;
create policy "template_dependencies_read"
on public.activity_template_dependencies
for select
to authenticated
using (true);

drop policy if exists "template_dependencies_manage_admin" on public.activity_template_dependencies;
create policy "template_dependencies_manage_admin"
on public.activity_template_dependencies
for all
to authenticated
using (public.is_active_user())
with check (public.is_active_user());

drop policy if exists "workflow_activities_read" on public.workflow_activities;
create policy "workflow_activities_read"
on public.workflow_activities
for select
to authenticated
using (public.can_access_workflow(workflow_id));

drop policy if exists "workflow_activities_manage" on public.workflow_activities;
create policy "workflow_activities_manage"
on public.workflow_activities
for all
to authenticated
using (
  public.can_edit_workflow(workflow_id)
  or auth.uid() in (responsible_user_id, responsible_backup_user_id, approver_user_id)
)
with check (
  public.can_edit_workflow(workflow_id)
  or auth.uid() in (responsible_user_id, responsible_backup_user_id, approver_user_id)
);

drop policy if exists "workflow_activity_dependencies_read" on public.workflow_activity_dependencies;
create policy "workflow_activity_dependencies_read"
on public.workflow_activity_dependencies
for select
to authenticated
using (
  exists (
    select 1
    from public.workflow_activities wa
    where wa.id = workflow_activity_dependencies.workflow_activity_id
      and public.can_access_workflow(wa.workflow_id)
  )
);

drop policy if exists "workflow_activity_dependencies_manage" on public.workflow_activity_dependencies;
create policy "workflow_activity_dependencies_manage"
on public.workflow_activity_dependencies
for all
to authenticated
using (
  exists (
    select 1
    from public.workflow_activities wa
    where wa.id = workflow_activity_dependencies.workflow_activity_id
      and public.can_edit_workflow(wa.workflow_id)
  )
)
with check (
  exists (
    select 1
    from public.workflow_activities wa
    where wa.id = workflow_activity_dependencies.workflow_activity_id
      and public.can_edit_workflow(wa.workflow_id)
  )
);

drop policy if exists "attachments_read" on public.workflow_activity_attachments;
create policy "attachments_read"
on public.workflow_activity_attachments
for select
to authenticated
using (
  exists (
    select 1
    from public.workflow_activities wa
    where wa.id = workflow_activity_attachments.workflow_activity_id
      and public.can_access_workflow(wa.workflow_id)
  )
);

drop policy if exists "attachments_manage" on public.workflow_activity_attachments;
create policy "attachments_manage"
on public.workflow_activity_attachments
for all
to authenticated
using (
  exists (
    select 1
    from public.workflow_activities wa
    where wa.id = workflow_activity_attachments.workflow_activity_id
      and public.can_access_workflow_activity(wa.id)
  )
)
with check (
  exists (
    select 1
    from public.workflow_activities wa
    where wa.id = workflow_activity_attachments.workflow_activity_id
      and public.can_access_workflow_activity(wa.id)
  )
);

drop policy if exists "settings_admin_only" on public.stage_responsibility_settings;
create policy "settings_admin_only"
on public.stage_responsibility_settings
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "audit_read" on public.audit_logs;
create policy "audit_read"
on public.audit_logs
for select
to authenticated
using (
  public.is_admin()
  or (workflow_id is not null and public.can_access_workflow(workflow_id))
  or user_id = auth.uid()
);

drop policy if exists "audit_insert" on public.audit_logs;
create policy "audit_insert"
on public.audit_logs
for insert
to authenticated
with check (public.is_admin() or user_id = auth.uid());

insert into storage.buckets (id, name, public)
values ('workflow-attachments', 'workflow-attachments', false)
on conflict (id) do nothing;

drop policy if exists "workflow_attachments_read" on storage.objects;
create policy "workflow_attachments_read"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'workflow-attachments'
  and public.can_access_workflow(coalesce((storage.foldername(name))[1], '00000000-0000-0000-0000-000000000000')::uuid)
);

drop policy if exists "workflow_attachments_write" on storage.objects;
create policy "workflow_attachments_write"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'workflow-attachments'
  and public.can_access_workflow_activity(coalesce((storage.foldername(name))[2], '00000000-0000-0000-0000-000000000000')::uuid)
);

drop policy if exists "workflow_attachments_delete" on storage.objects;
create policy "workflow_attachments_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'workflow-attachments'
  and public.can_access_workflow_activity(coalesce((storage.foldername(name))[2], '00000000-0000-0000-0000-000000000000')::uuid)
);
