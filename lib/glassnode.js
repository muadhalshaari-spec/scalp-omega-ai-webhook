const GLASSNODE_BASE_URL = 'https://api.glassnode.com/v1/metrics';

const DEFAULT_METRICS = [
  { key: 'priceUsdClose', path: 'market/price_usd_close' },
  { key: 'activeAddresses', path: 'addresses/active_count' },
  { key: 'newAddresses', path: 'addresses/new_non_zero_count' },
  { key: 'sopr', path: 'indicators/sopr' },
  { key: 'nupl', path: 'indicators/net_unrealized_profit_loss' }
];

function apiKey() {
  return (process.env.GLASSNODE_API_KEY || '').trim();
}

export function glassnodeConfigured() {
  return Boolean(apiKey());
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function fetchMetric(metric, { asset = 'ETH', interval = '24h', since, until, signal } = {}) {
  const key = apiKey();
  if (!key) throw new Error('GLASSNODE_API_KEY is not configured');

  const url = new URL(GLASSNODE_BASE_URL + '/' + metric.path);
  url.searchParams.set('a', asset);
  url.searchParams.set('i', interval);
  if (since != null) url.searchParams.set('s', String(since));
  if (until != null) url.searchParams.set('u', String(until));

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-Api-Key': key,
      'User-Agent': 'SCALP-Omega-Glassnode/1.0'
    },
    cache: 'no-store',
    signal
  });

  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}

  if (!response.ok) {
    throw new Error(`Glassnode HTTP ${response.status}: ${typeof data === 'object' ? JSON.stringify(data).slice(0, 300) : text.slice(0, 300)}`);
  }

  if (!Array.isArray(data)) {
    throw new Error('Glassnode returned a non-array metric payload');
  }

  return data
    .map(row => ({
      t: number(row?.t),
      v: number(row?.v)
    }))
    .filter(row => row.t != null && row.v != null)
    .sort((a, b) => a.t - b.t);
}

function trend(rows, lookback = 7) {
  if (!rows || rows.length < 2) return null;
  const recent = rows.slice(-Math.min(lookback, rows.length));
  const first = recent[0]?.v;
  const last = recent.at(-1)?.v;
  if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) return null;
  return (last - first) / Math.abs(first);
}

export async function getGlassnodeEthContext({
  asset = 'ETH',
  interval = '24h',
  days = 90,
  signal
} = {}) {
  if (!glassnodeConfigured()) {
    return {
      configured: false,
      source: 'GLASSNODE',
      asset,
      interval,
      metrics: {},
      quality: { available: false, reason: 'GLASSNODE_API_KEY is not configured' }
    };
  }

  const until = Math.floor(Date.now() / 1000);
  const since = until - Math.max(1, days) * 86400;

  const settled = await Promise.allSettled(
    DEFAULT_METRICS.map(async metric => [metric.key, await fetchMetric(metric, { asset, interval, since, until, signal })])
  );

  const metrics = {};
  const errors = {};
  for (let i = 0; i < settled.length; i += 1) {
    const key = DEFAULT_METRICS[i].key;
    const item = settled[i];
    if (item.status === 'fulfilled') metrics[key] = item.value;
    else errors[key] = item.reason?.message || String(item.reason);
  }

  const latest = Object.fromEntries(
    Object.entries(metrics).map(([key, rows]) => [key, rows.at(-1)?.v ?? null])
  );

  return {
    configured: true,
    source: 'GLASSNODE',
    asset,
    interval,
    latest,
    trends: {
      activeAddresses: trend(metrics.activeAddresses),
      newAddresses: trend(metrics.newAddresses),
      sopr: trend(metrics.sopr),
      nupl: trend(metrics.nupl)
    },
    metrics,
    quality: {
      available: Object.keys(metrics).length > 0,
      metricCount: Object.keys(metrics).length,
      requestedMetricCount: DEFAULT_METRICS.length,
      errors
    }
  };
}

export async function testGlassnode() {
  const context = await getGlassnodeEthContext({ days: 3 });
  return {
    configured: context.configured,
    source: context.source,
    asset: context.asset,
    metricCount: context.quality.metricCount || 0,
    available: context.quality.available,
    errors: context.quality.errors || {}
  };
}
