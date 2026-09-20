const TF_LIMITS = {
  '1m': { recent: 30, anchors: 2 },
  '5m': { recent: 30, anchors: 2 },
  '15m': { recent: 50, anchors: 3 },
  '1H': { recent: 30, anchors: 2 },
  '4H': { recent: 20, anchors: 2 },
  '1D': { recent: 15, anchors: 2 }
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
  return Number.isFinite(c.time) && [c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite) ? c : null;
}

function summarizeCandles(rows, tf) {
  const all = (rows || []).map(candle).filter(Boolean).filter(x => x.confirmed).slice(-1000);
  const cfg = TF_LIMITS[tf] || { recent: 30, anchors: 2 };
  const recent = all.slice(-cfg.recent);
  const historical = all.slice(0, Math.max(0, all.length - cfg.recent));
  const anchors = [];
  const count = Math.min(cfg.anchors, historical.length);

  for (let i = 0; i < count; i += 1) {
    const idx = Math.min(historical.length - 1, Math.floor((i * historical.length) / Math.max(1, count - 1 || 1)));
    anchors.push(historical[idx]);
  }

  const seen = new Map();
  for (const x of [...anchors, ...recent]) seen.set(x.time, x);
  const bars = [...seen.values()].sort((a, b) => a.time - b.time)
    .map(x => [x.time, x.open, x.high, x.low, x.close, x.volume]);

  const closes = all.map(x => x.close);
  const last = all.at(-1);
  const ref = closes.length > 100 ? closes.at(-101) : closes[0];

  return {
    storedClosedBars: all.length,
    oldest: all[0]?.time ?? null,
    newest: last?.time ?? null,
    range1000: all.length ? {
      high: Math.max(...all.map(x => x.high)),
      low: Math.min(...all.map(x => x.low))
    } : { high: null, low: null },
    changePctFromOldest: last && all[0]?.close ? ((last.close - all[0].close) / all[0].close) * 100 : null,
    changePct100: last && ref ? ((last.close - ref) / ref) * 100 : null,
    representativeBars: bars
  };
}

function tail(arr, n) {
  return Array.isArray(arr) ? arr.slice(-n) : [];
}

function compactExternal(external) {
  if (!external) return null;
  return {
    fetchedAt: external.fetchedAt || null,
    crossExchange: external.crossExchange || null,
    featureSignals: external.featureSignals || null,
    dataQuality: external.dataQuality || null,
    providers: Object.fromEntries(
      Object.entries(external.providers || {}).map(([name, p]) => [
        name,
        p ? {
          available: p.available === true,
          timestamp: p.timestamp || null,
          price: p.price ?? null,
          markPrice: p.markPrice ?? null,
          indexPrice: p.indexPrice ?? null,
          fundingRate: p.fundingRate ?? p.currentFunding ?? null,
          nextFundingRate: p.nextFundingRate ?? null,
          openInterest: p.openInterest ?? null,
          spotPrice: p.spotPrice ?? null,
          basisRate: p.basisRate ?? null,
          options: p.options ? {
            totalOI: p.options.totalOI ?? null,
            putCallOI: p.options.putCallOI ?? null,
            weightedIV: p.options.weightedIV ?? null
          } : null
        } : null
      ])
    )
  };
}

function compactMacro(macro) {
  if (!macro) return null;
  return {
    source: macro.source || 'FRED',
    status: macro.status || 'UNKNOWN',
    fetchedAt: macro.fetchedAt || null,
    series: Object.fromEntries(
      Object.entries(macro.series || {}).map(([id, s]) => [id, {
        id: s.id || id,
        latest: tail(s.observations, 1)
      }])
    )
  };
}

function compactMarket(market) {
  return {
    price: market.price ?? null,
    openInterest: market.openInterest ?? null,
    fundingRate: market.fundingRate ?? null,
    fundingTime: market.fundingTime ?? null,
    nextFundingTime: market.nextFundingTime ?? null,
    nextFundingRate: market.nextFundingRate ?? null,
    oiHistory: tail(market.oiHistory, 10),
    fundingHistory: tail(market.fundingHistory, 10),
    longShortHistory: tail(market.longShortHistory, 10),
    takerVolumeHistory: tail(market.takerVolumeHistory, 10),
    trades: tail(market.trades, 10),
    orderBook: market.orderBook ? {
      time: market.orderBook.time ?? market.orderBook.ts ?? null,
      bids: tail(market.orderBook.bids, 3),
      asks: tail(market.orderBook.asks, 3)
    } : null,
    liquidations: tail(market.liquidations, 20),
    liquidationHistory: tail(market.liquidationHistory, 20)
  };
}

export function compactAiInput(raw) {
  const market = raw.market || {};
  const candleContext = Object.fromEntries(
    Object.entries(market.candlesByTf || {}).map(([tf, rows]) => [tf, summarizeCandles(rows, tf)])
  );

  return {
    engine: raw.engine,
    decisionAuthority: raw.decisionAuthority,
    decisionPolicy: raw.decisionPolicy,
    source: raw.source,
    instrument: raw.instrument,
    analysisMode: raw.analysisMode,
    fetchedAt: raw.fetchedAt,
    market: compactMarket(market),
    features: raw.features || {},
    contexts: raw.contexts || {},
    featureSummary: raw.featureSummary || {},
    externalIntelligence: compactExternal(raw.externalIntelligence || null),
    macroContext: compactMacro(raw.macroContext || null),
    candleContext,
    realtime: raw.realtime || null,
    memoryPolicy: {
      historicalStore: 'SUPABASE',
      realtimeStore: 'UPSTASH_REDIS',
      rawHistoricalCandlesSentToModel: false,
      fullHistoricalCandlesPersisted: true,
      fullHistoryAvailableViaSupabase: true,
      configuredTimeframes: Object.fromEntries(
        Object.entries(candleContext).map(([tf, x]) => [tf, {
          storedClosedBars: x.storedClosedBars,
          representativeBarsSent: x.representativeBars.length,
          format: '[time,open,high,low,close,volume]'
        }])
      )
    }
  };
}
