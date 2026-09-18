import{buildInstitutionalAnalysis}from'./institutional-engine.js';
import{simulateExecution}from'./execution-simulator.js';
import{measureExcursions}from'./excursion-engine.js';
import{calibrateProbability}from'./calibration-engine.js';
import{buildWalkForwardWindows,summarizeWalkForward}from'./walkforward-engine.js';
import{estimatePBO,detectOverfit}from'./overfitting-engine.js';
import{safeDiv,mean}from'./quant-core.js';

function asOf(rows,ts,limit=120){
  const a=Array.isArray(rows)?rows:[];
  let lo=0,hi=a.length;
  while(lo<hi){
    const mid=(lo+hi)>>1;
    const mt=Number(a[mid]?.ts??a[mid]?.time??a[mid]?.[0]);
    if(Number.isFinite(mt)&&mt<=ts)lo=mid+1;
    else hi=mid;
  }
  return a.slice(Math.max(0,lo-limit),lo);
}

function latestBefore(rows,ts){
  const a=Array.isArray(rows)?rows:[];
  let lo=0,hi=a.length;
  while(lo<hi){
    const mid=(lo+hi)>>1;
    const mt=Number(a[mid]?.ts??a[mid]?.time??a[mid]?.[0]);
    if(Number.isFinite(mt)&&mt<=ts)lo=mid+1;
    else hi=mid;
  }
  return lo>0?a[lo-1]:null;
}

function derivativeMarket(derivatives,ts){
  const h=derivatives?.history||{};
  const oi=asOf(h.oi,ts,120);
  const funding=asOf(h.funding,ts,120);
  const ls=asOf(h.longShort,ts,120);
  const taker=asOf(h.takerVolume,ts,120);
  const lastOi=oi.at(-1)||null;
  const lastFunding=funding.at(-1)||null;
  return{
    openInterest:lastOi?{oi:lastOi.oi,oiCcy:lastOi.oiCcy,ts:lastOi.ts}:null,
    fundingRate:lastFunding?.fundingRate??null,
    fundingTime:lastFunding?.ts??null,
    nextFundingTime:lastFunding?.nextFundingTime??null,
    oiHistory:oi,
    fundingHistory:funding,
    longShortHistory:ls,
    takerVolumeHistory:taker
  };
}

function thresholdVariantFolds(rows,windows,thresholds){
  return(windows||[]).map(w=>thresholds.map(t=>{
    const test=rows.filter(x=>x.index>=w.testStart&&x.index<w.testEnd&&Number(x.probability)>=t);
    return test.length?test.reduce((s,x)=>s+(x.pnlR||0),0)/test.length:null;
  }));
}

export function runInstitutionalBacktest({
  candlesByTf,
  derivatives=null,
  horizonBars=48,
  feesBps=5,
  slippageBps=2,
  maxTrades=2000
}){
  const base=(candlesByTf['15m']||[]).filter(x=>x.confirmed);
  const rows=[],probRows=[];
  let nextAvailableIndex=220;

  const diagnostics={
    evaluated:0,
    setupFound:0,
    setupTypes:{},
    decisions:{},
    reasons:{},
    probabilitySamples:0,
    probabilityMin:null,
    probabilityMax:null,
    probabilitySum:0
  };

  for(let i=220;i<base.length-horizonBars&&rows.length<maxTrades;i++){
    const history={};
    for(const [tf,c] of Object.entries(candlesByTf)){
      history[tf]=(c||[]).filter(x=>x.confirmed&&x.time<=base[i].time);
    }

    if(i<nextAvailableIndex)continue;
    diagnostics.evaluated++;

    const market={
      ...derivativeMarket(derivatives,base[i].time),
      price:base[i].close,
      instrument:'ETH-USDT-SWAP'
    };

    const a=buildInstitutionalAnalysis({
      candlesByTf:history,
      market,
      timestamp:base[i].time,
      mode:'backtest'
    });

    diagnostics.decisions[a.decision]=(diagnostics.decisions[a.decision]||0)+1;
    if(a.setup){
      diagnostics.setupFound++;
      diagnostics.setupTypes[a.setup.type]=(diagnostics.setupTypes[a.setup.type]||0)+1;
    }
    for(const reason of a.noTradeReasons||[]){
      diagnostics.reasons[reason]=(diagnostics.reasons[reason]||0)+1;
    }

    diagnostics.probabilitySamples++;
    diagnostics.probabilitySum+=a.probability.probability;
    diagnostics.probabilityMin=diagnostics.probabilityMin==null?a.probability.probability:Math.min(diagnostics.probabilityMin,a.probability.probability);
    diagnostics.probabilityMax=diagnostics.probabilityMax==null?a.probability.probability:Math.max(diagnostics.probabilityMax,a.probability.probability);

    if(a.decision==='NO_TRADE')continue;
    const risk=a.risk;
    if(!risk||!Number.isFinite(risk.stopLoss)||!Number.isFinite(risk.target))continue;

    const sim=simulateExecution({
      entry:base[i].close,
      stopLoss:risk.stopLoss,
      target:risk.target,
      direction:a.decision,
      candles:base.slice(i+1,i+1+horizonBars),
      horizonBars,
      feesBps,
      slippageBps
    });

    const ex=measureExcursions({
      trade:{
        direction:a.decision,
        entry:base[i].close,
        risk:Math.abs(base[i].close-risk.stopLoss),
        horizonBars
      },
      candles:base.slice(i,i+horizonBars)
    });

    const r={
      index:i,
      time:base[i].time,
      direction:a.decision,
      probability:a.probability.probability,
      score:a.probability.quality,
      outcome:sim.outcome,
      pnlR:sim.pnlR,
      barsHeld:sim.barsHeld,
      mfeR:ex.mfeR,
      maeR:ex.maeR,
      setup:a.setup.type,
      regime:a.regime?.environment||'UNKNOWN'
    };
    rows.push(r);

    // Calibration is explicitly based on resolved WIN/LOSS outcomes.
    // TIMEOUTs remain in performance statistics but are not treated as binary wins/losses.
    if(sim.outcome==='WIN'||sim.outcome==='LOSS'){
      probRows.push({p:a.probability.probability,y:sim.outcome==='WIN'?1:0});
    }

    nextAvailableIndex=i+Math.max(1,sim.barsHeld);
  }

  const wins=rows.filter(x=>x.outcome==='WIN').length;
  const losses=rows.filter(x=>x.outcome==='LOSS').length;
  const timeouts=rows.filter(x=>x.outcome==='TIMEOUT').length;
  const closed=wins+losses;
  const netR=rows.reduce((s,x)=>s+x.pnlR,0);
  const calibration=calibrateProbability(probRows);

  const windows=buildWalkForwardWindows(base.length,{trainBars:800,testBars:200,step:200});
  const wf=summarizeWalkForward(windows,rows);

  const thresholds=[0.50,0.55,0.60,0.65];
  const variantMatrix=thresholdVariantFolds(rows,windows,thresholds);
  const pbo=estimatePBO(variantMatrix);

  const trainRates=wf.map(x=>x.trainWinRate).filter(Number.isFinite);
  const testRates=wf.map(x=>x.testWinRate).filter(Number.isFinite);
  const overfitting=detectOverfit({
    inSample:mean(trainRates)??0,
    outOfSample:mean(testRates)??0,
    experiments:thresholds.length,
    pbo:pbo.pbo
  });

  diagnostics.probabilityMean=diagnostics.probabilitySamples
    ? diagnostics.probabilitySum/diagnostics.probabilitySamples
    : null;

  return{
    diagnostics,
    methodology:{
      executionTimeframe:'15m',
      contextTimeframes:['1H','4H','1D'],
      positionModel:'single-position-no-overlap',
      sameBarHandling:'LOSS',
      feesBps,
      slippageBps,
      horizonBars,
      lookahead:'closed candles only',
      derivativesAlignment:'as-of-only; no future derivative observation used',
      historyRequirement:'prefer OKX history-candles'
    },
    derivativesDataQuality:derivatives?.quality||{
      oi:{count:0,available:false},
      funding:{count:0,available:false},
      longShort:{count:0,available:false},
      takerVolume:{count:0,available:false}
    },
    summary:{
      trades:rows.length,
      wins,
      losses,
      timeouts,
      timeoutRate:rows.length?safeDiv(timeouts,rows.length)*100:null,
      winRate:closed?safeDiv(wins,closed)*100:null,
      targetHitRate:rows.length?safeDiv(wins,rows.length)*100:null,
      netR,
      avgR:rows.length?netR/rows.length:null,
      maxDrawdownR:drawdown(rows.map(x=>x.pnlR))
    },
    calibration,
    walkForward:{
      parameters:{trainBars:800,testBars:200,step:200},
      windows:wf,
      usableWindows:wf.filter(x=>x.testTrades>=5).length
    },
    overfitting,
    pbo:{
      ...pbo,
      variantThresholds:thresholds
    },
    trades:rows
  };
}

function drawdown(a){
  let equity=0,peak=0,dd=0;
  for(const r of a){
    equity+=r;
    peak=Math.max(peak,equity);
    dd=Math.max(dd,peak-equity);
  }
  return dd;
}
