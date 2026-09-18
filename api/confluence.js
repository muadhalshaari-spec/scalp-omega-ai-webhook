import { buildMarketContext } from '../lib/scalp-engine.js';
import { buildConfluence } from '../lib/confluence-engine.js';
import { buildInstitutionalAnalysis } from '../lib/institutional-engine.js';
import { fetchDerivativeData } from '../lib/derivatives-data.js';
import { fetchExternalIntelligence } from '../lib/external-intelligence.js';

export const maxDuration = 60;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const instId = 'ETH-USDT-SWAP';
  const bars = ['1m', '5m', '15m', '1H', '4H', '1D'];
  const CANDLE_TARGET = 1000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55_000);

  const fetchJson = async (url) => {
    const r = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'SCALP-Omega-ConfluenceEngine/1.0'
      },
      cache: 'no-store',
      signal: controller.signal
    });

    const text = await r.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {}

    if (!r.ok || data?.code !== '0') {
      throw new Error(`OKX HTTP ${r.status}: ${data?.msg || text.slice(0, 200)}`);
    }

    return data;
  };

  const fetchCandles = async (bar) => {
    const out = [];
    let after = null;

    for (let page = 0; page < 5 && out.length < CANDLE_TARGET; page++) {
      const params = new URLSearchParams({ instId, bar, limit: '300' });
      if (after != null) params.set('after', String(after));
      const data = await fetchJson(`https://www.okx.com/api/v5/market/candles?${params.toString()}`);
      const rows = data.data || [];
      if (!rows.length) break;
      out.push(...rows);
      const oldest = Number(rows[rows.length - 1][0]);
      if (!Number.isFinite(oldest) || oldest === after) break;
      after = oldest;
      if (rows.length < 300) break;
    }

    const unique = new Map(out.map(row => [String(row[0]), row]));
    return [...unique.values()]
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .slice(-CANDLE_TARGET);
  };

  // Keep candles in ascending chronological order. The previous reverse()
  // made featurePack() select the oldest closed candle instead of the latest.
  const normalize = (rows) => rows.map((c) => ({
    time: Number(c[0]),
    open: Number(c[1]),
    high: Number(c[2]),
    low: Number(c[3]),
    close: Number(c[4]),
    volume: Number(c[5]),
    volumeBase: Number(c[6]),
    volumeQuote: Number(c[7]),
    confirmed: c[8] === '1'
  }));

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

  const sma = (values, period) => values.length < period
    ? null
    : values.slice(-period).reduce((a, b) => a + b, 0) / period;

  const rsi = (values, period = 14) => {
    if (values.length <= period) return null;
    let gain = 0;
    let loss = 0;

    for (let i = 1; i <= period; i++) {
      const d = values[i] - values[i - 1];
      if (d >= 0) gain += d;
      else loss -= d;
    }

    let avgGain = gain / period;
    let avgLoss = loss / period;

    for (let i = period + 1; i < values.length; i++) {
      const d = values[i] - values[i - 1];
      avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    }

    if (avgLoss === 0) return 100;
    return 100 - (100 / (1 + avgGain / avgLoss));
  };

  const atr = (candles, period = 14) => {
    if (candles.length <= period) return null;
    const trs = [];

    for (let i = 1; i < candles.length; i++) {
      const c = candles[i];
      const p = candles[i - 1];
      trs.push(Math.max(
        c.high - c.low,
        Math.abs(c.high - p.close),
        Math.abs(c.low - p.close)
      ));
    }

    let value = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < trs.length; i++) {
      value = (value * (period - 1) + trs[i]) / period;
    }
    return value;
  };

  const vwap = (candles) => {
    let pv = 0;
    let vol = 0;

    for (const c of candles) {
      const typical = (c.high + c.low + c.close) / 3;
      pv += typical * c.volume;
      vol += c.volume;
    }

    return vol ? pv / vol : null;
  };

  const featurePack = (candles) => {
    // Confluence uses only closed candles to prevent the active candle from affecting decisions.
    const closed = candles.filter((c) => c.confirmed);
    if (closed.length < 210) {
      return { status: 'INSUFFICIENT_CLOSED_DATA', count: closed.length };
    }

    const closes = closed.map((c) => c.close);
    const volumes = closed.map((c) => c.volume);
    const ema20 = emaSeries(closes, 20);
    const ema50 = emaSeries(closes, 50);
    const ema200 = emaSeries(closes, 200);
    const fast = emaSeries(closes, 12);
    const slow = emaSeries(closes, 26);
    const macdValues = [];

    for (let i = 0; i < closes.length; i++) {
      if (fast[i] != null && slow[i] != null) {
        macdValues.push(fast[i] - slow[i]);
      }
    }

    const sig = emaSeries(macdValues, 9);
    const macd = macdValues.at(-1) ?? null;
    const macdSignal = sig.at(-1) ?? null;
    const last = closed.at(-1);
    const prev = closed.at(-2);
    const e20 = ema20.at(-1);
    const e50 = ema50.at(-1);
    const e200 = ema200.at(-1);
    const avgVol20 = sma(volumes, 20);

    return {
      status: 'CALCULATED_CLOSED_ONLY',
      lastCandle: {
        time: last.time,
        open: last.open,
        high: last.high,
        low: last.low,
        close: last.close,
        volume: last.volume,
        confirmed: true
      },
      indicators: {
        ema20: e20,
        ema50: e50,
        ema200: e200,
        rsi14: rsi(closes, 14),
        atr14: atr(closed, 14),
        vwap: vwap(closed),
        macd,
        macdSignal,
        macdHistogram: macd != null && macdSignal != null ? macd - macdSignal : null,
        volumeSma20: avgVol20,
        volumeRatio20: avgVol20 ? last.volume / avgVol20 : null
      },
      momentum: {
        priceChange1: last.close - prev.close,
        priceChangePct1: prev.close ? ((last.close - prev.close) / prev.close) * 100 : null,
        aboveEma20: e20 == null ? null : last.close > e20,
        aboveEma50: e50 == null ? null : last.close > e50,
        aboveEma200: e200 == null ? null : last.close > e200
      }
    };
  };

  try {
    const candleResults = await Promise.all(
      bars.map(async (bar) => [bar, normalize(await fetchCandles(bar))])
    );

    const [tickerData, oiData, fundingData, bookData, tradesData] = await Promise.all([
      fetchJson(`https://www.okx.com/api/v5/market/ticker?instId=${instId}`),
      fetchJson(`https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=${instId}`),
      fetchJson(`https://www.okx.com/api/v5/public/funding-rate?instId=${instId}`),
      fetchJson(`https://www.okx.com/api/v5/market/books?instId=${instId}&sz=20`),
      fetchJson(`https://www.okx.com/api/v5/market/trades?instId=${instId}&limit=100`)
    ]);

    const book = bookData.data?.[0] || null;
    const orderBook = book ? {
      time: Number(book.ts),
      bids: (book.bids || []).map((x) => ({
        price: Number(x[0]),
        size: Number(x[1]),
        orders: Number(x[3] || 0)
      })),
      asks: (book.asks || []).map((x) => ({
        price: Number(x[0]),
        size: Number(x[1]),
        orders: Number(x[3] || 0)
      }))
    } : null;

    const candles = Object.fromEntries(candleResults);
    const features = Object.fromEntries(
      candleResults.map(([bar, data]) => [bar, featurePack(data)])
    );

    const contexts = Object.fromEntries(
      candleResults.map(([bar, data]) => {
        const closed = data.filter((c) => c.confirmed);
        return [bar, closed.length >= 20 ? buildMarketContext(closed, orderBook) : null];
      })
    );

    const base15m = candles['15m'] || [];
    const derivativesData = await fetchDerivativeData({
      instId,
      begin: base15m[0]?.time ?? null,
      end: base15m.at(-1)?.time ?? null,
      mode: 'live',
      signal: controller.signal
    });

    const derivativesCurrent = derivativesData.current || {};
    const ticker = tickerData.data?.[0] || null;

    const externalIntelligence = await fetchExternalIntelligence({ symbol: 'ETHUSDT', signal: controller.signal }).catch(() => ({ ok:false, providers:{}, crossExchange:{agreement:'UNAVAILABLE'} }));

    const market = {
      price: ticker ? Number(ticker.last) : null,
      openInterest: derivativesCurrent.openInterest,
      fundingRate: derivativesCurrent.fundingRate,
      fundingTime: derivativesCurrent.fundingTime,
      nextFundingTime: derivativesCurrent.nextFundingTime,
      nextFundingRate: derivativesCurrent.nextFundingRate,
      settState: derivativesCurrent.settState,
      oiHistory: derivativesData.history.oi,
      fundingHistory: derivativesData.history.funding,
      longShortHistory: derivativesData.history.longShort,
      takerVolumeHistory: derivativesData.history.takerVolume,
      orderBook,
      trades: tradesData.data || [],
      instrument: instId,
      externalIntelligence
    };

    const confluence = buildConfluence({ features, contexts, market });
    const institutional = buildInstitutionalAnalysis({
      candlesByTf: candles,
      market,
      realtime: { orderBook, trades: tradesData.data || [] },
      externalEvents: [],
      timestamp: Date.now()
    });

    const newestCandleTs = Object.fromEntries(
      candleResults.map(([bar, data]) => [bar, data.at(-1)?.time ?? null])
    );
    const oldestCandleTs = Object.fromEntries(
      candleResults.map(([bar, data]) => [bar, data.at(0)?.time ?? null])
    );
    const newestClosedCandleTs = Object.fromEntries(
      candleResults.map(([bar, data]) => [bar, data.filter((c) => c.confirmed).at(-1)?.time ?? null])
    );

    const payload = {
      ok: true,
      engine: 'SCALP-Ω Confluence Engine v1',
      source: 'OKX',
      instrument: instId,
      analysisMode: 'CLOSED_CANDLES_ONLY',
      fetchedAt: new Date().toISOString(),
      market,
      externalIntelligence,
      confluence,
      institutional,
      dataQuality: {
        candlesPerTimeframe: Object.fromEntries(
          candleResults.map(([bar, data]) => [bar, data.length])
        ),
        closedCandlesPerTimeframe: Object.fromEntries(
          candleResults.map(([bar, data]) => [bar, data.filter((c) => c.confirmed).length])
        ),
        oldestCandleTs,
        newestCandleTs,
        newestClosedCandleTs,
        chronologicalOrder: Object.fromEntries(
          candleResults.map(([bar, data]) => [bar, (data.length < 2 || data[0].time <= data.at(-1).time)])
        )
      },
      featureSummary: Object.fromEntries(
        Object.entries(features).map(([bar, f]) => [
          bar,
          f.status === 'CALCULATED_CLOSED_ONLY'
            ? { lastCandle: f.lastCandle, indicators: f.indicators, momentum: f.momentum }
            : { status: f.status, count: f.count }
        ])
      )
    };

    // Return stable, human-readable English JSON for clean copy/paste.
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    return res.status(200).send(JSON.stringify(payload, null, 2));
  } catch (error) {
    const payload = {
      ok: false,
      source: 'OKX',
      error: error?.name === 'AbortError'
        ? 'OKX request timed out after 55 seconds'
        : error?.message || String(error)
    };

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    return res.status(502).send(JSON.stringify(payload, null, 2));
  } finally {
    clearTimeout(timeout);
  }
}
