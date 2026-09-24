const REQUIRED_TIMEFRAMES = Object.freeze({
  '15m': 20 * 60 * 1000,
  '1H': 75 * 60 * 1000,
  '4H': 270 * 60 * 1000
});

const REQUIRED_PROVIDERS = Object.freeze(['OKX', 'BINANCE', 'BYBIT', 'DERIBIT']);

function finite(value) {
  return Number.isFinite(Number(value));
}

function providerTimestamp(provider, fallback) {
  const candidates = [
    provider?.timestamp,
    provider?.fetchedAt,
    provider?.updatedAt,
    provider?.ts
  ];
  for (const candidate of candidates) {
    const value = typeof candidate === 'string' ? Date.parse(candidate) : Number(candidate);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return Number.isFinite(Number(fallback)) ? Number(fallback) : null;
}

function timeframeBias(feature) {
  const candle = feature?.lastCandle;
  if (!candle) return 'UNKNOWN';
  const votes = [];
  for (const key of ['ema20', 'ema50', 'ema200']) {
    if (finite(feature[key])) votes.push(Number(candle.close) > Number(feature[key]) ? 'LONG' : 'SHORT');
  }
  if (finite(feature.macdHistogram)) votes.push(Number(feature.macdHistogram) > 0 ? 'LONG' : 'SHORT');
  const longs = votes.filter((x) => x === 'LONG').length;
  const shorts = votes.filter((x) => x === 'SHORT').length;
  if (!votes.length || longs === shorts) return 'NEUTRAL';
  return longs > shorts ? 'LONG' : 'SHORT';
}

function freshnessGate({ candlesByTf, now }) {
  const byTimeframe = {};
  const reasons = [];
  for (const [tf, maxAgeMs] of Object.entries(REQUIRED_TIMEFRAMES)) {
    const rows = Array.isArray(candlesByTf?.[tf]) ? candlesByTf[tf].filter((x) => x?.confirmed) : [];
    const latest = rows.at(-1);
    const latestTs = latest ? Number(latest.time) : null;
    const ageMs = finite(latestTs) ? Math.max(0, Number(now) - latestTs) : null;
    const pass = finite(ageMs) && ageMs <= maxAgeMs;
    byTimeframe[tf] = { pass, latestTs, ageMs, maxAgeMs };
    if (!pass) reasons.push(`STALE_OR_MISSING_${tf}`);
  }
  return { pass: reasons.length === 0, byTimeframe, reasons };
}

function sourceConsensus({ market, externalIntelligence, now }) {
  const providers = externalIntelligence?.providers || {};
  const rows = [];
  if (finite(market?.price)) rows.push({ name: 'OKX', price: Number(market.price), fundingRate: market.fundingRate, openInterest: market.openInterest?.oi ?? market.openInterest, timestamp: Number(now) });
  for (const name of ['binance', 'bybit', 'deribit']) {
    const provider = providers[name];
    if (provider?.available !== false && finite(provider?.price)) {
      rows.push({ name: name.toUpperCase(), price: Number(provider.price), fundingRate: provider.fundingRate, openInterest: provider.openInterest, timestamp: providerTimestamp(provider, now) });
    }
  }
  const reasons = [];
  const missing = REQUIRED_PROVIDERS.filter((name) => !rows.some((row) => row.name === name));
  if (missing.length) reasons.push(`MISSING_SOURCES_${missing.join('_')}`);
  const prices = rows.map((x) => x.price).filter(finite);
  const minPrice = prices.length ? Math.min(...prices) : null;
  const maxPrice = prices.length ? Math.max(...prices) : null;
  const spreadBps = minPrice && maxPrice ? ((maxPrice - minPrice) / ((maxPrice + minPrice) / 2)) * 10000 : null;
  if (!finite(spreadBps) || spreadBps > 35) reasons.push('SOURCE_PRICE_DIVERGENCE');
  const staleSources = rows.filter((row) => Number(now) - row.timestamp > 2 * 60 * 1000).map((row) => row.name);
  if (staleSources.length) reasons.push(`STALE_SOURCES_${staleSources.join('_')}`);
  const funding = rows.map((x) => Number(x.fundingRate)).filter(finite);
  const fundingSpread = funding.length > 1 ? Math.max(...funding) - Math.min(...funding) : null;
  if (finite(fundingSpread) && fundingSpread > 0.0005) reasons.push('FUNDING_DIVERGENCE');
  return { pass: reasons.length === 0, reasons, providers: rows, spreadBps, fundingSpread };
}

function timeframeAlignment({ features, requestedDirection }) {
  const biases = Object.fromEntries(['15m', '1H', '4H'].map((tf) => [tf, timeframeBias(features?.[tf])]));
  const known = Object.values(biases).filter((x) => x === 'LONG' || x === 'SHORT');
  const aligned = known.length === 3 && new Set(known).size === 1;
  const pass = aligned && (requestedDirection === 'NO_TRADE' || requestedDirection === 'NONE' || biases['15m'] === requestedDirection);
  const reasons = [];
  if (!aligned) reasons.push('TIMEFRAME_CONFLICT_15M_1H_4H');
  if (requestedDirection !== 'NO_TRADE' && requestedDirection !== 'NONE' && biases['15m'] !== requestedDirection) reasons.push('SETUP_TIMEFRAME_DIRECTION_CONFLICT');
  return { pass, biases, reasons };
}

function researchReadiness({ calibration, externalIntelligence, micro, market }) {
  const parity = externalIntelligence?.pineParity?.ready === true || externalIntelligence?.tradingViewParity?.ready === true;
  const rawFlow = micro?.flow?.rawTickTape === true || micro?.flow?.quality === 'RAW_TICK';
  const outcomeCount = Array.isArray(market?.outcomes) ? market.outcomes.length : 0;
  const walkForward = market?.research?.walkForward?.ready === true || market?.walkForward?.ready === true;
  const reasons = [];
  if (calibration?.ready !== true) reasons.push('CALIBRATION_NOT_READY');
  if (!walkForward) reasons.push('WALK_FORWARD_NOT_VERIFIED');
  if (!parity) reasons.push('PINE_PARITY_NOT_VERIFIED');
  if (!rawFlow) reasons.push('RAW_FLOW_NOT_VERIFIED');
  if (outcomeCount < 100) reasons.push('INSUFFICIENT_OUTCOMES');
  return { pass: reasons.length === 0, calibrationReady: calibration?.ready === true, walkForward, pineParity: parity, rawFlow, outcomeCount, reasons };
}

export function evaluateAnalysisQualityGates({
  candlesByTf,
  features,
  market = {},
  externalIntelligence = null,
  calibration = null,
  micro = null,
  requestedDirection = 'NO_TRADE',
  timestamp = Date.now(),
  strict = true
} = {}) {
  const freshness = freshnessGate({ candlesByTf, now: timestamp });
  const sources = sourceConsensus({ market, externalIntelligence, now: timestamp });
  const alignment = timeframeAlignment({ features, requestedDirection });
  const research = researchReadiness({ calibration, externalIntelligence, micro, market });
  const groups = { freshness, sourceConsensus: sources, timeframeAlignment: alignment, researchReadiness: research };
  const reasons = Object.values(groups).flatMap((x) => x.reasons || []);
  const pass = strict ? reasons.length === 0 : freshness.pass && sources.pass;
  return {
    enabled: true,
    strict,
    pass,
    score: pass ? 10 : 0,
    grade: pass ? '10/10' : 'BLOCKED',
    reasons,
    groups,
    policy: 'FAIL_CLOSED_NO_TRADE_ON_UNVERIFIED_QUALITY'
  };
}

export { timeframeBias };
