create table if not exists public.market_candles (
  source text not null,
  instrument text not null,
  timeframe text not null,
  time_ms bigint not null,
  open numeric not null,
  high numeric not null,
  low numeric not null,
  close numeric not null,
  volume numeric not null default 0,
  confirmed boolean not null default false,
  observed_at timestamptz not null default now(),
  primary key (source, instrument, timeframe, time_ms)
);
create index if not exists market_candles_lookup_idx on public.market_candles (instrument, timeframe, time_ms desc);
create index if not exists market_candles_source_lookup_idx on public.market_candles (source, instrument, timeframe, time_ms desc);
alter table public.market_candles enable row level security;
drop policy if exists market_candles_deny_all on public.market_candles;
create policy market_candles_deny_all on public.market_candles for all using (false) with check (false);

create table if not exists public.market_snapshots (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  instrument text not null,
  event_ts timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists market_snapshots_lookup_idx on public.market_snapshots (instrument, event_ts desc);
create index if not exists market_snapshots_source_lookup_idx on public.market_snapshots (source, instrument, event_ts desc);
alter table public.market_snapshots enable row level security;
drop policy if exists market_snapshots_deny_all on public.market_snapshots;
create policy market_snapshots_deny_all on public.market_snapshots for all using (false) with check (false);
