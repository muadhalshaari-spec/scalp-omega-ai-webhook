const JSON_HEADERS={Accept:'application/json','User-Agent':'SCALP-Omega-External-Intelligence/2.0'};
const CG_BASE='https://open-api-v4.coinglass.com/api';
const DERIBIT_BASE='https://www.deribit.com/api/v2/public';

async function get(url,signal,options={}){
  const r=await fetch(url,{headers:JSON_HEADERS,cache:'no-store',signal,...options});
  const t=await r.text(); let d=null; try{d=JSON.parse(t)}catch{}
  if(!r.ok) throw new Error('HTTP '+r.status);
  return d;
}
function num(v){const x=Number(v);return Number.isFinite(x)?x:null}
function ratio(a,b){return Number.isFinite(a)&&Number.isFinite(b)&&b!==0?a/b:null}
function bookMetrics(book){
  const bids=(book?.bids||[]).map(x=>[num(x[0]),num(x[1])]).filter(x=>x.every(Number.isFinite));
  const asks=(book?.asks||[]).map(x=>[num(x[0]),num(x[1])]).filter(x=>x.every(Number.isFinite));
  const bid=bids[0]?.[0]??null, ask=asks[0]?.[0]??null;
  const mid=bid!=null&&ask!=null?(bid+ask)/2:null;
  const bidSize=bids.reduce((s,x)=>s+x[1],0), askSize=asks.reduce((s,x)=>s+x[1],0);
  return {bestBid:bid,bestAsk:ask,mid,spread:bid!=null&&ask!=null?ask-bid:null,spreadBps:mid?((ask-bid)/mid)*10000:null,bidDepth:bidSize,askDepth:askSize,imbalance:ratio(bidSize-askSize,bidSize+askSize)};
}
async function deribit(method,params,signal){
  const q=new URLSearchParams(Object.entries(params).filter(([,v])=>v!=null).map(([k,v])=>[k,String(v)]));
  const d=await get(DERIBIT_BASE+'/'+method+'?'+q.toString(),signal);
  if(d?.error)throw new Error(d.error.message||'Deribit error');
  return d?.result;
}
async function coinglass(path,params,signal){
  const key=process.env.COINGLASS_API_KEY;if(!key)return null;
  const q=new URLSearchParams(Object.entries(params).filter(([,v])=>v!=null).map(([k,v])=>[k,String(v)]));
  const d=await get(CG_BASE+path+'?'+q.toString(),signal,{headers:{...JSON_HEADERS,'CG-API-KEY':key}});
  if(d?.code&&String(d.code)!=='0')throw new Error(d.msg||'CoinGlass error');
  return d?.data??d;
}
function summarizeDeribitOptions(rows){
  const options=(rows||[]).filter(x=>x?.instrument_name);
  const byExpiry=new Map(), strikes=[];
  let callOI=0,putOI=0,totalOI=0,weightedIv=0,ivWeight=0;
  for(const x of options){
    const parts=String(x.instrument_name).split('-'); const expiry=parts[1]||'UNKNOWN'; const strike=num(parts[2]); const side=parts[3];
    const oi=num(x.open_interest)||0, iv=num(x.mark_iv);
    totalOI+=oi; if(side==='C')callOI+=oi; if(side==='P')putOI+=oi;
    if(iv!=null){weightedIv+=iv*oi;ivWeight+=oi}
    if(strike!=null)strikes.push(strike);
    const e=byExpiry.get(expiry)||{expiry,callOI:0,putOI:0,totalOI:0,ivWeighted:0,ivWeight:0};
    if(side==='C')e.callOI+=oi;if(side==='P')e.putOI+=oi;e.totalOI+=oi;
    if(iv!=null){e.ivWeighted+=iv*oi;e.ivWeight+=oi} byExpiry.set(expiry,e);
  }
  const expiries=[...byExpiry.values()].map(e=>({...e,iv:e.ivWeight?e.ivWeighted/e.ivWeight:null,putCallOI:ratio(e.putOI,e.callOI)})).sort((a,b)=>b.totalOI-a.totalOI);
  return {instrumentCount:options.length,totalOI,callOI,putOI,putCallOI:ratio(putOI,callOI),weightedIV:ivWeight?weightedIv/ivWeight:null,topExpiries:expiries.slice(0,12)};
}

export async function fetchExternalIntelligence({symbol='ETHUSDT',signal}={}){
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),5000);
  const providers={
    binance:{available:false,source:'Binance',timestamp:null},
    bybit:{available:false,source:'Bybit',timestamp:null},
    deribit:{available:false,source:'Deribit',timestamp:null},
    coinglass:{available:false,source:'CoinGlass',timestamp:null}
  };
  try{
    const [binance,bybit,deribitSettled]=await Promise.allSettled([
      Promise.all([
        get('https://fapi.binance.com/fapi/v1/premiumIndex?symbol='+symbol,controller.signal),
        get('https://fapi.binance.com/fapi/v1/openInterest?symbol='+symbol,controller.signal),
        get('https://fapi.binance.com/fapi/v1/depth?symbol='+symbol+'&limit=20',controller.signal),
        get('https://fapi.binance.com/futures/data/takerlongshortRatio?symbol='+symbol+'&period=15m&limit=1',controller.signal).catch(()=>null)
      ]),
      Promise.all([
        get('https://api.bybit.com/v5/market/tickers?category=linear&symbol='+symbol,controller.signal),
        get('https://api.bybit.com/v5/market/open-interest?category=linear&symbol='+symbol+'&intervalTime=15min&limit=2',controller.signal),
        get('https://api.bybit.com/v5/market/funding/history?category=linear&symbol='+symbol+'&limit=2',controller.signal),
        get('https://api.bybit.com/v5/market/orderbook?category=linear&symbol='+symbol+'&limit=25',controller.signal)
      ]),
      Promise.all([
        deribit('ticker',{instrument_name:'ETH-PERPETUAL'},controller.signal),
        deribit('get_book_summary_by_currency',{currency:'ETH',kind:'option'},controller.signal)
      ])
    ]);
    if(binance.status==='fulfilled'){
      const [p,oi,book,ls]=binance.value; const bm=bookMetrics(book);
      providers.binance={available:true,source:'Binance',timestamp:num(p?.time),price:num(p?.markPrice),indexPrice:num(p?.indexPrice),fundingRate:num(p?.lastFundingRate),nextFundingTime:num(p?.nextFundingTime),openInterest:num(oi?.openInterest),book:bm,takerLongShort:ls?.[0]||null};
    }
    if(bybit.status==='fulfilled'){
      const [t,oi,fr,book]=bybit.value; const x=t?.result?.list?.[0]; const bm=bookMetrics({bids:book?.result?.b||[],asks:book?.result?.a||[]});
      providers.bybit={available:Boolean(x),source:'Bybit',timestamp:num(book?.result?.ts),price:num(x?.lastPrice),markPrice:num(x?.markPrice),indexPrice:num(x?.indexPrice),fundingRate:num(x?.fundingRate),nextFundingTime:num(x?.nextFundingTime),openInterest:num(x?.openInterest),openInterestHistory:(oi?.result?.list||[]).map(v=>({time:num(v.timestamp),openInterest:num(v.openInterest)})),fundingHistory:(fr?.result?.list||[]).map(v=>({time:num(v.fundingRateTimestamp),fundingRate:num(v.fundingRate)})),book:bm};
    }
    if(deribitSettled.status==='fulfilled'){
      const [t,options]=deribitSettled.value;
      const optionRows=Array.isArray(options)?options:[];
      const optionSummary=summarizeDeribitOptions(optionRows);
      const lastPrice=num(t?.lastPrice??t?.last_price);
      const markPrice=num(t?.markPrice??t?.mark_price);
      const indexPrice=num(t?.indexPrice??t?.index_price);
      const openInterest=num(t?.openInterest??t?.open_interest);
      const currentFunding=num(t?.currentFunding??t?.current_funding);
      const funding8h=num(t?.funding8h??t?.funding_8h);
      const iv=num(t?.markIv??t?.mark_iv);
      const compactOptions=optionRows
        .filter(x=>x?.instrument_name)
        .map(x=>({instrument:x.instrument_name,openInterest:num(x.open_interest),markIv:num(x.mark_iv)}))
        .sort((a,b)=>(b.openInterest??0)-(a.openInterest??0))
        .slice(0,120);
      providers.deribit={available:Boolean(t),source:'Deribit',timestamp:num(t?.timestamp),price:lastPrice,markPrice,indexPrice,openInterest,currentFunding,funding8h,iv,options:{...optionSummary,rows:compactOptions}};
    }
    if(process.env.COINGLASS_API_KEY){
      const results=await Promise.allSettled([
        coinglass('/futures/open-interest/exchange-list',{symbol:'ETH'},controller.signal),
        coinglass('/futures/funding-rate/oi-weight-history',{symbol:'ETH',interval:'15m',limit:20},controller.signal),
        coinglass('/futures/funding-rate/exchange-list',{symbol:'ETH'},controller.signal),
        coinglass('/futures/global-long-short-account-ratio/history',{symbol:'ETH',interval:'15m',limit:20},controller.signal),
        coinglass('/futures/taker-buy-sell-volume/exchange-list',{symbol:'ETH'},controller.signal),
        coinglass('/futures/liquidation/exchange-list',{symbol:'ETH'},controller.signal)
      ]);
      const val=i=>results[i].status==='fulfilled'?results[i].value:null;
      providers.coinglass={available:results.some(x=>x.status==='fulfilled'),source:'CoinGlass',timestamp:Date.now(),openInterestByExchange:val(0),oiWeightedFundingHistory:val(1),fundingByExchange:val(2),globalLongShortHistory:val(3),takerBuySell:val(4),liquidationsByExchange:val(5)};
    }
    const prices=[providers.binance.price,providers.bybit.price,providers.deribit.price].filter(Number.isFinite);
    const sorted=prices.slice().sort((a,b)=>a-b); const median=sorted.length?sorted[Math.floor(sorted.length/2)]:null;
    const divergence=prices.length>=2&&median?Math.max(...prices.map(p=>Math.abs(p-median)/median*100)):null;
    const funding=[providers.binance.fundingRate,providers.bybit.fundingRate,providers.deribit.currentFunding].filter(Number.isFinite);
    const fundingMean=funding.length?funding.reduce((a,b)=>a+b,0)/funding.length:null;
    const fundingDispersion=funding.length>=2?Math.max(...funding)-Math.min(...funding):null;
    const oi=[providers.binance.openInterest,providers.bybit.openInterest,providers.deribit.openInterest].filter(Number.isFinite);
    return {
      ok:true,version:'2.0',fetchedAt:new Date().toISOString(),asOf:Date.now(),providers,
      crossExchange:{
        priceMedian:median,priceDivergencePct:divergence,
        agreement:divergence==null?'UNKNOWN':divergence<=0.08?'STRONG':divergence<=0.2?'NORMAL':'DIVERGENT',
        fundingMean,fundingDispersion,
        openInterestSources:oi.length,priceSources:prices.length,fundingSources:funding.length
      },
      featureSignals:{
        priceAgreement:divergence!=null?Math.max(0,1-Math.min(divergence/0.5,1)):null,
        fundingCrowding:fundingMean==null?null:Math.min(Math.abs(fundingMean)/0.001,1),
        fundingDirection:fundingMean==null?null:Math.sign(fundingMean),
        oiAgreement:oi.length>=2?'AVAILABLE':'PARTIAL'
      },
      dataQuality:{
        live:true,providersAvailable:Object.values(providers).filter(p=>p.available).length,
        historicalExternalData:process.env.COINGLASS_API_KEY?'PARTIAL':'NOT_CONFIGURED',
        note:'External REST snapshots are live verification inputs; they are not a substitute for persisted historical streams in backtests.'
      }
    };
  }catch(error){
    return {
      ok:false,
      version:'2.0',
      fetchedAt:new Date().toISOString(),
      asOf:Date.now(),
      providers,
      crossExchange:{
        priceMedian:null,priceDivergencePct:null,agreement:'UNKNOWN',
        fundingMean:null,fundingDispersion:null,
        openInterestSources:Object.values(providers).filter(p=>Number.isFinite(p?.openInterest)).length,
        priceSources:Object.values(providers).filter(p=>Number.isFinite(p?.price)).length,
        fundingSources:Object.values(providers).filter(p=>Number.isFinite(p?.fundingRate)).length
      },
      featureSignals:{priceAgreement:null,fundingCrowding:null,fundingDirection:null,oiAgreement:'PARTIAL'},
      dataQuality:{live:true,providersAvailable:Object.values(providers).filter(p=>p.available).length,historicalExternalData:process.env.COINGLASS_API_KEY?'PARTIAL':'NOT_CONFIGURED',partialError:String(error?.message||error||'external intelligence error')}
    };
  }finally{clearTimeout(timer)}
}
