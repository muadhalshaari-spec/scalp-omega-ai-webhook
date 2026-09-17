export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const instId = 'ETH-USDT-SWAP';
  const bars = [
    ['1m', 300],
    ['5m', 300],
    ['15m', 300],
    ['1H', 300],
    ['4H', 300],
    ['1D', 300]
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  const fetchJson = async url => {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': 'SCALP-Omega-DataEngine/2.0' },
      cache: 'no-store',
      signal: controller.signal
    });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    if (!response.ok || data?.code !== '0') {
      throw new Error(`OKX HTTP ${response.status}: ${data?.msg || text.slice(0, 200)}`);
    }
    return data;
  };

  const normalizeCandles = rows => rows.map(c => ({
    time: Number(c[0]), open: Number(c[1]), high: Number(c[2]), low: Number(c[3]), close: Number(c[4]),
    volume: Number(c[5]), volumeBase: Number(c[6]), volumeQuote: Number(c[7]), confirmed: c[8] === '1'
  })).reverse();

  const sma = (values, period) => values.length < period ? null : values.slice(-period).reduce((a, b) => a + b, 0) / period;

  const emaSeries = (values, period) => {
    if (values.length < period) return [];
    const k = 2 / (period + 1);
    let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    const out = new Array(period - 1).fill(null);
    out.push(ema);
    for (let i = period; i < values.length; i++) {
      ema = values[i] * k + ema * (1 - k);
      out.push(ema);
    }
    return out;
  };

  const rsi = (values, period = 14) => {
    if (values.length <= period) return null;
    let gain = 0, loss = 0;
    for (let i = 1; i <= period; i++) {
      const d = values[i] - values[i - 1];
      if (d >= 0) gain += d; else loss -= d;
    }
    let avgGain = gain / period;
    let avgLoss = loss / period;
    for (let i = period + 1; i < values.length; i++) {
      const d = values[i] - values[i - 1];
      const g = Math.max(d, 0);
      const l = Math.max(-d, 0);
      avgGain = (avgGain * (period - 1) + g) / period;
      avgLoss = (avgLoss * (period - 1) + l) / period;
    }
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  };

  const atr = (candles, period = 14) => {
    if (candles.length <= period) return null;
    const trs = [];
    for (let i = 1; i < candles.length; i++) {
      const c = candles[i], p = candles[i - 1];
      trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
    }
    let value = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < trs.length; i++) value = (value * (period - 1) + trs[i]) / period;
    return value;
  };

  const vwap = candles => {
    if (!candles.length) return null;
    let pv = 0, vol = 0;
    for (const c of candles) {
      const typical = (c.high + c.low + c.close) / 3;
      pv += typical * c.volume;
      vol += c.volume;
    }
    return vol ? pv / vol : null;
  };

  const pivotStructure = (candles, left = 3, right = 3) => {
    const highs = [], lows = [];
    for (let i = left; i < candles.length - right; i++) {
      let high = true, low = true;
      for (let j = i - left; j <= i + right; j++) {
        if (j !== i && candles[j].high >= candles[i].high) high = false;
        if (j !== i && candles[j].low <= candles[i].low) low = false;
      }
      if (high) highs.push({ index: i, price: candles[i].high, time: candles[i].time });
      if (low) lows.push({ index: i, price: candles[i].low, time: candles[i].time });
    }
    const lastHighs = highs.slice(-4);
    const lastLows = lows.slice(-4);
    const classify = points => {
      if (points.length < 2) return [];
      return points.map((p, i) => i === 0 ? { ...p, type: 'INITIAL' } : { ...p, type: p.price > points[i - 1].price ? 'HH' : p.price < points[i - 1].price ? 'LH' : 'EQH' });
    };
    const classifyLows = points => {
      if (points.length < 2) return [];
      return points.map((p, i) => i === 0 ? { ...p, type: 'INITIAL' } : { ...p, type: p.price > points[i - 1].price ? 'HL' : p.price < points[i - 1].price ? 'LL' : 'EQL' });
    };
    return { highs: classify(lastHighs), lows: classifyLows(lastLows) };
  };

  const featurePack = candles => {
    const closes = candles.map(c => c.close);
    const volumes = candles.map(c => c.volume);
    const ema20s = emaSeries(closes, 20);
    const ema50s = emaSeries(closes, 50);
    const ema200s = emaSeries(closes, 200);
    const fast = emaSeries(closes, 12);
    const slow = emaSeries(closes, 26);
    let macd = null, signal = null, histogram = null;
    if (fast.length && slow.length) {
      const aligned = [];
      for (let i = 0; i < closes.length; i++) if (fast[i] != null && slow[i] != null) aligned.push(fast[i] - slow[i]);
      const sig = emaSeries(aligned, 9);
      if (aligned.length) {
        macd = aligned[aligned.length - 1];
        signal = sig.length ? sig[sig.length - 1] : null;
        histogram = signal == null ? null : macd - signal;
      }
    }
    const structure = pivotStructure(candles);
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const avgVol20 = sma(volumes, 20);
    const range = last.high - last.low;
    const body = Math.abs(last.close - last.open);
    const direction = last.close > last.open ? 'BULLISH' : last.close < last.open ? 'BEARISH' : 'NEUTRAL';
    return {
      status: 'CALCULATED',
      lastCandle: { time: last.time, open: last.open, high: last.high, low: last.low, close: last.close, volume: last.volume, confirmed: last.confirmed },
      indicators: {
        ema20: ema20s.at(-1), ema50: ema50s.at(-1), ema200: ema200s.at(-1),
        rsi14: rsi(closes, 14), atr14: atr(candles, 14), vwap: vwap(candles),
        macd, macdSignal: signal, macdHistogram: histogram,
        volumeSma20: avgVol20,
        volumeRatio20: avgVol20 ? last.volume / avgVol20 : null
      },
      candle: {
        direction, range, body, bodyRatio: range ? body / range : null,
        upperWick: last.high - Math.max(last.open, last.close),
        lowerWick: Math.min(last.open, last.close) - last.low
      },
      momentum: {
        priceChange1: last.close - prev.close,
        priceChangePct1: prev.close ? ((last.close - prev.close) / prev.close) * 100 : null,
        aboveEma20: ema20s.at(-1) == null ? null : last.close > ema20s.at(-1),
        aboveEma50: ema50s.at(-1) == null ? null : last.close > ema50s.at(-1),
        aboveEma200: ema200s.at(-1) == null ? null : last.close > ema200s.at(-1)
      },
      structure
    };
  };

  try {
    const candleResults = await Promise.all(bars.map(async ([bar, limit]) => {
      const data = await fetchJson(`https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=${limit}`);
      return [bar, normalizeCandles(data.data)];
    }));

    const [tickerData, oiData, fundingData, bookData] = await Promise.all([
      fetchJson(`https://www.okx.com/api/v5/market/ticker?instId=${instId}`),
      fetchJson(`https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=${instId}`),
      fetchJson(`https://www.okx.com/api/v5/public/funding-rate?instId=${instId}`),
      fetchJson(`https://www.okx.com/api/v5/market/books?instId=${instId}&sz=20`)
    ]);

    const ticker = tickerData.data?.[0] || null;
    const oi = oiData.data?.[0] || null;
    const funding = fundingData.data?.[0] || null;
    const book = bookData.data?.[0] || null;
    const orderBook = book ? {
      time: Number(book.ts),
      bids: (book.bids || []).map(x => ({ price: Number(x[0]), size: Number(x[1]), orders: Number(x[3] || 0) })),
      asks: (book.asks || []).map(x => ({ price: Number(x[0]), size: Number(x[1]), orders: Number(x[3] || 0) }))
    } : null;

    const candles = Object.fromEntries(candleResults);
    const features = Object.fromEntries(candleResults.map(([bar, data]) => [bar, featurePack(data)]));

    return res.status(200).json({
      ok: true,
      engine: 'SCALP-Ω Data + Feature Engine v2',
      dataStatus: 'OBSERVED',
      calculatedStatus: 'CALCULATED',
      source: 'OKX',
      instrument: instId,
      marketType: 'USDT perpetual swap',
      fetchedAt: new Date().toISOString(),
      ticker: ticker ? {
        last: Number(ticker.last), bid: Number(ticker.bidPx), ask: Number(ticker.askPx),
        high24h: Number(ticker.high24h), low24h: Number(ticker.low24h),
        volume24h: Number(ticker.vol24h), volume24hBase: Number(ticker.volCcy24h), ts: Number(ticker.ts)
      } : null,
      openInterest: oi ? { oi: Number(oi.oi), oiCcy: Number(oi.oiCcy), ts: Number(oi.ts) } : null,
      funding: funding ? {
        fundingRate: Number(funding.fundingRate), nextFundingRate: funding.nextFundingRate ? Number(funding.nextFundingRate) : null,
        fundingTime: Number(funding.fundingTime), nextFundingTime: Number(funding.nextFundingTime)
      } : null,
      orderBook,
      features,
      candles,
      counts: Object.fromEntries(candleResults.map(([bar, data]) => [bar, data.length]))
    });
  } catch (error) {
    return res.status(502).json({
      ok: false, source: 'OKX', error: error?.name === 'AbortError' ? 'OKX request timed out after 15 seconds' : error?.message || String(error)
    });
  } finally {
    clearTimeout(timeout);
  }
}
