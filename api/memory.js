import { getLiveMemory } from '../lib/market-memory.js';

export const maxDuration = 10;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const live = await getLiveMemory();

    return res.status(200).json({
      ok: true,
      engine: 'SCALP-Ω Memory Layer v1',
      instrument: 'ETH-USDT-SWAP',
      persistence: {
        historical: 'SUPABASE',
        realtime: live.source
      },
      upstash: {
        configured: live.configured,
        key: live.key,
        snapshot: live.value
          ? {
              updatedAt: live.value.updatedAt,
              price: live.value.ticker?.last ?? null,
              candleTimeframes: Object.keys(live.value.shortCandles || {})
            }
          : null
      }
    });
  } catch (error) {
    return res.status(502).json({ ok: false, error: error?.message || String(error) });
  }
}
