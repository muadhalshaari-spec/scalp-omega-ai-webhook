import { recent, normalizeCandle, atr, percentile } from './quant-core.js';

export function buildZones(candles, { lookback = 240, maxAgeBars = 64 } = {}) {
  const all = (candles || [])
    .map(normalizeCandle)
    .filter((x) => x.confirmed);
  const c = all.slice(-lookback);
  const zones = [];
  const a = atr(c, 14) ?? (c.at(-1)?.close || 1) * 0.005;
  const ranges = c.slice(-50).map((x) => x.high - x.low);
  const expansionRange = percentile(ranges, 0.8) ?? a * 1.4;

  for (let i = 2; i < c.length; i += 1) {
    const a0 = c[i - 2];
    const b = c[i - 1];
    const d = c[i];
    const age = c.length - 1 - i;
    if (age > maxAgeBars) continue;

    if (a0.high < d.low) {
      zones.push({
        kind: 'FVG',
        side: 'BULLISH',
        top: d.low,
        bottom: a0.high,
        mid: (d.low + a0.high) / 2,
        formedAt: b.time,
        ageBars: age,
        size: d.low - a0.high,
        mitigated: false
      });
    }

    if (a0.low > d.high) {
      zones.push({
        kind: 'FVG',
        side: 'BEARISH',
        top: a0.low,
        bottom: d.high,
        mid: (a0.low + d.high) / 2,
        formedAt: b.time,
        ageBars: age,
        size: a0.low - d.high,
        mitigated: false
      });
    }
  }

  for (let i = 20; i < c.length - 1; i += 1) {
    const p = c[i];
    const x = c[i + 1];
    const body = Math.abs(p.close - p.open);
    const range = p.high - p.low;
    const displacement = x.high - x.low;

    if (range <= 0 || body / range < 0.55 || displacement < expansionRange) continue;

    const age = c.length - 1 - i;
    if (age > maxAgeBars) continue;

    if (p.close < p.open && x.close > p.high + 0.25 * a) {
      zones.push({
        kind: 'ORDER_BLOCK',
        side: 'BULLISH',
        high: p.high,
        low: p.low,
        mid: (p.high + p.low) / 2,
        formedAt: p.time,
        ageBars: age,
        displacementRange: displacement,
        mitigated: false
      });
    }

    if (p.close > p.open && x.close < p.low - 0.25 * a) {
      zones.push({
        kind: 'ORDER_BLOCK',
        side: 'BEARISH',
        high: p.high,
        low: p.low,
        mid: (p.high + p.low) / 2,
        formedAt: p.time,
        ageBars: age,
        displacementRange: displacement,
        mitigated: false
      });
    }
  }

  const price = c.at(-1)?.close ?? 0;
  const nearby = zones.filter((z) => {
    const center = z.mid ?? ((z.high + z.low) / 2);
    return Math.abs(center - price) <= Math.max(a * 3, price * 0.02);
  });

  const activeFvgs = nearby
    .filter((z) => z.kind === 'FVG')
    .filter((z) => {
      if (z.side === 'BULLISH') return !c.some((x) => x.time > z.formedAt && x.low <= z.mid);
      return !c.some((x) => x.time > z.formedAt && x.high >= z.mid);
    });

  const activeObs = nearby
    .filter((z) => z.kind === 'ORDER_BLOCK')
    .filter((z) => {
      if (z.side === 'BULLISH') return !c.some((x) => x.time > z.formedAt && x.low <= z.mid);
      return !c.some((x) => x.time > z.formedAt && x.high >= z.mid);
    });

  return {
    fvgs: recent(activeFvgs, 20),
    orderBlocks: recent(activeObs, 20)
  };
}

export function zoneAt(zones, price) {
  const activeFvg = (zones?.fvgs || [])
    .filter((z) => price >= z.bottom && price <= z.top)
    .sort((a, b) => a.ageBars - b.ageBars)[0] || null;

  const activeOrderBlock = (zones?.orderBlocks || [])
    .filter((z) => price >= z.low && price <= z.high)
    .sort((a, b) => a.ageBars - b.ageBars)[0] || null;

  return {
    ...zones,
    activeFvg,
    activeOrderBlock
  };
}