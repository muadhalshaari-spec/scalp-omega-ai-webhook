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
  if (!storeConfigured()) return { configured: false, rows: 0 };
  const rows = SOURCES.flatMap(({ name, instrument }) => TIMEFRAMES.map((timeframe) => ({ source: name, instrument, timeframe, target_rows: TARGET_ROWS })));
  await request('/rest/v1/market_history_sync_state?on_conflict=source,instrument,timeframe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(rows)
  });
  return { configured: true, rows: rows.length };
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
