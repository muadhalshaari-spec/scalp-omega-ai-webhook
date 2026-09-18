import crypto from 'node:crypto';

export const maxDuration = 60;

function parseBody(req) {
  if (req?.body && typeof req.body === 'object') return req.body;
  if (typeof req?.body === 'string') {
    try { return JSON.parse(req.body); } catch { return { raw: req.body }; }
  }
  return {};
}

function authorized(req) {
  const expected = process.env.TV_WEBHOOK_SECRET;
  if (!expected) return { configured: false, ok: true };

  const supplied = String(
    req.headers?.['x-tradingview-secret'] ??
    req.headers?.['x-webhook-secret'] ??
    ''
  );

  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  return { configured: true, ok };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      service: 'SCALP-Ω TradingView Webhook',
      endpoint: '/api/webhook',
      accepts: ['POST'],
      analysisEndpoint: '/api/analyze',
      authentication: process.env.TV_WEBHOOK_SECRET ? 'configured' : 'not_configured'
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const auth = authorized(req);
  if (!auth.ok) {
    return res.status(401).json({ ok: false, error: 'Invalid webhook secret' });
  }

  const alert = parseBody(req);
  const baseUrl = `https://${req.headers.host}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55_000);

  try {
    const response = await fetch(`${baseUrl}/api/analyze?ts=${Date.now()}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal
    });

    const text = await response.text();
    let analysis = null;
    try { analysis = JSON.parse(text); } catch {}

    if (!response.ok || !analysis?.ok) {
      return res.status(502).json({
        ok: false,
        stage: 'ANALYSIS',
        webhookAuthenticated: auth.configured,
        alert,
        error: analysis?.error || text.slice(0, 500)
      });
    }

    return res.status(200).json({
      ok: true,
      service: 'SCALP-Ω TradingView Webhook',
      webhookAuthenticated: auth.configured,
      receivedAt: new Date().toISOString(),
      alert,
      decision: analysis.institutionalDecision ?? analysis.analysis?.decision ?? 'NO_TRADE',
      analysis
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      stage: 'ANALYSIS',
      webhookAuthenticated: auth.configured,
      error: error?.name === 'AbortError'
        ? 'Analysis request timed out after 55 seconds'
        : error?.message || String(error)
    });
  } finally {
    clearTimeout(timeout);
  }
}
