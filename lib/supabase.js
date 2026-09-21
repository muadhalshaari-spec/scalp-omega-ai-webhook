const rawUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

function supabaseBaseUrl() {
  if (!rawUrl) return '';
  return rawUrl.replace(/\/+$/, '').replace(/\/rest\/v1$/i, '');
}

export function supabaseConfigured() {
  return Boolean(supabaseBaseUrl() && key);
}

function authHeaders(extra = {}) {
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

export async function insertSignalEvent(row) {
  const baseUrl = supabaseBaseUrl();
  if (!baseUrl || !key) return { configured: false };

  const response = await fetch(`${baseUrl}/rest/v1/signal_events`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify(row),
    cache: 'no-store'
  });

  if (!response.ok) {
    const text = await response.text();
    if (response.status === 404) return { configured: true, persisted: false, status: 'TABLE_MISSING', migrationRequired: 'supabase/schema.sql' };
    throw new Error(`Supabase HTTP ${response.status}: ${text.slice(0, 500)}`);
  }

  return { configured: true, persisted: true, status: 'PERSISTED' };
}

export async function insertTitanSnapshot(row) {
  const baseUrl = supabaseBaseUrl();
  if (!baseUrl || !key) return { configured: false, persisted: false, status: 'NOT_CONFIGURED' };
  const response = await fetch(baseUrl + '/rest/v1/titan_snapshots', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify(row),
    cache: 'no-store'
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error('Supabase titan_snapshots HTTP ' + response.status + ': ' + text.slice(0, 500));
  }
  return { configured: true, persisted: true, status: 'PERSISTED' };
}

export async function insertTitanFeature(row) {
  const baseUrl = supabaseBaseUrl();
  if (!baseUrl || !key) return { configured: false, persisted: false, status: 'NOT_CONFIGURED' };
  const response = await fetch(baseUrl + '/rest/v1/titan_features', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify(row),
    cache: 'no-store'
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error('Supabase titan_features HTTP ' + response.status + ': ' + text.slice(0, 500));
  }
  return { configured: true, persisted: true, status: 'PERSISTED' };
}

export async function insertTitanSystemEvent(row) {
  const baseUrl = supabaseBaseUrl();
  if (!baseUrl || !key) return { configured: false, persisted: false, status: 'NOT_CONFIGURED' };
  const response = await fetch(baseUrl + '/rest/v1/titan_system_events', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify(row),
    cache: 'no-store'
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error('Supabase titan_system_events HTTP ' + response.status + ': ' + text.slice(0, 500));
  }
  return { configured: true, persisted: true, status: 'PERSISTED' };
}

export async function insertLiquidationEvents(rows) {
  const baseUrl = supabaseBaseUrl();
  if (!baseUrl || !key) return { configured: false, persisted: false, status: 'NOT_CONFIGURED' };
  if (!Array.isArray(rows) || rows.length === 0) return { configured: true, persisted: true, status: 'NO_EVENTS', inserted: 0 };

  const response = await fetch(`${baseUrl}/rest/v1/titan_liquidations?on_conflict=id`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' }),
    body: JSON.stringify(rows),
    cache: 'no-store'
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase liquidation persistence HTTP ${response.status}: ${text.slice(0, 500)}`);
  }

  return { configured: true, persisted: true, status: 'PERSISTED', inserted: rows.length };
}

export async function getRecentLiquidations({ limit = 200, sinceMs = 3600000 } = {}) {
  const baseUrl = supabaseBaseUrl();
  if (!baseUrl || !key) return { configured: false, rows: [] };
  const since = new Date(Date.now() - sinceMs).toISOString();
  const q = new URLSearchParams({
    select: '*',
    event_ts: `gte.${since}`,
    order: 'event_ts.desc',
    limit: String(Math.max(1, Math.min(1000, limit)))
  });
  const response = await fetch(`${baseUrl}/rest/v1/titan_liquidations?${q.toString()}`, {
    headers: authHeaders({ Accept: 'application/json' }),
    cache: 'no-store'
  });
  if (!response.ok) throw new Error(`Supabase liquidation read HTTP ${response.status}`);
  const rows = await response.json();
  return { configured: true, rows: Array.isArray(rows) ? rows : [] };
}

function chunk(rows, size = 500) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export async function upsertMarketCandles(rows) {
  const baseUrl = supabaseBaseUrl();
  if (!baseUrl || !key) return { configured: false, persisted: false, rows: 0 };
  if (!Array.isArray(rows) || rows.length === 0) return { configured: true, persisted: true, rows: 0 };

  let written = 0;
  for (const batch of chunk(rows, 500)) {
    const response = await fetch(`${baseUrl}/rest/v1/market_candles?on_conflict=source,instrument,timeframe,time_ms`, {
      method: 'POST',
      headers: authHeaders({
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal'
      }),
      body: JSON.stringify(batch),
      cache: 'no-store'
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Supabase market_candles HTTP ${response.status}: ${text.slice(0, 500)}`);
    }
    written += batch.length;
  }

  return { configured: true, persisted: true, rows: written };
}

export async function insertMarketSnapshot(row) {
  const baseUrl = supabaseBaseUrl();
  if (!baseUrl || !key) return { configured: false, persisted: false };

  const response = await fetch(`${baseUrl}/rest/v1/market_snapshots`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify(row),
    cache: 'no-store'
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase market_snapshots HTTP ${response.status}: ${text.slice(0, 500)}`);
  }

  return { configured: true, persisted: true };
}


export async function insertMicrostructureSnapshot(row) {
  const baseUrl = supabaseBaseUrl();
  if (!baseUrl || !key) return { configured: false, persisted: false };
  const response = await fetch(`${baseUrl}/rest/v1/market_microstructure_snapshots?on_conflict=source,instrument,event_bucket`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(row),
    cache: 'no-store'
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase microstructure snapshot HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  return { configured: true, persisted: true };
}

export async function getMicrostructureHistory({ source='OKX', instrument='ETH-USDT-SWAP', limit=1000 }={}) {
  const baseUrl = supabaseBaseUrl();
  if (!baseUrl || !key) return { configured: false, rows: [] };
  const q = new URLSearchParams({
    select: 'source,instrument,event_ts,event_bucket,seq_id,best_bid,best_ask,mid_price,spread,spread_bps,bid_depth_400,ask_depth_400,bid_notional_400,ask_notional_400,trade_count,buy_size,sell_size,delta_size,vwap,metrics',
    source: `eq.${source}`,
    instrument: `eq.${instrument}`,
    order: 'event_ts.desc',
    limit: String(Math.max(1, Math.min(5000, limit)))
  });
  const response = await fetch(`${baseUrl}/rest/v1/market_microstructure_snapshots?${q.toString()}`, {
    headers: authHeaders({ Accept: 'application/json' }),
    cache: 'no-store'
  });
  if (!response.ok) throw new Error(`Supabase microstructure history HTTP ${response.status}`);
  const rows = await response.json();
  return { configured: true, rows: Array.isArray(rows) ? rows : [] };
}

export async function getRecentMarketCandles({ source, instrument, timeframe, limit = 200 } = {}) {
  const baseUrl = supabaseBaseUrl();
  if (!baseUrl || !key) return { configured: false, rows: [] };

  const q = new URLSearchParams({
    select: 'source,instrument,timeframe,time_ms,open,high,low,close,volume,confirmed,observed_at',
    source: `eq.${source || 'OKX'}`,
    instrument: `eq.${instrument || 'ETH-USDT-SWAP'}`,
    timeframe: `eq.${timeframe || '15m'}`,
    order: 'time_ms.desc',
    limit: String(Math.max(1, Math.min(1000, limit)))
  });

  const response = await fetch(`${baseUrl}/rest/v1/market_candles?${q.toString()}`, {
    headers: authHeaders({ Accept: 'application/json' }),
    cache: 'no-store'
  });
  if (!response.ok) throw new Error(`Supabase market_candles read HTTP ${response.status}`);
  const rows = await response.json();
  return { configured: true, rows: Array.isArray(rows) ? rows : [] };
}


export async function getMarketCandleCoverageMatrix({ sources=['OKX','BINANCE','BYBIT'], instruments={OKX:'ETH-USDT-SWAP',BINANCE:'ETHUSDT',BYBIT:'ETHUSDT'}, timeframes=['1m','5m','15m','1H','4H','1D'] }={}) {
  const rows = {};
  for (const source of sources) {
    rows[source] = {};
    for (const timeframe of timeframes) {
      rows[source][timeframe] = await getMarketCandleCoverage({
        source,
        instrument: instruments[source],
        timeframe
      }).catch(error => ({ configured:true, status:'ERROR', error:error?.message || String(error) }));
    }
  }
  return rows;
}

export async function getLatestMarketSnapshot({ source = 'SCALP-OMEGA-MARKET-SYNC', instrument = 'ETH-USDT-SWAP' } = {}) {
  const baseUrl = supabaseBaseUrl();
  if (!baseUrl || !key) return { configured: false, row: null };
  const q = new URLSearchParams({ select: 'source,instrument,event_ts,payload,created_at', source: 'eq.' + source, instrument: 'eq.' + instrument, order: 'event_ts.desc', limit: '1' });
  const response = await fetch(baseUrl + '/rest/v1/market_snapshots?' + q.toString(), { headers: authHeaders({ Accept: 'application/json' }), cache: 'no-store' });
  if (!response.ok) throw new Error('Supabase market_snapshots read HTTP ' + response.status);
  const rows = await response.json();
  return { configured: true, row: Array.isArray(rows) ? (rows[0] || null) : null };
}


export async function getMarketCandleCoverage({ source = 'OKX', instrument = 'ETH-USDT-SWAP', timeframe = '15m' } = {}) {
  const baseUrl = supabaseBaseUrl();
  if (!baseUrl || !key) return { configured: false, status: 'NOT_CONFIGURED' };
  const base = {
    select: 'time_ms,confirmed',
    source: `eq.${source}`,
    instrument: `eq.${instrument}`,
    timeframe: `eq.${timeframe}`,
    limit: '1'
  };
  const readEdge = async (order) => {
    const q = new URLSearchParams({ ...base, order });
    const response = await fetch(`${baseUrl}/rest/v1/market_candles?${q.toString()}`, {
      headers: authHeaders({ Accept: 'application/json' }),
      cache: 'no-store'
    });
    if (!response.ok) throw new Error(`Supabase market_candles coverage HTTP ${response.status}`);
    const rows = await response.json();
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  };
  const [oldest, newest] = await Promise.all([
    readEdge('time_ms.asc'),
    readEdge('time_ms.desc')
  ]);
  const oldestMs = Number(oldest?.time_ms), newestMs = Number(newest?.time_ms);
  return {
    configured: true,
    status: oldest && newest ? 'AVAILABLE' : 'EMPTY',
    oldestTimeMs: Number.isFinite(oldestMs) ? oldestMs : null,
    newestTimeMs: Number.isFinite(newestMs) ? newestMs : null,
    spanDays: Number.isFinite(oldestMs) && Number.isFinite(newestMs) ? (newestMs - oldestMs) / 86400000 : null,
    confirmedEdgeFlags: { oldest: oldest?.confirmed === true, newest: newest?.confirmed === true }
  };
}
