const TF_LIMITS = {
  '1m': { recent: 80, anchors: 8 },
  '5m': { recent: 80, anchors: 8 },
  '15m': { recent: 120, anchors: 12 },
  '1H': { recent: 80, anchors: 8 },
  '4H': { recent: 60, anchors: 8 },
  '1D': { recent: 40, anchors: 8 }
};

function candle(x) {
  if (!x) return null;
  const c = {
    time: Number(x.time ?? x[0]),
    open: Number(x.open ?? x[1]),
    high: Number(x.high ?? x[2]),
    low: Number(x.low ?? x[3]),
    close: Number(x.close ?? x[4]),
    volume: Number(x.volume ?? x[5]),
    confirmed: x.confirmed === true || x.confirmed === '1' || x[8] === '1'
  };
  return Number.isFinite(c.time) &&
    [c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite)
    ? c
    : null;
}

function summarizeCandles(rows, tf) {
  const all = (rows || []).map(candle).filter(Boolean).filter(x => x.confirmed).slice(-1000);
  const cfg = TF_LIMITS[tf] || { recent: 80, anchors: 8 };
  const recent = all.slice(-cfg.recent);
  const historical = all.slice(0, Math.max(0, all.length - cfg.recent));
  const anchors = [];
  const count = Math.min(cfg.anchors, historical.length);

  for (let i = 0; i < count; i += 1) {
    const idx = Math.min(
      historical.length - 1,
      Math.floor((i * historical.length) / Math.max(1, count - 1 || 1))
    );
    anchors.push(historical[idx]);
  }

  const seen = new Map();
  for (const x of [...anchors, ...recent]) seen.set(x.time, x);
  const bars = [...seen.values()]
    .sort((a, b) => a.time - b.time)
    .map(x => [x.time, x.open, x.high, x.low, x.close, x.volume]);

  const closes = all.map(x => x.close);
  const last = all.at(-1);
  const ref = closes.length > 100 ? closes.at(-101) : closes[0];

  return {
    storedClosedBars: all.length,
    oldest: all[0]?.time ?? null,
    newest: last?.time ?? null,
    range1000: {
      high: all.length ? Math.max(...all.map(x => x.high)) : null,
      low: all.length ? Math.min(...all.map(x => x.low)) : null
    },
    changePctFromOldest: last && all[0]?.close
      ? ((last.close - all[0].close) / all[0].close) * 100
      : null,
    changePct100: last && ref
      ? ((last.close - ref) / ref) * 100
      : null,
    representativeBars: bars
  };
}

function tail(arr, n) {
  return Array.isArray(arr) ? arr.slice(-n) : [];
}

function compactBook(book, depth = 10) {
  if (!book) return null;
  return {
    ...book,
    bids: tail(book.bids, depth),
    asks: tail(book.asks, depth)
  };
}

function compactObject(value, limit = 30) {
  if (Array.isArray(value)) return tail(value, limit);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, compactObject(v, limit)])
  );
}

function compactExternal(external) {
  if (!external) return null;
  const providers = Object.fromEntries(
    Object.entries(external.providers || {}).map(([name, p]) => {
      if (!p) return [name, null];
      return [name, {
        available: p.available === true,
        source: p.source || null,
        timestamp: p.timestamp || null,
        price: p.price ?? null,
        markPrice: p.markPrice ?? null,
        indexPrice: p.indexPrice ?? null,
        fundingRate: p.fundingRate ?? p.currentFunding ?? null,
        openInterest: p.openInterest ?? null,
        book: compactBook(p.book, 10),
        options: p.options
          ? {
              totalOI: p.options.totalOI ?? null,
              callOI: p.options.callOI ?? null,
              putOI: p.options.putOI ?? null,
              putCallOI: p.options.putCallOI ?? null,
              weightedIV: p.options.weightedIV ?? null,
              topExpiries: tail(p.options.topExpiries, 6)
            }
          : null,
        futures: p.futures
          ? {
              ticker: p.futures.ticker || p.futures.ticker24h || null,
              orderBook: compactBook(p.futures.orderBook, 10),
              trades: tail(p.futures.trades, 40),
              markAndFunding: p.futures.markAndFunding || null,
              openInterest: p.futures.openInterest || null,
              histories: compactObject(p.futures.histories, 30),
              riskAndStructure: p.futures.riskAndStructure || null
            }
          : null,
        spot: p.spot
          ? {
              ticker: p.spot.ticker || p.spot.ticker24h || null,
              orderBook: compactBook(p.spot.orderBook, 10),
              trades: tail(p.spot.trades, 30)
            }
          : null
      }];
    })
  );

  return {
    ok: external.ok,
    fetchedAt: external.fetchedAt,
    crossExchange: external.crossExchange || null,
    featureSignals: external.featureSignals || null,
    dataQuality: external.dataQuality || null,
    providers
  };
}

function compactMacro(macro) {
  if (!macro) return null;
  return {
    source: macro.source || 'FRED',
    provider: macro.provider || null,
    status: macro.status || 'UNKNOWN',
    fetchedAt: macro.fetchedAt || null,
    series: Object.fromEntries(
      Object.entries(macro.series || {}).map(([id, s]) => [id, {
        id: s.id || id,
        title: s.title || null,
        observations: tail(s.observations, 6)
      }])
    ),
    errors: macro.errors || {}
  };
}

export function compactAiInput(raw, { previousLive = null } = {}) {
  const market = raw.market || {};
  const candleContext = Object.fromEntries(
    Object.entries(market.candlesByTf || {}).map(([tf, rows]) => [
      tf,
      summarizeCandles(rows, tf)
    ])
  );

  return {
    ...raw,
    market: {
      ...market,
      candlesByTf: undefined,
      candlesByExchange: undefined,
      oiHistory: tail(market.oiHistory, 40),
      fundingHistory: tail(market.fundingHistory, 40),
      longShortHistory: tail(market.longShortHistory, 40),
      takerVolumeHistory: tail(market.takerVolumeHistory, 40),
      trades: tail(market.trades, 50),
      orderBook: compactBook(market.orderBook, 10),
      liquidations: tail(market.liquidations, 80),
      liquidationHistory: tail(market.liquidationHistory, 80)
    },
    candleContext,
    externalIntelligence: compactExternal(raw.externalIntelligence || null),
    macroContext: compactMacro(raw.macroContext || null),
    previousLiveMemory: previousLive?.value || null,
    memoryPolicy: {
      historicalStore: 'SUPABASE',
      realtimeStore: 'UPSTASH_REDIS',
      rawHistoricalCandlesSentToModel: false,
      fullHistoricalCandlesPersisted: true,
      configuredTimeframes: Object.fromEntries(
        Object.entries(candleContext).map(([tf, x]) => [
          tf,
          {
            storedClosedBars: x.storedClosedBars,
            representativeBarsSent: x.representativeBars.length,
            format: '[time,open,high,low,close,volume]'
          }
        ])
      )
    }
  };
}
