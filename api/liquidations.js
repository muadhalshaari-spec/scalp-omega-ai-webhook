import crypto from 'node:crypto';
import { getRecentLiquidations } from '../lib/supabase.js';

export const maxDuration = 10;

function authorized(req) {
  const expected = process.env.LIQUIDATION_CRON_SECRET;
  if (!expected) return false;
  const supplied = String(req.headers?.['x-liquidation-secret'] || '');
  const a = Buffer.from(supplied), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok:false, error:'Method not allowed' });
  if (!authorized(req)) return res.status(401).json({ ok:false, error:'Liquidation read secret not configured or invalid' });
  try {
    const result = await getRecentLiquidations({ limit: 200, sinceMs: 60 * 60 * 1000 });
    return res.status(200).json({
      ok:true,
      source:'SUPABASE_PERSISTED_BINANCE_FORCE_ORDER_STREAM',
      instrument:'ETHUSDT',
      count:result.rows.length,
      latest:result.rows[0] || null,
      rows:result.rows
    });
  } catch (e) {
    return res.status(502).json({ ok:false, error:e?.message || String(e) });
  }
}
