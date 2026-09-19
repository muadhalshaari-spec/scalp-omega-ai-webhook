import { deribitConfigured, getDeribitMarket, testDeribitCredentials } from '../lib/deribit.js';

export const maxDuration = 20;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  if (!deribitConfigured()) {
    return res.status(503).json({
      ok: false,
      source: 'DERIBIT',
      error: 'DERIBIT_CLIENT_ID/DERIBIT_CLIENT_SECRET are not configured'
    });
  }

  try {
    const instrument = typeof req.query?.instrument === 'string'
      ? req.query.instrument.trim().toUpperCase()
      : 'ETH-PERPETUAL';

    const [market, auth] = await Promise.all([
      getDeribitMarket(instrument),
      testDeribitCredentials()
    ]);

    return res.status(200).json({
      ok: true,
      engine: 'SCALP-Ω Deribit Market Context v1',
      source: 'DERIBIT',
      instrument,
      authenticated: auth.authenticated,
      market,
      account: {
        currency: auth.currency,
        accountType: auth.accountType,
        equity: auth.equity,
        availableFunds: auth.availableFunds
      },
      fetchedAt: new Date().toISOString(),
      disclosure: 'Deribit data is provided by Deribit. This endpoint uses credentials from Vercel environment variables and does not return client secrets or access tokens.'
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      source: 'DERIBIT',
      error: error?.message || String(error)
    });
  }
}
