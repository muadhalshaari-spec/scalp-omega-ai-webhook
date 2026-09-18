import { buildMarketContext } from './scalp-engine.js';

const emaSeries = (values, period) => {
  if (values.length < period) return Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out = Array(period - 1).fill(null);
  out.push(ema);
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    out.push(ema);
  }
  return out;
};

const rsiSeries = (values, period = 14) => {
  const out = Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  }
  return out;
};

const atrSeries = (candles, period = 14) => {
  const out = Array(candles.length).fill(null);
  if (candles.length <= period) return out;
  const trs = Array(candles.length).fill(null);
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    trs[i] = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
  }
  let value = trs.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  out[period] = value;
  for (let i = period + 1; i < candles.length; i++) {
    value = (value * (period - 1) + trs[i]) / period;
    out[i] = value;
  }
  return out;
};

const featureSeries = (candles) => {
  const closed = candles.filter(c => c.confirmed);
  const closes = closed.map(c => c.close);
  const volumes = closed.map(c => c.volume);
  const e20 = emaSeries(closes, 20);
  const e50 = emaSeries(closes, 50);
  const e200 = emaSeries(closes, 200);
  const fast = emaSeries(closes, 12);
  const slow = emaSeries(closes, 26);
  const macd = closes.map((_, i) => fast[i] != null && slow[i] != null ? fast[i] - slow[i] : null);
  const signal = emaSeries(macd.filter(x => x != null), 9);
  const rsi = rsiSeries(closes);
  const atr = atrSeries(closed);
  const result = new Map();
  let signalOffset = 0;
  for (let i = 0; i < closes.length; i++) {
    if (macd[i] != null) {
      const sigIndex = i - 26 + 1;
      const sig = sigIndex >= 0 ? signal[sigIndex] : null;
      result.set(closed[i].time, {
        lastCandle: closed[i],
        indicators: {
          ema20: e20[i], ema50: e50[i], ema200: e200[i],
          rsi14: rsi[i], atr14: atr[i],
          macd: macd[i], macdSignal: sig,
          macdHistogram: sig == null ? null : macd[i] - sig,
          volumeRatio20: volumes.slice(Math.max(0, i - 19), i + 1).reduce((a,b)=>a+b,0) /
            Math.max(1, volumes.slice(Math.max(0, i - 19), i + 1).length) > 0
              ? volumes[i] / (volumes.slice(Math.max(0, i - 19), i + 1).reduce((a,b)=>a+b,0) /
                Math.max(1, volumes.slice(Math.max(0, i - 19), i + 1).length))
              : null
        },
        momentum: {
          aboveEma20: e20[i] == null ? null : closes[i] > e20[i],
          aboveEma50: e50[i] == null ? null : closes[i] > e50[i],
          aboveEma200: e200[i] == null ? null : closes[i] > e200[i]
        }
      });
    }
  }
  return result;
};

function trendDirection(feature) {
  if (!feature?.indicators || !feature?.momentum) return 'NEUTRAL';
  const i = feature.indicators, m = feature.momentum;
  let bull = 0, bear = 0;
  for (const x of [m.aboveEma20, m.aboveEma50, m.aboveEma200]) {
    if (x === true) bull++; else if (x === false) bear++;
  }
  if (i.macdHistogram > 0) bull++; else if (i.macdHistogram < 0) bear++;
  if (i.rsi14 > 50) bull++; else if (i.rsi14 < 50) bear++;
  return bull >= 4 ? 'BULLISH' : bear >= 4 ? 'BEARISH' : 'NEUTRAL';
}

function momentumDirection(feature) {
  const i = feature?.indicators;
  if (!i) return 'NEUTRAL';
  let bull = 0, bear = 0;
  if (i.macdHistogram > 0) bull++; else if (i.macdHistogram < 0) bear++;
  if (i.rsi14 > 55) bull++; else if (i.rsi14 < 45) bear++;
  if (i.ema20 > i.ema50) bull++; else if (i.ema20 < i.ema50) bear++;
  return bull >= 2 && bull > bear ? 'BULLISH' : bear >= 2 && bear > bull ? 'BEARISH' : 'NEUTRAL';
}

function scoreAt(signalTime, series) {
  const get = tf => {
    const entries = [...series[tf].entries()];
    let chosen = null;
    for (const [time, feature] of entries) {
      if (time <= signalTime) chosen = feature; else break;
    }
    return chosen;
  };

  const htf = ['1D','4H','1H'].map(tf => trendDirection(get(tf)));
  const exec15 = get('15m'), exec5 = get('5m');
  const dirs = {
    htf: htf,
    m15: momentumDirection(exec15),
    m5: momentumDirection(exec5)
  };

  let longScore = 0, shortScore = 0;
  const hBull = htf.filter(x => x === 'BULLISH').length;
  const hBear = htf.filter(x => x === 'BEARISH').length;
  if (hBull >= 2 && hBull > hBear) longScore += 20;
  else if (hBear >= 2 && hBear > hBull) shortScore += 20;
  else return { signal: 'NO_TRADE', longScore, shortScore, reason: 'HTF_MIXED', dirs };

  if (exec15 && exec5) {
    const m = dirs.m15 === dirs.m5 ? dirs.m15 : dirs.m15 !== 'NEUTRAL' ? dirs.m15 : dirs.m5;
    if (m === 'BULLISH') longScore += 15;
    if (m === 'BEARISH') shortScore += 15;
  }

  const f15 = exec15;
  if (f15) {
    const c = f15.lastCandle.close, e20=f15.indicators.ema20, e50=f15.indicators.ema50;
    if (c > e20 && c > e50) longScore += 10;
    if (c < e20 && c < e50) shortScore += 10;
    const v = f15.indicators.volumeRatio20;
    if (v >= 1.25) {
      if (f15.lastCandle.close >= f15.lastCandle.open) longScore += 7.5;
      else shortScore += 7.5;
    }
  }

  // Historical order-book snapshots are unavailable, so the 7.5-point live book component is omitted.
  const gap = Math.abs(longScore - shortScore);
  const dominant = longScore > shortScore ? 'LONG' : shortScore > longScore ? 'SHORT' : 'NONE';
  const score = dominant === 'LONG' ? longScore : dominant === 'SHORT' ? shortScore : 0;
  const signal = score >= 70 && gap >= 10 ? dominant : 'NO_TRADE';
  return { signal, longScore, shortScore, score, gap, dirs };
}

export function runBacktest({ candlesByTf, horizonBars = 48, rr = 2 }) {
  const series = Object.fromEntries(Object.entries(candlesByTf).map(([tf,c]) => [tf, featureSeries(c)]));
  const base = candlesByTf['15m'].filter(c => c.confirmed);
  const results = [];
  const start = 220;

  for (let i = start; i < base.length - horizonBars; i++) {
    const candle = base[i];
    const decision = scoreAt(candle.time, series);
    if (decision.signal === 'NO_TRADE') continue;
    const f15 = [...series['15m'].entries()].find(([t]) => t === candle.time)?.[1];
    const atr = f15?.indicators?.atr14;
    if (!atr || !Number.isFinite(atr) || atr <= 0) continue;

    const entry = candle.close;
    const risk = atr;
    const sl = decision.signal === 'LONG' ? entry - risk : entry + risk;
    const tp = decision.signal === 'LONG' ? entry + risk * rr : entry - risk * rr;
    let outcome = 'TIMEOUT';
    let exitPrice = base[i + horizonBars].close;
    let exitIndex = horizonBars;

    for (let j = 1; j <= horizonBars; j++) {
      const f = base[i+j];
      const hitSL = decision.signal === 'LONG' ? f.low <= sl : f.high >= sl;
      const hitTP = decision.signal === 'LONG' ? f.high >= tp : f.low <= tp;
      if (hitSL && hitTP) { outcome = 'LOSS'; exitPrice = sl; exitIndex = j; break; }
      if (hitSL) { outcome = 'LOSS'; exitPrice = sl; exitIndex = j; break; }
      if (hitTP) { outcome = 'WIN'; exitPrice = tp; exitIndex = j; break; }
    }

    const pnlR = decision.signal === 'LONG'
      ? (exitPrice - entry) / risk
      : (entry - exitPrice) / risk;

    results.push({
      time: candle.time,
      direction: decision.signal,
      score: decision.score,
      longScore: decision.longScore,
      shortScore: decision.shortScore,
      entry, sl, tp, outcome, pnlR,
      barsHeld: exitIndex,
      htf: decision.dirs.htf
    });
  }

  const wins = results.filter(x => x.outcome === 'WIN').length;
  const losses = results.filter(x => x.outcome === 'LOSS').length;
  const timeouts = results.filter(x => x.outcome === 'TIMEOUT').length;
  const closed = wins + losses;
  const winRate = closed ? (wins / closed) * 100 : null;
  const netR = results.reduce((s,x)=>s+x.pnlR,0);
  const avgR = results.length ? netR / results.length : null;
  const maxDrawdownR = (() => {
    let peak=0, equity=0, dd=0;
    for(const x of results){ equity += x.pnlR; peak=Math.max(peak,equity); dd=Math.max(dd,peak-equity); }
    return dd;
  })();

  const buckets = {};
  for (const r of results) {
    const bucket = r.score >= 80 ? '80-100' : r.score >= 70 ? '70-79.9' : '60-69.9';
    buckets[bucket] ||= { trades:0,wins:0,losses:0,netR:0 };
    buckets[bucket].trades++;
    if(r.outcome==='WIN') buckets[bucket].wins++;
    if(r.outcome==='LOSS') buckets[bucket].losses++;
    buckets[bucket].netR += r.pnlR;
  }
  for (const b of Object.values(buckets)) {
    const c=b.wins+b.losses;
    b.winRate=c ? (b.wins/c)*100 : null;
  }

  return {
    methodology: {
      executionTimeframe:'15m',
      contextTimeframes:['1H','4H','1D'],
      riskModel:'1 ATR stop, 2R target',
      horizonBars,
      horizonMinutes:horizonBars*15,
      historicalOrderBook:false,
      lookaheadBias:'avoided: each decision uses candles at or before signal time',
      sameBarTpSl:'conservative LOSS'
    },
    summary:{trades:results.length,wins,losses,timeouts,winRate,netR,avgR,maxDrawdownR},
    calibration:buckets,
    trades:results
  };
}
