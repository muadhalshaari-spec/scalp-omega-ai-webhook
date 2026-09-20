import { atr, ema, rsi, safeDiv, mean, stdev, clamp, num } from './kernel.js';

/*
 * TITAN Real-Input Adapter
 * ------------------------
 * Converts real closed-candle/live state into the concrete contracts
 * required by research, calibration, execution, monitoring and audit modules.
 *
 * Research labels intentionally use ONLY historical bars after the labelled
 * bar. These rows must never be promoted into the live signal context.
 */

function seriesEma(values, period) {
  const a = Array.isArray(values) ? values.map(Number) : [];
  if (!a.length) return [];
  const k = 2 / (period + 1);
  const out = new Array(a.length).fill(null);
  let e = null;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    if (!Number.isFinite(x)) continue;
    e = e == null ? x : x * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}

function seriesRsi(values, period = 14) {
  const a = Array.isArray(values) ? values.map(Number) : [];
  const out = new Array(a.length).fill(null);
  if (a.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const d = a[i] - a[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let ag = gain / period;
  let al = loss / period;
  out[period] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = period + 1; i < a.length; i += 1) {
    const d = a[i] - a[i - 1];
    ag = (ag * (period - 1) + Math.max(0, d)) / period;
    al = (al * (period - 1) + Math.max(0, -d)) / period;
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}

function seriesAtr(candles, period = 14) {
  const cs = Array.isArray(candles) ? candles : [];
  const tr = new Array(cs.length).fill(null);
  for (let i = 0; i < cs.length; i += 1) {
    const h = Number(cs[i]?.high);
    const l = Number(cs[i]?.low);
    const pc = i ? Number(cs[i - 1]?.close) : null;
    if (!Number.isFinite(h) || !Number.isFinite(l)) continue;
    tr[i] = i && Number.isFinite(pc)
      ? Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc))
      : h - l;
  }
  const out = new Array(cs.length).fill(null);
  let window = [];
  for (let i = 0; i < tr.length; i += 1) {
    if (Number.isFinite(tr[i])) window.push(tr[i]);
    if (window.length > period) window.shift();
    out[i] = window.length === period ? mean(window) : null;
  }
  return out;
}

function closed(candles) {
  return (Array.isArray(candles) ? candles : []).filter((x) => x && x.confirmed === true);
}

function trendOf(row) {
  const e20 = Number(row?.ema20);
  const e50 = Number(row?.ema50);
  const e200 = Number(row?.ema200);
  const px = Number(row?.close);
  if (![px, e20, e50, e200].every(Number.isFinite)) return 'RANGE';
  if (px > e20 && e20 > e50 && e50 > e200) return 'UPTREND';
  if (px < e20 && e20 < e50 && e50 < e200) return 'DOWNTREND';
  return 'RANGE';
}

function sessionBucket(ts) {
  const d = new Date(Number(ts));
  if (!Number.isFinite(d.getTime())) return 'UNKNOWN';
  const h = d.getUTCHours();
  if (h < 7) return 'ASIA';
  if (h < 13) return 'LONDON';
  if (h < 20) return 'NEW_YORK';
  return 'LATE_US';
}

function makeFeatureRows(candles) {
  const cs = closed(candles);
  if (cs.length < 5) return [];
  const closes = cs.map((x) => Number(x.close));
  const volumes = cs.map((x) => Number(x.volume));
  const e20 = seriesEma(closes, 20);
  const e50 = seriesEma(closes, 50);
  const e200 = seriesEma(closes, 200);
  const rs = seriesRsi(closes, 14);
  const ats = seriesAtr(cs, 14);
  const rows = [];
  for (let i = 200; i < cs.length - 1; i += 1) {
    const c = cs[i];
    const prev = cs[i - 1];
    const a = Number(ats[i]);
    const px = Number(c.close);
    const avgVol = mean(volumes.slice(Math.max(0, i - 20), i));
    const range = Math.max(Number(c.high) - Number(c.low), 1e-12);
    const momentum5 = i >= 5 ? safeDiv(px - Number(cs[i - 5]?.close), Number(cs[i - 5]?.close), 0) : 0;
    const ema20Gap = safeDiv(px - Number(e20[i]), px, 0);
    const ema50Gap = safeDiv(px - Number(e50[i]), px, 0);
    const ema200Gap = safeDiv(px - Number(e200[i]), px, 0);
    const row = {
      timestamp: Number(c.timestamp ?? c.ts ?? c.time),
      close: px,
      rsi: Number(rs[i]),
      atr: a,
      atrPct: safeDiv(a, px, 0),
      ema20Gap,
      ema50Gap,
      ema200Gap,
      volumeRatio: avgVol ? Number(c.volume) / avgVol : 1,
      rangePct: safeDiv(range, px, 0),
      bodyPct: safeDiv(Math.abs(px - Number(c.open)), range, 0),
      momentum5,
      trend: trendOf({ close:px, ema20:e20[i], ema50:e50[i], ema200:e200[i] }),
      volatility: a && px ? a / px : 0,
      session: sessionBucket(c.timestamp ?? c.ts ?? c.time),
      aboveVwap: null,
      liquiditySweep: 'NONE',
      direction: ema20Gap > 0 && momentum5 > 0 ? 'LONG' : ema20Gap < 0 && momentum5 < 0 ? 'SHORT' : 'NO_TRADE',
      setupType: 'MOMENTUM_CONTEXT'
    };
    rows.push(row);
  }
  return rows;
}

function labelRows(featureRows, candles, horizon = 8, tpAtr = 1.2, slAtr = 0.8) {
  const cs = closed(candles);
  const byTs = new Map(cs.map((c, i) => [String(Number(c.timestamp ?? c.ts ?? c.time)), i]));
  return featureRows.map((f) => {
    const idx = byTs.get(String(f.timestamp));
    if (!Number.isInteger(idx)) return { timestamp: f.timestamp, y: null, label: null };
    const entry = Number(f.close);
    const a = Math.max(Number(f.atr) || 0, entry * 0.0001);
    const tp = a * tpAtr;
    const sl = a * slAtr;
    const direction = f.direction === 'SHORT' ? 'SHORT' : 'LONG';
    let outcome = null;
    for (let j = idx + 1; j <= Math.min(cs.length - 1, idx + horizon); j += 1) {
      const bar = cs[j];
      const hi = Number(bar.high);
      const lo = Number(bar.low);
      const tpHit = direction === 'LONG' ? hi >= entry + tp : lo <= entry - tp;
      const slHit = direction === 'LONG' ? lo <= entry - sl : hi >= entry + sl;
      if (tpHit && slHit) { outcome = null; break; }
      if (tpHit) { outcome = 1; break; }
      if (slHit) { outcome = 0; break; }
    }
    return {
      timestamp: f.timestamp,
      y: outcome,
      label: outcome == null ? null : outcome > 0 ? 1 : 0,
      direction,
      horizon,
      tpDistance: tp,
      slDistance: sl
    };
  }).filter((x) => Number.isFinite(x.y));
}

function modelProbability(row) {
  const r = Number(row?.rsi);
  const trend = row?.trend === 'UPTREND' ? 1 : row?.trend === 'DOWNTREND' ? -1 : 0;
  const gap = clamp(Number(row?.ema20Gap) * 30, -1, 1);
  const mom = clamp(Number(row?.momentum5) * 25, -1, 1);
  const score = clamp(0.5 + 0.14 * trend + 0.12 * gap + 0.12 * mom + (Number.isFinite(r) ? clamp((r - 50) / 100, -0.12, 0.12) : 0));
  return score;
}

function buildStrategyReturns(featureRows, candles) {
  const cs = closed(candles);
  const indexByTs = new Map(cs.map((c, i) => [String(Number(c.timestamp ?? c.ts ?? c.time)), i]));
  const rows = [];
  for (const f of featureRows) {
    const i = indexByTs.get(String(f.timestamp));
    if (!Number.isInteger(i) || !cs[i + 1]) continue;
    const px = Number(cs[i].close);
    const nx = Number(cs[i + 1].close);
    const ret = safeDiv(nx - px, px, 0);
    const trendDir = f.trend === 'UPTREND' ? 1 : f.trend === 'DOWNTREND' ? -1 : 0;
    const momentumDir = f.momentum5 > 0 ? 1 : f.momentum5 < 0 ? -1 : 0;
    const rsiDir = f.rsi < 35 ? 1 : f.rsi > 65 ? -1 : 0;
    const vwapDir = f.ema20Gap > 0 ? 1 : f.ema20Gap < 0 ? -1 : 0;
    rows.push({
      timestamp: f.timestamp,
      trend: ret * trendDir,
      momentum: ret * momentumDir,
      meanReversion: ret * rsiDir,
      vwap: ret * vwapDir
    });
  }
  return rows;
}

function researchContext(c15, market = {}, baseDecision = 'NO_TRADE', timestamp = Date.now()) {
  const rows = makeFeatureRows(c15);
  const outcomes = labelRows(rows, c15);
  const predictionRows = outcomes.map((o) => {
    const f = rows.find((x) => x.timestamp === o.timestamp) || {};
    return modelProbability(f);
  });
  const analogs = outcomes.map((o) => {
    const f = rows.find((x) => x.timestamp === o.timestamp) || {};
    return {
      ...f,
      y: o.y,
      outcome: o.y,
      timestamp: o.timestamp,
      setupType: f.setupType || 'MOMENTUM_CONTEXT',
      direction: f.direction,
      session: f.session
    };
  });
  const strategyReturns = buildStrategyReturns(rows, c15);
  const ts = rows.map((x) => x.timestamp).filter(Number.isFinite);
  const performance = strategyReturns.map((x) => ({ value: x.trend, timestamp: x.timestamp }));

  const currentFeature = rows.at(-1) || {
    rsi: Number(market.rsi) || 50,
    atr: Number(market.atr) || null,
    atrPct: Number(market.atr) && Number(market.price) ? Number(market.atr) / Number(market.price) : 0,
    trend: 'RANGE',
    direction: baseDecision,
    setupType: 'NONE'
  };

  const currentHistory = rows.slice(-200);
  const referenceHistory = rows.slice(Math.max(0, rows.length - 600), Math.max(0, rows.length - 200));
  const oiHistory = Array.isArray(market.oiHistory) ? market.oiHistory : [];
  const fundingHistory = Array.isArray(market.fundingHistory) ? market.fundingHistory : [];
  const takerHistory = Array.isArray(market.takerVolumeHistory) ? market.takerVolumeHistory : [];
  const longShortHistory = Array.isArray(market.longShortHistory) ? market.longShortHistory : [];

  const history = {
    openInterest: oiHistory,
    funding: fundingHistory,
    taker: takerHistory,
    longShort: longShortHistory
  };

  const decisionTimestamps = ts.slice(-Math.min(120, ts.length));
  const metrics = Object.fromEntries(Object.keys(history).map((key) => [key, history[key]]));
  const schema = {
    version: 'TITAN-DATASET-1',
    candleFields: ['timestamp','open','high','low','close','volume','confirmed'],
    featureFields: Object.keys(rows[0] || {}),
    labelFields: ['timestamp','y','direction','horizon','tpDistance','slDistance']
  };
  const featureConfig = {
    timeframe: '15m',
    lookbackBars: 1000,
    horizon: 8,
    tpAtr: 1.2,
    slAtr: 0.8,
    closedOnly: true,
    labelPolicy: 'first-touch; ambiguous same-bar => null'
  };

  const tables = [
    { name:'signal_events', primaryKey:'id', columns:[
      {name:'id',type:'uuid',primaryKey:true,notNull:true},{name:'job_id',type:'text',unique:true},
      {name:'source',type:'text',notNull:true},{name:'alert',type:'jsonb',notNull:true},
      {name:'institutional',type:'jsonb'},{name:'status',type:'text'},{name:'received_at',type:'timestamptz'},{name:'processed_at',type:'timestamptz',notNull:true},{name:'created_at',type:'timestamptz',notNull:true}
    ]},
    { name:'titan_snapshots', primaryKey:'id', columns:[
      {name:'id',type:'uuid',primaryKey:true,notNull:true},{name:'timestamp',type:'timestamptz',notNull:true},
      {name:'instrument',type:'text',notNull:true},{name:'decision',type:'text',notNull:true},{name:'payload',type:'jsonb',notNull:true},{name:'created_at',type:'timestamptz',notNull:true}
    ]},
    { name:'titan_outcomes', primaryKey:'id', columns:[
      {name:'id',type:'uuid',primaryKey:true,notNull:true},{name:'signal_id',type:'text',notNull:true},
      {name:'status',type:'text',notNull:true},{name:'net_r',type:'numeric'},{name:'mae',type:'numeric'},{name:'mfe',type:'numeric'},{name:'created_at',type:'timestamptz',notNull:true}
    ]},
    { name:'titan_features', primaryKey:'id', columns:[
      {name:'id',type:'bigint',primaryKey:true,notNull:true},{name:'timestamp',type:'timestamptz',notNull:true},
      {name:'instrument',type:'text',notNull:true},{name:'features',type:'jsonb',notNull:true},{name:'created_at',type:'timestamptz',notNull:true}
    ]},
    { name:'titan_system_events', primaryKey:'id', columns:[
      {name:'id',type:'uuid',primaryKey:true,notNull:true},{name:'event_type',type:'text',notNull:true},
      {name:'payload',type:'jsonb',notNull:true},{name:'created_at',type:'timestamptz',notNull:true}
    ]}
  ];

  const basePrices = {};
  if (Number.isFinite(Number(market.price))) basePrices.OKX = Number(market.price);
  const external = market.externalIntelligence?.providers || {};
  for (const [name, provider] of Object.entries(external)) {
    if (Number.isFinite(Number(provider?.price))) basePrices[name.toUpperCase()] = Number(provider.price);
  }

  const candlesByExchange = market.candlesByExchange || {
    OKX: c15,
    ...(Array.isArray(market.externalCandles?.BINANCE) && market.externalCandles.BINANCE.length ? { BINANCE: market.externalCandles.BINANCE } : {})
  };

  return {
    featureRows: rows,
    currentFeatures: currentFeature,
    outcomes,
    predictions: predictionRows,
    predictionBins: 12,
    latestProbability: modelProbability(currentFeature),
    historicalAnalogs: analogs,
    analogQuery: { ...currentFeature, direction: baseDecision, setupType: currentFeature.setupType || 'NONE' },
    strategyReturns,
    strategyReturnsMatrix: strategyReturns,
    rows: strategyReturns.map((r) => ({...r, return:r.trend})),
    windows: { trainBars: 400, testBars: 100, step: 100 },
    models: [
      {id:'trend',type:'directional-close-return'},
      {id:'momentum',type:'directional-close-return'},
      {id:'meanReversion',type:'countertrend-close-return'},
      {id:'vwap',type:'ema-location-close-return'}
    ],
    thresholds: { probability:0.72, minEdge:0.12 },
    strategies: ['trend','momentum','meanReversion','vwap'],
    splits: 8,
    ranking: { rule:'maximize in-sample mean; evaluate OOS rank' },
    featureHistory: rows,
    liveFeatures: currentFeature,
    referenceFeatureHistory: referenceHistory,
    currentFeatureHistory: currentHistory,
    performanceHistory: performance,
    referencePerformance: strategyReturns.slice(0, 400).map((x) => ({value:x.trend,timestamp:x.timestamp})),
    currentPerformance: strategyReturns.slice(-200).map((x) => ({value:x.trend,timestamp:x.timestamp})),
    timestamps: ts,
    history,
    decisionTimestamps,
    metrics,
    policy: { maxAgeMs: 7 * 24 * 60 * 60 * 1000 },
    sources: ['OKX:ETH-USDT-SWAP:15m'],
    schema,
    featureConfig,
    tables,
    rowsForSchema: strategyReturns.slice(-20),
    migrations: [
      {id:'001_core_signal_events',status:'defined'},
      {id:'002_titan_snapshots',status:'defined'},
      {id:'003_titan_outcomes',status:'defined'},
      {id:'004_titan_features',status:'defined'},
      {id:'005_titan_system_events',status:'defined'}
    ],
    indexes: tables.flatMap((t) => t.columns.filter((c) => c.name === 'timestamp').map((c) => ({name:t.name+'_timestamp_idx',columns:['timestamp']}))),
    candlesByExchange,
    prices: basePrices,
    liveEvent: {
      id: 'analysis:' + String(timestamp),
      timestamp,
      sequence: Number(timestamp),
      symbol: 'ETH-USDT-SWAP',
      direction: baseDecision
    },
    webhookPayload: {
      event:'SCALP_OMEGA_ANALYSIS',
      symbol:'ETH-USDT-SWAP',
      direction:baseDecision,
      timestamp
    }
  };
}

export { researchContext, makeFeatureRows, labelRows, modelProbability };
