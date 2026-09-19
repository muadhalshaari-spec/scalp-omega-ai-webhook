const FRED_BASE_URL = 'https://api.stlouisfed.org/fred';

export const FRED_SERIES = Object.freeze({
  FEDFUNDS: 'Federal Funds Effective Rate',
  CPIAUCSL: 'Consumer Price Index for All Urban Consumers: All Items',
  UNRATE: 'Unemployment Rate',
  DGS2: 'Market Yield on U.S. Treasury Securities at 2-Year Constant Maturity',
  DGS10: 'Market Yield on U.S. Treasury Securities at 10-Year Constant Maturity',
  DFII10: 'Market Yield on U.S. Treasury Securities at 10-Year Constant Maturity, Inflation-Indexed',
  VIXCLS: 'CBOE Volatility Index: VIX',
  DTWEXBGS: 'Nominal Broad U.S. Dollar Index',
  SOFR: 'Secured Overnight Financing Rate',
  BAMLH0A0HYM2: 'ICE BofA US High Yield Index Option-Adjusted Spread'
});

const ALLOWED_SERIES = new Set(Object.keys(FRED_SERIES));

function getApiKey() { return process.env.FRED_API_KEY || ''; }

function parseObservation(row) {
  const value = Number(row?.value);
  return { date: row?.date || null, value: Number.isFinite(value) ? value : null };
}

export function fredConfigured() { return getApiKey().length === 32; }

export function allowedFredSeries(seriesIds) {
  const requested = Array.isArray(seriesIds) ? seriesIds : [];
  const normalized = requested.map((id) => String(id).trim().toUpperCase()).filter((id) => ALLOWED_SERIES.has(id));
  return normalized.length ? [...new Set(normalized)] : Object.keys(FRED_SERIES);
}

export async function getFredSeries(seriesId, options = {}) {
  if (!fredConfigured()) throw new Error('FRED_API_KEY is not configured');
  const id = String(seriesId).trim().toUpperCase();
  if (!ALLOWED_SERIES.has(id)) throw new Error('FRED series is not allowed: ' + id);
  const limit = Math.min(Math.max(Number(options.limit) || 12, 1), 50);
  const params = new URLSearchParams({ series_id: id, api_key: getApiKey(), file_type: 'json', limit: String(limit), sort_order: 'desc' });
  const response = await fetch(FRED_BASE_URL + '/series/observations?' + params.toString(), { headers: { Accept: 'application/json' }, cache: 'no-store' });
  const body = await response.text();
  let data = null;
  try { data = JSON.parse(body); } catch {}
  if (!response.ok || !Array.isArray(data?.observations)) {
    throw new Error('FRED HTTP ' + response.status + ': ' + (data?.error_message || body.slice(0, 200)));
  }
  return { id, title: FRED_SERIES[id], observations: data.observations.map(parseObservation).filter((x) => x.value !== null), realtimeStart: data.realtime_start || null, realtimeEnd: data.realtime_end || null };
}

export async function getFredMacroSnapshot(seriesIds, options = {}) {
  const ids = allowedFredSeries(seriesIds);
  const results = await Promise.allSettled(ids.map((id) => getFredSeries(id, options)));
  const series = {};
  const errors = {};
  results.forEach((result, index) => {
    const id = ids[index];
    if (result.status === 'fulfilled') series[id] = result.value;
    else errors[id] = result.reason?.message || String(result.reason);
  });
  return { source: 'FRED', provider: 'Federal Reserve Bank of St. Louis', fetchedAt: new Date().toISOString(), status: Object.keys(series).length ? (Object.keys(errors).length ? 'PARTIAL' : 'OK') : 'UNAVAILABLE', series, errors };
}

export function fredDisclosure() {
  return 'This product uses the FRED API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.';
}
