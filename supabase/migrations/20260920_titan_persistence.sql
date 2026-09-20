create extension if not exists pgcrypto;

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
create index if not exists signal_events_processed_at_idx on public.signal_events (processed_at desc);
create index if not exists signal_events_status_idx on public.signal_events (status);

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

create table if not exists public.titan_liquidations (
  id text primary key,
  event_ts timestamptz not null,
  instrument text not null,
  price numeric not null,
  qty numeric not null default 0,
  notional numeric not null default 0,
  side text,
  source text not null,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists titan_liquidations_event_ts_idx on public.titan_liquidations (event_ts desc);
create index if not exists titan_liquidations_instrument_ts_idx on public.titan_liquidations(instrument,event_ts desc);

alter table public.signal_events enable row level security;
alter table public.titan_snapshots enable row level security;
alter table public.titan_features enable row level security;
alter table public.titan_outcomes enable row level security;
alter table public.titan_system_events enable row level security;
alter table public.titan_liquidations enable row level security;

drop policy if exists signal_events_deny_all on public.signal_events;
create policy signal_events_deny_all on public.signal_events for all using (false) with check (false);
drop policy if exists titan_snapshots_deny_all on public.titan_snapshots;
create policy titan_snapshots_deny_all on public.titan_snapshots for all using (false) with check (false);
drop policy if exists titan_features_deny_all on public.titan_features;
create policy titan_features_deny_all on public.titan_features for all using (false) with check (false);
drop policy if exists titan_outcomes_deny_all on public.titan_outcomes;
create policy titan_outcomes_deny_all on public.titan_outcomes for all using (false) with check (false);
drop policy if exists titan_system_events_deny_all on public.titan_system_events;
create policy titan_system_events_deny_all on public.titan_system_events for all using (false) with check (false);
drop policy if exists titan_liquidations_deny_all on public.titan_liquidations;
create policy titan_liquidations_deny_all on public.titan_liquidations for all using (false) with check (false);

revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
