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
