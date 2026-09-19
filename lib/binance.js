const BINANCE_BASE_URL = 'https://fapi.binance.com';

async function getJson(path, params = {}, signal) {
  const url = new URL(BINANCE_BASE_URL + path);
  Object.entries(params).forEach(([key, value]) => {
    if (value != null) url.searchParams.set(key, String(value));
  });

  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'SCALP-Omega-Binance-Adapter/1.0' },
    cache: 'no-store',
    signal
  });

  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}

  if (!response.ok || data?.code < 0) {
    throw new Error(`Binance HTTP ${response.status}: ${data?.msg || text.slice(0, 300)}`);
  }
  return data;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function getBinanceEthContext({ signal } = {}) {
  const symbol = 'ETHUSDT';

  try {
    const [ticker, book, funding, oi] = await Promise.all([
      getJson('/fapi/v1/ticker/24hr', { symbol }, signal),
      getJson('/fapi/v1/depth', { symbol, limit: 50 }, signal),
      getJson('/fapi/v1/premiumIndex', { symbol }, signal),
      getJson('/fapi/v1/openInterest', { symbol }, signal)
    ]);

    const bidNotional = (book?.bids || []).reduce((sum, row) => sum + (num(row?.[0]) || 0) * (num(row?.[1]) || 0), 0);
    const askNotional = (book?.asks || []).reduce((sum, row) => sum + (num(row?.[0]) || 0) * (num(row?.[1]) || 0), 0);

    return {
      configured: true,
      available: true,
      source: 'BINANCE',
      symbol,
      fetchedAt: new Date().toISOString(),
      ticker: {
        lastPrice: num(ticker?.lastPrice),
        volume24h: num(ticker?.volume),
        quoteVolume24h: num(ticker?.quoteVolume)
      },
      orderBook: {
        bestBid: num(book?.bids?.[0]?.[0]),
        bestAsk: num(book?.asks?.[0]?.[0]),
        bidNotional,
        askNotional,
        imbalance: bidNotional + askNotional ? (bidNotional - askNotional) / (bidNotional + askNotional) : null
      },
      funding: {
        markPrice: num(funding?.markPrice),
        indexPrice: num(funding?.indexPrice),
        fundingRate: num(funding?.lastFundingRate),
        nextFundingTime: num(funding?.nextFundingTime)
      },
      openInterest: {
        value: num(oi?.openInterest),
        timestamp: num(oi?.time)
      },
      quality: { available: true, errors: [] }
    };
  } catch (error) {
    return {
      configured: true,
      available: false,
      source: 'BINANCE',
      symbol,
      fetchedAt: new Date().toISOString(),
      ticker: null,
      orderBook: null,
      funding: null,
      openInterest: null,
      quality: { available: false, errors: [error?.message || String(error)] }
    };
  }
}
