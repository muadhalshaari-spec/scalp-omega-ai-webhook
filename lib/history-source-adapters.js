const INTERVALS = Object.freeze({ '1m': 60_000, '5m': 300_000, '15m': 900_000, '1H': 3_600_000, '4H': 14_400_000, '1D': 86_400_000 });
const OKX_BAR = Object.freeze({ '1m': '1m', '5m': '5m', '15m': '15m', '1H': '1H', '4H': '4H', '1D': '1D' });
const BINANCE_INTERVAL = Object.freeze({ '1m': '1m', '5m': '5m', '15m': '15m', '1H': '1h', '4H': '4h', '1D': '1d' });
const BYBIT_INTERVAL = Object.freeze({ '1m': '1', '5m': '5', '15m': '15', '1H': '60', '4H': '240', '1D': 'D' });

function finite(x) { return Number.isFinite(Number(x)); }
function normalize(source, instrument, timeframe, row, intervalMs) {
  const a = Array.isArray(row) ? row : null;
  const time = Number(row?.time ?? row?.startTime ?? row?.[0]);
  const open = Number(row?.open ?? row?.[1]);
  const high = Number(row?.high ?? row?.[2]);
  const low = Number(row?.low ?? row?.[3]);
  const close = Number(row?.close ?? row?.[4]);
  const volume = Number(row?.volume ?? row?.[5] ?? 0);
  if (![time, open, high, low, close, volume].every(finite)) return null;
  const now = Date.now();
  return { source, instrument, timeframe, time_ms: time, open, high, low, close, volume, confirmed: time + intervalMs <= now, observed_at: new Date().toISOString() };
}
async function json(url, signal) { const r = await fetch(url, { signal, headers: { Accept: 'application/json' }, cache: 'no-store' }); const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = null; } if (!r.ok) throw new Error(`History source HTTP ${r.status}: ${t.slice(0, 240)}`); return b; }

async function okx({ instrument, timeframe, before, limit = 1000, signal }) {
  const p = new URLSearchParams({ instId: instrument, bar: OKX_BAR[timeframe], limit: String(Math.min(1000, limit)) });
  if (finite(before)) p.set('after', String(before));
  const b = await json('https://www.okx.com/api/v5/market/history-candles?' + p, signal);
  const rows = (b?.data || []).map((x) => normalize('OKX', instrument, timeframe, x, INTERVALS[timeframe])).filter(Boolean);
  return { rows: rows.sort((a, z) => a.time_ms - z.time_ms), nextCursorMs: rows.length ? Math.min(...rows.map((x) => x.time_ms)) - 1 : null };
}
async function binance({ instrument, timeframe, before, limit = 1000, signal }) {
  const p = new URLSearchParams({ symbol: instrument, interval: BINANCE_INTERVAL[timeframe], limit: String(Math.min(1000, limit)) });
  if (finite(before)) p.set('endTime', String(before));
  const b = await json('https://fapi.binance.com/fapi/v1/klines?' + p, signal);
  const rows = (Array.isArray(b) ? b : []).map((x) => normalize('BINANCE', instrument, timeframe, x, INTERVALS[timeframe])).filter(Boolean);
  return { rows: rows.sort((a, z) => a.time_ms - z.time_ms), nextCursorMs: rows.length ? Math.min(...rows.map((x) => x.time_ms)) - 1 : null };
}
async function bybit({ instrument, timeframe, before, limit = 1000, signal }) {
  const p = new URLSearchParams({ category: 'linear', symbol: instrument, interval: BYBIT_INTERVAL[timeframe], limit: String(Math.min(1000, limit)) });
  if (finite(before)) p.set('end', String(before));
  const b = await json('https://api.bybit.com/v5/market/kline?' + p, signal);
  const rows = (b?.result?.list || []).map((x) => normalize('BYBIT', instrument, timeframe, x, INTERVALS[timeframe])).filter(Boolean);
  return { rows: rows.sort((a, z) => a.time_ms - z.time_ms), nextCursorMs: rows.length ? Math.min(...rows.map((x) => x.time_ms)) - 1 : null };
}
async function deribit({ instrument, timeframe, before, limit = 1000, signal }) {
  const end = finite(before) ? Number(before) : Date.now();
  const start = end - INTERVALS[timeframe] * Math.min(limit, 1000);
  const p = new URLSearchParams({ instrument_name: instrument, start_timestamp: String(start), end_timestamp: String(end), resolution: timeframe === '1D' ? '1D' : String(INTERVALS[timeframe] / 60_000) });
  const b = await json('https://www.deribit.com/api/v2/public/get_tradingview_chart_data?' + p, signal);
  const result = b?.result || {};
  const rows = (result.ticks || result.t || []).map((time, i) => normalize('DERIBIT', instrument, timeframe, { time, open: result.open?.[i] ?? result.o?.[i], high: result.high?.[i] ?? result.h?.[i], low: result.low?.[i] ?? result.l?.[i], close: result.close?.[i] ?? result.c?.[i], volume: result.volume?.[i] ?? result.v?.[i] ?? 0 }, INTERVALS[timeframe])).filter(Boolean);
  return { rows: rows.sort((a, z) => a.time_ms - z.time_ms), nextCursorMs: rows.length ? Math.min(...rows.map((x) => x.time_ms)) - 1 : null };
}

export async function fetchHistoryBatch({ source, instrument, timeframe, before, limit = 1000, signal }) {
  if (!INTERVALS[timeframe]) throw new Error(`Unsupported timeframe ${timeframe}`);
  if (source === 'OKX') return okx({ instrument, timeframe, before, limit, signal });
  if (source === 'BINANCE') return binance({ instrument, timeframe, before, limit, signal });
  if (source === 'BYBIT') return bybit({ instrument, timeframe, before, limit, signal });
  if (source === 'DERIBIT') return deribit({ instrument, timeframe, before, limit, signal });
  throw new Error(`Unsupported source ${source}`);
}
