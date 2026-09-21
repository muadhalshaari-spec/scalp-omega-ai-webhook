// SCALP-Ω Institutional Research & Execution Layer
// Purpose: deepen market evidence without becoming the conversational decision-maker.
// No LONG/SHORT/NO_TRADE decision is emitted here.

function n(v){ const x=Number(v); return Number.isFinite(x)?x:null; }
function clamp(v,a=0,b=1){ return Math.max(a,Math.min(b,v)); }
function mean(xs){ return xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : null; }
function median(xs){
  if(!xs.length)return null;
  const a=[...xs].sort((x,y)=>x-y), m=Math.floor(a.length/2);
  return a.length%2?a[m]:(a[m-1]+a[m])/2;
}
function stdev(xs){
  if(xs.length<2)return null;
  const m=mean(xs);
  return Math.sqrt(mean(xs.map(x=>(x-m)**2)));
}
function emaSeries(values,period){
  if(values.length<period)return Array(values.length).fill(null);
  const k=2/(period+1);
  let e=mean(values.slice(0,period));
  const out=Array(period-1).fill(null);
  out.push(e);
  for(let i=period;i<values.length;i++){ e=values[i]*k+e*(1-k); out.push(e); }
  return out;
}
function returns(candles){
  const c=(candles||[]).filter(x=>x?.confirmed!==false).map(x=>n(x.close)).filter(Number.isFinite);
  const r=[];
  for(let i=1;i<c.length;i++) if(c[i-1]!==0) r.push(c[i]/c[i-1]-1);
  return r;
}
function autocorr(xs,lag=1){
  if(xs.length<=lag+2)return null;
  const m=mean(xs), a=xs.slice(lag).map(x=>x-m), b=xs.slice(0,-lag).map(x=>x-m);
  const den=Math.sqrt(a.reduce((s,x)=>s+x*x,0)*b.reduce((s,x)=>s+x*x,0));
  return den? a.reduce((s,x,i)=>s+x*b[i],0)/den:null;
}
function drawdown(equity){
  let peak=-Infinity, max=0;
  for(const x of equity){
    peak=Math.max(peak,x);
    if(peak>0) max=Math.max(max,(peak-x)/peak);
  }
  return max;
}

function depthSlice(book, levels=20){
  const bids=(book?.bids||[]).slice(0,levels).map(x=>({price:n(x.price??x[0]),size:n(x.size??x[1])??0,orders:n(x.orders??x[3])??0})).filter(x=>Number.isFinite(x.price));
  const asks=(book?.asks||[]).slice(0,levels).map(x=>({price:n(x.price??x[0]),size:n(x.size??x[1])??0,orders:n(x.orders??x[3])??0})).filter(x=>Number.isFinite(x.price));
  return {bids,asks};
}
function bookMetrics(book){
  const out={};
  for(const levels of [1,5,10,20,50,100,200,400]){
    const {bids,asks}=depthSlice(book,levels);
    if(!bids.length&&!asks.length)continue;
    const bidSize=bids.reduce((s,x)=>s+x.size,0), askSize=asks.reduce((s,x)=>s+x.size,0);
    const total=bidSize+askSize;
    const bidNotional=bids.reduce((s,x)=>s+x.price*x.size,0);
    const askNotional=asks.reduce((s,x)=>s+x.price*x.size,0);
    const bidOrders=bids.reduce((s,x)=>s+x.orders,0), askOrders=asks.reduce((s,x)=>s+x.orders,0);
    const bestBid=bids[0]?.price??null, bestAsk=asks[0]?.price??null;
    const mid=bestBid!=null&&bestAsk!=null?(bestBid+bestAsk)/2:null;
    const micro=mid!=null&&bidSize+askSize?((bestAsk*bidSize)+(bestBid*askSize))/(bidSize+askSize):null;
    out[String(levels)]={
      bidSize,askSize,bidNotional,askNotional,bidOrders,askOrders,
      imbalance:total?(bidSize-askSize)/total:null,
      notionalImbalance:(bidNotional+askNotional)?(bidNotional-askNotional)/(bidNotional+askNotional):null,
      bestBid,bestAsk,mid,spread:bestBid!=null&&bestAsk!=null?bestAsk-bestBid:null,
      spreadBps:mid?((bestAsk-bestBid)/mid)*10000:null,
      microPrice:micro,
      microPriceEdgeBps:micro&&mid?((micro-mid)/mid)*10000:null,
      topLevelConcentration:total?((bids[0]?.size||0)+(asks[0]?.size||0))/total:null
    };
  }
  return out;
}
function depthSlope(book){
  const {bids,asks}=depthSlice(book,100);
  const fit=(rows,side)=>{
    if(rows.length<3)return null;
    const best=rows[0].price;
    const pts=rows.map((x,i)=>({
      d:Math.abs(x.price-best)/best,
      q:x.size
    })).filter(x=>x.d>0);
    if(pts.length<2)return null;
    const mx=mean(pts.map(x=>x.d)), my=mean(pts.map(x=>x.q));
    const den=pts.reduce((s,x)=>s+(x.d-mx)**2,0);
    return den?pts.reduce((s,x)=>s+(x.d-mx)*(x.q-my),0)/den:null;
  };
  return {bidSlope:fit(bids,'bid'),askSlope:fit(asks,'ask')};
}
function walkBook(book,side,notional){
  const {bids,asks}=depthSlice(book,400);
  const rows=side==='BUY'?asks:bids;
  let remaining=notional, filled=0, baseQty=0;
  for(const r of rows){
    if(remaining<=0)break;
    const px=r.price, qty=r.size;
    const levelNotional=px*qty;
    const take=levelNotional>=remaining?remaining/px:qty;
    baseQty+=take; filled+=take*px; remaining-=take*px;
  }
  if(baseQty<=0)return {notional,filled:0,qty:0,complete:false,avgPrice:null,slippageBps:null,levelsUsed:0};
  const avg=filled/baseQty;
  const best=rows[0]?.price??null;
  return {notional,filled,qty:baseQty,complete:remaining<=1e-9,avgPrice:avg,slippageBps:best?Math.abs(avg-best)/best*10000:null,levelsUsed:rows.findIndex(r=>r.price===rows[Math.min(rows.length-1,0)]?.price)+1};
}
function executionProfile(book){
  const sizes=[1000,5000,10000,25000,50000,100000];
  const market=bookMetrics(book)['20']||{};
  const buy=sizes.map(x=>walkBook(book,'BUY',x));
  const sell=sizes.map(x=>walkBook(book,'SELL',x));
  const staleMs=n(book?.time)!=null?Math.max(0,Date.now()-n(book.time)):null;
  return {
    reference:{bestBid:market.bestBid??null,bestAsk:market.bestAsk??null,mid:market.mid??null,spreadBps:market.spreadBps??null,staleMs},
    marketBuyImpact:buy,marketSellImpact:sell,
    quality:staleMs==null?'UNKNOWN':staleMs<=1000?'FRESH':staleMs<=5000?'AGING':'STALE'
  };
}
function flowMetrics(trades){
  const xs=(trades||[]).map(t=>({
    price:n(t?.px??t?.price),
    size:n(t?.sz??t?.size)??0,
    side:String(t?.side||'').toLowerCase(),
    ts:n(t?.ts??t?.timestamp)
  })).filter(x=>Number.isFinite(x.price));
  const buy=xs.filter(x=>x.side==='buy'), sell=xs.filter(x=>x.side==='sell');
  const buySize=buy.reduce((s,x)=>s+x.size,0), sellSize=sell.reduce((s,x)=>s+x.size,0);
  const total=buySize+sellSize;
  const signed=buySize-sellSize;
  const notionals=xs.map(x=>x.price*x.size);
  const q=notionals.length?notionals.slice().sort((a,b)=>b-a):[];
  const p90=q.length?q[Math.floor((q.length-1)*0.1)]:null;
  const large=xs.filter(x=>x.price*x.size>=p90&&p90!=null);
  const firstTs=xs.map(x=>x.ts).filter(Number.isFinite).sort((a,b)=>a-b)[0]??null;
  const lastTs=xs.map(x=>x.ts).filter(Number.isFinite).sort((a,b)=>b-a)[0]??null;
  const durationSec=firstTs!=null&&lastTs!=null?Math.max(0,(lastTs-firstTs)/1000):null;
  const vwap=xs.reduce((s,x)=>s+x.price*x.size,0)/(xs.reduce((s,x)=>s+x.size,0)||1);
  return {
    tradeCount:xs.length,buyCount:buy.length,sellCount:sell.length,buySize,sellSize,
    deltaSize:signed,deltaPct:total?signed/total:null,
    buySellRatio:sellSize?buySize/sellSize:null,
    notional:mean(notionals),medianTradeNotional:median(notionals),
    vwap,largeTradeCount:large.length,
    largeTradeNotionalShare:notionals.reduce((s,x)=>s+x,0)?large.reduce((s,x)=>s+x.price*x.size,0)/notionals.reduce((s,x)=>s+x,0):null,
    durationSec,tradeRatePerSec:durationSec?xs.length/durationSec:null,
    cvdProxy:signed,
    note:'Flow is a recent-trades snapshot; true historical CVD requires a persisted tick stream.'
  };
}
function statisticalDiagnostics(candles){
  const cs=(candles||[]).filter(x=>x?.confirmed!==false && [x?.open,x?.high,x?.low,x?.close].every(v=>Number.isFinite(Number(v))));
  const closes=cs.map(x=>Number(x.close));
  const r=returns(cs);
  const last=closes.at(-1), prev=closes.at(-2);
  const e20=emaSeries(closes,20), e50=emaSeries(closes,50);
  const vol=stdev(r);
  const skew=(()=>{
    if(r.length<3||vol==null||vol===0)return null;
    const m=mean(r); return mean(r.map(x=>((x-m)/vol)**3));
  })();
  const positive=r.filter(x=>x>0).length, negative=r.filter(x=>x<0).length;
  const range=cs.length?Math.max(...cs.map(x=>Number(x.high)))-Math.min(...cs.map(x=>Number(x.low))):null;
  const position=range&&last!=null? (last-Math.min(...cs.map(x=>Number(x.low))))/range:null;
  return {
    sample:cs.length,returnCount:r.length,last,oneBarReturn:prev?last/prev-1:null,
    meanReturn:mean(r),medianReturn:median(r),returnStdev:vol,returnSkew:skew,
    annualizedVolProxy:vol!=null?vol*Math.sqrt(96*365):null,
    positiveFraction:r.length?positive/r.length:null,negativeFraction:r.length?negative/r.length:null,
    autocorr1:autocorr(r,1),autocorr4:autocorr(r,4),
    ema20:e20.at(-1)??null,ema50:e50.at(-1)??null,
    trendSpread:e20.at(-1)!=null&&e50.at(-1)!=null?e20.at(-1)-e50.at(-1):null,
    rangePosition:position,
    rangeAbs:range
  };
}
function forwardStudy(candles, lookback=3, horizons=[1,4,8,16]){
  const cs=(candles||[]).filter(x=>x?.confirmed!==false && Number.isFinite(Number(x.close))).map(x=>Number(x.close));
  const studies={};
  for(const h of horizons){
    const samples=[];
    for(let i=lookback;i<cs.length-h;i++){
      const sig=Math.sign(cs[i]/cs[i-lookback]-1);
      if(sig===0)continue;
      const fwd=cs[i+h]/cs[i]-1;
      samples.push({sig,fwd});
    }
    const aligned=samples.filter(x=>Math.sign(x.fwd)===x.sig);
    studies[String(h)]={
      observations:samples.length,
      alignedWinRate:samples.length?aligned.length/samples.length:null,
      meanForwardReturn:mean(samples.map(x=>x.fwd)),
      medianForwardReturn:median(samples.map(x=>x.fwd)),
      longConditionMean:mean(samples.filter(x=>x.sig>0).map(x=>x.fwd)),
      shortConditionMean:mean(samples.filter(x=>x.sig<0).map(x=>-x.fwd)),
      note:'Event-study only; not the live ChatGPT decision.'
    };
  }
  return studies;
}
function baselineBacktest(candles,costBps=0){
  const cs=(candles||[]).filter(x=>x?.confirmed!==false).map(x=>Number(x.close)).filter(Number.isFinite);
  if(cs.length<80)return {status:'INSUFFICIENT_DATA',observations:cs.length};
  const e20=emaSeries(cs,20), e50=emaSeries(cs,50);
  let equity=1, peak=1, trades=0, wins=0, sum=0;
  const eq=[1], tradeReturns=[];
  for(let i=50;i<cs.length-1;i++){
    let s=0;
    if(e20[i]!=null&&e50[i]!=null)s=e20[i]>e50[i]?1:e20[i]<e50[i]?-1:0;
    if(!s)continue;
    const gross=s*(cs[i+1]/cs[i]-1);
    const net=gross-costBps/10000;
    equity*=1+net; eq.push(equity);
    trades++; if(net>0)wins++; sum+=net; tradeReturns.push(net);
  }
  const sd=stdev(tradeReturns);
  return {
    status:'RESEARCH_BASELINE',observations:cs.length,trades,winRate:trades?wins/trades:null,
    cumulativeReturn:equity-1,avgTradeReturn:trades?sum/trades:null,
    maxDrawdown:drawdown(eq),profitFactor:sum>0?sum/(Math.abs(tradeReturns.filter(x=>x<0).reduce((a,b)=>a+b,0))||1):null,
    sharpeLike:sd?mean(tradeReturns)/sd*Math.sqrt(trades):null,
    costBps,
    costModelConfigured:costBps>0,
    model:'EMA20/EMA50 direction baseline; research diagnostic only; no current trade decision.'
  };
}
function walkForward(candles,costBps=0){
  const cs=(candles||[]).filter(x=>x?.confirmed!==false);
  if(cs.length<240)return {status:'INSUFFICIENT_DATA',observations:cs.length};
  const windows=[];
  const n=cs.length, width=Math.floor(n/5);
  for(let k=0;k<5;k++){
    const start=Math.max(0,k*width-50), end=Math.min(n,(k+1)*width+50);
    const slice=cs.slice(start,end);
    const train=slice.slice(0,Math.max(80,Math.floor(slice.length*0.6)));
    const test=slice.slice(Math.floor(slice.length*0.6));
    windows.push({window:k+1,trainBars:train.length,testBars:test.length,train:baselineBacktest(train,costBps),test:baselineBacktest(test,costBps)});
  }
  return {status:'ROLLING_WINDOWS',windows,model:'Fixed baseline; no parameter optimization or look-ahead.'};
}
function mtfAlignment(features){
  const bars=['1m','5m','15m','1H','4H','1D'];
  const rows=bars.map(tf=>{
    const f=features?.[tf]; const m=f?.momentum||{};
    const ind=f?.indicators||{};
    const votes=[
      m.aboveEma20===true?1:m.aboveEma20===false?-1:0,
      m.aboveEma50===true?1:m.aboveEma50===false?-1:0,
      m.aboveEma200===true?1:m.aboveEma200===false?-1:0,
      Number(ind.macdHistogram)>0?1:Number(ind.macdHistogram)<0?-1:0,
      Number(ind.rsi14)>=50?1:Number(ind.rsi14)<50?-1:0
    ];
    return {timeframe:tf,voteSum:votes.reduce((a,b)=>a+b,0),voteCount:votes.length,normalized:votes.reduce((a,b)=>a+b,0)/votes.length};
  });
  const score=mean(rows.map(x=>x.normalized));
  return {timeframes:rows,aggregateScore:score,bullishFrames:rows.filter(x=>x.normalized>0.2).map(x=>x.timeframe),bearishFrames:rows.filter(x=>x.normalized<-0.2).map(x=>x.timeframe),agreement:Math.abs(score??0)>=0.6?'HIGH':Math.abs(score??0)>=0.3?'MEDIUM':'MIXED'};
}

export function buildInstitutionalLayer({
  candlesByTf={},
  features={},
  contexts={},
  orderBook=null,
  trades=[],
  externalIntelligence=null,
  derivatives={},
  coverage={}
}={}){
  const primary=candlesByTf['15m']||[];
  const microBook=bookMetrics(orderBook);
  const flow=flowMetrics(trades);
  const stats15=statisticalDiagnostics(primary);
  const study=forwardStudy(primary);
  const backtest=baselineBacktest(primary,Number(process.env.BACKTEST_COST_BPS)||0);
  const walk=walkForward(primary,Number(process.env.BACKTEST_COST_BPS)||0);
  const mtf=mtfAlignment(features);
  const currentOI=derivatives?.current?.openInterest?.oi??null;
  const oiHist=(derivatives?.history?.oi||[]).map(x=>n(x?.oi)).filter(Number.isFinite);
  const fundingHist=(derivatives?.history?.funding||[]).map(x=>n(x?.fundingRate)).filter(Number.isFinite);
  const oiDelta=oiHist.length>=2?oiHist.at(-1)-oiHist.at(-2):null;
  const fundMean=mean(fundingHist), fundSd=stdev(fundingHist);
  const fundCurrent=derivatives?.current?.fundingRate??null;
  return {
    version:'1.0',
    authority:'CHATGPT_CONVERSATIONAL_ONLY',
    evidenceMode:'INSTITUTIONAL_RESEARCH_EXECUTION',
    mtf,
    microstructure:{
      orderBook:microBook,
      depthSlope:depthSlope(orderBook),
      tradeFlow:flow,
      execution:executionProfile(orderBook)
    },
    derivatives:{
      currentOpenInterest:currentOI,
      oiChangeLastSample:oiDelta,
      fundingCurrent:fundCurrent,
      fundingMean:fundMean,
      fundingStd:fundSd,
      fundingZ:fundCurrent!=null&&fundSd?((fundCurrent-fundMean)/fundSd):null,
      longShortHistoryCount:(derivatives?.history?.longShort||[]).length,
      takerVolumeHistoryCount:(derivatives?.history?.takerVolume||[]).length
    },
    crossExchange:{
      sources:Object.entries(externalIntelligence?.providers||{}).filter(([,v])=>v?.available||Number.isFinite(v?.price)).map(([k])=>k),
      summary:externalIntelligence?.crossExchange||null,
      dataQuality:externalIntelligence?.dataQuality||null
    },
    quantitativeModels:{
      modelInputs:['trend','momentum','volatility','autocorrelation','range-position','trade-flow','book-imbalance','derivatives'],
      statistics15m:stats15,
      forwardReturnStudy15m:study,
      baselineBacktest15m:backtest,
      walkForward15m:walk
    },
    structure:{
      perTimeframe:Object.fromEntries(Object.entries(contexts||{}).map(([tf,c])=>[tf,c?.structure||null])),
      liquidity:Object.fromEntries(Object.entries(contexts||{}).map(([tf,c])=>[tf,c?.liquidity||null])),
      rangeLocation:Object.fromEntries(Object.entries(contexts||{}).map(([tf,c])=>[tf,c?.location||null]))
    },
    historicalCoverage:coverage,
    validation:{
      liveStatisticalValidation:'AVAILABLE_ON_CURRENT_1000_BAR_WINDOWS',
      outOfSampleValidation:'FIXED_BASELINE_ROLLING_WINDOWS',
      lookAheadPolicy:'CLOSED_CANDLES_ONLY',
      executionCostModel:process.env.BACKTEST_COST_BPS?'CONFIGURED':'NOT_CONFIGURED',
      microstructureHistory:'REQUIRES_PERSISTED_TICK/BOOK_STREAM',
      modelSelection:'NO_OPTIMIZATION_IN_LIVE_DECISION_PATH'
    },
    decision:{
      finalDecision:null,
      reason:'ChatGPT is the sole conversational decision authority. This layer never emits a trade direction.'
    }
  };
}
