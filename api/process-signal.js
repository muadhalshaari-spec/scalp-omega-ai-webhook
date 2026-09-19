import { verifySignature } from '@upstash/qstash/nextjs';
import { insertSignalEvent, supabaseConfigured } from '../lib/supabase.js';

export const maxDuration = 60;
export const config = { api: { bodyParser: false } };

async function handler(req, res) {
  let stage = 'start';

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    // verifySignature() handles the raw request body and exposes the parsed
    // payload on req.body. Do not read the request stream again here.
    stage = 'read_body';
    const body = req.body && typeof req.body === 'object'
      ? req.body
      : JSON.parse(String(req.body || '{}'));

    const base = `https://${req.headers.host}`;

    stage = 'institutional';
    const r = await fetch(
      `${base}/api/institutional?ts=${Date.now()}`,
      { headers: { Accept: 'application/json' }, cache: 'no-store' }
    );

    const t = await r.text();
    let data = null;
    try { data = JSON.parse(t); } catch {}

    if (!r.ok || !data?.ok) {
      return res.status(502).json({
        ok: false,
        error: data?.error || t.slice(0, 500),
        stage
      });
    }

    const processedAt = new Date().toISOString();
    const alert = body.alert || body;

    let persistence = { configured: false };

    if (supabaseConfigured()) {
      stage = 'supabase_insert';
      persistence = await insertSignalEvent({
        job_id: body.jobId || null,
        source: body.source || 'TRADINGVIEW',
        alert,
        institutional: data.institutional || null,
        status: 'PROCESSED',
        received_at: body.receivedAt || null,
        processed_at: processedAt
      });
    }

    return res.status(200).json({
      ok: true,
      processedAt,
      alert,
      pipeline: 'INSTITUTIONAL_EXECUTION',
      institutional: data.institutional || null,
      persistence
    });
  } catch (e) {
    console.error('process-signal failed', {
      stage,
      error: e?.message || String(e)
    });

    return res.status(502).json({
      ok: false,
      error: e?.message || String(e),
      stage
    });
  }
}

export default verifySignature(handler);
