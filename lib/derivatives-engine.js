import { safeDiv, zscore, recent, n, slope, mean } from './quant-core.js';

function value(row, keys, fallback = 0) {
  if (row == null) return fallback;
  for (const key of keys) {
    const v = Number(row[key]);
    if (Number.isFinite(v)) return v;
  }
  return fallback;
}

function series(rows, keys) {
  return recent(rows || [], 100)
    .map((row) => value(row, keys, NaN))
    .filter(Number.isFinite);
}

export function analyzeDerivatives({
  openInterest = null,
  fundingRate = null,
  fundingTime = null,
  nextFundingTime = null,
  oiHistory = [],
  fundingHistory = [],
  takerVolumeHistory = [],
  longShortHistory = []
} = {}) {
  const oiNow = value(openInterest, ['oi', 'oiUsd', 'oiCcy'], 0);
  const fundingNow = n(fundingRate, 0);

  const oiSeries = series(oiHistory, ['oi', 'oiUsd', 'oiCcy']);
  const fundingSeries = series(fundingHistory, ['fundingRate']);

  const taker = (takerVolumeHistory || []).slice(-100).map((row) => ({
    buy: value(row, ['buyVol', 'buyVolume', 'buy'], 0),
    sell: value(row, ['sellVol', 'sellVolume', 'sell'], 0),
    ts: value(row, ['ts', 'time'], 0)
  })).filter((row) => row.buy > 0 || row.sell > 0);

  const longShort = series(longShortHistory, [
    'longShortRatio',
    'longShortAccountRatio',
    'ratio'
  ]);

  const oiStart = oiSeries[0] ?? oiNow;
  const oiEnd = oiSeries.at(-1) ?? oiNow;
  const oiChange = oiEnd - oiStart;
  const oiChangePct = safeDiv(oiChange, Math.max(1, Math.abs(oiStart))) * 100;
  const fundingZ = fundingSeries.length >= 8 ? zscore(fundingNow, fundingSeries) : 0;

  const takerBuy = taker.reduce((s, row) => s + row.buy, 0);
  const takerSell = taker.reduce((s, row) => s + row.sell, 0);
  const takerDelta = takerBuy - takerSell;
  const takerTotal = takerBuy + takerSell;
  const takerImbalance = safeDiv(takerDelta, takerTotal, 0);

  const lsNow = longShort.at(-1) ?? null;
  const lsZ = lsNow != null && longShort.length >= 8
    ? zscore(lsNow, longShort)
    : 0;

  let pressure = 'NEUTRAL';
  if (oiChange > 0 && fundingNow > 0) pressure = 'LONG_CROWDING';
  else if (oiChange > 0 && fundingNow < 0) pressure = 'SHORT_CROWDING';
  else if (oiChange < 0 && fundingNow > 0) pressure = 'LONG_UNWIND';
  else if (oiChange < 0 && fundingNow < 0) pressure = 'SHORT_UNWIND';

  let takerBias = 'NEUTRAL';
  if (takerImbalance > 0.12) takerBias = 'BUYER_AGGRESSION';
  else if (takerImbalance < -0.12) takerBias = 'SELLER_AGGRESSION';

  return {
    available: oiNow > 0 || fundingNow !== 0 || taker.length > 0 || lsNow != null,
    openInterest: {
      current: oiNow,
      change: oiChange,
      changePct: oiChangePct,
      slope: slope(oiSeries)
    },
    funding: {
      rate: fundingNow,
      zscore: fundingZ,
      fundingTime: n(fundingTime),
      nextFundingTime: n(nextFundingTime)
    },
    takerVolume: {
      available: taker.length > 0,
      buy: takerBuy,
      sell: takerSell,
      delta: takerDelta,
      imbalance: takerImbalance,
      bias: takerBias,
      observations: taker.length
    },
    longShort: {
      current: lsNow,
      zscore: lsZ,
      observations: longShort.length
    },
    pressure,
    crowdingSeverity: Math.min(
      1,
      Math.abs(fundingZ) * 0.35 +
      Math.min(1, Math.abs(oiChangePct) / 3) * 0.35 +
      Math.abs(takerImbalance) * 0.3
    )
  };
}