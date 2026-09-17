function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function sideScore(value, bullish, bearish) {
  if (bullish) return { long: value, short: 0 };
  if (bearish) return { long: 0, short: value };
  return { long: 0, short: 0 };
}

function trendDirection(feature) {
  if (!feature?.indicators || !feature?.momentum) return 'NEUTRAL';
  const i = feature.indicators;
  const m = feature.momentum;
  let bull = 0, bear = 0;
  if (m.aboveEma20 === true) bull++; else if (m.aboveEma20 === false) bear++;
  if (m.aboveEma50 === true) bull++; else if (m.aboveEma50 === false) bear++;
  if (m.aboveEma200 === true) bull++; else if (m.aboveEma200 === false) bear++;
  if (i.macdHistogram > 0) bull++; else if (i.macdHistogram < 0) bear++;
  if (i.rsi14 > 50) bull++; else if (i.rsi14 < 50) bear++;
  if (bull >= 4) return 'BULLISH';
  if (bear >= 4) return 'BEARISH';
  return 'NEUTRAL';
}

function structureDirection(context) {
  const event = context?.structure?.structureEvent;
  const highs = context?.structure?.highs || [];
  const lows = context?.structure?.lows || [];
  if (event === 'BOS_BULLISH' || event === 'BREAK_HIGH') return 'BULLISH';
  if (event === 'BOS_BEARISH' || event === 'BREAK_LOW') return 'BEARISH';
  const h = highs.at(-1)?.type;
  const l = lows.at(-1)?.type;
  if (h === 'HH' && l === 'HL') return 'BULLISH';
  if (h === 'LH' && l === 'LL') return 'BEARISH';
  return 'NEUTRAL';
}

function liquidityDirection(context) {
  const sweep = context?.liquidity?.sweep;
  if (sweep === 'SELL_SIDE_SWEPT') return 'BULLISH';
  if (sweep === 'BUY_SIDE_SWEPT') return 'BEARISH';
  return 'NEUTRAL';
}

function momentumDirection(feature) {
  const i = feature?.indicators;
  if (!i) return 'NEUTRAL';
  let bull = 0, bear = 0;
  if (i.macdHistogram > 0) bull++; else if (i.macdHistogram < 0) bear++;
  if (i.rsi14 > 55) bull++; else if (i.rsi14 < 45) bear++;
  if (i.ema20 != null && i.ema50 != null) {
    if (i.ema20 > i.ema50) bull++; else if (i.ema20 < i.ema50) bear++;
  }
  if (bull >= 2 && bull > bear) return 'BULLISH';
  if (bear >= 2 && bear > bull) return 'BEARISH';
  return 'NEUTRAL';
}

function vwapDirection(feature) {
  const price = feature?.lastCandle?.close;
  const vwap = feature?.indicators?.vwap;
  if (price == null || vwap == null) return 'NEUTRAL';
  if (price > vwap) return 'BULLISH';
  if (price < vwap) return 'BEARISH';
  return 'NEUTRAL';
}

function volumeEvidence(feature) {
  const ratio = feature?.indicators?.volumeRatio20;
  if (ratio == null) return 'NEUTRAL';
  if (ratio >= 1.25) return feature.lastCandle.close >= feature.lastCandle.open ? 'BULLISH' : 'BEARISH';
  return 'NEUTRAL';
}

function addEvidence(result, name, weight, direction, detail) {
  const long = direction === 'BULLISH' ? weight : 0;
  const short = direction === 'BEARISH' ? weight : 0;
  result.longScore += long;
  result.shortScore += short;
  result.evidence.push({ name, weight, direction, detail });
}

export function buildConfluence({ features, contexts, market }) {
  const result = {
    longScore: 0,
    shortScore: 0,
    evidence: [],
    conflicts: [],
    noTradeReasons: [],
    alignment: {},
    setupState: 'UNCONFIRMED'
  };

  const htf = ['1D', '4H', '1H'];
  const exec = ['15m', '5m'];
  const htfDirs = htf.map(tf => [tf, trendDirection(features?.[tf])]);
  const execDirs = exec.map(tf => [tf, trendDirection(features?.[tf])]);
  result.alignment = {
    htf: Object.fromEntries(htfDirs),
    execution: Object.fromEntries(execDirs),
    htfBullish: htfDirs.filter(([, d]) => d === 'BULLISH').length,
    htfBearish: htfDirs.filter(([, d]) => d === 'BEARISH').length,
    executionBullish: execDirs.filter(([, d]) => d === 'BULLISH').length,
    executionBearish: execDirs.filter(([, d]) => d === 'BEARISH').length
  };

  const htfBull = result.alignment.htfBullish;
  const htfBear = result.alignment.htfBearish;
  if (htfBull >= 2 && htfBull > htfBear) addEvidence(result, 'HTF trend alignment', 20, 'BULLISH', `${htfBull}/3 HTF timeframes bullish`);
  else if (htfBear >= 2 && htfBear > htfBull) addEvidence(result, 'HTF trend alignment', 20, 'BEARISH', `${htfBear}/3 HTF timeframes bearish`);
  else result.noTradeReasons.push('HTF trend is mixed or neutral');

  const s15 = structureDirection(contexts?.['15m']);
  const s1h = structureDirection(contexts?.['1H']);
  const structureDir = s15 === s1h ? s15 : s15 !== 'NEUTRAL' ? s15 : s1h;
  addEvidence(result, 'Structure', 20, structureDir, `15m=${s15}, 1H=${s1h}`);
  if (s15 !== 'NEUTRAL' && s1h !== 'NEUTRAL' && s15 !== s1h) result.conflicts.push('15m and 1H structure disagree');

  const l15 = liquidityDirection(contexts?.['15m']);
  const l5 = liquidityDirection(contexts?.['5m']);
  const liquidityDir = l15 !== 'NEUTRAL' ? l15 : l5;
  addEvidence(result, 'Liquidity', 15, liquidityDir, `15m=${l15}, 5m=${l5}`);

  const m15 = momentumDirection(features?.['15m']);
  const m5 = momentumDirection(features?.['5m']);
  const momentumDir = m15 === m5 ? m15 : m15 !== 'NEUTRAL' ? m15 : m5;
  addEvidence(result, 'Momentum', 15, momentumDir, `15m=${m15}, 5m=${m5}`);

  const vwapDir = vwapDirection(features?.['15m']);
  addEvidence(result, 'VWAP location', 10, vwapDir, `15m price vs VWAP=${vwapDir}`);

  const volumeDir = volumeEvidence(features?.['15m']);
  addEvidence(result, 'Volume expansion', 5, volumeDir, `15m volume ratio=${features?.['15m']?.indicators?.volumeRatio20 ?? null}`);

  const oi = market?.openInterest?.oi;
  const funding = market?.fundingRate;
  // OI/funding are contextual, not directional by themselves in this v1.
  if (oi != null) result.evidence.push({ name: 'Open interest', weight: 5, direction: 'CONTEXT', detail: `OI=${oi}` });
  if (funding != null) result.evidence.push({ name: 'Funding', weight: 2.5, direction: 'CONTEXT', detail: `funding=${funding}` });

  const bookBias = contexts?.['15m']?.orderBook?.bias;
  const bookDir = bookBias === 'BID_DOMINANT' ? 'BULLISH' : bookBias === 'ASK_DOMINANT' ? 'BEARISH' : 'NEUTRAL';
  addEvidence(result, 'Order-book imbalance', 5, bookDir, `15m=${bookBias || 'UNKNOWN'}`);

  const atr = features?.['15m']?.indicators?.atr14;
  const price = features?.['15m']?.lastCandle?.close;
  const atrPct = atr != null && price ? (atr / price) * 100 : null;
  result.evidence.push({ name: 'Volatility', weight: 2.5, direction: 'CONTEXT', detail: `15m ATR%=${atrPct}` });
  if (atrPct != null && atrPct < 0.15) result.noTradeReasons.push('15m volatility is very low');

  const gap = Math.abs(result.longScore - result.shortScore);
  const dominant = result.longScore > result.shortScore ? 'LONG' : result.shortScore > result.longScore ? 'SHORT' : 'NONE';
  const htfConflict = htfBull > 0 && htfBear > 0 && Math.max(htfBull, htfBear) < 2;
  if (htfConflict) result.noTradeReasons.push('No clear HTF majority');
  if (result.conflicts.length) result.noTradeReasons.push('Cross-timeframe structure conflict');
  if (gap < 10) result.noTradeReasons.push('Directional edge is too small');

  const maxScore = 100;
  const dominantScore = dominant === 'LONG' ? result.longScore : dominant === 'SHORT' ? result.shortScore : 0;
  if (dominantScore >= 70 && gap >= 10 && result.noTradeReasons.length === 0) {
    result.setupState = 'ACTIONABLE';
  } else if (dominantScore >= 60) {
    result.setupState = 'WATCH';
  } else {
    result.setupState = 'NO_TRADE';
  }

  result.directionBias = result.setupState === 'ACTIONABLE' ? dominant : 'NO_TRADE';
  result.score = dominantScore;
  result.scoreScale = maxScore;
  result.scoreMeaning = 'Evidence score, not a win probability. Thresholds require historical calibration/backtesting.';
  result.invalidation = result.directionBias === 'LONG'
    ? 'Invalidate if the supporting 15m/1H structure fails or the liquidity/confirmation evidence reverses.'
    : result.directionBias === 'SHORT'
      ? 'Invalidate if the supporting 15m/1H structure fails or the liquidity/confirmation evidence reverses.'
      : 'No directional invalidation until a qualified setup exists.';

  return result;
}
