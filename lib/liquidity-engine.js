import { recent, safeDiv, percentile } from './quant-core.js';

function equalPools(points, side, tolerance) {
  const out = [];
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const a = points[i].price;
      const b = points[j].price;
      const mid = (a + b) / 2;
      if (mid > 0 && Math.abs(a - b) / mid <= tolerance) {
        out.push({
          side,
          type: side === 'HIGH' ? 'EQH' : 'EQL',
          price: mid,
          sourceTimes: [points[i].time, points[j].time]
        });
      }
    }
  }
  return out;
}

export function buildLiquidityMap(candles, structure, tolerancePct = null) {
  const c = candles || [];
  const last = c.at(-1);
  const price = last?.close ?? 0;
  const ranges = recent(c, 100).map((x) => x.high - x.low).filter((x) => Number.isFinite(x) && x > 0);
  const rangeP50 = percentile(ranges, 0.5) ?? price * 0.001;
  const adaptiveTolerance = tolerancePct ?? Math.min(
    0.003,
    Math.max(0.0005, safeDiv(rangeP50 * 0.35, Math.max(price, 1)))
  );

  const highs = structure?.highs || [];
  const lows = structure?.lows || [];
  const pools = [
    ...equalPools(highs, 'HIGH', adaptiveTolerance),
    ...equalPools(lows, 'LOW', adaptiveTolerance)
  ];

  const highAbove = pools
    .filter((x) => x.side === 'HIGH' && x.price > price)
    .sort((a, b) => a.price - b.price)[0] || null;

  const lowBelow = pools
    .filter((x) => x.side === 'LOW' && x.price < price)
    .sort((a, b) => b.price - a.price)[0] || null;

  const swingHigh = structure?.latestSwingHigh?.price ?? null;
  const swingLow = structure?.latestSwingLow?.price ?? null;
  const buySideSwept =
    swingHigh != null &&
    last?.high > swingHigh &&
    last?.close < swingHigh;

  const sellSideSwept =
    swingLow != null &&
    last?.low < swingLow &&
    last?.close > swingLow;

  const rangeHigh = c.length ? Math.max(...recent(c, 96).map((x) => x.high)) : price;
  const rangeLow = c.length ? Math.min(...recent(c, 96).map((x) => x.low)) : price;

  return {
    tolerancePct: adaptiveTolerance,
    pools: recent(pools, 24),
    buySide: [
      highAbove,
      swingHigh != null ? { type: 'SWING_HIGH', side: 'HIGH', price: swingHigh } : null
    ].filter(Boolean),
    sellSide: [
      lowBelow,
      swingLow != null ? { type: 'SWING_LOW', side: 'LOW', price: swingLow } : null
    ].filter(Boolean),
    nearestAbove: highAbove,
    nearestBelow: lowBelow,
    sweep: buySideSwept ? 'BUY_SIDE_SWEPT' : sellSideSwept ? 'SELL_SIDE_SWEPT' : 'NONE',
    sweepPrice: buySideSwept ? swingHigh : sellSideSwept ? swingLow : null,
    rangePosition: safeDiv(price - rangeLow, Math.max(1, rangeHigh - rangeLow), 0.5)
  };
}