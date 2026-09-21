import { upstashConfigured, redisGetJson, redisSetJson } from './upstash.js';
import { insertMarketSnapshot, insertMicrostructureSnapshot, upsertMarketCandles } from './supabase.js';

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

    const orderBook = dataFeed.market?.orderBook || null;
    const trades = Array.isArray(dataFeed.market?.trades) ? dataFeed.market.trades : [];
    if (orderBook) {
      const bids = Array.isArray(orderBook.bids) ? orderBook.bids : [];
      const asks = Array.isArray(orderBook.asks) ? orderBook.asks : [];
      const num = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
      const bid400 = bids.slice(0, 400);
      const ask400 = asks.slice(0, 400);
      const bidDepth = bid400.reduce((s,x) => s + num(x?.size ?? x?.[1]), 0);
      const askDepth = ask400.reduce((s,x) => s + num(x?.size ?? x?.[1]), 0);
      const bidNotional = bid400.reduce((s,x) => s + num(x?.price ?? x?.[0]) * num(x?.size ?? x?.[1]), 0);
      const askNotional = ask400.reduce((s,x) => s + num(x?.price ?? x?.[0]) * num(x?.size ?? x?.[1]), 0);
      const bestBid = num(bids[0]?.price ?? bids[0]?.[0]) || null;
      const bestAsk = num(asks[0]?.price ?? asks[0]?.[0]) || null;
      const mid = bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : null;
      const sizes = trades.map(t => num(t?.sz ?? t?.size)).filter(x => x > 0);
      const buySize = trades.filter(t => String(t?.side).toLowerCase() === 'buy').reduce((s,t) => s + num(t?.sz ?? t?.size), 0);
      const sellSize = trades.filter(t => String(t?.side).toLowerCase() === 'sell').reduce((s,t) => s + num(t?.sz ?? t?.size), 0);
      const total = buySize + sellSize;
      const eventDate = new Date(observedAt);
      const bucketMs = Math.floor(eventDate.getTime() / 60000) * 60000;
      await insertMicrostructureSnapshot({
        source,
        instrument,
        event_ts: eventDate.toISOString(),
        event_bucket: new Date(bucketMs).toISOString(),
        seq_id: Number.isFinite(Number(orderBook.seqId)) ? Number(orderBook.seqId) : null,
        best_bid: bestBid,
        best_ask: bestAsk,
        mid_price: mid,
        spread: mid != null ? bestAsk - bestBid : null,
        spread_bps: mid ? ((bestAsk - bestBid) / mid) * 10000 : null,
        bid_depth_400: bidDepth,
        ask_depth_400: askDepth,
        bid_notional_400: bidNotional,
        ask_notional_400: askNotional,
        trade_count: trades.length,
        buy_size: buySize,
        sell_size: sellSize,
        delta_size: buySize - sellSize,
        vwap: total ? trades.reduce((s,t) => s + num(t?.px ?? t?.price) * num(t?.sz ?? t?.size), 0) / total : null,
        order_book: { bids: bid400, asks: ask400, ts: orderBook.time ?? null, seqId: orderBook.seqId ?? null },
        trades,
        metrics: {
          depthImbalance400: (bidDepth + askDepth) ? (bidDepth - askDepth) / (bidDepth + askDepth) : null,
          notionalImbalance400: (bidNotional + askNotional) ? (bidNotional - askNotional) / (bidNotional + askNotional) : null,
          buySellRatio: sellSize ? buySize / sellSize : null,
          medianTradeSize: sizes.length ? sizes.slice().sort((a,b)=>a-b)[Math.floor(sizes.length/2)] : null,
          source: 'LIVE_ORDERBOOK_AND_RECENT_TRADES'
        }
      });
    }


    const snapshotPayload = {
      instrument,
      fetchedAt: dataFeed.fetchedAt || observedAt,
      source: dataFeed.source || null,
      current: compactLive(dataFeed, liveData),
      featureSummary: dataFeed.featureSummary || {},
      institutionalLayer: dataFeed.institutionalLayer || null,
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
