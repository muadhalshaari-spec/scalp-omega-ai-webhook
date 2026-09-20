create table if not exists public.signal_events (
  id uuid primary key default gen_random_uuid(),
  job_id text unique,
  source text not null default 'TRADINGVIEW',
  alert jsonb not null default '{}'::jsonb,
  institutional jsonb,
  status text not null default 'PROCESSED',
  received_at timestamptz,
  processed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists signal_events_processed_at_idx
  on public.signal_events (processed_at desc);

create index if not exists signal_events_status_idx
  on public.signal_events (status);

alter table public.signal_events enable row level security;

create table if not exists public.titan_snapshots (
  id uuid primary key default gen_random_uuid(),
  event_ts timestamptz not null,
  instrument text not null,
  decision text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists titan_snapshots_event_ts_idx on public.titan_snapshots (event_ts desc);

create table if not exists public.titan_features (
  id bigserial primary key,
  event_ts timestamptz not null,
  instrument text not null,
  features jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists titan_features_event_ts_idx on public.titan_features (event_ts desc);

create table if not exists public.titan_outcomes (
  id uuid primary key default gen_random_uuid(),
  signal_id text not null,
  status text not null,
  net_r numeric,
  mae numeric,
  mfe numeric,
  created_at timestamptz not null default now()
);
create index if not exists titan_outcomes_signal_id_idx on public.titan_outcomes (signal_id);
create index if not exists titan_outcomes_created_at_idx on public.titan_outcomes (created_at desc);

create table if not exists public.titan_system_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists titan_system_events_created_at_idx on public.titan_system_events (created_at desc);

alter table public.titan_snapshots enable row level security;
alter table public.titan_features enable row level security;
alter table public.titan_outcomes enable row level security;
alter table public.titan_system_events enable row level security;
