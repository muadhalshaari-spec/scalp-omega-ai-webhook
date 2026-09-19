import { fredConfigured, getFredMacroSnapshot, fredDisclosure } from '../lib/fred.js';

export const maxDuration = 30;
const MAX_SERIES = 10;

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ ok: false, error: 'Method not allowed' }); }
  if (!fredConfigured()) return res.status(503).json({ ok: false, source: 'FRED', error: 'FRED_API_KEY is not configured' });
  const raw = typeof req.query?.series === 'string' ? req.query.series : '';
  const series = raw ? raw.split(',').map((id) => id.trim()).filter(Boolean).slice(0, MAX_SERIES) : undefined;
  try {
    const macro = await getFredMacroSnapshot(series, { limit: 12 });
    const statusCode = macro.status === 'UNAVAILABLE' ? 502 : 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    res.setHeader('X-FRED-Source', 'FRED API');
    return res.status(statusCode).json({ ok: macro.status !== 'UNAVAILABLE', engine: 'SCALP-Ω FRED Macro Context v1', source: macro.source, provider: macro.provider, status: macro.status, fetchedAt: macro.fetchedAt, series: macro.series, errors: macro.errors, disclosure: fredDisclosure() });
  } catch (error) {
    return res.status(502).json({ ok: false, source: 'FRED', error: error?.message || String(error) });
  }
}
