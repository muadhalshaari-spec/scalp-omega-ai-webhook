function trendDirection(feature) {
  if (!feature?.indicators || !feature?.momentum) return 'NEUTRAL';
  const i = feature.indicators, m = feature.momentum;
  let bull = 0, bear = 0;
  if (m.aboveEma20 === true) bull++; else if (m.aboveEma20 === false) bear++;
  if (m.aboveEma50 === true) bull++; else if (m.aboveEma50 === false) bear++;
  if (m.aboveEma200 === true) bull++; else if (m.aboveEma200 === false) bear++;
  if (i.macdHistogram > 0) bull++; else if (i.macdHistogram < 0) bear++;
  if (i.rsi14 > 50) bull++; else if (i.rsi14 < 50) bear++;
  return bull >= 4 ? 'BULLISH' : bear >= 4 ? 'BEARISH' : 'NEUTRAL';
}

function structureDirection(context) {
  const event = context?.structure?.structureEvent;
  const highs = context?.structure?.highs || [], lows = context?.structure?.lows || [];
  if (event === 'BOS_BULLISH' || event === 'BREAK_HIGH') return 'BULLISH';
  if (event === 'BOS_BEARISH' || event === 'BREAK_LOW') return 'BEARISH';
  const h = highs.at(-1)?.type, l = lows.at(-1)?.type;
  if (h === 'HH' && l === 'HL') return 'BULLISH';
  if (h === 'LH' && l === 'LL') return 'BEARISH';
  return 'NEUTRAL';
}

function liquidityDirection(context) {
  const sweep = context?.liquidity?.sweep;
  return sweep === 'SELL_SIDE_SWEPT' ? 'BULLISH' : sweep === 'BUY_SIDE_SWEPT' ? 'BEARISH' : 'NEUTRAL';
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
  return bull >= 2 && bull > bear ? 'BULLISH' : bear >= 2 && bear > bull ? 'BEARISH' : 'NEUTRAL';
}

function vwapDirection(feature) {
  const price = feature?.lastCandle?.close, vwap = feature?.indicators?.vwap;
  return price == null || vwap == null ? 'NEUTRAL' : price > vwap ? 'BULLISH' : price < vwap ? 'BEARISH' : 'NEUTRAL';
}

function volumeEvidence(feature) {
  const ratio = feature?.indicators?.volumeRatio20;
  if (ratio == null || ratio < 1.25) return 'NEUTRAL';
  return feature.lastCandle.close >= feature.lastCandle.open ? 'BULLISH' : 'BEARISH';
}

function addEvidence(result, name, weight, direction, detail) {
  result.evidence.push({ name, weight, direction, detail });
  if (direction === 'BULLISH') result.longScore += weight;
  if (direction === 'BEARISH') result.shortScore += weight;
}

function glassnodeDirection(glassnode) {
  const latest = glassnode?.latest || {};
  const trends = glassnode?.trends || {};
  let bull = 0;
  let bear = 0;

  if (Number.isFinite(latest.sopr)) {
    if (latest.sopr > 1.01) bull++;
    else if (latest.sopr < 0.99) bear++;
  }
  if (Number.isFinite(latest.nupl)) {
    if (latest.nupl > 0.05) bull++;
    else if (latest.nupl < -0.05) bear++;
  }
  if (trends.activeAddresses != null) {
    if (trends.activeAddresses > 0.03) bull++;
    else if (trends.activeAddresses < -0.03) bear++;
  }
  if (trends.newAddresses != null) {
    if (trends.newAddresses > 0.03) bull++;
    else if (trends.newAddresses < -0.03) bear++;
  }

  return bull >= 2 && bull > bear ? 'BULLISH'
    : bear >= 2 && bear > bull ? 'BEARISH'
    : 'NEUTRAL';
}

export function buildConfluence({ features, contexts, market, glassnode = null }) {
  const result = { longScore: 0, shortScore: 0, evidence: [], conflicts: [], noTradeReasons: [], alignment: {}, setupState: 'UNCONFIRMED' };
  const htf = ['1D', '4H', '1H'], exec = ['15m', '5m'];
  const htfDirs = htf.map(tf => [tf, trendDirection(features?.[tf])]);
  const execDirs = exec.map(tf => [tf, trendDirection(features?.[tf])]);
  result.alignment = {
    htf: Object.fromEntries(htfDirs), execution: Object.fromEntries(execDirs),
    htfBullish: htfDirs.filter(([, d]) => d === 'BULLISH').length,
    htfBearish: htfDirs.filter(([, d]) => d === 'BEARISH').length,
    executionBullish: execDirs.filter(([, d]) => d === 'BULLISH').length,
    executionBearish: execDirs.filter(([, d]) => d === 'BEARISH').length
  };

  const htfBull = result.alignment.htfBullish, htfBear = result.alignment.htfBearish;
  if (htfBull >= 2 && htfBull > htfBear) addEvidence(result, 'HTF trend alignment', 20, 'BULLISH', `${htfBull}/3 HTF timeframes bullish`);
  else if (htfBear >= 2 && htfBear > htfBull) addEvidence(result, 'HTF trend alignment', 20, 'BEARISH', `${htfBear}/3 HTF timeframes bearish`);
  else result.noTradeReasons.push('HTF trend is mixed or neutral');

  const s15 = structureDirection(contexts?.['15m']), s1h = structureDirection(contexts?.['1H']);
  const structureDir = s15 === s1h ? s15 : s15 !== 'NEUTRAL' ? s15 : s1h;
  addEvidence(result, 'Structure', 20, structureDir, `15m=${s15}, 1H=${s1h}`);
  if (s15 !== 'NEUTRAL' && s1h !== 'NEUTRAL' && s15 !== s1h) result.conflicts.push('15m and 1H structure disagree');

  const l15 = liquidityDirection(contexts?.['15m']), l5 = liquidityDirection(contexts?.['5m']);
  addEvidence(result, 'Liquidity', 15, l15 !== 'NEUTRAL' ? l15 : l5, `15m=${l15}, 5m=${l5}`);

  const m15 = momentumDirection(features?.['15m']), m5 = momentumDirection(features?.['5m']);
  addEvidence(result, 'Momentum', 15, m15 === m5 ? m15 : m15 !== 'NEUTRAL' ? m15 : m5, `15m=${m15}, 5m=${m5}`);
  addEvidence(result, 'VWAP location', 10, vwapDirection(features?.['15m']), `15m price vs VWAP`);
  addEvidence(result, 'Volume expansion', 7.5, volumeEvidence(features?.['15m']), `15m volume ratio=${features?.['15m']?.indicators?.volumeRatio20 ?? null}`);

  const bookBias = contexts?.['15m']?.orderBook?.bias;
  const bookDir = bookBias === 'BID_DOMINANT' ? 'BULLISH' : bookBias === 'ASK_DOMINANT' ? 'BEARISH' : 'NEUTRAL';
  addEvidence(result, 'Order-book imbalance', 7.5, bookDir, `15m=${bookBias || 'UNKNOWN'}`);

  const onchainDir = glassnodeDirection(glassnode);
  addEvidence(result, 'Glassnode on-chain', 10, onchainDir,
    `SOPR=${glassnode?.latest?.sopr ?? null}; NUPL=${glassnode?.latest?.nupl ?? null}; activeAddressTrend=${glassnode?.trends?.activeAddresses ?? null}`);
  if (!glassnode?.quality?.available) {
    result.noTradeReasons.push('Glassnode on-chain data unavailable');
  }

  result.evidence.push({ name: 'Open interest', weight: 0, direction: 'CONTEXT', detail: `OI=${market?.openInterest?.oi ?? null}; single snapshot is non-directional` });
  result.evidence.push({ name: 'Funding', weight: 0, direction: 'CONTEXT', detail: `funding=${market?.fundingRate ?? null}; single snapshot is non-directional` });
  const atr = features?.['15m']?.indicators?.atr14, price = features?.['15m']?.lastCandle?.close;
  const atrPct = atr != null && price ? (atr / price) * 100 : null;
  result.evidence.push({ name: 'Volatility', weight: 0, direction: 'CONTEXT', detail: `15m ATR%=${atrPct}` });
  if (atrPct != null && atrPct < 0.15) result.noTradeReasons.push('15m volatility is very low');

  const gap = Math.abs(result.longScore - result.shortScore);
  const dominant = result.longScore > result.shortScore ? 'LONG' : result.shortScore > result.longScore ? 'SHORT' : 'NONE';
  if (Math.max(htfBull, htfBear) < 2) result.noTradeReasons.push('No clear HTF majority');
  if (result.conflicts.length) result.noTradeReasons.push('Cross-timeframe structure conflict');
  if (gap < 10) result.noTradeReasons.push('Directional edge is too small');

  const dominantScore = dominant === 'LONG' ? result.longScore : dominant === 'SHORT' ? result.shortScore : 0;
  if (dominantScore >= 70 && gap >= 10 && result.noTradeReasons.length === 0) result.setupState = 'ACTIONABLE';
  else if (dominantScore >= 60) result.setupState = 'WATCH';
  else result.setupState = 'NO_TRADE';
  result.directionBias = result.setupState === 'ACTIONABLE' ? dominant : 'NO_TRADE';
  result.score = dominantScore;
  result.scoreScale = 100;
  result.scoreMeaning = 'Evidence score, not a win probability. Thresholds require historical calibration/backtesting.';
  result.invalidation = result.directionBias === 'NO_TRADE' ? 'No directional invalidation until a qualified setup exists.' : 'Invalidate if supporting 15m/1H structure fails or liquidity/confirmation evidence reverses.';
  return result;
}
