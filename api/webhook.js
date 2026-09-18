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
      analysisEndpoint: '/api/institutional',
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
    const institutionalResponse = await fetch(`${baseUrl}/api/institutional?ts=${Date.now()}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal
    });

    const institutionalText = await institutionalResponse.text();
    let institutional = null;
    try { institutional = JSON.parse(institutionalText); } catch {}

    if (!institutionalResponse.ok || !institutional?.ok) {
      return res.status(502).json({
        ok: false,
        stage: 'INSTITUTIONAL',
        webhookAuthenticated: auth.configured,
        alert,
        error: institutional?.error || institutionalText.slice(0, 500)
      });
    }

    let analysis = null;
    let aiStatus = 'not_configured';

    if (process.env.OPENAI_API_KEY) {
      aiStatus = 'configured';
      const response = await fetch(`${baseUrl}/api/analyze?ts=${Date.now()}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal
      });
      const text = await response.text();
      try { analysis = JSON.parse(text); } catch {}
      if (!response.ok || !analysis?.ok) aiStatus = 'error';
    }

    return res.status(200).json({
      ok: true,
      service: 'SCALP-Ω TradingView Webhook',
      webhookAuthenticated: auth.configured,
      receivedAt: new Date().toISOString(),
      alert,
      decision: institutional.institutional?.decision ?? 'NO_TRADE',
      institutional,
      aiStatus,
      analysis
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      stage: 'WEBHOOK',
      webhookAuthenticated: auth.configured,
      error: error?.name === 'AbortError'
        ? 'Webhook analysis timed out after 55 seconds'
        : error?.message || String(error)
    });
  } finally {
    clearTimeout(timeout);
  }
}