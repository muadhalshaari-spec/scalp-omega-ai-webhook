function n(v){const x=Number(v);return Number.isFinite(x)?x:null}
function round(v,p=2){const x=n(v);if(x==null)return null;const m=10**p;return Math.round(x*m)/m}
function sideSign(direction){return direction==='LONG'?1:direction==='SHORT'?-1:0}

export function buildExecutionPlan({decision='NO_TRADE',setup=null,risk=null,probability=null,marketPrice=null,liquidity=null,zones=null,regime=null,timestamp=Date.now(),feesBps=8,slippageBps=4,maxAgeMs=15*60*1000}={}){
  const dir=decision==='LONG'||decision==='SHORT'?decision:'NO_TRADE';
  if(dir==='NO_TRADE') return {status:'NO_TRADE',decision:'NO_TRADE',entryMode:'NONE',createdAt:new Date(timestamp).toISOString(),reason:'No executable institutional decision.'};

  const sign=sideSign(dir);
  const entry=n(marketPrice);
  const atr=n(risk?.atr)||n(regime?.atr);
  const rawEntry=n(risk?.entry)||entry;
  const stop=n(risk?.stopLoss)||n(risk?.stop)||null;
  const targets=Array.isArray(risk?.targets)?risk.targets.filter(x=>n(x)!=null).map(n):[];
  const activeFvg=n(zones?.activeFvg?.mid)||n(zones?.activeFvg?.price);
  const activeOb=n(zones?.activeOrderBlock?.mid)||n(zones?.activeOrderBlock?.price);
  const retrace=dir==='LONG'?(activeFvg||activeOb||n(liquidity?.nearestBelow)): (activeFvg||activeOb||n(liquidity?.nearestAbove));
  const entryZone={min:null,max:null,reference:null};
  const center=n(rawEntry)||entry;
  const width=atr?Math.max(atr*0.12,Math.abs(center)*0.0005):Math.abs(center)*0.001;
  if(center!=null){entryZone.min=round(center-width,4);entryZone.max=round(center+width,4)}
  if(retrace!=null&&center!=null&&Math.abs(retrace-center)>0){entryZone.reference=round(retrace,4)}

  let entryMode='MARKET';
  if(entryZone.reference!=null){
    const distance=Math.abs(entryZone.reference-center)/(atr||Math.max(center*0.001,1));
    if(distance>=0.15) entryMode='LIMIT';
  }
  if(setup?.type && /BREAK|BREAKOUT/i.test(String(setup.type))) entryMode='STOP';

  const fill=entryMode==='LIMIT'&&entryZone.reference!=null?entryZone.reference:entry;
  const costBps=Math.max(0,feesBps+slippageBps)/10000;
  const costPerUnit=fill!=null?Math.abs(fill)*costBps:null;
  const effectiveStop=stop;
  const riskPerUnit=fill!=null&&effectiveStop!=null?Math.abs(fill-effectiveStop)+2*costPerUnit: null;
  const rr=targets.map(t=>riskPerUnit?Math.abs(t-fill)/riskPerUnit:null).filter(x=>x!=null&&Number.isFinite(x));
  const minRR=rr.length?Math.min(...rr):null;
  const confidence=probability?.probability!=null?Math.round(Number(probability.probability)*100):null;
  const trigger=entryMode==='MARKET'
    ? 'Institutional decision is confirmed; execute at/near live price within the entry zone.'
    : entryMode==='LIMIT'
      ? `Place ${dir} limit inside the entry zone; cancel if structure invalidates before fill.`
      : `Place ${dir} stop beyond the confirmed breakout trigger; cancel if breakout condition is no longer valid.`;

  return {
    status:'READY',
    decision:dir,
    entryMode,
    entry:fill!=null?round(fill,4):null,
    entryZone,
    trigger,
    stopLoss:effectiveStop!=null?round(effectiveStop,4):null,
    targets:targets.slice(0,3).map(x=>round(x,4)),
    rr:rr.slice(0,3).map(x=>round(x,2)),
    minRR:minRR!=null?round(minRR,2):null,
    confidence,
    probability:probability?.probability??null,
    invalidation:setup?.invalidation||'Cancel when the institutional setup or structural trigger is invalidated.',
    validUntil:new Date(timestamp+maxAgeMs).toISOString(),
    cancellationConditions:[
      'Closed-candle structure invalidation',
      'Live market data becomes stale',
      'Spread/slippage exceeds execution limits',
      'Event-risk gate changes to no-trade',
      'Entry is not filled before expiry'
    ],
    executionCosts:{feesBps,slippageBps,totalBps:feesBps+slippageBps},
    createdAt:new Date(timestamp).toISOString()
  };
}
