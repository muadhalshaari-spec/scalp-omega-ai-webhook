import { upsertMarketCandles } from './supabase.js';

const rawUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const base = () => (rawUrl || '').replace(/\/+$/, '').replace(/\/rest\/v1$/i, '');
const headers = (extra = {}) => ({ apikey: key, Authorization: `Bearer ${key}`, ...extra });

export const SOURCES = Object.freeze([
  { name: 'OKX', instrument: 'ETH-USDT-SWAP' },
  { name: 'BINANCE', instrument: 'ETHUSDT' },
  { name: 'BYBIT', instrument: 'ETHUSDT' },
  { name: 'DERIBIT', instrument: 'ETH-PERPETUAL' }
]);
export const TIMEFRAMES = Object.freeze(['1m', '5m', '15m', '1H', '4H', '1D']);
export const TARGET_ROWS = 100000;

export function storeConfigured() { return Boolean(base() && key); }

async function request(path, options = {}) {
  const response = await fetch(base() + path, { ...options, headers: headers(options.headers), cache: 'no-store' });
  const text = await response.text();
  let body = null; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) throw new Error(`Supabase history store HTTP ${response.status}: ${text.slice(0, 300)}`);
  return body;
}

export async function ensureSyncStates() {
  if (!storeConfigured()) return { configured:false, rows:0 };
  const rows = SOURCES.flatMap(({ name, instrument }) =>
    TIMEFRAMES.map((timeframe) => ({ source:name, instrument, timeframe, target_rows:TARGET_ROWS }))
  );
  await request('/rest/v1/market_history_sync_state?on_conflict=source,instrument,timeframe', {
    method:'POST',
    headers:{ 'Content-Type':'application/json', Prefer:'resolution=ignore-duplicates,return=minimal' },
    body:JSON.stringify(rows)
  });
  const states = await getSyncStates(100);
  const candidates = states.rows.filter(s =>
    Number(s.stored_rows || 0) === 0 || s.cursor_ms == null || ['PENDING','RETRY_PENDING'].includes(s.status)
  );
  for (const state of candidates) {
    const coverage = await actualCandleCoverage(state.source,state.instrument,state.timeframe);
    if (!coverage) continue;
    if (coverage.count > 0) {
      const target = Number(state.target_rows || TARGET_ROWS);
      const stored = Math.min(target, coverage.count);
      const complete = coverage.count >= target;
      await updateSyncState({
        source:state.source,
        instrument:state.instrument,
        timeframe:state.timeframe,
        target_rows:target,
        stored_rows:stored,
        cursor_ms:Number.isFinite(coverage.oldestTimeMs) ? coverage.oldestTimeMs - 1 : state.cursor_ms,
        status:complete ? 'COMPLETE' : 'RUNNING',
        last_error:null,
        completed_at:complete ? (state.completed_at || new Date().toISOString()) : null
      }).catch(()=>null);
    }
  }
  return { configured:true, rows:rows.length, reconciled:candidates.length };
}

async function actualCandleCoverage(source, instrument, timeframe) {
  if (!storeConfigured()) return null;
  const q = new URLSearchParams({
    select: 'time_ms',
    source: 'eq.' + source,
    instrument: 'eq.' + instrument,
    timeframe: 'eq.' + timeframe,
    order: 'time_ms.asc',
    limit: '1'
  });
  const response = await fetch(base() + '/rest/v1/market_candles?' + q.toString(), {
    headers: headers({ Accept:'application/json', Prefer:'count=exact' }),
    cache:'no-store'
  });
  if (!response.ok) return null;
  const rows = await response.json();
  const range = response.headers.get('content-range') || '';
  const match = range.match(/\\/(\\d+)$/);
  const count = match ? Number(match[1]) : 0;
  return {
    count: Number.isFinite(count) ? count : 0,
    oldestTimeMs: Number(rows?.[0]?.time_ms)
  };
}

export async function getSyncStates(limit = 24) {
  if (!storeConfigured()) return { configured: false, rows: [] };
  const q = new URLSearchParams({ select: '*', order: 'status.asc,updated_at.asc', limit: String(Math.max(1, Math.min(100, limit))) });
  const rows = await request('/rest/v1/market_history_sync_state?' + q);
  return { configured: true, rows: Array.isArray(rows) ? rows : [] };
}

export async function updateSyncState(state) {
  if (!storeConfigured()) return { configured: false };
  const q = new URLSearchParams({ source: `eq.${state.source}`, instrument: `eq.${state.instrument}`, timeframe: `eq.${state.timeframe}` });
  await request('/rest/v1/market_history_sync_state?' + q, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ ...state, updated_at: new Date().toISOString() })
  });
  return { configured: true };
}

export async function persistHistoryRows(rows) { return upsertMarketCandles(rows); }
