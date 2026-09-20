import { clamp, mean, safeDiv } from './quant-core.js';

const KEYS=['trend','volatility','environment','direction','setupType','rsi','atrPct','liquiditySweep','microDirection','fundingPressure','oiSlope','session'];

function num(v,d=0){const x=Number(v);return Number.isFinite(x)?x:d}
function norm(a,b,scale=1){return Math.min(1,Math.abs(num(a)-num(b))/(Math.max(Math.abs(num(scale)),1e-9)))}
function distance(a,b){
  let d=0,w=0;
  for(const k of KEYS){
    const av=a?.[k],bv=b?.[k];
    if(av==null||bv==null)continue;
    let x=0;
    if(typeof av==='number'&&typeof bv==='number') x=Math.min(1,Math.abs(av-bv)/(Math.abs(num(a.atrPct,1))+1));
    else x=String(av)===String(bv)?0:1;
    const weight=['trend','environment','direction','setupType'].includes(k)?2:1;
    d+=x*weight;w+=weight;
  }
  return w?safeDiv(d,w,1):1;
}
export function buildAnalogFeature({direction,setup,regime,features,liquidity,micro,derivatives,session}={}){
  return {
    trend:regime?.trend??'UNKNOWN',volatility:regime?.volatility??'UNKNOWN',environment:regime?.environment??'UNKNOWN',
    direction:direction??'NO_TRADE',setupType:setup?.type??'NONE',rsi:num(features?.rsi,null),atrPct:num(regime?.atrPct,null),
    liquiditySweep:liquidity?.sweep??'NONE',microDirection:micro?.microDirection??'UNKNOWN',
    fundingPressure:derivatives?.pressure??'UNKNOWN',oiSlope:derivatives?.oiSlope??0,session:session?.name??session?.session??'UNKNOWN'
  };
}
export function findHistoricalAnalogs(current,cases=[],{k=25,maxDistance=.45}={}){
  const scored=(cases||[]).filter(x=>x?.features&&x?.outcome).map(x=>({...x,distance:distance(current,x.features)}))
    .filter(x=>x.distance<=maxDistance).sort((a,b)=>a.distance-b.distance).slice(0,k);
  const wins=scored.filter(x=>String(x.outcome).toUpperCase()==='WIN').length;
  const losses=scored.filter(x=>String(x.outcome).toUpperCase()==='LOSS').length;
  const resolved=wins+losses;
  const p=resolved?(wins+1)/(resolved+2):null;
  return {available:scored.length>0,count:scored.length,wins,losses,winRate:resolved?safeDiv(wins,resolved,null):null,bayesianProbability:p,meanDistance:scored.length?mean(scored.map(x=>x.distance)):null,analogs:scored.map(({features,outcome,distance,...x})=>({...x,outcome,distance}))};
}
export function analogConfidence(result){
  if(!result?.available)return 0;
  return clamp(Math.min(0.9,result.count/30)*Math.max(0,1-(result.meanDistance??1)),0,0.9);
}
