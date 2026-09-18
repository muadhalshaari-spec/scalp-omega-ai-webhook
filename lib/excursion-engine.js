import { n, mean, percentile } from './quant-core.js';

export function measureExcursions({ trade, candles }) {
  const direction = trade.direction;
  const entry = n(trade.entry, 0);
  const start = trade.index ?? 0;
  const requestedHorizon = trade.horizonBars ?? 48;
  const actualExitBars = Number.isFinite(trade.exitBars) ? trade.exitBars : requestedHorizon;
  const end = Math.min(
    candles.length,
    start + Math.max(0, Math.min(requestedHorizon, actualExitBars)) + 1
  );
  const risk = Math.max(1e-9, n(trade.risk, 1));

  let mfe = 0;
  let mae = 0;
  let mfeBar = 0;
  let maeBar = 0;

  for (let i = start + 1; i < end; i += 1) {
    const candle = candles[i];
    const favorable = direction === 'LONG'
      ? candle.high - entry
      : entry - candle.low;
    const adverse = direction === 'LONG'
      ? entry - candle.low
      : candle.high - entry;

    if (favorable > mfe) {
      mfe = favorable;
      mfeBar = i - start;
    }

    if (adverse > mae) {
      mae = adverse;
      maeBar = i - start;
    }
  }

  return {
    mfeR: mfe / risk,
    maeR: mae / risk,
    mfeBar,
    maeBar,
    sampledThroughBars: Math.max(0, end - start - 1),
    maxFavorablePrice: direction === 'LONG' ? entry + mfe : entry - mfe,
    maxAdversePrice: direction === 'LONG' ? entry - mae : entry + mae
  };
}

export function summarizeExcursions(rows) {
  const clean = (rows || []).filter(Boolean);
  if (!clean.length) return null;

  const mfe = clean.map((x) => x.mfeR).filter(Number.isFinite);
  const mae = clean.map((x) => x.maeR).filter(Number.isFinite);

  return {
    count: clean.length,
    avgMfeR: mean(mfe),
    medianMfeR: percentile(mfe, 0.5),
    p90MfeR: percentile(mfe, 0.9),
    avgMaeR: mean(mae),
    medianMaeR: percentile(mae, 0.5),
    p90MaeR: percentile(mae, 0.9)
  };
}