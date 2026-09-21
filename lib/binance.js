const USD_M_BASE = 'https://fapi.binance.com';
const SPOT_BASE = 'https://api.binance.com';
const SYMBOL = 'ETHUSDT';
const INTERVALS = Object.freeze(['1m','5m','15m','1h','4h','1d']);
const SENTIMENT_PERIODS = Object.freeze(['5m','15m','1h','4h']);

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeKlineRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((x) => ({
    time: num(x?.[0]),
    open: num(x?.[1]),
    high: num(x?.[2]),
    low: num(x?.[3]),
    close: num(x?.[4]),
    volume: num(x?.[5]),
    closeTime: num(x?.[6]),
    quoteVolume: num(x?.[7]),
    trades: num(x?.[8]),
    takerBuyVolume: num(x?.[9]),
    takerBuyQuoteVolume: num(x?.[10]),
    ignore: x?.[11] ?? null,
    confirmed: num(x?.[6]) != null ? num(x[6]) < Date.now() : false
  })).filter((x) => [x.time,x.open,x.high,x.low,x.close].every(Number.isFinite));
}

function normalizePriceKlineRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((x) => ({
    time: num(x?.[0]),
    open: num(x?.[1]),
    high: num(x?.[2]),
    low: num(x?.[3]),
    close: num(x?.[4]),
    closeTime: num(x?.[6]),
    trades: num(x?.[8]),
    confirmed: num(x?.[6]) != null ? num(x[6]) < Date.now() : false
  })).filter((x) => [x.time,x.open,x.high,x.low,x.close].every(Number.isFinite));
}

function bookMetrics(book) {
  const bids = (book?.bids || []).map((x) => [num(x?.[0]), num(x?.[1])]).filter((x) => x.every(Number.isFinite));
  const asks = (book?.asks || []).map((x) => [num(x?.[0]), num(x?.[1])]).filter((x) => x.every(Number.isFinite));
  const bidQty = bids.reduce((s, x) => s + x[1], 0);
  const askQty = asks.reduce((s, x) => s + x[1], 0);
  const bidNotional = bids.reduce((s, x) => s + x[0] * x[1], 0);
  const askNotional = asks.reduce((s, x) => s + x[0] * x[1], 0);
  const bestBid = bids[0]?.[0] ?? null;
  const bestAsk = asks[0]?.[0] ?? null;
  const mid = bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : null;
  return {
    bestBid,
    bestAsk,
    mid,
    spread: bestBid != null && bestAsk != null ? bestAsk - bestBid : null,
    spreadBps: mid ? ((bestAsk - bestBid) / mid) * 10000 : null,
    bidQty,
    askQty,
    bidNotional,
    askNotional,
    imbalance: bidNotional + askNotional ? (bidNotional - askNotional) / (bidNotional + askNotional) : null,
    bidLevels: bids,
    askLevels: asks
  };
}

async function requestJson(base, path, params = {}, { signal, apiKey = false } = {}) {
  const url = new URL(base + path);
  Object.entries(params).forEach(([key, value]) => {
    if (value != null) url.searchParams.set(key, String(value));
  });
  const started = Date.now();
  const headers = {
    Accept: 'application/json',
    'User-Agent': 'SCALP-Omega-Binance-Adapter/2.0'
  };
  if (apiKey && process.env.BINANCE_API_KEY) headers['X-MBX-APIKEY'] = process.env.BINANCE_API_KEY;
  const response = await fetch(url, { headers, cache: 'no-store', signal });
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  if (!response.ok || (data && Number.isFinite(Number(data.code)) && Number(data.code) < 0)) {
    throw new Error(`Binance ${path} HTTP ${response.status}: ${data?.msg || text.slice(0, 300)}`);
  }
  return { data, latencyMs: Date.now() - started };
}

async function safeRequest(label, base, path, params, options) {
  const started = Date.now();
  try {
    const result = await requestJson(base, path, params, options);
    return { ok: true, label, latencyMs: result.latencyMs, value: result.data };
  } catch (error) {
    return { ok: false, label, latencyMs: Date.now() - started, error: error?.message || String(error) };
  }
}

async function batch(entries, { signal } = {}) {
  const results = await Promise.all(entries.map((entry) =>
    safeRequest(entry.label, entry.base, entry.path, entry.params, { signal, apiKey: entry.apiKey === true })
  ));
  return Object.fromEntries(results.map((r) => [r.label, r]));
}

function valueOf(results, label) {
  const r = results?.[label];
  return r?.ok ? r.value : null;
}

function auditOf(results) {
  const rows = Object.values(results || {});
  return {
    requested: rows.length,
    successful: rows.filter((x) => x.ok).length,
    failed: rows.filter((x) => !x.ok).length,
    failures: rows.filter((x) => !x.ok).map((x) => ({ label: x.label, error: x.error }))
  };
}

function onlySymbol(rows, symbol = SYMBOL) {
  if (!Array.isArray(rows)) return rows;
  return rows.filter((x) => !x?.symbol || x.symbol === symbol || x.ps === symbol);
}

function latest(rows) {
  return Array.isArray(rows) && rows.length ? rows[rows.length - 1] : null;
}

async function getPublicMarketData({ signal } = {}) {
  const publicEntries = [
    { label:'futures.ping', base:USD_M_BASE, path:'/fapi/v1/ping' },
    { label:'futures.time', base:USD_M_BASE, path:'/fapi/v1/time' },
    { label:'futures.exchangeInfo', base:USD_M_BASE, path:'/fapi/v1/exchangeInfo' },
    { label:'futures.symbolAdlRisk', base:USD_M_BASE, path:'/fapi/v1/symbolAdlRisk', params:{symbol:SYMBOL} },
    { label:'futures.indexInfo', base:USD_M_BASE, path:'/fapi/v1/indexInfo', params:{symbol:SYMBOL} },
    { label:'futures.assetIndex', base:USD_M_BASE, path:'/fapi/v1/assetIndex', params:{symbol:SYMBOL} },
    { label:'futures.constituents', base:USD_M_BASE, path:'/fapi/v1/constituents', params:{symbol:SYMBOL} },
    { label:'futures.insuranceBalance', base:USD_M_BASE, path:'/fapi/v1/insuranceBalance', params:{symbol:SYMBOL} },
    { label:'futures.deliveryPrice', base:USD_M_BASE, path:'/futures/data/delivery-price', params:{pair:SYMBOL} },
    { label:'futures.tradingSchedule', base:USD_M_BASE, path:'/fapi/v1/tradingSchedule' },
    { label:'futures.fundingInfo', base:USD_M_BASE, path:'/fapi/v1/fundingInfo' },
    { label:'futures.fundingRate', base:USD_M_BASE, path:'/fapi/v1/fundingRate', params:{symbol:SYMBOL,limit:1000} },
    { label:'futures.ticker24h', base:USD_M_BASE, path:'/fapi/v1/ticker/24hr', params:{symbol:SYMBOL} },
    { label:'futures.priceTicker', base:USD_M_BASE, path:'/fapi/v1/ticker/price', params:{symbol:SYMBOL} },
    { label:'futures.priceTickerV2', base:USD_M_BASE, path:'/fapi/v2/ticker/price', params:{symbol:SYMBOL} },
    { label:'futures.bookTicker', base:USD_M_BASE, path:'/fapi/v1/ticker/bookTicker', params:{symbol:SYMBOL} },
    { label:'futures.depth', base:USD_M_BASE, path:'/fapi/v1/depth', params:{symbol:SYMBOL,limit:1000} },
    { label:'futures.rpiDepth', base:USD_M_BASE, path:'/fapi/v1/rpiDepth', params:{symbol:SYMBOL,limit:1000} },
    { label:'futures.trades', base:USD_M_BASE, path:'/fapi/v1/trades', params:{symbol:SYMBOL,limit:1000} },
    { label:'futures.aggTrades', base:USD_M_BASE, path:'/fapi/v1/aggTrades', params:{symbol:SYMBOL,limit:1000} },
    { label:'futures.premiumIndex', base:USD_M_BASE, path:'/fapi/v1/premiumIndex', params:{symbol:SYMBOL} },
    { label:'futures.openInterest', base:USD_M_BASE, path:'/fapi/v1/openInterest', params:{symbol:SYMBOL} },
    { label:'futures.basis', base:USD_M_BASE, path:'/futures/data/basis', params:{pair:SYMBOL,contractType:'PERPETUAL',period:'15m',limit:500} },
    { label:'futures.takerBuySell', base:USD_M_BASE, path:'/futures/data/takerlongshortRatio', params:{symbol:SYMBOL,period:'15m',limit:500} }
  ];

  for (const period of SENTIMENT_PERIODS) {
    publicEntries.push(
      { label:`futures.openInterestHist.${period}`, base:USD_M_BASE, path:'/futures/data/openInterestHist', params:{symbol:SYMBOL,period,limit:500} },
      { label:`futures.globalLongShort.${period}`, base:USD_M_BASE, path:'/futures/data/globalLongShortAccountRatio', params:{symbol:SYMBOL,period,limit:500} },
      { label:`futures.takerLongShort.${period}`, base:USD_M_BASE, path:'/futures/data/takerlongshortRatio', params:{symbol:SYMBOL,period,limit:500} },
      { label:`futures.takerBuySell.${period}`, base:USD_M_BASE, path:'/futures/data/takerlongshortRatio', params:{symbol:SYMBOL,period,limit:500} },
      { label:`futures.basis.${period}`, base:USD_M_BASE, path:'/futures/data/basis', params:{pair:SYMBOL,contractType:'PERPETUAL',period,limit:500} }
    );
  }

  for (const interval of INTERVALS) {
    publicEntries.push(
      { label:`futures.klines.${interval}`, base:USD_M_BASE, path:'/fapi/v1/klines', params:{symbol:SYMBOL,interval,limit:1000} },
      { label:`futures.markPriceKlines.${interval}`, base:USD_M_BASE, path:'/fapi/v1/markPriceKlines', params:{symbol:SYMBOL,interval,limit:1000} },
      { label:`futures.indexPriceKlines.${interval}`, base:USD_M_BASE, path:'/fapi/v1/indexPriceKlines', params:{pair:SYMBOL,interval,limit:1000} },
      { label:`futures.premiumIndexKlines.${interval}`, base:USD_M_BASE, path:'/fapi/v1/premiumIndexKlines', params:{symbol:SYMBOL,interval,limit:1000} },
      { label:`futures.continuousKlines.${interval}`, base:USD_M_BASE, path:'/fapi/v1/continuousKlines', params:{pair:SYMBOL,contractType:'PERPETUAL',interval,limit:1000} }
    );
  }

  // Keep the spot market in view as a cross-market liquidity/price reference.
  const spotEntries = [
    { label:'spot.time', base:SPOT_BASE, path:'/api/v3/time' },
    { label:'spot.exchangeInfo', base:SPOT_BASE, path:'/api/v3/exchangeInfo', params:{symbol:SYMBOL} },
    { label:'spot.ticker24h', base:SPOT_BASE, path:'/api/v3/ticker/24hr', params:{symbol:SYMBOL} },
    { label:'spot.priceTicker', base:SPOT_BASE, path:'/api/v3/ticker/price', params:{symbol:SYMBOL} },
    { label:'spot.bookTicker', base:SPOT_BASE, path:'/api/v3/ticker/bookTicker', params:{symbol:SYMBOL} },
    { label:'spot.depth', base:SPOT_BASE, path:'/api/v3/depth', params:{symbol:SYMBOL,limit:5000} },
    { label:'spot.trades', base:SPOT_BASE, path:'/api/v3/trades', params:{symbol:SYMBOL,limit:1000} },
    { label:'spot.aggTrades', base:SPOT_BASE, path:'/api/v3/aggTrades', params:{symbol:SYMBOL,limit:1000} }
  ];
  for (const interval of INTERVALS) {
    spotEntries.push({ label:`spot.klines.${interval}`, base:SPOT_BASE, path:'/api/v3/klines', params:{symbol:SYMBOL,interval,limit:1000} });
  }

  const [futuresResults, spotResults] = await Promise.all([
    batch(publicEntries, { signal }),
    batch(spotEntries, { signal })
  ]);

  const exchangeInfoRaw = valueOf(futuresResults,'futures.exchangeInfo');
  const symbolInfo = Array.isArray(exchangeInfoRaw?.symbols)
    ? exchangeInfoRaw.symbols.find((x) => x.symbol === SYMBOL) || null
    : null;

  const futuresDepth = valueOf(futuresResults,'futures.depth');
  const futuresRpiDepth = valueOf(futuresResults,'futures.rpiDepth');
  const spotDepth = valueOf(spotResults,'spot.depth');

  const futures = {
    symbol: SYMBOL,
    endpoints: futuresResults,
    audit: auditOf(futuresResults),
    exchange: {
      serverTime: num(exchangeInfoRaw?.serverTime),
      rateLimits: exchangeInfoRaw?.rateLimits || [],
      symbol: symbolInfo
    },
    connectivity: {
      serverTime: valueOf(futuresResults,'futures.time')?.serverTime ?? null
    },
    ticker24h: valueOf(futuresResults,'futures.ticker24h'),
    priceTicker: valueOf(futuresResults,'futures.priceTicker'),
    priceTickerV2: valueOf(futuresResults,'futures.priceTickerV2'),
    bookTicker: valueOf(futuresResults,'futures.bookTicker'),
    orderBook: {
      raw: futuresDepth,
      metrics: bookMetrics(futuresDepth),
      rpi: futuresRpiDepth
    },
    trades: valueOf(futuresResults,'futures.trades') || [],
    aggTrades: valueOf(futuresResults,'futures.aggTrades') || [],
    markAndFunding: valueOf(futuresResults,'futures.premiumIndex'),
    openInterest: valueOf(futuresResults,'futures.openInterest'),
    histories: {
      fundingRate: valueOf(futuresResults,'futures.fundingRate') || null,
      openInterest: Object.fromEntries(SENTIMENT_PERIODS.map((p) => [p, valueOf(futuresResults,`futures.openInterestHist.${p}`) || []])),
      globalLongShort: Object.fromEntries(SENTIMENT_PERIODS.map((p) => [p, valueOf(futuresResults,`futures.globalLongShort.${p}`) || []])),
      takerBuySell: Object.fromEntries(SENTIMENT_PERIODS.map((p) => [p, valueOf(futuresResults,`futures.takerBuySell.${p}`) || []])),
      basis: Object.fromEntries(SENTIMENT_PERIODS.map((p) => [p, valueOf(futuresResults,`futures.basis.${p}`) || []]))
    },
    candles: {
      klines: Object.fromEntries(INTERVALS.map((i) => [i, normalizeKlineRows(valueOf(futuresResults,`futures.klines.${i}`) || [])])),
      markPrice: Object.fromEntries(INTERVALS.map((i) => [i, normalizePriceKlineRows(valueOf(futuresResults,`futures.markPriceKlines.${i}`) || [])])),
      indexPrice: Object.fromEntries(INTERVALS.map((i) => [i, normalizePriceKlineRows(valueOf(futuresResults,`futures.indexPriceKlines.${i}`) || [])])),
      premiumIndex: Object.fromEntries(INTERVALS.map((i) => [i, normalizePriceKlineRows(valueOf(futuresResults,`futures.premiumIndexKlines.${i}`) || [])])),
      continuous: Object.fromEntries(INTERVALS.map((i) => [i, normalizeKlineRows(valueOf(futuresResults,`futures.continuousKlines.${i}`) || [])]))
    },
    riskAndStructure: {
      adlRisk: valueOf(futuresResults,'futures.symbolAdlRisk'),
      indexInfo: valueOf(futuresResults,'futures.indexInfo'),
      constituents: valueOf(futuresResults,'futures.constituents'),
      insuranceBalance: valueOf(futuresResults,'futures.insuranceBalance'),
      deliveryPrice: valueOf(futuresResults,'futures.deliveryPrice'),
      tradingSchedule: valueOf(futuresResults,'futures.tradingSchedule'),
      fundingInfo: onlySymbol(valueOf(futuresResults,'futures.fundingInfo'), SYMBOL)
    }
  };

  const spot = {
    symbol: SYMBOL,
    endpoints: spotResults,
    audit: auditOf(spotResults),
    exchange: valueOf(spotResults,'spot.exchangeInfo'),
    ticker24h: valueOf(spotResults,'spot.ticker24h'),
    priceTicker: valueOf(spotResults,'spot.priceTicker'),
    bookTicker: valueOf(spotResults,'spot.bookTicker'),
    orderBook: { raw: spotDepth, metrics: bookMetrics(spotDepth) },
    trades: valueOf(spotResults,'spot.trades') || [],
    aggTrades: valueOf(spotResults,'spot.aggTrades') || [],
    candles: Object.fromEntries(INTERVALS.map((i) => [i, normalizeKlineRows(valueOf(spotResults,`spot.klines.${i}`) || [])]))
  };

  return { futures, spot };
}

async function getOptionalApiKeyData({ signal } = {}) {
  const hasKey = Boolean(process.env.BINANCE_API_KEY);
  if (!hasKey) {
    return {
      configured: false,
      note: 'Optional API-key feeds are wired but skipped because BINANCE_API_KEY is not configured.',
      audit: { requested: 0, successful: 0, failed: 0, failures: [] }
    };
  }

  // Binance documents these as API-key protected market/user-data endpoints. We never
  // expose the key itself in the feed; only the returned market/account observations.
  const entries = [
    { label:'futures.topLongShortAccount', base:USD_M_BASE, path:'/futures/data/topLongShortAccountRatio', params:{symbol:SYMBOL,period:'15m',limit:500}, apiKey:true },
    { label:'futures.topLongShortPosition', base:USD_M_BASE, path:'/futures/data/topLongShortPositionRatio', params:{symbol:SYMBOL,period:'15m',limit:500}, apiKey:true },
    { label:'futures.historicalTrades', base:USD_M_BASE, path:'/fapi/v1/historicalTrades', params:{symbol:SYMBOL,limit:500}, apiKey:true }
  ];
  const results = await batch(entries, { signal });
  return {
    configured: true,
    apiKeyPresent: true,
    audit: auditOf(results),
    data: {
      topLongShortAccount: valueOf(results,'futures.topLongShortAccount') || [],
      topLongShortPosition: valueOf(results,'futures.topLongShortPosition') || [],
      historicalTrades: valueOf(results,'futures.historicalTrades') || []
    },
    endpoints: results
  };
}

export async function getBinanceFullMarketData({ signal } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 14_000);
  try {
    const [publicData, optionalKeyData] = await Promise.all([
      getPublicMarketData({ signal: controller.signal }).catch((error) => ({
        futures: { symbol:SYMBOL, endpoints:{}, audit:{requested:0,successful:0,failed:1,failures:[{label:'publicData',error:error?.message||String(error)}]} },
        spot: { symbol:SYMBOL, endpoints:{}, audit:{requested:0,successful:0,failed:1,failures:[{label:'spotData',error:error?.message||String(error)}]} }
      })),
      getOptionalApiKeyData({ signal: controller.signal })
    ]);

    const futuresMark = publicData.futures?.markAndFunding;
    const futuresTicker = publicData.futures?.ticker24h;
    const spotTicker = publicData.spot?.ticker24h;
    const futuresPrice = num(futuresTicker?.lastPrice ?? valueOf(publicData.futures?.endpoints,'futures.priceTicker')?.price);
    const spotPrice = num(spotTicker?.lastPrice ?? valueOf(publicData.spot?.endpoints,'spot.priceTicker')?.price);

    const futuresSuccessful = publicData.futures?.audit?.successful || 0;
    const spotSuccessful = publicData.spot?.audit?.successful || 0;
    const available = futuresSuccessful + spotSuccessful > 0;

    return {
      available,
      source: 'BINANCE',
      environment: 'production',
      symbol: SYMBOL,
      fetchedAt: new Date().toISOString(),
      coverage: {
        scope: 'ETHUSDT USDⓈ-M Futures + ETHUSDT Spot',
        publicMarketData: true,
        optionalApiKeyData: optionalKeyData.configured,
        timeframes: INTERVALS,
        requestedPublicEndpointCount: (publicData.futures?.audit?.requested || 0) + (publicData.spot?.audit?.requested || 0),
        successfulPublicEndpointCount: (publicData.futures?.audit?.successful || 0) + (publicData.spot?.audit?.successful || 0),
        failedPublicEndpointCount: (publicData.futures?.audit?.failed || 0) + (publicData.spot?.audit?.failed || 0),
        note: 'Coverage tracks documented Binance public market-data endpoints relevant to ETHUSDT plus optional API-key protected feeds. Endpoint availability can vary by account permissions and Binance product lifecycle.'
      },
      summary: {
        futuresPrice,
        futuresMarkPrice: num(futuresMark?.markPrice),
        futuresIndexPrice: num(futuresMark?.indexPrice),
        futuresFundingRate: num(futuresMark?.lastFundingRate),
        futuresNextFundingTime: num(futuresMark?.nextFundingTime),
        futuresOpenInterest: num(valueOf(publicData.futures?.endpoints,'futures.openInterest')?.openInterest),
        spotPrice,
        futuresSpotBasisPct: futuresPrice != null && spotPrice ? ((futuresPrice - spotPrice) / spotPrice) * 100 : null,
        futuresBook: publicData.futures?.orderBook?.metrics || null,
        spotBook: publicData.spot?.orderBook?.metrics || null,
        adlRisk: publicData.futures?.riskAndStructure?.adlRisk || null
      },
      futures: publicData.futures,
      spot: publicData.spot,
      apiKeyData: optionalKeyData,
      quality: {
        live: true,
        publicAudit: {
          futures: publicData.futures?.audit || null,
          spot: publicData.spot?.audit || null
        },
        apiKeyAudit: optionalKeyData.audit,
        allRequestedPublicDataSucceeded:
          (publicData.futures?.audit?.failed || 0) === 0 &&
          (publicData.spot?.audit?.failed || 0) === 0
      }
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function getBinanceEthContext({ signal } = {}) {
  const data = await getBinanceFullMarketData({ signal });
  return {
    configured: true,
    available: data.available,
    source: data.source,
    symbol: data.symbol,
    fetchedAt: data.fetchedAt,
    ticker: {
      lastPrice: data.summary.futuresPrice,
      volume24h: num(data.futures?.ticker24h?.volume),
      quoteVolume24h: num(data.futures?.ticker24h?.quoteVolume)
    },
    orderBook: data.summary.futuresBook,
    funding: {
      markPrice: data.summary.futuresMarkPrice,
      indexPrice: data.summary.futuresIndexPrice,
      fundingRate: data.summary.futuresFundingRate,
      nextFundingTime: data.summary.futuresNextFundingTime
    },
    openInterest: {
      value: data.summary.futuresOpenInterest,
      timestamp: valueOf(data.futures?.endpoints,'futures.openInterest')?.time ?? null
    },
    quality: data.quality
  };
}
