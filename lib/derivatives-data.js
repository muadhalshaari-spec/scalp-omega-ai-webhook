const OKX_BASE = 'https://www.okx.com';

function toNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toTimestamp(row) {
  if (Array.isArray(row)) return toNumber(row[0]);
  return toNumber(row?.ts ?? row?.time ?? row?.timestamp ?? row?.fundingTime);
}

function sortUnique(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const ts = toTimestamp(row);
    if (Number.isFinite(ts)) map.set(String(ts), row);
  }
  return [...map.values()].sort((a, b) => toTimestamp(a) - toTimestamp(b));
}

function parseOpenInterestRow(row) {
  if (Array.isArray(row)) {
    return {
      ts: toTimestamp(row),
      oi: toNumber(row[1], 0),
      oiCcy: toNumber(row[2], null)
    };
  }
  return {
    ts: toTimestamp(row),
    oi: toNumber(row?.oi ?? row?.openInterest ?? row?.open_interest, 0),
    oiCcy: toNumber(row?.oiCcy ?? row?.oiCurrency ?? row?.openInterestCurrency, null)
  };
}

function parseFundingRow(row) {
  return {
    ts: toNumber(row?.fundingTime ?? row?.ts ?? row?.time),
    fundingRate: toNumber(row?.fundingRate ?? row?.realizedRate, 0),
    realizedRate: toNumber(row?.realizedRate, null),
    nextFundingTime: toNumber(row?.nextFundingTime, null)
  };
}

function parseLongShortRow(row) {
  if (Array.isArray(row)) {
    return { ts: toTimestamp(row), longShortRatio: toNumber(row[1], null) };
  }
  return {
    ts: toTimestamp(row),
    longShortRatio: toNumber(row?.longShortRatio ?? row?.longShortAccountRatio ?? row?.ratio, null)
  };
}

function parseTakerRow(row) {
  if (Array.isArray(row)) {
    // OKX Rubik contract taker-volume series is [timestamp, sellVolume, buyVolume].
    return {
      ts: toTimestamp(row),
      sellVol: toNumber(row[1], 0),
      buyVol: toNumber(row[2], 0)
    };
  }
  return {
    ts: toTimestamp(row),
    sellVol: toNumber(row?.sellVol ?? row?.sellVolume ?? row?.sell, 0),
    buyVol: toNumber(row?.buyVol ?? row?.buyVolume ?? row?.buy, 0)
  };
}

async function fetchJson(url, { signal } = {}) {
  const response = await fetch(url, {
    cache: 'no-store',
    signal,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'SCALP-Omega-Derivatives/2.0'
    }
  });
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  if (!response.ok || data?.code !== '0') {
    throw new Error(`OKX HTTP ${response.status}: ${data?.msg || text.slice(0, 300)}`);
  }
  return data;
}

function query(params) {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value != null && value !== '') q.set(key, String(value));
  }
  return q.toString();
}

async function fetchPaged({
  path,
  baseParams,
  limit = 100,
  maxPages = 1,
  cursorField = null,
  cursorDirection = null,
  signal
}) {
  const rows = [];
  let cursor = null;

  for (let page = 0; page < maxPages; page += 1) {
    const params = { ...baseParams, limit };
    if (cursor != null && cursorField) params[cursorField] = cursor;

    const data = await fetchJson(`${OKX_BASE}${path}?${query(params)}`, { signal });
    const pageRows = Array.isArray(data.data) ? data.data : [];
    if (!pageRows.length) break;

    rows.push(...pageRows);

    const timestamps = pageRows.map(toTimestamp).filter(Number.isFinite);
    const edge = timestamps.length ? (
      cursorDirection === 'older'
        ? Math.min(...timestamps)
        : Math.max(...timestamps)
    ) : null;

    if (!Number.isFinite(edge) || String(edge) === String(cursor)) break;
    if (baseParams.begin != null && edge <= Number(baseParams.begin)) break;
    cursor = edge;

    if (pageRows.length < limit) break;
  }

  return sortUnique(rows);
}

async function fetchFundingHistory({ instId, signal, limit = 100 }) {
  const rows = await fetchPaged({
    path: '/api/v5/public/funding-rate-history',
    baseParams: { instId },
    limit: Math.min(400, limit),
    maxPages: Math.max(1, Math.ceil(limit / 100)),
    cursorField: 'after',
    cursorDirection: 'older',
    signal
  });
  return rows.map(parseFundingRow).filter(x => Number.isFinite(x.ts));
}

async function fetchOpenInterestHistory({ instId, begin, end, signal, limit = 1440 }) {
  const params = { instId, period: '1H' };
  if (begin != null) params.begin = begin;
  if (end != null) params.end = end;

  // The endpoint is available as a public Rubik data series. Keep requests bounded;
  // if a requested range exceeds the endpoint page size, use the endpoint's end cursor.
  const pages = await fetchPaged({
    path: '/api/v5/rubik/stat/contracts/open-interest-history',
    baseParams: params,
    limit: Math.min(100, limit),
    maxPages: Math.min(20, Math.max(1, Math.ceil(limit / 100))),
    cursorField: 'end',
    cursorDirection: 'older',
    signal
  });

  return pages.map(parseOpenInterestRow).filter(x => Number.isFinite(x.ts));
}

async function fetchLongShortContract({ instId, begin, end, signal, limit = 1440 }) {
  const params = { instId, period: '1H' };
  if (begin != null) params.begin = begin;
  if (end != null) params.end = end;
  try {
    const rows = await fetchPaged({
      path: '/api/v5/rubik/stat/contracts/long-short-account-ratio-contract',
      baseParams: params,
      limit: Math.min(1440, limit),
      maxPages: 1,
      signal
    });
    return rows.map(parseLongShortRow).filter(x => Number.isFinite(x.ts) && Number.isFinite(x.longShortRatio));
  } catch {
    return [];
  }
}

async function fetchLongShortFallback({ ccy, begin, end, signal }) {
  const params = { ccy, period: '1D' };
  if (begin != null) params.begin = begin;
  if (end != null) params.end = end;
  try {
    const rows = await fetchPaged({
      path: '/api/v5/rubik/stat/contracts/long-short-account-ratio',
      baseParams: params,
      limit: 180,
      maxPages: 2,
      signal
    });
    return rows.map(parseLongShortRow).filter(x => Number.isFinite(x.ts) && Number.isFinite(x.longShortRatio));
  } catch {
    return [];
  }
}

async function fetchTakerContract({ instId, begin, end, signal, limit = 1440 }) {
  const params = { instId, period: '1H' };
  if (begin != null) params.begin = begin;
  if (end != null) params.end = end;
  try {
    const rows = await fetchPaged({
      path: '/api/v5/rubik/stat/taker-volume-contract',
      baseParams: params,
      limit: Math.min(1440, limit),
      maxPages: 1,
      signal
    });
    return rows.map(parseTakerRow).filter(x => Number.isFinite(x.ts));
  } catch {
    return [];
  }
}

async function fetchTakerFallback({ ccy, begin, end, signal }) {
  const params = { ccy, instType: 'CONTRACTS', period: '1D' };
  if (begin != null) params.begin = begin;
  if (end != null) params.end = end;
  try {
    const rows = await fetchPaged({
      path: '/api/v5/rubik/stat/taker-volume',
      baseParams: params,
      limit: 180,
      maxPages: 2,
      signal
    });
    return rows.map(parseTakerRow).filter(x => Number.isFinite(x.ts));
  } catch {
    return [];
  }
}

function enrichFundingSchedule(fundingHistory, currentFunding = {}, includeFutureSchedule = false) {
  const sorted = sortUnique(fundingHistory);
  return sorted.map((row) => ({
    ...row,
    // In live mode the current OKX snapshot supplies nextFundingTime.
    // In backtests we intentionally do not infer the next event from a future
    // historical row because that would leak future information into the signal.
    nextFundingTime: includeFutureSchedule
      ? row.nextFundingTime ?? toNumber(currentFunding.nextFundingTime, null)
      : row.nextFundingTime ?? null
  }));
}

export async function fetchDerivativeData({
  instId = 'ETH-USDT-SWAP',
  begin = null,
  end = null,
  mode = 'live',
  signal
} = {}) {
  const ccy = instId.split('-')[0];

  const currentFundingPromise = mode === 'live'
    ? fetchJson(
        `${OKX_BASE}/api/v5/public/funding-rate?${query({ instId })}`,
        { signal }
      ).catch(() => ({ data: [] }))
    : Promise.resolve({ data: [] });

  const currentOiPromise = mode === 'live'
    ? fetchJson(
        `${OKX_BASE}/api/v5/public/open-interest?${query({ instType: 'SWAP', instId })}`,
        { signal }
      ).catch(() => ({ data: [] }))
    : Promise.resolve({ data: [] });

  const [currentFundingData, currentOiData, fundingHistoryRaw, oiHistoryRaw, longShortRaw, longShortFallbackRaw, takerRaw, takerFallbackRaw] =
    await Promise.all([
      currentFundingPromise,
      currentOiPromise,
      fetchFundingHistory({ instId, signal, limit: mode === 'backtest' ? 400 : 100 }).catch(() => []),
      fetchOpenInterestHistory({ instId, begin, end, signal, limit: mode === 'backtest' ? 1600 : 200 }).catch(() => []),
      fetchLongShortContract({ instId, begin, end, signal, limit: 1440 }),
      fetchLongShortFallback({ ccy, begin, end, signal }),
      fetchTakerContract({ instId, begin, end, signal, limit: 1440 }),
      fetchTakerFallback({ ccy, begin, end, signal })
    ]);

  const fundingCurrent = currentFundingData.data?.[0] || {};
  const oiCurrent = currentOiData.data?.[0] || null;
  const longShort = sortUnique(longShortRaw.length ? longShortRaw : longShortFallbackRaw);
  const takerVolume = sortUnique(takerRaw.length ? takerRaw : takerFallbackRaw);
  const fundingHistory = enrichFundingSchedule(fundingHistoryRaw, fundingCurrent, mode === 'live');
  const oiHistory = sortUnique(oiHistoryRaw);

  return {
    current: {
      openInterest: oiCurrent ? {
        oi: toNumber(oiCurrent.oi, 0),
        oiCcy: toNumber(oiCurrent.oiCcy, null),
        ts: toNumber(oiCurrent.ts, null)
      } : null,
      fundingRate: toNumber(fundingCurrent.fundingRate, null),
      fundingTime: toNumber(fundingCurrent.fundingTime, null),
      nextFundingTime: toNumber(fundingCurrent.nextFundingTime, null),
      nextFundingRate: toNumber(fundingCurrent.nextFundingRate, null),
      settState: fundingCurrent.settState ?? null
    },
    history: {
      oi: oiHistory,
      funding: fundingHistory,
      longShort,
      takerVolume
    },
    quality: {
      oi: { count: oiHistory.length, available: oiHistory.length > 0, source: 'OKX Rubik open-interest-history' },
      funding: { count: fundingHistory.length, available: fundingHistory.length > 0, source: 'OKX public funding-rate-history' },
      longShort: {
        count: longShort.length,
        available: longShort.length > 0,
        source: longShortRaw.length ? 'OKX Rubik contract long-short ratio' : 'OKX Rubik exchange long-short ratio fallback'
      },
      takerVolume: {
        count: takerVolume.length,
        available: takerVolume.length > 0,
        source: takerRaw.length ? 'OKX Rubik contract taker volume' : 'OKX Rubik taker volume fallback'
      }
    }
  };
}
