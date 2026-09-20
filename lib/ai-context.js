const TF_LIMITS = {
  '1m': { recent: 120, anchors: 20 },
  '5m': { recent: 120, anchors: 20 },
  '15m': { recent: 160, anchors: 24 },
  '1H': { recent: 120, anchors: 20 },
  '4H': { recent: 100, anchors: 18 },
  '1D': { recent: 80, anchors: 16 }
};

function asCandle(x) {
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

function contextSeries(candles, timeframe) {
  const all = (candles || []).map(asCandle).filter(Boolean).filter(c => c.confirmed);
  const cfg = TF_LIMITS[timeframe] || { recent: 100, anchors: 16 };
  const recent = all.slice(-cfg.recent);
  const historical = all.slice(0, Math.max(0, all.length - cfg.recent));
  const anchors = [];

  if (historical.length) {
    const count = Math.min(cfg.anchors, historical.length);
    for (let i = 0; i < count; i += 1) {
      const idx = Math.min(
        historical.length - 1,
        Math.floor((i * historical.length) / Math.max(1, count - 1 || 1))
      );
      anchors.push(historical[idx]);
    }
  }

  const byTime = new Map();
  for (const c of [...anchors, ...recent]) byTime.set(c.time, c);
  const bars = [...byTime.values()].sort((a, b) => a.time - b.time);

  const highs = all.map(c => c.high);
  const lows = all.map(c => c.low);
  const closes = all.map(c => c.close);
  const last = all.at(-1);
  const close100 = closes.length > 100 ? closes.at(-101) : closes[0];

  return {
    count: all.length,
    oldest: all[0]?.time ?? null,
    newest: last?.time ?? null,
    rangeAll: {
      high: highs.length ? Math.max(...highs) : null,
      low: lows.length ? Math.min(...lows) : null
    },
    recentRange: {
      high: recent.length ? Math.max(...recent.map(c => c.high)) : null,
      low: recent.length ? Math.min(...recent.map(c => c.low)) : null
    },
    changePctFromStart: closes.length && closes[0] ? ((last.close - closes[0]) / closes[0]) * 100 : null,
    changePct100: close100 ? ((last.close - close100) / close100) * 100 : null,
    bars
  };
}

function capArray(arr, n) {
  return Array.isArray(arr) ? arr.slice(-n) : [];
}

function compactOrderBook(book, depth = 40) {
  if (!book) return null;
  if (book.raw) {
    return {
      ...book,
      raw: {
        ...book.raw,
        bids: capArray(book.raw.bids, depth),
        asks: capArray(book.raw.asks, depth)
      }
    };
  }
  return {
    ...book,
    bids: capArray(book.bids, depth),
    asks: capArray(book.asks, depth)
  };
}

function compactNestedArrays(value, limit = 80) {
  if (Array.isArray(value)) return capArray(value, limit);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = compactNestedArrays(v, limit);
  return out;
}

export function compactAiInput(raw, { previousLive = null } = {}) {
  const market = raw.market || {};
  const external = raw.externalIntelligence || null;
  const macro = raw.macroContext || null;

  // Send the full closed-candle history to GPT, candle-by-candle.
  // Each candle is encoded compactly as [time, open, high, low, close, volume]
  // to preserve all 1000 observations per timeframe without repeating object keys.
  const candleContext = Object.fromEntries(
    Object.entries(market.candlesByTf || {}).map(([tf, candles]) => {
      const all = (candles || []).map(asCandle).filter(Boolean);
      const closed = all.filter(c => c.confirmed).slice(-1000);
      return [tf, {
        count: closed.length,
        oldest: closed[0]?.time ?? null,
        newest: closed.at(-1)?.time ?? null,
        bars: closed.map(c => [c.time, c.open, c.high, c.low, c.close, c.volume])
      }];
    })
  );

  const externalCompact = external ? {
    ok: external.ok,
    fetchedAt: external.fetchedAt,
    crossExchange: external.crossExchange,
    featureSignals: external.featureSignals,
    dataQuality: external.dataQuality,
    providers: Object.fromEntries(
      Object.entries(external.providers || {}).map(([name, p]) => {
        if (!p) return [name, null];

        const out = {
          available: p.available === true,
          source: p.source || null,
          timestamp: p.timestamp || null,
          price: p.price ?? null,
          markPrice: p.markPrice ?? null,
          indexPrice: p.indexPrice ?? null,
          fundingRate: p.fundingRate ?? p.currentFunding ?? null,
          nextFundingRate: p.nextFundingRate ?? null,
          openInterest: p.openInterest ?? null,
          book: compactOrderBook(p.book, 40),
          options: p.options || null
        };

        if (p.futures) {
          out.futures = {
            ticker: p.futures.ticker || p.futures.ticker24h || null,
            orderBook: compactOrderBook(p.futures.orderBook, 40),
            trades: capArray(p.futures.trades, 120),
            aggTrades: capArray(p.futures.aggTrades, 120),
            markAndFunding: p.futures.markAndFunding || null,
            openInterest: p.futures.openInterest || null,
            histories: compactNestedArrays(p.futures.histories, 80),
            candles: compactNestedArrays(p.futures.candles, 80),
            riskAndStructure: p.futures.riskAndStructure || null
          };
        }

        if (p.spot) {
          out.spot = {
            ticker: p.spot.ticker || p.spot.ticker24h || null,
            orderBook: compactOrderBook(p.spot.orderBook, 40),
            trades: capArray(p.spot.trades, 80),
            aggTrades: capArray(p.spot.aggTrades, 80),
            candles: compactNestedArrays(p.spot.candles, 80)
          };
        }

        return [name, out];
      })
    )
  } : null;

  const macroCompact = macro ? {
    source: macro.source || 'FRED',
    provider: macro.provider || null,
    status: macro.status || 'UNKNOWN',
    fetchedAt: macro.fetchedAt || null,
    series: Object.fromEntries(
      Object.entries(macro.series || {}).map(([id, s]) => [id, {
        id: s.id || id,
        title: s.title || null,
        observations: capArray(s.observations, 12),
        realtimeStart: s.realtimeStart || null,
        realtimeEnd: s.realtimeEnd || null
      }])
    ),
    errors: macro.errors || {}
  } : null;

  return {
    ...raw,
    market: {
      ...market,
      candlesByTf: undefined,
      candlesByExchange: undefined,
      oiHistory: capArray(market.oiHistory, 100),
      fundingHistory: capArray(market.fundingHistory, 100),
      longShortHistory: capArray(market.longShortHistory, 100),
      takerVolumeHistory: capArray(market.takerVolumeHistory, 100),
      trades: capArray(market.trades, 100),
      orderBook: compactOrderBook(market.orderBook, 20),
      liquidations: capArray(market.liquidations, 160),
      liquidationHistory: capArray(market.liquidationHistory, 160)
    },
    candleContext,
    externalIntelligence: externalCompact,
    macroContext: macroCompact,
    previousLiveMemory: previousLive?.value || null,
    memoryPolicy: {
      historicalStore: 'SUPABASE',
      realtimeStore: 'UPSTASH_REDIS',
      rawHistoricalCandlesSentToModel: true,
      macroContextSentToModel: macroCompact != null,
      configuredTimeframes: Object.fromEntries(
        Object.entries(candleContext).map(([tf, x]) => [
          tf,
          { sourceCount: x.count, barsSent: x.bars.length, format: '[time,open,high,low,close,volume]' }
        ])
      )
    }
  };
}
