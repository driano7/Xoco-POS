-- Roles extendidos
create table if not exists staff_roles (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  role text not null check (role in ('barista','gerente','socio','superuser')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Perfil extendido con campos cifrados (AES-GCM). Se guardan como texto base16.
alter table if exists staff_profiles
  add column if not exists encrypted_salary text,
  add column if not exists encrypted_tip_pool text,
  add column if not exists encrypted_paid_leave_days text,
  add column if not exists encrypted_admin_faults text,
  add column if not exists encrypted_branch_assignment text,
  add column if not exists encrypted_position text,
  add column if not exists encrypted_comments text;

-- Requests de gobernanza
create table if not exists staff_governance_requests (
  id uuid primary key default gen_random_uuid(),
  employee_email text not null,
  branch_id text,
  type text not null check (type in (
    'salary','role','branch','manager','termination','branch-edit','inventory','evaluation'
  )),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','requires_changes','approved','declined')),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deadline timestamptz not null default (now() + interval '5 days')
);

create table if not exists staff_governance_votes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references staff_governance_requests(id) on delete cascade,
  reviewer_email text not null,
  decision text not null default 'pending' check (decision in ('pending','approved','declined')),
  comment text,
  decided_at timestamptz,
  constraint unique_reviewer_per_request unique (request_id, reviewer_email)
);

-- Tabla de aprobaciones operativas (goce de sueldo, limpieza, evaluaciones)
create table if not exists staff_approvals (
  id uuid primary key default gen_random_uuid(),
  employee_email text not null,
  category text not null check (category in ('paid_leave','cleaning','comments','performance')),
  note text,
  status text not null default 'pending' check (status in ('pending','approved','declined')),
  due_date date not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- Auditoría de inventarios editados por socios/gerentes
create table if not exists inventory_adjustments (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  item_name text not null,
  previous_quantity numeric not null,
  new_quantity numeric not null,
  branch_id text,
  edited_by text not null,
  request_id uuid references staff_governance_requests(id),
  created_at timestamptz not null default now()
);

-- Control de super usuarios
create table if not exists staff_superusers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Comentarios de evaluaciones (cifrado en frontend)
create table if not exists staff_evaluations (
  id uuid primary key default gen_random_uuid(),
  employee_email text not null,
  reviewer_email text not null,
  encrypted_comment text not null,
  score numeric(3,1),
  created_at timestamptz not null default now()
);

-- Trigger para actualizar updated_at en governance
create or replace function touch_staff_governance_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_touch_governance on staff_governance_requests;
create trigger trg_touch_governance
before update on staff_governance_requests
for each row execute procedure touch_staff_governance_updated_at();

-- Vista rápida para dashboard
create or replace view view_staff_governance_dashboard as
select
  r.id,
  r.employee_email,
  r.branch_id,
  r.type,
  r.status,
  r.deadline,
  r.payload,
  r.created_by,
  r.created_at,
  jsonb_agg(
    jsonb_build_object(
      'reviewer', v.reviewer_email,
      'decision', v.decision,
      'comment', v.comment,
      'decided_at', v.decided_at
    )
  ) as approvals
from staff_governance_requests r
left join staff_governance_votes v on v.request_id = r.id
group by r.id;

-- --------------------------------------------------------------------
--  Marketing analytics (idempotent setup to avoid 42P07 errors)
-- --------------------------------------------------------------------
do $$
begin
  if to_regclass('public.marketing_cluster_snapshots') is null then
    create table public.marketing_cluster_snapshots (
      id uuid primary key default gen_random_uuid(),
      snapshot_date timestamptz not null,
      range_key text not null,
      cluster_id text not null,
      centroid jsonb not null,
      customer_count integer not null,
      avg_ticket numeric(10,2) not null
    );
  end if;
end$$;

create index if not exists marketing_cluster_snapshots_snapshot_range_idx
  on marketing_cluster_snapshots (snapshot_date, range_key);

do $$
begin
  if to_regclass('public.marketing_product_suggestions') is null then
    create table public.marketing_product_suggestions (
      id uuid primary key default gen_random_uuid(),
      snapshot_date timestamptz not null,
      range_key text not null,
      product_id text not null,
      reason text,
      support_count integer not null
    );
  end if;
end$$;

do $$
begin
  if to_regclass('public.marketing_markov_edges') is null then
    create table public.marketing_markov_edges (
      id uuid primary key default gen_random_uuid(),
      snapshot_date timestamptz not null,
      range_key text not null,
      from_page text not null,
      to_page text not null,
      probability numeric(6,3) not null
    );
  end if;
end$$;

create index if not exists marketing_markov_edges_snapshot_range_idx
  on marketing_markov_edges (snapshot_date, range_key);

do $$
begin
  if to_regclass('public.marketing_inventory_insights') is null then
    create table public.marketing_inventory_insights (
      id uuid primary key default gen_random_uuid(),
      snapshot_date timestamptz not null,
      item_id text not null,
      risk text not null,
      recommendation text not null,
      posterior jsonb
    );
  end if;
end$$;

do $$
begin
  if to_regclass('public.marketing_anomalies') is null then
    create table public.marketing_anomalies (
      id uuid primary key default gen_random_uuid(),
      snapshot_date timestamptz not null,
      label text not null,
      description text not null,
      severity text default 'medium'
    );
  end if;
end$$;
