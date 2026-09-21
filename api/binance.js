import { getBinanceFullMarketData } from '../lib/binance.js';

export const maxDuration = 60;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55_000);

  try {
    const data = await getBinanceFullMarketData({ signal: controller.signal });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    return res.status(200).json({
      ok: true,
      engine: 'SCALP-Ω Binance Full Market Data Adapter v2',
      decisionAuthority: 'TITAN_DETERMINISTIC',
      decisionPolicy: 'BINANCE_DATA_ONLY_NO_DECISION',
      ...data
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      engine: 'SCALP-Ω Binance Full Market Data Adapter v2',
      error: error?.name === 'AbortError'
        ? 'Binance data collection timed out'
        : error?.message || String(error)
    });
  } finally {
    clearTimeout(timeout);
  }
}
