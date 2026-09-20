import crypto from 'node:crypto';
import { insertLiquidationEvents } from '../lib/supabase.js';

export const maxDuration = 10;

function authorized(req) {
  const expected = process.env.LIQUIDATION_CRON_SECRET;
  if (!expected) return false;
  const supplied = String(req.headers?.['x-liquidation-secret'] || '');
  const a = Buffer.from(supplied), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function fetchLiquidations() {
  const url = 'https://fapi.binance.com/fapi/v1/allForceOrders?symbol=ETHUSDT&limit=100';
  const r = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'SCALP-Omega-Liquidation-Poller/1.0' },
    cache: 'no-store'
  });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  if (!r.ok || !Array.isArray(data)) throw new Error(`Binance liquidation feed unavailable: HTTP ${r.status}`);
  return data.map(x => ({
    id: `binance:${x.symbol || 'ETHUSDT'}:${x.orderId || x.time}:${x.price || 0}`,
    event_ts: new Date(Number(x.time)).toISOString(),
    instrument: 'ETHUSDT',
    price: Number(x.price),
    qty: Number(x.origQty || 0),
    notional: Number(x.averagePrice || x.price) * Number(x.origQty || 0),
    side: String(x.side || '').toUpperCase(),
    source: 'BINANCE_FORCE_ORDER',
    raw: x
  })).filter(x => Number.isFinite(x.price) && Number.isFinite(x.qty) && Number.isFinite(Date.parse(x.event_ts)));
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ ok:false, error:'Method not allowed' });
  if (!authorized(req)) return res.status(401).json({ ok:false, error:'Liquidation poll secret not configured or invalid' });
  try {
    const events = await fetchLiquidations();
    const persistence = await insertLiquidationEvents(events);
    return res.status(200).json({
      ok:true,
      source:'BINANCE_FORCE_ORDER',
      instrument:'ETHUSDT',
      count:events.length,
      persistence
    });
  } catch (e) {
    return res.status(502).json({ ok:false, error:e?.message || String(e) });
  }
}
