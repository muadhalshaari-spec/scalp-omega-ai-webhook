import { safeDiv, n } from './quant-core.js';

function round(v, p = 6) {
  const x = n(v);
  if (x == null) return null;
  const m = 10 ** p;
  return Math.round(x * m) / m;
}

function candidateLevels({ entry, direction, structure, liquidity, zones = {}, regime, atrValue }) {
  const sign = direction === 'LONG' ? 1 : -1;
  const structural = direction === 'LONG'
    ? [structure?.protectedLow, structure?.latestSwingLow?.price, liquidity?.nearestBelow]
    : [structure?.protectedHigh, structure?.latestSwingHigh?.price, liquidity?.nearestAbove];
  const structuralPrices = structural
    .map(v => typeof v === 'object' ? v?.price : v)
    .map(v => n(v))
    .filter(Number.isFinite);

  const zonePrices = [
    zones?.activeFvg?.low, zones?.activeFvg?.high, zones?.activeFvg?.mid,
    zones?.activeOrderBlock?.low, zones?.activeOrderBlock?.high, zones?.activeOrderBlock?.mid
  ].map(n).filter(Number.isFinite);

  const relevant = [...structuralPrices, ...zonePrices]
    .filter(level => direction === 'LONG' ? level < entry : level > entry)
    .sort((a,b) => direction === 'LONG' ? b-a : a-b);

  const base = relevant[0] ?? (entry - sign * atrValue);
  return { sign, base };
}

export function buildAdaptiveRisk({
  entry,
  direction,
  atr,
  structure,
  liquidity,
  zones,
  regime,
  feesBps = 5,
  slippageBps = 2
}) {
  const e = n(entry);
  const a = Math.max(n(atr, 0), Math.abs(e || 0) * 0.0005);
  if (!e || !['LONG','SHORT'].includes(direction)) return null;

  const { sign, base } = candidateLevels({ entry: e, direction, structure, liquidity, zones, regime, atrValue: a });

  const volatilityMultiplier =
    regime?.volatility === 'EXPANDING' ? 0.34 :
    regime?.volatility === 'COMPRESSED' ? 0.16 : 0.24;

  const distance = Math.max(
    a * 0.75,
    Math.abs(e - base) + a * volatilityMultiplier
  );

  const stopLoss = round(e - sign * distance);
  const riskDistance = Math.abs(e - stopLoss);

  const liquidityTarget = direction === 'LONG'
    ? n(liquidity?.nearestAbove?.price)
    : n(liquidity?.nearestBelow?.price);

  const fvgTarget = direction === 'LONG'
    ? n(zones?.nextBearishFvg?.low)
    : n(zones?.nextBullishFvg?.high);

  const swingTarget = direction === 'LONG'
    ? n(structure?.latestSwingHigh?.price)
    : n(structure?.latestSwingLow?.price);

  const rawCandidates = [liquidityTarget, fvgTarget, swingTarget]
    .filter(Number.isFinite)
    .filter(level => direction === 'LONG' ? level > e + riskDistance * 0.35 : level < e - riskDistance * 0.35);

  const ordered = [...new Set(rawCandidates.map(round))]
    .sort((x,y) => direction === 'LONG' ? x-y : y-x);

  const fallback = [
    e + sign * riskDistance * 1.25,
    e + sign * riskDistance * 2.0,
    e + sign * riskDistance * 3.2
  ];

  const targets = [];
  for (const level of [...ordered, ...fallback]) {
    if (!Number.isFinite(level)) continue;
    if (direction === 'LONG' && level <= e) continue;
    if (direction === 'SHORT' && level >= e) continue;
    if (!targets.some(t => Math.abs(t-level) <= Math.max(a*0.08, e*0.0002))) targets.push(level);
    if (targets.length === 3) break;
  }

  const costPerUnit = e * ((2 * feesBps + 2 * slippageBps) / 10000);
  const rewardDistances = targets.map(t => Math.max(0, Math.abs(t-e) - costPerUnit));
  const rrAfterCosts = rewardDistances.map(r => safeDiv(r, riskDistance, 0));

  return {
    entry: round(e),
    stopLoss,
    target: targets[0] ?? null,
    targets: targets.map(round),
    riskDistance: round(riskDistance),
    rewardDistances: rewardDistances.map(round),
    rrAfterCosts: rrAfterCosts.map(x => round(x, 3)),
    invalidLevel: round(base),
    buffer: round(Math.max(a * volatilityMultiplier, a * 0.1)),
    atr: round(a),
    volatilityRegime: regime?.volatility ?? 'UNKNOWN',
    estimatedRoundTripCost: round(costPerUnit),
    feesBps,
    slippageBps
  };
}
