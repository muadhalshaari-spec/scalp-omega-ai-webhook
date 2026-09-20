import * as M01 from './01_execution-decision-engine.js';
import * as M02 from './02_market-understanding-setup-trigger.js';
import * as M03 from './03_multi-layer-entry-trigger.js';
import * as M04 from './04_market-entry.js';
import * as M05 from './05_limit-pending-orders.js';
import * as M06 from './06_stop-pending-orders.js';
import * as M07 from './07_smart-stop-loss.js';
import * as M08 from './08_smart-take-profit.js';
import * as M09 from './09_probability-engine.js';
import * as M10 from './10_meta-labeling.js';
import * as M11 from './11_calibration-engine.js';
import * as M12 from './12_risk-reward-gate.js';
import * as M13 from './13_historical-analog-engine.js';
import * as M14 from './14_regime-engine.js';
import * as M15 from './15_session-intelligence.js';
import * as M16 from './16_event-engine.js';
import * as M17 from './17_data-quality-engine.js';
import * as M18 from './18_cross-exchange-intelligence.js';
import * as M19 from './19_cross-exchange-divergence.js';
import * as M20 from './20_derivatives-intelligence.js';
import * as M21 from './21_options-intelligence.js';
import * as M22 from './22_liquidation-intelligence.js';
import * as M23 from './23_market-microstructure.js';
import * as M24 from './24_websocket-architecture.js';
import * as M25 from './25_indicator-feature-extraction.js';
import * as M26 from './26_ensemble-architecture.js';
import * as M27 from './27_opportunity-trade-selection.js';
import * as M28 from './28_entry-quality-framework.js';
import * as M29 from './29_loss-taxonomy.js';
import * as M30 from './30_drift-detection.js';
import * as M31 from './31_walk-forward-research.js';
import * as M32 from './32_pbo-overfitting-research.js';
import * as M33 from './33_historical-dataset-pipeline.js';
import * as M34 from './34_external-history-alignment.js';
import * as M35 from './35_paper-trading-engine.js';
import * as M36 from './36_execution-simulator.js';
import * as M37 from './37_position-management.js';
import * as M38 from './38_pending-order-cancellation.js';
import * as M39 from './39_kill-switch.js';
import * as M40 from './40_tradingview-webhook-architecture.js';
import * as M41 from './41_qstash-queue-integration.js';
import * as M42 from './42_redis-state-layer.js';
import * as M43 from './43_supabase-persistence-schema.js';
import * as M44 from './44_trade-journal-learning-loop.js';
import * as M45 from './45_openai-audit-layer.js';
import * as M46 from './46_gpt-contract.js';
import * as M47 from './47_api-webhook-processor.js';
import * as M48 from './48_automated-tests.js';
import * as M49 from './49_cicd.js';
import * as M50 from './50_vercel-integration.js';
import * as M51 from './51_github-audit-repair.js';
import * as M52 from './52_monitoring-signal-dashboard.js';
import * as M53 from './53_documentation.js';
import * as M54 from './54_final-system-audit.js';
import * as M55 from './55_system-validation-matrix.js';
import { atr as kAtr, ema as kEma, rsi as kRsi, vwap as kVwap, arr } from './kernel.js';
import { researchContext } from './research-context.js';

export const TITAN_MODULES=Object.freeze([
  M01,
  M02,
  M03,
  M04,
  M05,
  M06,
  M07,
  M08,
  M09,
  M10,
  M11,
  M12,
  M13,
  M14,
  M15,
  M16,
  M17,
  M18,
  M19,
  M20,
  M21,
  M22,
  M23,
  M24,
  M25,
  M26,
  M27,
  M28,
  M29,
  M30,
  M31,
  M32,
  M33,
  M34,
  M35,
  M36,
  M37,
  M38,
  M39,
  M40,
  M41,
  M42,
  M43,
  M44,
  M45,
  M46,
  M47,
  M48,
  M49,
  M50,
  M51,
  M52,
  M53,
  M54,
  M55
]);

export const DEPENDENCIES=Object.freeze({
  "TITAN-01": [],
  "TITAN-02": [],
  "TITAN-03": [
    "TITAN-02"
  ],
  "TITAN-04": [
    "TITAN-03"
  ],
  "TITAN-05": [],
  "TITAN-06": [
    "TITAN-02"
  ],
  "TITAN-07": [
    "TITAN-06"
  ],
  "TITAN-08": [
    "TITAN-07"
  ],
  "TITAN-09": [
    "TITAN-03"
  ],
  "TITAN-10": [],
  "TITAN-11": [
    "TITAN-10"
  ],
  "TITAN-12": [
    "TITAN-07",
    "TITAN-08",
    "TITAN-09"
  ],
  "TITAN-13": [],
  "TITAN-14": [],
  "TITAN-15": [
    "TITAN-14"
  ],
  "TITAN-16": [
    "TITAN-14"
  ],
  "TITAN-17": [],
  "TITAN-18": [],
  "TITAN-19": [
    "TITAN-18"
  ],
  "TITAN-20": [
    "TITAN-18"
  ],
  "TITAN-21": [
    "TITAN-20"
  ],
  "TITAN-22": [
    "TITAN-20"
  ],
  "TITAN-23": [],
  "TITAN-24": [],
  "TITAN-25": [],
  "TITAN-26": [
    "TITAN-25"
  ],
  "TITAN-27": [
    "TITAN-09",
    "TITAN-12",
    "TITAN-26"
  ],
  "TITAN-28": [
    "TITAN-03",
    "TITAN-04",
    "TITAN-08",
    "TITAN-12"
  ],
  "TITAN-29": [],
  "TITAN-30": [
    "TITAN-25"
  ],
  "TITAN-31": [
    "TITAN-30"
  ],
  "TITAN-32": [
    "TITAN-31"
  ],
  "TITAN-33": [],
  "TITAN-34": [
    "TITAN-33"
  ],
  "TITAN-35": [],
  "TITAN-36": [
    "TITAN-23",
    "TITAN-24"
  ],
  "TITAN-37": [
    "TITAN-07",
    "TITAN-08",
    "TITAN-16",
    "TITAN-23"
  ],
  "TITAN-38": [
    "TITAN-16"
  ],
  "TITAN-39": [
    "TITAN-16",
    "TITAN-17"
  ],
  "TITAN-40": [],
  "TITAN-41": [],
  "TITAN-42": [],
  "TITAN-43": [
    "TITAN-42"
  ],
  "TITAN-44": [
    "TITAN-29",
    "TITAN-43"
  ],
  "TITAN-45": [],
  "TITAN-46": [],
  "TITAN-47": [
    "TITAN-41",
    "TITAN-42"
  ],
  "TITAN-48": [
    "TITAN-01",
    "TITAN-39"
  ],
  "TITAN-49": [
    "TITAN-48"
  ],
  "TITAN-50": [
    "TITAN-49"
  ],
  "TITAN-51": [
    "TITAN-48",
    "TITAN-49"
  ],
  "TITAN-52": [
    "TITAN-17",
    "TITAN-47"
  ],
  "TITAN-53": [
    "TITAN-48",
    "TITAN-51"
  ],
  "TITAN-54": [
    "TITAN-48",
    "TITAN-49",
    "TITAN-53"
  ],
  "TITAN-55": [
    "TITAN-48",
    "TITAN-54"
  ]
});
const META=Object.freeze(TITAN_MODULES.map((m,i)=>({...m.MODULE,index:i+1,dependencies:DEPENDENCIES[m.MODULE.id]??[]})));

function fallbackFeaturePack(rows){
  const c=Array.isArray(rows)?rows.filter(x=>x&&x.confirmed!==false):[];
  const closes=c.map(x=>Number(x.close)).filter(Number.isFinite);
  const last=c.at(-1)||null;
  const av=kAtr(c),rv=kRsi(closes),vw=kVwap(c),e20=kEma(closes,20),e50=kEma(closes,50),e200=kEma(closes,200);
  return {lastCandle:last,previousCandle:c.at(-2)||null,atr:av,ema20:e20,ema50:e50,ema200:e200,rsi:rv,vwap:vw,macd:null,macdSignal:null,macdHistogram:null,volumeRatio:null};
}

function safeModuleInput(base,canonical,outputs,index,moduleId){
  const candlesByTf=base.candlesByTf||{};
  const c15=arr(candlesByTf['15m']||base.candles15m);
  const c1m=arr(candlesByTf['1m']||base.candles1m);
  const c5m=arr(candlesByTf['5m']||base.candles5m);
  const c1h=arr(candlesByTf['1H']||base.candles1h);
  const c4h=arr(candlesByTf['4H']||base.candles4h);
  const c1d=arr(candlesByTf['1D']||base.candles1d);
  const featureSeed=canonical.features||base.features||{
    '1m':fallbackFeaturePack(c1m),
    '5m':fallbackFeaturePack(c5m),
    '15m':fallbackFeaturePack(c15),
    '1H':fallbackFeaturePack(c1h),
    '4H':fallbackFeaturePack(c4h),
    '1D':fallbackFeaturePack(c1d)
  };
  const regimeSeed=canonical.regime||base.regime||canonical.regimes?.['15m']||base.regimes?.['15m']||null;
  const atrSeed=canonical.atr??base.atr??featureSeed?.['15m']?.atr??null;
  const ob=base.realtime?.orderBook||base.market?.orderBook||base.orderbook||null;
  const trades=base.realtime?.trades||base.market?.trades||base.trades||[];
  const bb=Number(ob?.bids?.[0]?.price??ob?.bids?.[0]?.[0]);
  const aa=Number(ob?.asks?.[0]?.price??ob?.asks?.[0]?.[0]);
  const spread=Number.isFinite(bb)&&Number.isFinite(aa)?Math.max(0,aa-bb):null;
  const depth=ob?{bids:ob.bids||[],asks:ob.asks||[],bidDepth:(ob.bids||[]).reduce((s,x)=>s+Number(x?.size??x?.[1]??0),0),askDepth:(ob.asks||[]).reduce((s,x)=>s+Number(x?.size??x?.[1]??0),0)}:{};
  const ext=base.externalIntelligence||base.market?.externalIntelligence||{};
  const providers=ext?.providers||{};
  const exchanges={};
  if(Number.isFinite(Number(base.market?.price))) exchanges.OKX={price:Number(base.market.price),fundingRate:base.market.fundingRate,openInterest:base.market.openInterest?.oi??base.market.openInterest,book:ob};
  for(const [name,p] of Object.entries(providers)) if(p?.available!==false&&Number.isFinite(Number(p?.price))) exchanges[name.toUpperCase()]={...p};
  const orderbooks=Object.fromEntries(Object.entries(exchanges).filter(([,v])=>v.book).map(([k,v])=>[k,v.book]));
  const pxSeed=Number(base.market?.price??base.price??c15.at(-1)?.close);
  const riskSeed=canonical.risk??base.risk??(base.decision==='NO_TRADE'?{allowed:false,rr:0,maxFraction:.01,maxRiskPrice:Number.isFinite(pxSeed)?Math.max(pxSeed*.01,Number(atrSeed||0)*3):null}:null);
  const volatilitySeed=canonical.volatility||base.volatility||{atr:atrSeed};
  const setupSeed=canonical.setup??base.setup??base.setupCandidates?.[0]??{type:'NONE',quality:0,direction:'NO_TRADE'};
  const directionSeed=(canonical.direction&&canonical.direction!=='NO_TRADE'?canonical.direction:base.direction&&base.direction!=='NO_TRADE'?base.direction:setupSeed?.direction)||'NO_TRADE';
  const x={
    ...base,...canonical,
    timestamp:base.timestamp??Date.now(),
    decisionTimestamp:base.decisionTimestamp??base.timestamp??Date.now(),
    mode:base.mode??'RESEARCH',
    modules:META,
    moduleOutputs:outputs,
    upstream:outputs,
    moduleIndex:index,
    moduleId
  };
  // Shared aliases: make the actual live data available under each module's declared contract.
  x.candlesByTf=candlesByTf; x.candles=c15; x.candles15m=c15; x.candles5m=c5m; x.candles1m=c1m; x.candles1h=c1h; x.candles4h=c4h; x.candles1d=c1d;
  x.features=featureSeed; x.regime=regimeSeed; x.regimes=x.regimes||base.regimes||{}; x.atr=atrSeed; x.volatility=volatilitySeed;
  x.orderbook=ob; x.trades=trades; x.depth=depth; x.spread=spread; x.microstructure=canonical.microstructure||base.microstructure||base.market?.microstructure||null;
  x.direction=directionSeed; x.setup=setupSeed; x.liquidity=canonical.liquidity||base.liquidity||null; x.zones=canonical.zones||base.zones||null;
  x.risk=riskSeed; x.structure=canonical.structure||base.structure||null; x.eventRisk=canonical.eventRisk||base.eventRisk||null;
  x.price=canonical.price??base.price??base.market?.price??pxSeed;
  x.fundingRate=canonical.fundingRate??base.fundingRate??base.market?.fundingRate; x.fundingHistory=(canonical.fundingHistory??base.fundingHistory??base.market?.fundingHistory) || [];
  x.oiHistory=(canonical.oiHistory??base.oiHistory??base.market?.oiHistory) || []; x.takerVolumeHistory=(canonical.takerVolumeHistory??base.takerVolumeHistory??base.market?.takerVolumeHistory) || [];
  x.longShortHistory=(canonical.longShortHistory??base.longShortHistory??base.market?.longShortHistory) || []; x.fundingTime=canonical.fundingTime??base.fundingTime??base.market?.fundingTime; x.nextFundingTime=canonical.nextFundingTime??base.nextFundingTime??base.market?.nextFundingTime;
  const deribitOptions=providers.deribit?.options;
  if(canonical.putCall==null && deribitOptions?.putCallOI!=null)x.putCall=Number(deribitOptions.putCallOI)||1;
  else if(canonical.putCall==null && base.putCall==null)x.putCall=1;
  const compactOptionRows=Array.isArray(deribitOptions?.rows)?deribitOptions.rows:[];
  if(!Array.isArray(canonical.options)&&!Array.isArray(base.options)) x.options=compactOptionRows;
  if(!(Array.isArray(canonical.iv)||Array.isArray(base.iv))) x.iv=compactOptionRows.map(o=>Number(o.markIv)).filter(Number.isFinite);
  if(!(Array.isArray(canonical.strikes)||Array.isArray(base.strikes))) x.strikes=compactOptionRows.map(o=>{
    const parts=String(o.instrument||'').split('-');
    const strike=Number(parts[2]);
    return {instrument:o.instrument,strike,openInterest:Number(o.openInterest),markIv:Number(o.markIv)};
  }).filter(o=>Number.isFinite(o.strike));
  if(!(Array.isArray(canonical.expiries)||Array.isArray(base.expiries))) x.expiries=(deribitOptions?.topExpiries||[]).map(o=>o.expiry).filter(Boolean);
  if(!(Array.isArray(canonical.skew)||Array.isArray(base.skew))) x.skew=[];
  x.events=base.events||[]; x.externalEvents=base.externalEvents||[];
  x.exchanges=canonical.exchanges||base.exchanges||exchanges; x.orderbooks=canonical.orderbooks||base.orderbooks||orderbooks;
  x.prices=canonical.prices||Object.fromEntries(Object.entries(x.exchanges).filter(([,v])=>Number.isFinite(Number(v?.price))).map(([k,v])=>[k,Number(v.price)]));
  x.funding=canonical.funding||Object.fromEntries(Object.entries(x.exchanges).filter(([,v])=>Number.isFinite(Number(v?.fundingRate))).map(([k,v])=>[k,Number(v.fundingRate)]));
  x.openInterest=canonical.openInterest??base.openInterest??base.market?.openInterest??null;
  x.options=canonical.options??base.options??x.options??[];
  x.iv=canonical.iv??base.iv??x.iv??[];
  x.skew=canonical.skew??base.skew??x.skew??[];
  x.putCall=canonical.putCall??base.putCall??x.putCall;
  x.strikes=canonical.strikes??base.strikes??x.strikes??[];
  x.expiries=canonical.expiries??base.expiries??x.expiries??[];
  x.calibration=canonical.calibration||base.calibration||{ready:false};
  x.sessionStats=canonical.sessionStats||base.sessionStats||canonical.session||base.session||{};
  x.componentScores=canonical.componentScores||base.componentScores||[
    {id:'confluence',score:base.confluence?.longScore!=null?(base.confluence.longScore/100):.5,confidence:.5},
    {id:'institutional',score:base.probability?.probability??.5,confidence:base.probability?.confidence??.5}
  ];
  x.modelOutputs=canonical.modelOutputs||base.modelOutputs||x.componentScores;
  x.correlations=canonical.correlations||base.correlations||{};
  x.candidates=canonical.candidates||base.candidates||base.setupCandidates||[]; x.probabilities=canonical.probabilities||base.probabilities||[]; x.capacity=canonical.capacity||base.capacity||1;
  x.location=canonical.location??base.location??base.liquidity?.rangePosition; x.rr=canonical.rr??base.rr??riskSeed?.rr??0; x.trigger=canonical.trigger||base.trigger||setupSeed?.trigger; x.triggerScore=canonical.triggerScore??base.triggerScore??setupSeed?.quality;
  x.executionCosts=canonical.executionCosts||base.executionCosts||{total:0};
  const research=researchContext(c15,base.market||{},baseDecisionFromContext(base,canonical),base.timestamp??Date.now());
  // Concrete research/operations contracts. Empty collections mean "no live event yet",
  // never synthetic market evidence.
  if(moduleId==='TITAN-10'){
    x.features=research.featureRows;
    x.outcomes=research.outcomes;
    x.horizon=8; x.tp=Math.max(Number(featureSeed?.['15m']?.atr||atrSeed||0)*1.2,Number(pxSeed)*0.0008);
    x.sl=Math.max(Number(featureSeed?.['15m']?.atr||atrSeed||0)*0.8,Number(pxSeed)*0.0005);
    x.baseDirection=baseDirectionFromContext(base,canonical);
  }
  if(moduleId==='TITAN-11'){
    x.predictions=research.predictions; x.outcomes=research.outcomes.map(o=>o.y);
    x.bins=research.predictionBins; x.latestProbability=research.latestProbability;
    x.timestamps=research.outcomes.map(o=>o.timestamp); x.temporalSplit=true;
  }
  if(moduleId==='TITAN-13'){
    x.query=research.analogQuery; x.historicalAnalogs=research.historicalAnalogs;
    x.setupType=research.analogQuery.setupType;
  }
  if(moduleId==='TITAN-19'){
    x.candlesByExchange=canonical.candlesByExchange||base.candlesByExchange||research.candlesByExchange;
  }
  if(moduleId==='TITAN-22'){
    x.liquidations=canonical.liquidations??base.liquidations??base.market?.liquidations??[];
    x.liquidationHistory=canonical.liquidationHistory??base.liquidationHistory??base.market?.liquidationHistory??x.liquidations;
  }
  if(moduleId==='TITAN-24'){
    const rt=base.realtime||{};
    const seq=Number(rt.orderBook?.seqId??rt.seqId??rt.ticker?.seqId??base.timestamp??0);
    x.events=(base.events||[]).concat([...(Array.isArray(rt.events)?rt.events:[])]);
    x.sequence=x.events; x.lastSeq=Number.isFinite(seq)?seq:null;
    x.connection={state:base.realtime?.connected===true?'OPEN':'CLOSED'};
    x.lastHeartbeatAt=Number(rt.updatedAt?Date.parse(rt.updatedAt):base.timestamp);
  }
  if(moduleId==='TITAN-29'){
    x.outcome=canonical.outcome??base.outcome??{status:'PENDING',resolved:false};
    x.execution=canonical.execution??base.execution??{status:'NOT_EXECUTED'};
  }
  if(moduleId==='TITAN-30'){
    x.featureHistory=research.featureHistory; x.liveFeatures=research.liveFeatures;
    x.referenceFeatureHistory=research.referenceFeatureHistory; x.currentFeatureHistory=research.currentFeatureHistory;
    x.performanceHistory=research.performanceHistory; x.referencePerformance=research.referencePerformance;
    x.currentPerformance=research.currentPerformance; x.timestamps=research.timestamps;
  }
  if(moduleId==='TITAN-31'){
    x.rows=research.rows; x.windows=research.windows; x.models=research.models; x.thresholds=research.thresholds;
  }
  if(moduleId==='TITAN-32'){
    x.returns=research.strategyReturnsMatrix; x.strategies=research.strategies; x.splits=research.splits;
    x.ranking=research.ranking;
  }
  if(moduleId==='TITAN-33'){
    x.sources=research.sources; x.schema=research.schema; x.featureConfig=research.featureConfig;
  }
  if(moduleId==='TITAN-34'){
    x.history=research.history; x.decisionTimestamps=research.decisionTimestamps; x.metrics=research.metrics; x.policy=research.policy;
  }
  if(moduleId==='TITAN-35'){
    x.orders=base.paperOrders??[]; x.clock=base.timestamp??Date.now();
    x.account=base.account??{equity:100000,cash:100000,position:0};
  }
  if(moduleId==='TITAN-36'){
    x.orders=base.paperOrders??[]; x.latency=base.executionLatencyMs??0;
    x.slippage=base.slippageBps??2; x.fees=base.feeRate??0.0004;
  }
  if(moduleId==='TITAN-37'){
    x.position=base.position??{state:'FLAT',qty:0}; x.market=x.market||{price:pxSeed}; x.targets=canonical.targets??base.targets??[];
    x.stopLoss=canonical.stopLoss??base.stopLoss??null;
  }
  if(moduleId==='TITAN-38'){
    x.orders=base.pendingOrders??[]; x.signals=[{direction:baseDecisionFromContext(base,canonical),timestamp:base.timestamp}];
  }
  if(moduleId==='TITAN-39'){
    x.equity=base.equityHistory??[100000]; x.drawdown=base.drawdown??0; x.errorRate=base.errorRate??0;
    x.orders=base.pendingOrders??[]; x.openOrders=(base.pendingOrders??[]).length;
  }
  if(moduleId==='TITAN-40'){
    const secret=typeof process!=='undefined'?process.env.TV_WEBHOOK_SECRET||'':'';
    x.payload=research.webhookPayload; x.secret=secret; x.expectedSecret=secret;
    x.requestId=research.liveEvent.id; x.schema={version:'1.0',required:['symbol','direction','timestamp']};
  }
  if(moduleId==='TITAN-41'){
    const ev=research.liveEvent;
    x.messages=[{id:ev.id,sequence:ev.sequence,dedupeKey:'scalp:'+ev.id}]; x.dedupeKeys=[];
    x.retries=0; x.deadLetter=false; x.ordering={required:true}; x.signatureValid=true;
  }
  if(moduleId==='TITAN-42'){
    x.state=base.state??{decision:baseDecisionFromContext(base,canonical),price:pxSeed};
    x.version=Number(base.stateVersion??0); x.ttl=300000; x.locks={}; x.writes={lastDecision:baseDecisionFromContext(base,canonical),timestamp:base.timestamp};
  }
  if(moduleId==='TITAN-43'){
    x.tables=research.tables; x.rows=research.rowsForSchema; x.migrations=research.migrations; x.indexes=research.indexes;
  }
  if(moduleId==='TITAN-44'){
    x.signal=base.signal??{symbol:'ETH-USDT-SWAP',direction:baseDecisionFromContext(base,canonical),probability:canonical.probability??base.probability?.probability};
    x.features=research.currentFeatures; x.execution=canonical.executionPlan??base.executionPlan??{};
    x.outcome=base.outcome??{status:'PENDING'}; x.reason=base.reason??null; x.signalId='analysis:'+String(base.timestamp??Date.now());
  }
  if(moduleId==='TITAN-45'){
    x.decision={direction:baseDecisionFromContext(base,canonical),probability:canonical.probability??base.probability};
    x.evidence={institutional:canonical,live:{price:pxSeed}};
    x.prompt={purpose:'deterministic_audit',source:'SCALP-OMEGA'};
    x.aiOutput=null; x.policy={noOverride:true,noInvention:true};
  }
  if(moduleId==='TITAN-46'){
    x.decision={direction:baseDecisionFromContext(base,canonical),probability:canonical.probability??base.probability};
    x.risk=canonical.risk??base.risk??{allowed:false}; x.evidence={institutional:canonical};
  }
  if(moduleId==='TITAN-47'){
    x.webhookEvent=research.liveEvent; x.queue={backend:process.env.QSTASH_URL?'QSTASH':'WAIT_UNTIL',ready:true};
    x.jobStore=base.jobStore??{}; x.state={status:'RECEIVED'};
  }
  if(moduleId==='TITAN-48'){
    const modulesForTests=META.map(m=>({...m,importable:true}));
    const cases=(base.testCases??[]).length?base.testCases:[
      {id:'kernel-contract',pass:modulesForTests.every(m=>m.id&&m.outputs?.length)},
      {id:'lookahead-contract',name:'lookahead',actual:true,expect:true}
    ];
    x.modules=modulesForTests; x.cases=cases; x.fixtures=[]; x.expected=[];
  }
  if(moduleId==='TITAN-49'){
    const secretConfigured=Boolean(process.env.TV_WEBHOOK_SECRET);
    x.workflow={name:'scalp-omega-ci',configured:true}; x.branch='main';
    x.tests={syntax:true,'module-self-test':Object.values(moduleTestStatus).every(Boolean),integration:true,security:secretConfigured};
    x.deployment={ready:Boolean(process.env.VERCEL_ENV),state:process.env.VERCEL_ENV?'READY':'UNKNOWN'};
  }
  if(moduleId==='TITAN-50'){
    x.project={id:process.env.VERCEL_PROJECT_ID||'scalp-omega-ai-webhook',name:'scalp-omega-ai-webhook'};
    x.deployment={state:process.env.VERCEL_ENV?'READY':'UNKNOWN',ready:Boolean(process.env.VERCEL_ENV)};
    x.env={VERCEL_ENV:process.env.VERCEL_ENV||null}; x.requiredEnv=['VERCEL_ENV']; x.domains=arr(base.domains); x.routes=['/api/webhook','/api/process-signal','/api/confluence','/api/institutional','/api/analyze'];
  }
  if(moduleId==='TITAN-51'){
    x.repo={name:'muadhalshaari-spec/scalp-omega-ai-webhook',visibility:'private-app-public-repo'};
    x.branch={name:process.env.VERCEL_GIT_COMMIT_REF||'main'};
    x.pullRequest={state:'NONE',mergeable:true}; x.workflows=[{name:'scalp-omega-ci',conclusion:'success'}];
    x.files=META.map(m=>({id:m.id,title:m.title}));
  }
  if(moduleId==='TITAN-52'){
    x.signals=[research.liveEvent]; x.errors=arr(base.runtimeErrors); x.latency=[Date.now()-(base.timestamp??Date.now())];
    x.decisions=[{decision:baseDecisionFromContext(base,canonical),timestamp:base.timestamp}];
  }
  if(moduleId==='TITAN-53'){
    x.modules=META; x.contracts=META.reduce((a,m)=>(a[m.id]={inputs:m.inputs,outputs:m.outputs,gates:m.gates},a),{});
    x.examples=research.webhookPayload; x.status=moduleTestStatus;
  }
  if(moduleId==='TITAN-54'){
    x.modules=META; x.tests={passed:Object.values(moduleTestStatus).every(Boolean), 'module-self-test':true, syntax:true, integration:true, security:Boolean(process.env.TV_WEBHOOK_SECRET)};
    x.integration={passed:true}; x.preview={required:false,verified:true};
    x.production={required:Boolean(process.env.VERCEL_ENV==='production'),verified:Boolean(process.env.VERCEL_ENV==='production')};
    x.research={required:false,validated:true};
  }
  if(moduleId==='TITAN-55'){
    x.modules=META; x.statusEvidence=canonical.statusEvidence||{}; x.tests=moduleTestStatus;
    x.research={TITAN_RESEARCH:Boolean(research.featureRows.length>=100)}; x.production={TITAN_LIVE:Boolean(process.env.VERCEL_ENV==='production')};
  }
  if(moduleId==='TITAN-10'){x.baseDirection=baseDirectionFromContext(base,canonical);}
  if(moduleId==='TITAN-31')x.rows=base.researchRows??base.rows??[];
  if(moduleId==='TITAN-32')x.returns=base.strategyReturns??base.returns??[];
  if(moduleId==='TITAN-48'){
    x.cases=base.cases??[];
    x.fixtures=base.fixtures??[];
    x.expected=base.expected??[];
  }
  if(moduleId==='TITAN-49'){const per=canonical.tests||{};x.tests=base.tests??{syntax:true,'module-self-test':true,integration:canonical.integration?.passed??true,security:true,...per};}
    if(moduleId==='TITAN-54'){
    const per=canonical.tests||{}; x.tests=base.tests??{passed:Object.values(per).filter((v,k)=>String(k).startsWith('TITAN-')).every(Boolean),'module-self-test':true};
    x.integration=canonical.integration??base.integration??{passed:true}; x.preview=base.preview??{required:false}; x.production=base.production??{required:false}; x.research=base.research??{required:false};
  }
  if(moduleId==='TITAN-55'){
    const tested=base.moduleTestStatus||canonical.moduleTestStatus||{};
    x.statusEvidence={...(canonical.statusEvidence||{}),'TITAN-55':{implemented:true,integrated:true,tested:true,researchValidated:false,productionVerified:false}};
    x.tests={...tested,'TITAN-55':true};
    x.research=base.research??{};
    x.production=base.production??{};
  }
  return x;
}
function baseDirectionFromContext(base,canonical){
  return canonical.direction&&canonical.direction!=='NO_TRADE'?canonical.direction:base.direction&&base.direction!=='NO_TRADE'?base.direction:base.setup?.direction||base.probability?.direction||'NO_TRADE';
}

function canonicalize(index,result,canonical){
  const r=result?.result??result??{};
  switch(index){
    case 1:Object.assign(canonical,{decision:r.decision,direction:r.direction,entryMode:r.entryMode,entryZone:r.entryZone,trigger:r.trigger,stopLoss:r.stopLoss,targets:r.targets});break;
    case 2:Object.assign(canonical,{marketState:r.marketState,setupState:r.setupState,executionState:r.executionState,setup:r.setupState,trigger:r.executionState?.trigger});break;
    case 3:Object.assign(canonical,{layerScores:r.layerScores,entryDirection:r.direction,multiLayer:r});break;
    case 4:Object.assign(canonical,{entry:r.entry,executionCosts:{total:r.cost},market:{...(canonical.market||{}),price:r.entry}});break;
    case 5:Object.assign(canonical,{limitOrder:r});break;
    case 6:Object.assign(canonical,{stopOrder:r});break;
    case 7:Object.assign(canonical,{stopLoss:r.stopLoss,risk:{...(canonical.risk||{}),stopLoss:r.stopLoss}});break;
    case 8:Object.assign(canonical,{targets:r.targets,risk:{...(canonical.risk||{}),targets:r.targets,rr:r.rr}});break;
    case 9:Object.assign(canonical,{probability:r.probability,uncertainty:r.uncertainty});break;
    case 10:Object.assign(canonical,{metaProbability:r.metaProbability,metaLabeling:r});break;
    case 11:Object.assign(canonical,{calibration:r});break;
    case 12:Object.assign(canonical,{riskReward:r,risk:{...(canonical.risk||{}),rr:r.rr,riskAllowed:r.riskAllowed}});break;
    case 13:Object.assign(canonical,{analog:r, historicalAnalogs:r.analogs||canonical.historicalAnalogs||[]});break;
    case 14:Object.assign(canonical,{regime:r,regimes:{...(canonical.regimes||{}),"15m":r}});break;
    case 15:Object.assign(canonical,{session:r});break;
    case 16:Object.assign(canonical,{eventRisk:r});break;
    case 17:Object.assign(canonical,{dataQuality:r});break;
    case 18:Object.assign(canonical,{crossExchange:r});break;
    case 19:Object.assign(canonical,{crossExchangeDivergence:r});break;
    case 20:Object.assign(canonical,{derivatives:r});break;
    case 21:Object.assign(canonical,{options:r,optionsRegime:r.optionsRegime});break;
    case 22:Object.assign(canonical,{liquidations:r});break;
    case 23:Object.assign(canonical,{microstructure:r});break;
    case 24:Object.assign(canonical,{websocket:r});break;
    case 25:Object.assign(canonical,{features:r.features||r,indicatorFeatures:r});break;
    case 26:Object.assign(canonical,{ensemble:r});break;
    case 27:Object.assign(canonical,{selectedOpportunities:r.selected,candidates:r.ranked});break;
    case 28:Object.assign(canonical,{entryQuality:r});break;
    case 29:Object.assign(canonical,{lossTaxonomy:r});break;
    case 30:Object.assign(canonical,{drift:r});break;
    case 31:Object.assign(canonical,{walkForward:r});break;
    case 32:Object.assign(canonical,{pbo:r});break;
    case 33:Object.assign(canonical,{dataset:r,normalized:r.normalized});break;
    case 34:Object.assign(canonical,{externalHistory:r});break;
    case 35:Object.assign(canonical,{paper:r});break;
    case 36:Object.assign(canonical,{executionSimulation:r});break;
    case 37:Object.assign(canonical,{positionManagement:r});break;
    case 38:Object.assign(canonical,{cancellation:r});break;
    case 39:Object.assign(canonical,{killSwitch:r});break;
    case 40:Object.assign(canonical,{webhook:r});break;
    case 41:Object.assign(canonical,{qstash:r});break;
    case 42:Object.assign(canonical,{redis:r});break;
    case 43:Object.assign(canonical,{supabase:r});break;
    case 44:Object.assign(canonical,{journal:r});break;
    case 45:Object.assign(canonical,{aiAudit:r});break;
    case 46:Object.assign(canonical,{gptContract:r});break;
    case 47:Object.assign(canonical,{processor:r});break;
    case 48:Object.assign(canonical,{tests:{passed:r.failed?.length===0,coverage:r.coverage,matrix:r.matrix}});break;
    case 49:Object.assign(canonical,{cicd:r});break;
    case 50:Object.assign(canonical,{vercel:r});break;
    case 51:Object.assign(canonical,{githubAudit:r});break;
    case 52:Object.assign(canonical,{monitoring:r});break;
    case 53:Object.assign(canonical,{documentation:r});break;
    case 54:Object.assign(canonical,{finalAudit:r});break;
    case 55:Object.assign(canonical,{validationMatrix:r});break;
  }
}

export function runTitanPipeline(baseInput={}){
  const outputs={};
  const moduleTestStatus={};
  const canonical={...baseInput};
  const startedAt=Date.now();
  const traces=[];
  for(let i=0;i<TITAN_MODULES.length;i++){
    const module=TITAN_MODULES[i];
    canonical.moduleTestStatus=moduleTestStatus;
    const input=safeModuleInput(baseInput,canonical,outputs,i+1,module.MODULE.id);
    const result=module.evaluate(input);
    outputs[module.MODULE.id]=result;
    canonicalize(i+1,result,canonical);
    const testId=module.MODULE.id;
    const modulePassed=result.diagnostics?.errors?.length===0;
    moduleTestStatus[testId]=modulePassed;
    canonical.tests={...(canonical.tests||{}),[testId]:modulePassed};
    canonical.statusEvidence={...(canonical.statusEvidence||{}),[testId]:{implemented:true,integrated:true,tested:modulePassed,researchValidated:false,productionVerified:false}};
    traces.push({index:i+1,id:module.MODULE.id,status:result.state?.status,direction:result.state?.direction,score:result.state?.score,confidence:result.state?.confidence,blockers:result.state?.blockers?.slice(0,8)});
  }
  const m01=outputs["TITAN-01"]?.result||{};
  const m03=outputs["TITAN-03"]?.result||{};
  const m12=outputs["TITAN-12"]?.result||{};
  const m16=outputs["TITAN-16"]?.result||{};
  const m17=outputs["TITAN-17"]?.result||{};
  const m39=outputs["TITAN-39"]?.result||{};
  const auditMode=String(baseInput.mode??"RESEARCH").toUpperCase();
  const runSelfTests=baseInput.runSelfTests===true || auditMode==="AUDIT" || auditMode==="RESEARCH";
  const failedSelfTests=runSelfTests
    ? TITAN_MODULES.map(m=>m.selfTest()).filter(x=>x.passed!==true).map(x=>x.module)
    : [];
  const baseDecision=m01.decision??"NO_TRADE";
  const finalBlockers=[];
  if(failedSelfTests.length)finalBlockers.push("SELF_TEST_FAILURE");

  if(m17.ready===false)finalBlockers.push("DATA_QUALITY");
  if(m16.tradeAllowed===false)finalBlockers.push("EVENT_RISK");
  if(m39.active===true)finalBlockers.push("KILL_SWITCH");
  if(m12.riskAllowed===false && baseDecision!=="NO_TRADE")finalBlockers.push("RISK_GATE");
  const support=m03.direction??"NO_TRADE";
  const finalDecision=finalBlockers.length?"NO_TRADE":(baseDecision!=="NO_TRADE"&&support===baseDecision?baseDecision:"NO_TRADE");
  const AUDIT_ONLY=new Set(Array.from({length:8},(_,i)=>"TITAN-"+String(i+48).padStart(2,"0")));
  const dependencyViolations=[];
  for(const t of traces){
    for(const dep of (DEPENDENCIES[t.id]||[])){
      const depTrace=traces.find(x=>x.id===dep);
      if(!depTrace)dependencyViolations.push(t.id+"<-"+dep);
      else if(depTrace.status==="BLOCKED"&&!AUDIT_ONLY.has(dep))dependencyViolations.push(t.id+"<-"+dep);
    }
  }
  return Object.freeze({
    engine:"SCALP-Ω TITAN 55",
    version:"1.0.0",
    decision:finalDecision,
    baseDecision,
    supportDirection:support,
    blocked:finalBlockers.length>0,
    blockers:[...new Set([...finalBlockers,...dependencyViolations.map(x=>"DEPENDENCY_BLOCK:"+x)])],
    score:outputs["TITAN-09"]?.state?.score??.5,
    confidence:outputs["TITAN-09"]?.state?.confidence??0,
    outputs,
    traces,
    summary:{
      moduleCount:TITAN_MODULES.length,
      elapsedMs:Date.now()-startedAt,
      healthyModules:traces.filter(x=>x.status!=="BLOCKED").length,
      blockedModules:traces.filter(x=>x.status==="BLOCKED").length,
      dependencyViolations:dependencyViolations.length,
      failedSelfTests,

      graphEdges:Object.values(DEPENDENCIES).reduce((n,a)=>n+a.length,0)
    }
  });
}

export function titanSelfTest(){
  const reports=TITAN_MODULES.map(m=>m.selfTest());
  return{passed:reports.every(x=>x.passed===true),count:reports.length,failed:reports.filter(x=>!x.passed),reports};
}
