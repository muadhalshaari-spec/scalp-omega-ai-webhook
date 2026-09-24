const TF_LIMITS = {
  '1m': 4, '5m': 4, '15m': 6, '1H': 5, '4H': 3, '1D': 2
};

function normalizeCandle(x) {
  if (!x) return null;
  const time = Number(x.time ?? x[0]);
  const open = Number(x.open ?? x[1]);
  const high = Number(x.high ?? x[2]);
  const low = Number(x.low ?? x[3]);
  const close = Number(x.close ?? x[4]);
  const volume = Number(x.volume ?? x[5]);
  const confirmed = x.confirmed === true || x.confirmed === '1' || x[8] === '1';
  if (!Number.isFinite(time) || ![open, high, low, close, volume].every(Number.isFinite)) return null;
  return { time, open, high, low, close, volume, confirmed };
}

function compactCandles(rows, tf) {
  const closed = (Array.isArray(rows) ? rows : []).map(normalizeCandle).filter(x => x?.confirmed).slice(-1000);
  const last = closed.at(-1);
  const first = closed[0];
  const recent = closed.slice(-(TF_LIMITS[tf] || 4)).map(x => [x.time,x.open,x.high,x.low,x.close,x.volume]);
  return {
    storedClosedBars: closed.length,
    oldest: first?.time ?? null,
    newest: last?.time ?? null,
    rangeHigh: closed.length ? Math.max(...closed.map(x=>x.high)) : null,
    rangeLow: closed.length ? Math.min(...closed.map(x=>x.low)) : null,
    changePct: first?.close ? ((last.close-first.close)/first.close)*100 : null,
    recentBars: recent.map(x=>[x.time,x.open,x.high,x.low,x.close,x.volume])
  };
}

function compactFeatures(featureSummary) {
  return Object.fromEntries(Object.entries(featureSummary || {}).map(([tf,f]) => [tf, {
    last: f?.lastCandle ? {
      time:f.lastCandle.time ?? null,
      open:f.lastCandle.open ?? null,
      high:f.lastCandle.high ?? null,
      low:f.lastCandle.low ?? null,
      close:f.lastCandle.close ?? null,
      volume:f.lastCandle.volume ?? null
    } : null,
    indicators: f?.indicators ? {
      ema20:f.indicators.ema20 ?? null,
      ema50:f.indicators.ema50 ?? null,
      ema200:f.indicators.ema200 ?? null,
      rsi:f.indicators.rsi14 ?? null,
      atr:f.indicators.atr14 ?? null,
      vwap:f.indicators.vwap ?? null,
      macdHist:f.indicators.macdHistogram ?? null,
      volRatio:f.indicators.volumeRatio20 ?? null
    } : null,
    momentum:f?.momentum ? {
      pct:f.momentum.priceChangePct1 ?? null,
      above20:f.momentum.aboveEma20 ?? null,
      above50:f.momentum.aboveEma50 ?? null,
      above200:f.momentum.aboveEma200 ?? null
    } : null
  }]));
}

function compactExternal(external) {
  if (!external) return null;
  const providers = Object.fromEntries(
    Object.entries(external.providers || {}).map(([name,p]) => [name, p ? {
      available:p.available === true,
      route:p.route ?? null,
      price:p.price ?? null,
      markPrice:p.markPrice ?? null,
      indexPrice:p.indexPrice ?? null,
      fundingRate:p.fundingRate ?? p.currentFunding ?? null,
      openInterest:p.openInterest ?? null,
      options:p.options ? {
        totalOI:p.options.totalOI ?? null,
        putCallOI:p.options.putCallOI ?? null,
        weightedIV:p.options.weightedIV ?? null
      } : null
    } : null])
  );
  const persistedHistory = Object.fromEntries(
    Object.entries(external.persistedHistory || {}).map(([source,byTf]) => [source,
      Object.fromEntries(Object.entries(byTf || {}).map(([tf,rows]) => {
        const list = Array.isArray(rows) ? rows.filter(x=>x?.confirmed===true) : [];
        const last = list.at(-1);
        return [tf,{storedRows:list.length,newest:last?.time_ms ?? null,recentBars:list.slice(-2).map(x=>[Number(x.time_ms),Number(x.open),Number(x.high),Number(x.low),Number(x.close),Number(x.volume??0)])}];
      }))
    ])
  );
  return {
    fetchedAt: external.fetchedAt ?? null,
    crossExchange: external.crossExchange ?? null,
    featureSignals: external.featureSignals ?? null,
    providers,
    persistedHistory
  };
}

function compact35(indicators){if(!indicators)return null;return{version:indicators.version??null,indicatorCount:indicators.indicatorCount??0,calculatedCount:indicators.calculatedCount??0,asOf:indicators.asOf??null,quality:indicators.quality??null,timeframes:Object.fromEntries(Object.entries(indicators.perTimeframe||{}).map(([tf,rows])=>[tf,Object.fromEntries(Object.entries(rows||{}).map(([id,x])=>[id,{name:x.name??null,category:x.category??null,score:x.current?.score??null,state:x.current?.state??null,features:x.current?.features??{},history:x.history??null,sampledHistory:Array.isArray(x.sampledHistory)?x.sampledHistory.slice(-6):[],warnings:x.current?.diagnostics?.warnings??[]}]))]))};}

function compactMacro(macro) {
  if (!macro) return null;
  return {
    source:macro.source ?? 'FRED',
    status:macro.status ?? 'UNKNOWN',
    fetchedAt:macro.fetchedAt ?? null,
    latest:Object.fromEntries(Object.entries(macro.series || {}).map(([id,s]) => [id, Array.isArray(s?.observations) ? s.observations.at(-1) : null]))
  };
}

function compactMarket(market) {
  const book = market.orderBook || null;
  return {
    price:market.price ?? null,
    openInterest:market.openInterest ?? null,
    fundingRate:market.fundingRate ?? null,
    nextFundingTime:market.nextFundingTime ?? null,
    nextFundingRate:market.nextFundingRate ?? null,
    oi: Array.isArray(market.oiHistory) ? market.oiHistory.at(-1) : null,
    funding: Array.isArray(market.fundingHistory) ? market.fundingHistory.at(-1) : null,
    longShort: Array.isArray(market.longShortHistory) ? market.longShortHistory.at(-1) : null,
    takerVolume: Array.isArray(market.takerVolumeHistory) ? market.takerVolumeHistory.at(-1) : null,
    trades: Array.isArray(market.trades) ? market.trades.slice(-2) : [],
    orderBook: book ? {
      time:book.time ?? book.ts ?? null,
      bids:Array.isArray(book.bids) ? book.bids.slice(0,1) : [],
      asks:Array.isArray(book.asks) ? book.asks.slice(0,1) : []
    } : null,
    liquidationCount:Array.isArray(market.liquidationHistory) ? market.liquidationHistory.length : 0
  };
}

function compactRealtimeMemory(memory) {
  const value = memory?.value || memory || null;
  if (!value || typeof value !== 'object') return { configured: memory?.configured === true, cached: false, updatedAt: null, snapshot: null };
  return {
    configured: memory?.configured !== false,
    cached: true,
    key: memory?.key ?? 'scalp-omega:ETH-USDT-SWAP:live',
    updatedAt: value.updatedAt ?? null,
    source: value.source ?? null,
    instrument: value.instrument ?? null,
    ticker: value.ticker ?? null,
    latestTrade: value.latestTrade ?? null,
    derivatives: value.derivatives ?? null,
    delta: value.delta ?? null,
    shortCandles: Object.fromEntries(Object.entries(value.shortCandles || {}).map(([tf, rows]) => [tf, (Array.isArray(rows) ? rows : []).slice(-6).map(normalizeCandle).filter(Boolean)])),
    orderBook: value.orderBook ? {
      time: value.orderBook.time ?? value.orderBook.ts ?? null,
      bids: Array.isArray(value.orderBook.bids) ? value.orderBook.bids.slice(0, 3) : [],
      asks: Array.isArray(value.orderBook.asks) ? value.orderBook.asks.slice(0, 3) : []
    } : null
  };
}

export function compactAiInput(raw) {
  const market = raw.market || {};
  const candleContext = Object.fromEntries(
    Object.entries(market.candlesByTf || {}).map(([tf,rows]) => [tf,compactCandles(rows,tf)])
  );
  return {
    engine:raw.engine,
    decisionAuthority:raw.decisionAuthority,
    decisionPolicy:raw.decisionPolicy,
    source:raw.source,
    instrument:raw.instrument,
    analysisMode:raw.analysisMode,
    fetchedAt:raw.fetchedAt,
    market:compactMarket(market),
    featureSummary:compactFeatures(raw.featureSummary),
    indicatorFeatures:compact35(raw.indicatorFeatures || null),
    externalIntelligence:compactExternal(raw.externalIntelligence || null),
    macroContext:compactMacro(raw.macroContext || null),
    realtimeMemory:compactRealtimeMemory(raw.realtimeMemory || raw.memory || null),
    timeframeContext: Object.fromEntries(Object.entries(candleContext).map(([tf,x])=>[tf,{storedClosedBars:x.storedClosedBars,oldest:x.oldest,newest:x.newest,rangeHigh:x.rangeHigh,rangeLow:x.rangeLow,changePct:x.changePct}])),
    realtime:raw.realtime ? {
      source:raw.realtime.source ?? null,
      receivedAt:raw.realtime.receivedAt ?? null,
      connected:raw.realtime.connected === true,
      ticker:raw.realtime.ticker ?? null
    } : null,
    memoryPolicy:{
      historicalStore:'SUPABASE',
      realtimeStore:'UPSTASH_REDIS',
      rawHistoricalCandlesSentToModel:false,
      fullHistoricalCandlesPersisted:true,
      fullHistoryAvailableViaSupabase:true,
      configuredTimeframes:Object.fromEntries(Object.entries(candleContext).map(([tf,x])=>[tf,{storedClosedBars:x.storedClosedBars,recentBars:x.recentBars.length}]))
    }
  };
}
