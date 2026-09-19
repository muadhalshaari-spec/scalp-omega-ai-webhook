import { getGlassnodeEthContext } from '../lib/glassnode.js';

export const maxDuration = 30;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);

  try {
    const context = await getGlassnodeEthContext({
      asset: 'ETH',
      interval: '24h',
      days: 90,
      signal: controller.signal
    });

    return res.status(context.quality.available ? 200 : 503).json({
      ok: context.quality.available,
      engine: 'SCALP-Ω Glassnode On-chain Context v1',
      ...context
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      source: 'GLASSNODE',
      error: error?.name === 'AbortError'
        ? 'Glassnode request timed out'
        : error?.message || String(error)
    });
  } finally {
    clearTimeout(timeout);
  }
}
