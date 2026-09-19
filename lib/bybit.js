const BYBIT_BASE_URL = 'https://api.bybit.com';

async function getJson(path, params = {}, signal) {
  const url = new URL(BYBIT_BASE_URL + path);
  Object.entries(params).forEach(([key, value]) => {
    if (value != null) url.searchParams.set(key, String(value));
  });

  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'SCALP-Omega-Bybit-Adapter/1.0' },
    cache: 'no-store',
    signal
  });

  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}

  if (!response.ok || data?.retCode !== 0) {
    throw new Error(`Bybit HTTP ${response.status}: ${data?.retMsg || text.slice(0, 300)}`);
  }

  return data?.result ?? {};
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function getBybitEthContext({ signal } = {}) {
  const symbol = 'ETHUSDT';
  const category = 'linear';

  try {
    const [ticker, orderbook, funding, openInterest] = await Promise.all([
      getJson('/v5/market/tickers', { category, symbol }, signal),
      getJson('/v5/market/orderbook', { category, symbol, limit: 50 }, signal),
      getJson('/v5/market/funding/history', { category, symbol, limit: 1 }, signal),
      getJson('/v5/market/open-interest', { category, symbol, intervalTime: '1h', limit: 1 }, signal)
    ]);

    const t = ticker?.list?.[0] || {};
    const bids = orderbook?.b || [];
    const asks = orderbook?.a || [];
    const bidNotional = bids.reduce((sum, row) => sum + (num(row?.[0]) || 0) * (num(row?.[1]) || 0), 0);
    const askNotional = asks.reduce((sum, row) => sum + (num(row?.[0]) || 0) * (num(row?.[1]) || 0), 0);
    const imbalance = bidNotional + askNotional > 0
      ? (bidNotional - askNotional) / (bidNotional + askNotional)
      : null;

    const latestFunding = funding?.list?.[0] || {};
    const latestOi = openInterest?.list?.[0] || {};

    return {
      configured: true,
      available: true,
      source: 'BYBIT',
      category,
      symbol,
      fetchedAt: new Date().toISOString(),
      ticker: {
        lastPrice: num(t.lastPrice),
        markPrice: num(t.markPrice),
        indexPrice: num(t.indexPrice),
        volume24h: num(t.volume24h),
        turnover24h: num(t.turnover24h),
        fundingRate: num(t.fundingRate),
        openInterest: num(t.openInterest)
      },
      orderBook: {
        bestBid: num(bids?.[0]?.[0]),
        bestAsk: num(asks?.[0]?.[0]),
        bidNotional,
        askNotional,
        imbalance
      },
      funding: {
        fundingRate: num(latestFunding.fundingRate),
        timestamp: num(latestFunding.fundingRateTimestamp)
      },
      openInterest: {
        value: num(latestOi.openInterest),
        timestamp: num(latestOi.timestamp)
      },
      quality: {
        available: true,
        errors: []
      }
    };
  } catch (error) {
    return {
      configured: true,
      available: false,
      source: 'BYBIT',
      category,
      symbol,
      fetchedAt: new Date().toISOString(),
      ticker: null,
      orderBook: null,
      funding: null,
      openInterest: null,
      quality: {
        available: false,
        errors: [error?.message || String(error)]
      }
    };
  }
}

export function bybitDirection(context) {
  const ticker = context?.ticker || {};
  const book = context?.orderBook || {};
  let bull = 0;
  let bear = 0;

  if (ticker.lastPrice != null && ticker.markPrice != null) {
    if (ticker.lastPrice > ticker.markPrice) bull++;
    else if (ticker.lastPrice < ticker.markPrice) bear++;
  }

  if (book.imbalance != null) {
    if (book.imbalance > 0.08) bull++;
    else if (book.imbalance < -0.08) bear++;
  }

  return bull >= 2 ? 'BULLISH' : bear >= 2 ? 'BEARISH' : 'NEUTRAL';
}
