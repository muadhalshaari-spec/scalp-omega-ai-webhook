function n(v){const x=Number(v);return Number.isFinite(x)?x:null}
function round(v,p=4){const x=n(v);if(x==null)return null;const m=10**p;return Math.round(x*m)/m}
function sideSign(direction){return direction==='LONG'?1:direction==='SHORT'?-1:0}
function inferEntryMode({direction,setup,marketPrice,entryZone,atr,regime}){
  if(!['LONG','SHORT'].includes(direction)) return 'NONE';
  const price=n(marketPrice);
  const trigger=String(setup?.trigger||'');
  if(/BREAKOUT|BOS|CONFIRMED.*BREAK/i.test(trigger) || /BREAKOUT|BREAK/i.test(String(setup?.type||''))) return 'STOP';
  const reference=n(entryZone?.reference);
  if(reference!=null && price!=null && atr>0 && Math.abs(reference-price)>=atr*0.12) return 'LIMIT';
  if(/MEAN_REVERSION|COMPRESSION/i.test(String(regime?.environment||'')) && reference!=null) return 'LIMIT';
  return 'MARKET';
}
export function buildExecutionPlan({decision='NO_TRADE',setup=null,risk=null,probability=null,marketPrice=null,liquidity=null,zones=null,regime=null,timestamp=Date.now(),feesBps=5,slippageBps=2,maxAgeMs=15*60*1000}={}){
  const dir=decision==='LONG'||decision==='SHORT'?decision:'NO_TRADE';
  const createdAt=new Date(timestamp).toISOString();
  if(dir==='NO_TRADE') return {status:'NO_TRADE',decision:'NO_TRADE',entryMode:'NONE',createdAt,reason:'No executable deterministic institutional decision.'};
  const entry=n(risk?.entry)||n(marketPrice);
  const atr=n(risk?.atr)||n(regime?.atr)||Math.max(Math.abs(entry||0)*0.001,1);
  const references=[dir==='LONG'?n(liquidity?.nearestBelow?.price):n(liquidity?.nearestAbove?.price),n(zones?.activeFvg?.mid),n(zones?.activeOrderBlock?.mid)].filter(Number.isFinite);
  const reference=references.filter(x=>entry!=null&&(dir==='LONG'?x<entry:x>entry)).sort((a,b)=>Math.abs(a-(entry||0))-Math.abs(b-(entry||0)))[0]??null;
  const width=Math.max(atr*0.10,Math.abs(entry||0)*0.00035);
  const center=reference!=null&&Math.abs(reference-(entry||0))>=atr*0.12?reference:entry;
  const entryZone=center!=null?{min:round(center-width),max:round(center+width),reference:reference!=null?round(reference):null}:{min:null,max:null,reference:null};
  const entryMode=inferEntryMode({direction:dir,setup,marketPrice,entryZone,atr,regime});
  const fill=entryMode==='LIMIT'&&reference!=null?reference:entry;
  const targets=Array.isArray(risk?.targets)?risk.targets.filter(Number.isFinite).slice(0,3):[risk?.target].filter(Number.isFinite);
  const stop=n(risk?.stopLoss);
  const totalCostBps=Math.max(0,feesBps+slippageBps);
  const costPerUnit=fill!=null?Math.abs(fill)*totalCostBps/10000:0;
  const riskPerUnit=fill!=null&&stop!=null?Math.abs(fill-stop)+2*costPerUnit:null;
  const rr=targets.map(t=>riskPerUnit?Math.max(0,Math.abs(t-fill)-costPerUnit)/riskPerUnit:null);
  const probabilityValue=n(probability?.probability);
  const uncertainty=n(probability?.uncertainty);
  const trigger=entryMode==='MARKET'?'Execute only while price remains inside the live entry zone and deterministic trigger is still valid.':entryMode==='LIMIT'?'Rest a limit order at the retracement zone; require structural validity at fill and cancel on invalidation.':'Place a stop order beyond the confirmed breakout trigger; require displacement and flow confirmation at activation.';
  return {status:'READY',decision:dir,entryMode,entry:fill!=null?round(fill):null,entryZone,trigger,setupTrigger:setup?.trigger||null,stopLoss:stop!=null?round(stop):null,targets:targets.map(x=>round(x)),rr:rr.map(x=>round(x,2)),minRR:rr.length?round(Math.min(...rr),2):null,probability:probabilityValue,uncertainty,probabilityBand:probabilityValue!=null&&uncertainty!=null?{low:round(Math.max(0,probabilityValue-uncertainty),3),high:round(Math.min(1,probabilityValue+uncertainty),3)}:null,invalidation:setup?.invalidation||('Invalidate '+dir+' thesis if the protected structural level is violated on a confirmed candle.'),validUntil:new Date(timestamp+maxAgeMs).toISOString(),cancellationConditions:['Closed-candle structural invalidation','Probability falls below execution threshold','Live data becomes stale','Spread or slippage exceeds configured limit','Event-risk gate changes to NO_TRADE','Order is not filled before expiry'],executionCosts:{feesBps,slippageBps,totalBps:totalCostBps},createdAt};
}
