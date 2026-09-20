import {runEngine,num,arr,obj,clamp,sum,mean,stdev,median,zscore,slope,corr,ema,atr,rsi,vwap,pct,sigmoid,safeDiv,hash,round,candles,closes,highs,lows,volumes} from "./kernel.js";
export const MODULE=Object.freeze({id:"TITAN-21",slug:"options-intelligence",title:"Options Intelligence",version:"5.0.0",modes:["LIVE","PAPER","BACKTEST","RESEARCH","AUDIT"],inputs:["options","iv","skew","putCall","strikes","expiries"],outputs:["optionsRegime","oiProfile","ivState","skewState"],gates:["expiryCoverage","surface","freshness"],lifecycle:["OBSERVE","NORMALIZE","DERIVE","GATE","DECIDE","AUDIT"],invariants:["no lookahead","domain-specific math","fail closed","traceable evidence"]});

function parseExpiry(s){
  const m=String(s||"").match(/^(\\d{1,2})([A-Z]{3})(\\d{2})$/);
  if(!m)return null;
  const months={JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11};
  const month=months[m[2]]; if(month==null)return null;
  return Date.UTC(2000+Number(m[3]),month,Number(m[1]));
}

function derive(input={}){
  const options=arr(input.options).filter(x=>x&&x.instrument);
  const rows=arr(input.strikes).map(r=>({strike:num(r.strike),oi:num(r.openInterest??r.oi,0),iv:num(r.markIv??r.iv),instrument:String(r.instrument||"")})).filter(r=>r.strike!=null&&r.iv!=null);
  const ivFallback=arr(input.iv).map(Number).filter(Number.isFinite);
  const expSet=new Set(arr(input.expiries).filter(Boolean));
  const expiryMap=new Map(), strikeMap=new Map();
  let callOI=0,putOI=0,totalOI=0;
  for(const o of (options.length?options:rows)){
    const instrument=String(o.instrument??o.instrument_name??"");
    const parts=instrument.split("-");
    const expiry=parts[1]||String(o.expiry||"UNKNOWN"), side=String(parts[3]||o.side||"").toUpperCase();
    const strike=num(o.strike??parts[2]), oi=num(o.openInterest??o.open_interest??o.oi,0), iv=num(o.markIv??o.mark_iv??o.iv);
    if(strike==null)return;
    if(side==="C")callOI+=oi; else if(side==="P")putOI+=oi;
    totalOI+=oi;
    const e=expiryMap.get(expiry)||{expiry,oi:0,ivWeighted:0,ivWeight:0,ts:parseExpiry(expiry)};
    e.oi+=oi; if(iv!=null){e.ivWeighted+=iv*oi;e.ivWeight+=oi;} expiryMap.set(expiry,e);
    const k=strikeMap.get(strike)||{strike,callIV:[],putIV:[],oi:0}; k.oi+=oi;
    if(side==="C"&&iv!=null)k.callIV.push(iv); else if(side==="P"&&iv!=null)k.putIV.push(iv);
    strikeMap.set(strike,k);
  }
  const expiryCurve=[...expiryMap.values()].filter(e=>e.ivWeight>0).map(e=>({...e,iv:e.ivWeighted/e.ivWeight})).sort((a,b)=>(a.ts??Number.MAX_SAFE_INTEGER)-(b.ts??Number.MAX_SAFE_INTEGER));
  const fallbackIV=ivFallback.length?mean(ivFallback):null;
  const atmStrike=strikeMap.size?median([...strikeMap.keys()]):null;
  const wing=atmStrike==null?[]:[...strikeMap.values()].filter(x=>x.strike!=null);
  const lower=atmStrike==null?[]:wing.filter(x=>x.strike<atmStrike*.97).sort((a,b)=>b.strike-a.strike).slice(0,5);
  const upper=atmStrike==null?[]:wing.filter(x=>x.strike>atmStrike*1.03).sort((a,b)=>a.strike-b.strike).slice(0,5);
  const putWingIV=mean(lower.flatMap(x=>x.putIV)), callWingIV=mean(upper.flatMap(x=>x.callIV));
  const computedSkew=putWingIV!=null&&callWingIV!=null?safeDiv(putWingIV-callWingIV,mean([putWingIV,callWingIV])||1):null;
  const suppliedSkew=mean(arr(input.skew).map(Number).filter(Number.isFinite));
  const skew= suppliedSkew!=null ? suppliedSkew : computedSkew;
  let termSlope=0;
  if(expiryCurve.length>=2){
    const first=expiryCurve[0],last=expiryCurve.at(-1),days=Math.max(1,((last.ts??0)-(first.ts??0))/86400000);
    termSlope=(last.iv-first.iv)/days;
  }
  const oi={}; for(const r of rows)oi[String(r.strike)]=(oi[String(r.strike)]||0)+r.oi;
  const totalStrikeOI=sum(Object.values(oi)),conc=totalStrikeOI?Math.max(...Object.values(oi))/totalStrikeOI:0;
  const pcr=num(input.putCall,1),ivMean=expiryCurve.length?mean(expiryCurve.map(x=>x.iv)):fallbackIV;
  const regime=conc>.4?"PINNED_STRIKE":termSlope>.5?"VOL_EXPANSION":termSlope<-.5?"VOL_COMPRESSION":Math.abs(skew??0)>.08?"SKEWED":"BALANCED";
  const direction=(skew??0)<-.05&&termSlope<=0?"LONG":(skew??0)>.05&&termSlope>=0?"SHORT":"NO_TRADE";
  const surfaceQuality=clamp(Math.min(1,(expiryCurve.length||expSet.size)/4)*.4+Math.min(1,rows.length/20)*.25+Math.min(1,ivFallback.length/10)*.2+Math.min(1,totalOI>0?1:0)*.15);
  return{status:surfaceQuality>=.55?"READY":"PARTIAL",direction,score:clamp(.5+(direction==="LONG"?.15:direction==="SHORT"?-.15:0)+(surfaceQuality-.5)*.25),confidence:surfaceQuality,signals:["regime="+regime,"IV="+round(ivMean??0,4),"skew="+round(skew??0,4),"PCR="+round(pcr??1,3)],gates:{expiryCoverage:expiryCurve.length>=2||expSet.size>=2,surface:rows.length>=3||ivFallback.length>=3,freshness:input.freshness!==false},metrics:{ivMean,skew,termSlope,concentration:conc,totalOI:totalStrikeOI,callOI,putOI,expiryCurve,atmStrike,putWingIV,callWingIV},optionsRegime:regime,oiProfile:{byStrike:oi,concentration:conc,totalOI:totalStrikeOI},ivState:{mean:ivMean,termSlope,termSlopeUnits:"IV-points-per-day"},skewState:{value:skew,putCall:pcr,putWingIV,callWingIV,method:computedSkew!=null?"WING_IV":"SUPPLIED"}};}
export function evaluate(input={}){return runEngine({module:MODULE,input,derive})}
export function selfTest(){const t=1700000000000,a=evaluate({mode:"RESEARCH",timestamp:t,decisionTimestamp:t,sourceTimestamp:t-1}),b=evaluate({mode:"RESEARCH",timestamp:t,decisionTimestamp:t,sourceTimestamp:t+1});return{module:MODULE.id,passed:a.provenance.lookaheadSafe&&b.diagnostics.errors.includes("LOOKAHEAD_VIOLATION")}}
export default evaluate;