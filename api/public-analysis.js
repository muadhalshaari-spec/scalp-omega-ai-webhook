export const maxDuration = 60;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const baseUrl = `https://${req.headers.host}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 50_000);

  try {
    const response = await fetch(`${baseUrl}/api/analyze?ts=${Date.now()}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal
    });

    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('X-SCALP-OMEGA-PUBLIC', 'true');

    return res.status(response.status).send(JSON.stringify(data ?? {
      ok: false,
      error: 'Upstream /api/analyze did not return JSON',
      upstreamStatus: response.status
    }, null, 2));
  } catch (error) {
    return res.status(502).json({
      ok: false,
      stage: 'PUBLIC_ANALYSIS_PROXY',
      error: error?.name === 'AbortError' ? 'Upstream analysis timed out' : error?.message || String(error)
    });
  } finally {
    clearTimeout(timeout);
  }
}
