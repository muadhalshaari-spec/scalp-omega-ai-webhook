import { buildDataIntelligence } from './data-intelligence.js';
import { buildMarketStructure } from './market-structure-engine.js';
import { buildLiquidityMap } from './liquidity-engine.js';
import { buildMicrostructure } from './microstructure-engine.js';
import { analyzeDerivatives } from './derivatives-engine.js';
import { classifyRegime } from './regime-engine.js';
import { buildZones, zoneAt } from './zone-engine.js';
import { detectSetups } from './setup-engine.js';
import { buildEventSequence } from './sequence-engine.js';
import { buildAdaptiveRisk } from './adaptive-risk-engine.js';
import { metaFeatures, estimateMetaProbability } from './meta-label-engine.js';
import { buildEnsemble } from './ensemble-engine.js';
import { passesThreshold } from './threshold-engine.js';
import { buildProbability } from './probability-engine.js';
import { sessionContext } from './session-engine.js';
import { buildEventRisk } from './event-risk-engine.js';
import { makeSignalJournal } from './journal-engine.js';
import { atr, ema, rsi, vwap, safeDiv, mean } from './quant-core.js';

const TF_ORDER = ['1D', '4H', '1H', '15m', '5m', '1m'];

function features(candles) {
  if (!Array.isArray(candles) || candles.length === 0) return { lastCandle: null, atr: null, ema20: null, ema50: null, ema200: null, rsi: null, vwap: null, macd: null, macdSignal: null, macdHistogram: null, volumeRatio: null };
  const closed = (candles || []).filter((x) => x.confirmed);
  const closes = closed.map((x) => x.close);
  const volumes = closed.map((x) => x.volume);
  const avgVol20 = mean(volumes.slice(-20));
  const last = closed.at(-1) || null;
  const previous = closed.at(-2) || null;
  const macdFast = ema(closes, 12);
  const macdSlow = ema(closes, 26);
  const macdSeries = closes.map((_, i) =>
    macdFast[i] != null && macdSlow[i] != null ? macdFast[i] - macdSlow[i] : null
  ).filter((x) => x != null);
  const macdSignal = ema(macdSeries, 9).at(-1) ?? null;
  const macdValue = macdSeries.at(-1) ?? null;
  return {
    lastCandle: last,
    previousCandle: previous,
    atr: atr(closed),
    ema20: ema(closes, 20).at(-1) ?? null,
    ema50: ema(closes, 50).at(-1) ?? null,
    ema200: ema(closes, 200).at(-1) ?? null,
    rsi: rsi(closes),
    vwap: vwap(closed),
    macd: macdValue,
    macdSignal,
    macdHistogram: macdValue != null && macdSignal != null ? macdValue - macdSignal : null,
    volumeRatio: avgVol20 ? (last?.volume ?? 0) / avgVol20 : null
  };
}

function directionalScore(value, positive, negative) {
  if (value === positive) return 1;
  if (value === negative) return -1;
  return 0;
}

function regimeScore(regime) {
  if (regime?.trend === 'UPTREND') return 0.85;
  if (regime?.trend === 'DOWNTREND') return 0.15;
  return 0.5;
}

function structureScore(structure) {
  if (structure?.externalDirection === 'BULLISH') return 0.85;
  if (structure?.externalDirection === 'BEARISH') return 0.15;
  return 0.5;
}

function momentumScore(feature) {
  if (!feature?.lastCandle) return 0.5;
  let s = 0.5;
  if (feature.ema20 != null) s += feature.lastCandle.close > feature.ema20 ? 0.08 : -0.08;
  if (feature.ema50 != null) s += feature.lastCandle.close > feature.ema50 ? 0.06 : -0.06;
  if (feature.ema200 != null) s += feature.lastCandle.close > feature.ema200 ? 0.06 : -0.06;
  if (feature.macdHistogram != null) s += feature.macdHistogram > 0 ? 0.06 : -0.06;
  if (feature.rsi != null) {
    if (feature.rsi >= 55 && feature.rsi <= 72) s += 0.08;
    else if (feature.rsi <= 45) s -= 0.08;
    else if (feature.rsi > 82) s -= 0.04;
  }
  return Math.max(0.05, Math.min(0.95, s));
}

function vwapScore(feature) {
  if (!feature?.lastCandle || !Number.isFinite(feature.vwap)) return 0.5;
  return feature.lastCandle.close > feature.vwap ? 0.75 : feature.lastCandle.close < feature.vwap ? 0.25 : 0.5;
}

function volumeScore(feature) {
  if (!Number.isFinite(feature?.volumeRatio)) return 0.5;
  if (feature.volumeRatio >= 1.5) return 0.8;
  if (feature.volumeRatio >= 1.1) return 0.65;
  if (feature.volumeRatio <= 0.65) return 0.35;
  return 0.5;
}

function weightedDirection(values) {
  const score = mean(values);
  if (score == null || score < 0.45) return 'SHORT';
  if (score > 0.55) return 'LONG';
  return 'NO_TRADE';
}

export function buildInstitutionalAnalysis({
  candlesByTf,
  market = {},
  realtime = {},
  externalEvents = [],
  calibration = null,
  thresholds = null,
  timestamp = Date.now(),
  mode = 'live'
}) {
  const data = buildDataIntelligence(candlesByTf, { mode });
  const clean = {};
  for (const tf of TF_ORDER) {
    clean[tf] = (candlesByTf?.[tf] || []).filter((x) => x.confirmed);
  }

  const feature = {};
  const regimes = {};
  const structures = {};

  for (const tf of TF_ORDER) {
    feature[tf] = features(clean[tf]);
    regimes[tf] = clean[tf].length >= 20 ? classifyRegime(clean[tf]) : null;
    structures[tf] = clean[tf].length >= 20 ? buildMarketStructure(clean[tf]) : null;
  }

  const c15 = clean['15m'];
  const structure15 = structures['15m'];
  const structure1h = structures['1H'];
  const liquidity = c15.length >= 20 && structure15 ? buildLiquidityMap(c15, structure15) : { pools: [], buySide: [], sellSide: [], nearestAbove: null, nearestBelow: null, sweep: 'NONE', sweepPrice: null, rangePosition: 0.5 };
  const zones = c15.length >= 20 ? zoneAt(buildZones(c15), c15.at(-1)?.close || 0) : { fvgs: [], orderBlocks: [], activeFvg: null, activeOrderBlock: null };

  const micro = buildMicrostructure({
    orderBook: realtime.orderBook || market.orderBook,
    trades: realtime.trades || market.trades || []
  });

  const derivatives = analyzeDerivatives({
    openInterest: market.openInterest,
    fundingRate: market.fundingRate,
    oiHistory: market.oiHistory || [],
    fundingHistory: market.fundingHistory || []
  });

  const setupCandidates = c15.length >= 220 && structure15 && regimes['15m'] ? detectSetups({
    regime: regimes['15m'] || { trend: 'RANGE', volatility: 'NORMAL', environment: 'UNKNOWN', atr: null, atrPct: null, rsi: null },
    structure: structure15,
    liquidity,
    zones,
    micro,
    features: feature['15m']
  }) : [];

  const setup = setupCandidates[0] || null;
  const candidateDirection = setup?.direction || 'NONE';
  const sequence = buildEventSequence(c15, {
    structure: structure15,
    liquidity,
    zones,
    micro
  });

  const htfScores = [regimes['1H'], regimes['4H'], regimes['1D']].filter(Boolean).map(regimeScore);
  const executionScores = [regimes['15m'], regimes['5m']].filter(Boolean).map(regimeScore);
  const structuralScores = [structures['15m'], structures['1H']].filter(Boolean).map(structureScore);

  const htfScore = mean(htfScores) ?? 0.5;
  const executionScore = mean(executionScores) ?? 0.5;
  const structureScoreCombined = mean(structuralScores) ?? 0.5;
  const momentum = momentumScore(feature['15m']);
  const vwapBias = vwapScore(feature['15m']);
  const volumeBias = volumeScore(feature['15m']);

  const liquidityBias =
    liquidity.sweep === 'SELL_SIDE_SWEPT' ? 0.72 :
    liquidity.sweep === 'BUY_SIDE_SWEPT' ? 0.28 :
    liquidity.rangePosition > 0.88 ? 0.35 :
    liquidity.rangePosition < 0.12 ? 0.65 :
    0.5;

  const microBias =
    micro.microDirection === 'BULLISH' ? 0.78 :
    micro.microDirection === 'BEARISH' ? 0.22 :
    0.5;

  const rawLongEvidence = mean([
    htfScore,
    executionScore,
    structureScoreCombined,
    momentum,
    vwapBias,
    volumeBias,
    liquidityBias,
    microBias
  ]) ?? 0.5;

  const rawShortEvidence = 1 - rawLongEvidence;

  const evidenceDirection =
    rawLongEvidence - rawShortEvidence > 0.08 ? 'LONG' :
    rawShortEvidence - rawLongEvidence > 0.08 ? 'SHORT' :
    'NO_TRADE';

  const direction = candidateDirection !== 'NONE' ? candidateDirection : evidenceDirection;

  const metaFeaturesValue = metaFeatures({
    direction,
    regime: regimes['15m'],
    sequence,
    setup,
    micro,
    liquidity,
    structure: structure15
  });

  const metaProbability = direction === 'NONE' || direction === 'NO_TRADE'
    ? 0.5
    : estimateMetaProbability(metaFeaturesValue);

  const setupProbability = {
    LONG: direction === 'LONG'
      ? Math.min(0.95, 0.55 + (setup?.quality || 0) * 0.28 + Math.max(0, rawLongEvidence - 0.5) * 0.35)
      : Math.max(0.05, 0.5 - Math.max(0, rawShortEvidence - 0.5) * 0.25),
    SHORT: direction === 'SHORT'
      ? Math.min(0.95, 0.55 + (setup?.quality || 0) * 0.28 + Math.max(0, rawShortEvidence - 0.5) * 0.35)
      : Math.max(0.05, 0.5 - Math.max(0, rawLongEvidence - 0.5) * 0.25)
  };

  const ensemble = buildEnsemble({
    setupProbability,
    metaProbability,
    regimeScore: htfScore * 0.6 + executionScore * 0.4,
    structureScore: structureScoreCombined,
    microScore: microBias
  });

  const sequenceFactor = 0.55 + 0.45 * (sequence.sequenceQuality || 0);
  const qualityFactor = mean([
    setup?.quality || 0.5,
    sequenceFactor,
    htfScore > 0.58 || htfScore < 0.42 ? 0.8 : 0.5,
    Math.max(0.5, 1 - Math.abs(feature['15m']?.rsi > 82 ? 1 : 0))
  ]) ?? 0.5;

  const probabilityBase = buildProbability({
    ensemble,
    calibration,
    thresholds,
    setupQuality: setup?.quality || 0.5,
    sequenceQuality: sequenceFactor
  });

  const probability = {
    ...probabilityBase,
    probability: Math.max(0.01, Math.min(0.99,
      probabilityBase.probability * 0.75 + qualityFactor * 0.25
    ))
  };

  const eventRisk = buildEventRisk({ timestamp, externalEvents });
  const session = sessionContext(timestamp);
  const reasons = [];

  if (!data.ready) reasons.push('DATA_QUALITY_GATE');
  if (direction === 'NO_TRADE' || direction === 'NONE') reasons.push('NO_DIRECTIONAL_EDGE');
  if (!setup && evidenceDirection === 'NO_TRADE') reasons.push('NO_VALID_SETUP_OR_EVIDENCE');
  if (eventRisk.riskLevel === 'HIGH') reasons.push('HIGH_EVENT_RISK');
  if (regimes['15m']?.environment === 'COMPRESSION') reasons.push('COMPRESSION_REGIME');

  const requestedDirection = direction === 'NONE' ? probability.direction : direction;

  if (
    requestedDirection !== 'NO_TRADE' &&
    !passesThreshold({
      probability: probability.probability,
      edge: probability.edge,
      direction: requestedDirection,
      thresholds: thresholds || { long: 0.72, short: 0.72, minEdge: 0.12 }
    })
  ) {
    reasons.push('PROBABILITY_GATE');
  }

  let decision = 'NO_TRADE';
  if (
    requestedDirection !== 'NO_TRADE' &&
    reasons.length === 0 &&
    eventRisk.tradeAllowed
  ) {
    decision = requestedDirection;
  }

  const risk = decision !== 'NO_TRADE'
    ? buildAdaptiveRisk({
        entry: realtime.price || market.price,
        direction: decision,
        atr: feature['15m'].atr,
        structure: structure15,
        liquidity,
        regime: regimes['15m']
      })
    : null;

  const journal = makeSignalJournal({
    timestamp,
    instrument: market.instrument || 'ETH-USDT-SWAP',
    decision,
    setup,
    regime: regimes['15m'],
    probability: probability.probability,
    score: Math.round(probability.quality * 100),
    risk,
    session,
    eventRisk
  });

  return {
    version: 'SCALP-Ω Institutional Intelligence v2',
    decision,
    probability,
    setup,
    setupCandidates,
    direction,
    regime: regimes['15m'],
    regimes,
    structure: structure15,
    structure1H: structure1h,
    structures,
    liquidity,
    zones,
    sequence,
    micro,
    derivatives,
    session,
    eventRisk,
    risk,
    journal,
    meta: {
      features: metaFeaturesValue,
      probability: metaProbability
    },
    ensemble,
    componentScores: {
      htf: htfScore,
      execution: executionScore,
      structure: structureScoreCombined,
      momentum,
      vwap: vwapBias,
      volume: volumeBias,
      liquidity: liquidityBias,
      microstructure: microBias,
      sequenceFactor,
      qualityFactor
    },
    thresholds: thresholds || { long: 0.72, short: 0.72, minEdge: 0.12 },
    noTradeReasons: reasons,
    dataQuality: data,
    layerStatus: {
      data: true,
      structure: true,
      liquidity: true,
      microstructure: micro.book.available || micro.flow.available,
      derivatives: derivatives.available,
      regime: true,
      setups: true,
      sequence: true,
      zones: true,
      adaptiveRisk: true,
      excursion: true,
      metaLabel: true,
      calibration: Boolean(calibration),
      walkForward: true,
      overfitting: true,
      executionSimulator: true,
      session: true,
      eventRisk: true,
      journal: true,
      counterfactual: true,
      ensemble: true,
      adaptiveThresholds: Boolean(thresholds),
      probability: true
    }
  };
}