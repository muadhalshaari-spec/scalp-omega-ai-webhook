import { getBinanceFullMarketData } from './binance.js';
import { getBybitFullMarketData } from './bybit.js';
import { getLatestMarketSnapshot } from './supabase.js';
import { fetchOnchainIntelligence } from './onchain-intelligence.js';
import { fetchNewsIntelligence } from './news-intelligence.js';

const JSON_HEADERS={Accept:'application/json','User-Agent':'SCALP-Omega-External-Intelligence/2.0'};
const CG_BASE='https://open-api-v4.coinglass.com/api';
const DERIBIT_BASE=(process.env.DERIBIT_BASE_URL || ((process.env.DERIBIT_ENV || 'testnet').toLowerCase()==='production' ? 'https://www.deribit.com/api/v2' : 'https://test.deribit.com/api/v2'))+'/public';

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
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),16000);
  const providers={
    binance:{available:false,source:'Binance',timestamp:null},
    bybit:{available:false,source:'Bybit',timestamp:null},
    deribit:{available:false,source:'Deribit',timestamp:null},
    coinglass:{available:false,source:'CoinGlass',timestamp:null},
    coingecko:{available:false,source:'CoinGecko',timestamp:null},
    alchemy:{available:false,source:'Alchemy',timestamp:null},
    etherscan:{available:false,source:'Etherscan',timestamp:null},
    glassnode:{available:false,source:'Glassnode',timestamp:null}
  };
  try{
    const [binance,bybit,deribitSettled,relay,onchainSettled,newsSettled]=await Promise.allSettled([
      getBinanceFullMarketData({ signal: controller.signal }),
      getBybitFullMarketData({ signal: controller.signal }),
      Promise.all([
        deribit('ticker',{instrument_name:'ETH-PERPETUAL'},controller.signal),
        deribit('get_book_summary_by_currency',{currency:'ETH',kind:'option'},controller.signal)
      ]),
      getLatestMarketSnapshot({source:'SCALP-OMEGA-MARKET-SYNC',instrument:'ETH-USDT-SWAP'}),
      fetchOnchainIntelligence({ signal: controller.signal }),
      fetchNewsIntelligence({ signal: controller.signal })
    ]);
    if(binance.status==='fulfilled'){
      const b=binance.value;
      const s=b?.summary||{};
      providers.binance={
        available:b?.available===true,
        source:'Binance',
        timestamp:b?.fetchedAt ? Date.parse(b.fetchedAt) : Date.now(),
        price:num(s.futuresPrice),
        markPrice:num(s.futuresMarkPrice),
        indexPrice:num(s.futuresIndexPrice),
        fundingRate:num(s.futuresFundingRate),
        nextFundingTime:num(s.futuresNextFundingTime),
        openInterest:num(s.futuresOpenInterest),
        book:s.futuresBook||null,
        spotPrice:num(s.spotPrice),
        futuresSpotBasisPct:num(s.futuresSpotBasisPct),
        adlRisk:s.adlRisk||null,
        coverage:b.coverage||null,
        futures:b.futures||null,
        spot:b.spot||null,
        apiKeyData:b.apiKeyData||null,
        quality:b.quality||null
      };
    }
    if(bybit.status==='fulfilled'){
      const b=bybit.value;
      providers.bybit={
        available:b?.available===true,
        source:'Bybit',
        timestamp:b?.fetchedAt?Date.parse(b.fetchedAt):Date.now(),
        environment:b?.environment||'production',
        price:num(b?.summary?.linearPrice),
        markPrice:num(b?.summary?.markPrice),
        indexPrice:num(b?.summary?.indexPrice),
        fundingRate:num(b?.summary?.fundingRate),
        nextFundingTime:num(b?.summary?.nextFundingTime),
        openInterest:num(b?.summary?.openInterest),
        spotPrice:num(b?.summary?.spotPrice),
        basis:num(b?.summary?.basis),
        basisRate:num(b?.summary?.basisRate),
        book:b?.summary?.book||null,
        coverage:b?.coverage||null,
        futures:b?.futures||null,
        spot:b?.spot||null,
        quality:b?.quality||null
      };
    }
    const relayRow=relay?.status==='fulfilled'?relay.value?.row:null;
    const relaySummary=relayRow?.payload?.summary||{};
    const relayBinance=relayRow?.payload?.binance||{};
    const relayBybit=relayRow?.payload?.bybit||{};
    const relayTs=relayRow?.event_ts?Date.parse(relayRow.event_ts):null;
    if(binance.status==='fulfilled' && !binance.value?.quality?.allRequestedPublicDataSucceeded && Number.isFinite(num(relaySummary.binanceMarkPrice))){
      providers.binance={available:true,source:'Binance',route:'SUPABASE_MARKET_SYNC_RELAY',directAvailable:false,timestamp:relayTs||Date.now(),price:num(relaySummary.binanceMarkPrice),markPrice:num(relaySummary.binanceMarkPrice),indexPrice:null,fundingRate:num(relaySummary.binanceFundingRate),nextFundingTime:null,openInterest:num(relayBinance?.openInterest?.data?.[0]?.openInterest),book:null,spotPrice:null,futuresSpotBasisPct:null,adlRisk:null,coverage:{relay:true},futures:{premiumIndex:relayBinance?.premiumIndex||null,openInterest:relayBinance?.openInterest||null},spot:{},apiKeyData:null,quality:{live:true,relay:true,directPublicAvailable:false}};
    }
    if(bybit.status==='fulfilled' && !bybit.value?.available && Number.isFinite(num(relaySummary.bybitPrice))){
      providers.bybit={available:true,source:'Bybit',route:'SUPABASE_MARKET_SYNC_RELAY',directAvailable:false,timestamp:relayTs||Date.now(),environment:'production',price:num(relaySummary.bybitPrice),markPrice:null,indexPrice:null,fundingRate:num(relaySummary.bybitFundingRate),nextFundingTime:null,openInterest:num(relayBybit?.openInterest?.result?.list?.[0]?.openInterest),spotPrice:null,basis:null,basisRate:null,book:null,coverage:{relay:true},futures:{ticker:relayBybit?.ticker||null,openInterest:relayBybit?.openInterest||null},spot:{},quality:{live:true,relay:true,directPublicAvailable:false}};
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
    if (onchainSettled?.status === 'fulfilled') {
      const onchain = onchainSettled.value || {};
      for (const name of ['coingecko', 'alchemy', 'etherscan']) {
        const provider = onchain.providers?.[name];
        if (provider) providers[name] = { ...provider, timestamp: provider.fetchedAt ? Date.parse(provider.fetchedAt) : Date.now() };
      }
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
      onchain: onchainSettled?.status === 'fulfilled' ? onchainSettled.value : { availableCount: 0, configuredCount: 0 },
      news: newsSettled?.status === 'fulfilled' ? newsSettled.value : { itemCount: 0, items: [], sources: {}, dataQuality: { newsIsContextOnly: true } },
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
