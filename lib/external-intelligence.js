const JSON_HEADERS={Accept:'application/json','User-Agent':'SCALP-Omega-External-Intelligence/1.0'};

async function get(url,signal){
  const r=await fetch(url,{headers:JSON_HEADERS,cache:'no-store',signal});
  const t=await r.text(); let d=null; try{d=JSON.parse(t)}catch{}
  if(!r.ok) throw new Error('HTTP '+r.status);
  return d;
}
function num(v){const x=Number(v);return Number.isFinite(x)?x:null}

export async function fetchExternalIntelligence({symbol='ETHUSDT',signal}={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),2500);
  const providers={
    binance: {available:false,source:'Binance'},
    bybit: {available:false,source:'Bybit'},
    deribit: {available:false,source:'Deribit'},
    coinglass: {available:false,source:'CoinGlass'}
  };
  try{
    const [binance,bybit,deribit]=await Promise.allSettled([
      get('https://fapi.binance.com/fapi/v1/premiumIndex?symbol='+symbol,controller.signal),
      get('https://api.bybit.com/v5/market/tickers?category=linear&symbol='+symbol,controller.signal),
      get('https://www.deribit.com/api/v2/public/ticker?instrument_name=ETH-PERPETUAL',controller.signal)
    ]);
    if(binance.status==='fulfilled'){
      const x=binance.value;
      providers.binance={available:true,source:'Binance',price:num(x?.markPrice),fundingRate:num(x?.lastFundingRate),nextFundingTime:num(x?.nextFundingTime),eventTime:num(x?.time)};
    }
    if(bybit.status==='fulfilled'){
      const x=bybit.value?.result?.list?.[0];
      providers.bybit={available:Boolean(x),source:'Bybit',price:num(x?.markPrice),indexPrice:num(x?.indexPrice),fundingRate:num(x?.fundingRate),openInterest:num(x?.openInterest)};
    }
    if(deribit.status==='fulfilled'){
      const x=deribit.value?.result;
      providers.deribit={available:Boolean(x),source:'Deribit',price:num(x?.lastPrice),markPrice:num(x?.markPrice),indexPrice:num(x?.indexPrice),openInterest:num(x?.openInterest),iv:num(x?.markIv)};
    }
    const key=process.env.COINGLASS_API_KEY;
    if(key){
      try{
        const x=await get('https://open-api-v4.coinglass.com/api/futures/funding-rate/exchange-list?symbol=ETH',controller.signal);
        providers.coinglass={available:true,source:'CoinGlass',funding:x?.data??x};
      }catch{}
    }
    const prices=[providers.binance.price,providers.bybit.price,providers.deribit.price].filter(Number.isFinite);
    const median=prices.length?prices.slice().sort((a,b)=>a-b)[Math.floor(prices.length/2)]:null;
    const divergence=prices.length>=2&&median?Math.max(...prices.map(p=>Math.abs(p-median)/median*100)):null;
    return {
      ok:true,
      fetchedAt:new Date().toISOString(),
      providers,
      crossExchange:{
        priceMedian:median,
        priceDivergencePct:divergence,
        agreement:divergence==null?'UNKNOWN':divergence<=0.08?'STRONG':divergence<=0.2?'NORMAL':'DIVERGENT'
      }
    };
  }finally{clearTimeout(timer)}
}
