import { upstashConfigured, redisGetJson, redisSetJson } from './upstash.js';
import { insertMarketSnapshot, upsertMarketCandles } from './supabase.js';

const LIVE_KEY = 'scalp-omega:ETH-USDT-SWAP:live';
const LIVE_TTL_SECONDS = 120;

function finite(v) {
  return Number.isFinite(Number(v)) ? Number(v) : null;
}

function normalizeCandle(c) {
  if (!c) return null;
  const row = {
    time: finite(c.time ?? c[0]),
    open: finite(c.open ?? c[1]),
    high: finite(c.high ?? c[2]),
    low: finite(c.low ?? c[3]),
    close: finite(c.close ?? c[4]),
    volume: finite(c.volume ?? c[5]) ?? 0,
    confirmed: c.confirmed === true || c.confirmed === '1' || c[8] === '1'
  };
  return Number.isFinite(row.time) &&
    [row.open, row.high, row.low, row.close, row.volume].every(Number.isFinite)
    ? row
    : null;
}

function compactLive(dataFeed, liveData, previous = null) {
  const m = dataFeed.market || {};
  const t = liveData?.ticker || {};
  const price = finite(t.last ?? t.lastPrice ?? t.lastPx ?? m.price);
  const previousPrice = finite(previous?.ticker?.last);
  return {
    source: liveData?.source || dataFeed.source || null,
    instrument: dataFeed.instrument || 'ETH-USDT-SWAP',
    updatedAt: liveData?.updatedAt || new Date().toISOString(),
    ticker: {
      last: price,
      bid: finite(t.bid ?? t.bidPx),
      ask: finite(t.ask ?? t.askPx),
      markPrice: finite(t.markPrice ?? t.markPx)
    },
    latestTrade: liveData?.latestTrade || null,
    orderBook: liveData?.orderBook || null,
    shortCandles: Object.fromEntries(
      Object.entries(m.candlesByTf || {}).map(([tf, candles]) => [
        tf,
        (Array.isArray(candles) ? candles : [])
          .filter((c) => c.confirmed)
          .slice(-20)
      ])
    ),
    derivatives: {
      openInterest: finite(m.openInterest),
      fundingRate: finite(m.fundingRate),
      nextFundingRate: finite(m.nextFundingRate)
    },
    delta: {
      price: price != null && previousPrice != null ? price - previousPrice : null,
      pricePct: price != null && previousPrice ? ((price - previousPrice) / previousPrice) * 100 : null
    }
  };
}

export async function getLiveMemory({ signal } = {}) {
  const r = await redisGetJson(LIVE_KEY, { signal });
  return {
    configured: r.configured,
    source: 'UPSTASH_REDIS',
    key: LIVE_KEY,
    value: r.value
  };
}

export async function persistMarketMemory(dataFeed, liveData, { signal } = {}) {
  const result = {
    supabase: { configured: false, persisted: false, candles: 0, snapshot: false },
    upstash: { configured: false, stored: false }
  };

  const source = String(dataFeed.source || 'OKX').toUpperCase();
  const instrument = dataFeed.instrument || 'ETH-USDT-SWAP';
  const observedAt = new Date(dataFeed.fetchedAt || Date.now()).toISOString();

  const candleRows = [];
  for (const [timeframe, candles] of Object.entries(dataFeed.market?.candlesByTf || {})) {
    for (const raw of Array.isArray(candles) ? candles : []) {
      const c = normalizeCandle(raw);
      if (!c) continue;
      candleRows.push({
        source,
        instrument,
        timeframe,
        time_ms: Math.trunc(c.time),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        confirmed: c.confirmed,
        observed_at: observedAt
      });
    }
  }

  // Persist the small realtime Redis snapshot first. This keeps the live-memory
  // path available immediately even when the larger Supabase historical write
  // takes longer than the caller's response window.
  try {
    const previous = await getLiveMemory({ signal });
    const current = compactLive(dataFeed, liveData, previous.value);
    const cached = await redisSetJson(LIVE_KEY, current, LIVE_TTL_SECONDS, { signal });
    result.upstash = {
      configured: cached.configured,
      stored: cached.stored,
      key: LIVE_KEY
    };
  } catch (error) {
    result.upstash = {
      configured: upstashConfigured(),
      stored: false,
      error: error?.message || String(error)
    };
  }

  try {
    if (candleRows.length) {
      const r = await upsertMarketCandles(candleRows);
      result.supabase.configured = r.configured;
      result.supabase.persisted = r.persisted;
      result.supabase.candles = r.rows || 0;
    }

    const snapshotPayload = {
      instrument,
      fetchedAt: dataFeed.fetchedAt || observedAt,
      source: dataFeed.source || null,
      current: compactLive(dataFeed, liveData),
      featureSummary: dataFeed.featureSummary || {},
      dataQuality: dataFeed.dataQuality || {}
    };
    const snapshot = await insertMarketSnapshot({
      source,
      instrument,
      event_ts: observedAt,
      payload: snapshotPayload
    });
    result.supabase.configured = result.supabase.configured || snapshot.configured;
    result.supabase.snapshot = snapshot.persisted === true;
  } catch (error) {
    result.supabase.error = error?.message || String(error);
  }

  return result;
}
