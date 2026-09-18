import { mean, safeDiv } from './quant-core.js';

function candleQuality(candle, direction, atrValue) {
  if (!candle || !Number.isFinite(atrValue) || atrValue <= 0) return 0;
  const range = Math.max(0, candle.high - candle.low);
  const body = Math.abs(candle.close - candle.open);
  if (!range) return 0;
  const bodyRatio = body / range;
  const directional = direction === 'LONG'
    ? candle.close > candle.open
    : candle.close < candle.open;
  const closeLocation = direction === 'LONG'
    ? safeDiv(candle.close - candle.low, range, 0.5)
    : safeDiv(candle.high - candle.close, range, 0.5);
  const displacement = safeDiv(range, atrValue, 0);

  let score = 0;
  if (directional) score += 0.35;
  score += Math.min(0.25, bodyRatio * 0.25);
  score += Math.min(0.2, Math.max(0, closeLocation - 0.5) * 0.4);
  score += Math.min(0.2, Math.max(0, displacement - 0.8) * 0.2);
  return Math.max(0, Math.min(1, score));
}

function zoneFresh(zone, maxAgeBars = 24) {
  return Boolean(zone && Number.isFinite(zone.ageBars) && zone.ageBars <= maxAgeBars);
}

function inZone(zone, price) {
  if (!zone || !Number.isFinite(price)) return false;
  const low = zone.low ?? zone.bottom;
  const high = zone.high ?? zone.top;
  return Number.isFinite(low) && Number.isFinite(high) && price >= low && price <= high;
}

export function detectSetups({
  regime,
  structure,
  liquidity,
  zones,
  micro,
  features,
  executionRegime = null,
  executionStructure = null,
  mode = 'live'
}) {
  const setups = [];
  const atrValue = features?.atr ?? null;
  const last = features?.lastCandle ?? null;
  const previous = features?.previousCandle ?? null;
  const volumeRatio = features?.volumeRatio ?? null;
  const momentum = candleQuality(last, 'LONG', atrValue);
  const momentumShort = candleQuality(last, 'SHORT', atrValue);
  const price = last?.close ?? null;

  const activeFvg = zones?.activeFvg ?? null;
  const activeOb = zones?.activeOrderBlock ?? null;
  const zone = activeFvg || activeOb;

  const longZone = zone?.side === 'BULLISH' && zoneFresh(zone) && inZone(zone, price);
  const shortZone = zone?.side === 'BEARISH' && zoneFresh(zone) && inZone(zone, price);

  const microLong = !micro?.flow?.available || micro.microDirection !== 'BEARISH';
  const microShort = !micro?.flow?.available || micro.microDirection !== 'BULLISH';

  // Liquidity-sweep reversal: sweep must be present, followed by directional displacement.
  if (
    regime?.trend !== 'DOWNTREND' &&
    liquidity?.sweep === 'SELL_SIDE_SWEPT' &&
    (structure?.displacementRatio ?? 0) >= 1.15 &&
    microLong
  ) {
    const quality = mean([
      0.88,
      candleQuality(last, 'LONG', atrValue),
      executionRegime?.trend === 'UPTREND' ? 0.85 : 0.5,
      executionStructure?.externalDirection === 'BULLISH' ? 0.85 : 0.5
    ]);
    setups.push({
      type: 'LIQUIDITY_SWEEP_REVERSAL',
      direction: 'LONG',
      quality,
      trigger: 'SELL_SIDE_SWEEP_WITH_BULLISH_DISPLACEMENT'
    });
  }

  if (
    regime?.trend !== 'UPTREND' &&
    liquidity?.sweep === 'BUY_SIDE_SWEPT' &&
    (structure?.displacementRatio ?? 0) >= 1.15 &&
    microShort
  ) {
    const quality = mean([
      0.88,
      candleQuality(last, 'SHORT', atrValue),
      executionRegime?.trend === 'DOWNTREND' ? 0.85 : 0.5,
      executionStructure?.externalDirection === 'BEARISH' ? 0.85 : 0.5
    ]);
    setups.push({
      type: 'LIQUIDITY_SWEEP_REVERSAL',
      direction: 'SHORT',
      quality,
      trigger: 'BUY_SIDE_SWEEP_WITH_BEARISH_DISPLACEMENT'
    });
  }

  // Trend pullback: fresh zone + rejection + HTF alignment. Avoid buying an overextended candle.
  if (
    regime?.trend === 'UPTREND' &&
    structure?.externalDirection === 'BULLISH' &&
    longZone &&
    executionRegime?.trend !== 'DOWNTREND' &&
    (features?.rsi == null || features.rsi < 78) &&
    momentum >= 0.45 &&
    (volumeRatio == null || volumeRatio >= 0.8) &&
    (last?.close ?? 0) >= (previous?.close ?? last?.close ?? 0)
  ) {
    const quality = mean([
      0.8,
      momentum,
      (structure?.structureEvent === 'BOS_BULLISH' || structure?.structureEvent === 'BREAK_HIGH') ? 0.78 : 0.65,
      executionRegime?.trend === 'UPTREND' ? 0.82 : 0.58,
      executionStructure?.externalDirection === 'BULLISH' ? 0.82 : 0.58,
      zoneFresh(zone) ? 0.85 : 0.45
    ]);
    setups.push({
      type: 'TREND_PULLBACK',
      direction: 'LONG',
      quality,
      trigger: 'FRESH_BULLISH_ZONE_REJECTION'
    });
  }

  if (
    regime?.trend === 'DOWNTREND' &&
    structure?.externalDirection === 'BEARISH' &&
    shortZone &&
    executionRegime?.trend !== 'UPTREND' &&
    (features?.rsi == null || features.rsi > 22) &&
    momentumShort >= 0.45 &&
    (volumeRatio == null || volumeRatio >= 0.8) &&
    (last?.close ?? 0) <= (previous?.close ?? last?.close ?? 0)
  ) {
    const quality = mean([
      0.8,
      momentumShort,
      (structure?.structureEvent === 'BOS_BEARISH' || structure?.structureEvent === 'BREAK_LOW') ? 0.78 : 0.65,
      executionRegime?.trend === 'DOWNTREND' ? 0.82 : 0.58,
      executionStructure?.externalDirection === 'BEARISH' ? 0.82 : 0.58,
      zoneFresh(zone) ? 0.85 : 0.45
    ]);
    setups.push({
      type: 'TREND_PULLBACK',
      direction: 'SHORT',
      quality,
      trigger: 'FRESH_BEARISH_ZONE_REJECTION'
    });
  }

  // Momentum breakout: the break must be real, not merely an expanding candle.
  const bullishBreak =
    (structure?.structureEvent === 'BOS_BULLISH' || structure?.structureEvent === 'BREAK_HIGH') &&
    regime?.volatility !== 'COMPRESSED' &&
    (structure?.displacementRatio ?? 0) >= 0.95 &&
    last?.close > (structure?.latestSwingHigh?.price ?? Infinity) &&
    momentum >= 0.35 &&
    (volumeRatio == null || volumeRatio >= 0.9) &&
    microLong;

  const bearishBreak =
    (structure?.structureEvent === 'BOS_BEARISH' || structure?.structureEvent === 'BREAK_LOW') &&
    regime?.volatility === 'EXPANDING' &&
    (structure?.displacementRatio ?? 0) >= 1.05 &&
    last?.close < (structure?.latestSwingLow?.price ?? -Infinity) &&
    momentumShort >= 0.35 &&
    (volumeRatio == null || volumeRatio >= 1.1) &&
    microShort;

  if (bullishBreak) {
    setups.push({
      type: 'BREAKOUT_CONTINUATION',
      direction: 'LONG',
      quality: mean([
        0.78,
        momentum,
        volumeRatio == null ? 0.55 : Math.min(0.9, 0.55 + Math.max(0, volumeRatio - 1) * 0.15),
        executionRegime?.trend === 'UPTREND' ? 0.85 : 0.55,
        executionStructure?.externalDirection === 'BULLISH' ? 0.85 : 0.55
      ]),
      trigger: 'CONFIRMED_BULLISH_BOS_WITH_EXPANSION'
    });
  }

  if (bearishBreak) {
    setups.push({
      type: 'BREAKOUT_CONTINUATION',
      direction: 'SHORT',
      quality: mean([
        0.78,
        momentumShort,
        volumeRatio == null ? 0.55 : Math.min(0.9, 0.55 + Math.max(0, volumeRatio - 1) * 0.15),
        executionRegime?.trend === 'DOWNTREND' ? 0.85 : 0.55,
        executionStructure?.externalDirection === 'BEARISH' ? 0.85 : 0.55
      ]),
      trigger: 'CONFIRMED_BEARISH_BOS_WITH_EXPANSION'
    });
  }

  if (mode === 'backtest') {
    const rsi = features?.rsi;
    const close = last?.close ?? 0;
    const e20 = features?.ema20;
    const e50 = features?.ema50;
    const vol = volumeRatio == null ? 1 : volumeRatio;

    const trendLong =
      regime?.trend === 'UPTREND' &&
      executionRegime?.trend !== 'DOWNTREND' &&
      e20 != null && e50 != null &&
      close > e20 && close > e50 &&
      (rsi == null || (rsi >= 52 && rsi <= 76)) &&
      vol >= 0.9 &&
      momentum >= 0.30;

    const trendShort =
      regime?.trend === 'DOWNTREND' &&
      executionRegime?.trend !== 'UPTREND' &&
      e20 != null && e50 != null &&
      close < e20 && close < e50 &&
      (rsi == null || (rsi >= 24 && rsi <= 48)) &&
      vol >= 0.9 &&
      momentumShort >= 0.30;

    if (trendLong) {
      setups.push({
        type: 'RESEARCH_TREND_CONTINUATION',
        direction: 'LONG',
        quality: mean([
          0.55,
          momentum,
          vol >= 1.2 ? 0.72 : 0.55,
          executionRegime?.trend === 'UPTREND' ? 0.75 : 0.52,
          executionStructure?.externalDirection === 'BULLISH' ? 0.75 : 0.52
        ]),
        trigger: 'RESEARCH_EMA_MOMENTUM_ALIGNMENT'
      });
    }

    if (trendShort) {
      setups.push({
        type: 'RESEARCH_TREND_CONTINUATION',
        direction: 'SHORT',
        quality: mean([
          0.55,
          momentumShort,
          vol >= 1.2 ? 0.72 : 0.55,
          executionRegime?.trend === 'DOWNTREND' ? 0.75 : 0.52,
          executionStructure?.externalDirection === 'BEARISH' ? 0.75 : 0.52
        ]),
        trigger: 'RESEARCH_EMA_MOMENTUM_ALIGNMENT'
      });
    }

    const rangePosition = liquidity?.rangePosition ?? 0.5;
    const bullishReject =
      regime?.trend === 'RANGE' &&
      rangePosition <= 0.15 &&
      last &&
      last.close > last.open &&
      last.close > (last.low + last.high) / 2 &&
      momentum >= 0.25;

    const bearishReject =
      regime?.trend === 'RANGE' &&
      rangePosition >= 0.85 &&
      last &&
      last.close < last.open &&
      last.close < (last.low + last.high) / 2 &&
      momentumShort >= 0.25;

    if (bullishReject) {
      setups.push({
        type: 'RESEARCH_MEAN_REVERSION',
        direction: 'LONG',
        quality: mean([0.52, momentum, 0.7]),
        trigger: 'RANGE_LOW_REJECTION'
      });
    }

    if (bearishReject) {
      setups.push({
        type: 'RESEARCH_MEAN_REVERSION',
        direction: 'SHORT',
        quality: mean([0.52, momentumShort, 0.7]),
        trigger: 'RANGE_HIGH_REJECTION'
      });
    }
  }

  return setups.sort((a, b) => b.quality - a.quality);
}