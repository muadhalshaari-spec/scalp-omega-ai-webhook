import { ema, atr, rsi, slope, percentile, recent, safeDiv, mean, stdev } from './quant-core.js';

function classifyTrend(close){
  const e20=ema(close,20).at(-1),e50=ema(close,50).at(-1),e200=ema(close,200).at(-1);
  const s=slope(recent(close,40));
  if(e20>e50&&e50>e200&&s>0) return 'UPTREND';
  if(e20<e50&&e50<e200&&s<0) return 'DOWNTREND';
  return 'RANGE';
}

export function classifyRegime(c){
  const candles=c||[],close=candles.map(x=>x.close).filter(Number.isFinite);
  if(close.length<20) return {trend:'UNKNOWN',volatility:'UNKNOWN',environment:'UNKNOWN',regime:'UNKNOWN',confidence:0,atr:null,atrPct:null,rsi:null};
  const a=atr(candles,14),p=close.at(-1),ap=safeDiv(a,p,0)*100;
  const rs=rsi(close,14);
  const ranges=recent(candles,200).map(x=>x.high-x.low).filter(Number.isFinite);
  const p20=percentile(ranges,.2),p50=percentile(ranges,.5),p80=percentile(ranges,.8);
  const currentRange=(candles.at(-1)?.high||0)-(candles.at(-1)?.low||0);
  const rangeMean=mean(ranges)||currentRange;
  const rangeSd=stdev(ranges)||0;
  const z=rangeSd?safeDiv(currentRange-rangeMean,rangeSd,0):0;
  const trend=classifyTrend(close);
  const vol=currentRange>=p80||z>=1.5?'EXPANDING':currentRange<=p20?'COMPRESSED':'NORMAL';
  const recentRet=safeDiv(close.at(-1)-close.at(-8),close.at(-8),0);
  const absRet=Math.abs(recentRet);
  const environment=vol==='COMPRESSED'?'COMPRESSION':vol==='EXPANDING'?(trend==='RANGE'?'EXPANSION_RANGE':trend):trend==='RANGE'?'MEAN_REVERSION':trend;
  const breakout=trend!=='RANGE'&&vol==='EXPANDING';
  const reversal=trend==='RANGE'&&(rs>=68||rs<=32);
  const liquidityEvent=Boolean(candles.at(-1)?.high>Math.max(...recent(candles.slice(0,-1),20).map(x=>x.high))||candles.at(-1)?.low<Math.min(...recent(candles.slice(0,-1),20).map(x=>x.low)));
  const confidence=Math.min(0.99,Math.max(0.05,0.5+Math.min(0.4,Math.abs(slope(recent(close,40)))/(Math.abs(p)||1)*2000)+((vol==='NORMAL'?0.05:0))));
  const regime=breakout?'BREAKOUT':liquidityEvent?'LIQUIDITY_EVENT':reversal?'REVERSAL':environment;
  return {
    trend,volatility:vol,environment,regime,confidence,
    atr:a,atrPct:ap,rsi:rs,ema20:ema(close,20).at(-1),ema50:ema(close,50).at(-1),ema200:ema(close,200).at(-1),
    slope:slope(recent(close,40)),rangeZ:z,recentReturn:recentRet,absReturn:absRet,
    breakout,reversal,liquidityEvent
  };
}

export function regimeCompatibility(direction,regime){
  if(!regime||!['LONG','SHORT'].includes(direction)) return 0.5;
  if(direction==='LONG'&&regime.trend==='UPTREND') return 0.9;
  if(direction==='SHORT'&&regime.trend==='DOWNTREND') return 0.9;
  if(regime.environment==='MEAN_REVERSION') return 0.65;
  if(regime.environment==='COMPRESSION') return 0.5;
  if(regime.volatility==='EXPANDING') return 0.55;
  return 0.5;
}
