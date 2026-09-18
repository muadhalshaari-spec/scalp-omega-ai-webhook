import {
  normalizeCandle,
  timeframeMs,
  mean,
  percentile,
  safeDiv
} from './quant-core.js';

export function auditTimeSeries(candles, timeframe) {
  const normalized = (candles || [])
    .map(normalizeCandle)
    .filter((c) => Number.isFinite(c.time))
    .sort((a, b) => a.time - b.time);

  const unique = [...new Map(normalized.map((c) => [c.time, c])).values()];
  const interval = timeframeMs(timeframe);
  const gaps = [];

  for (let i = 1; i < unique.length; i += 1) {
    const delta = unique[i].time - unique[i - 1].time;
    if (interval > 0 && delta > interval * 1.5) {
      gaps.push({
        from: unique[i - 1].time,
        to: unique[i].time,
        missing: Math.max(0, Math.round(delta / interval) - 1)
      });
    }
  }

  const malformed = unique.filter((c) =>
    c.low > c.high ||
    c.open < c.low ||
    c.open > c.high ||
    c.close < c.low ||
    c.close > c.high
  ).length;

  const shortHistoryPenalty = unique.length < 220 ? 30 : 0;
  const gapPenalty = Math.min(35, safeDiv(gaps.length, Math.max(1, unique.length)) * 100);
  const malformedPenalty = Math.min(35, safeDiv(malformed, Math.max(1, unique.length)) * 100);
  const coverageScore = Math.max(0, 100 - shortHistoryPenalty - gapPenalty - malformedPenalty);

  const recentRanges = unique.slice(-200).map((c) => c.high - c.low);

  return {
    timeframe,
    count: unique.length,
    confirmed: unique.filter((c) => c.confirmed).length,
    oldest: unique[0]?.time ?? null,
    newest: unique.at(-1)?.time ?? null,
    chronological: true,
    gaps: gaps.slice(-20),
    malformed,
    coverageScore,
    rangeP50: percentile(recentRanges, 0.5)
  };
}

export function buildDataIntelligence(candlesByTf = {}) {
  const audits = {};
  for (const [timeframe, candles] of Object.entries(candlesByTf)) {
    audits[timeframe] = auditTimeSeries(candles, timeframe);
  }

  const requiredMinimums = {
    '1m': 220,
    '5m': 220,
    '15m': 220,
    '1H': 220,
    '4H': 120,
    '1D': 20
  };

  const gates = {};
  for (const [timeframe, minimum] of Object.entries(requiredMinimums)) {
    const audit = audits[timeframe];
    const count = audit?.count ?? 0;
    const quality = audit?.coverageScore ?? 0;

    gates[timeframe] = {
      minCount: minimum,
      count,
      quality,
      pass: count >= minimum && quality >= 85
    };
  }

  const qualityValues = Object.values(audits).map((x) => x.coverageScore);

  return {
    audits,
    globalQuality: mean(qualityValues),
    gates,
    ready: Object.values(gates).every((gate) => gate.pass)
  };
}
