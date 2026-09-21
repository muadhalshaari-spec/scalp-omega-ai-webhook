import { getLiveMemory } from '../lib/market-memory.js';
import { getMarketCandleCoverageMatrix, getMicrostructureHistory } from '../lib/supabase.js';

export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const host=typeof req.headers.host==='string'?req.headers.host:'scalp-omega-ai-webhook.vercel.app';
  try{
    const r=await fetch('https://'+host+'/api/confluence?dataOnly=1&ts='+Date.now(),{cache:'no-store',headers:{Accept:'application/json'}});
    const [memory, microHistory, coverageMatrix] = await Promise.all([
      getLiveMemory().catch(()=>({configured:false,value:null})),
      getMicrostructureHistory({ source:'OKX', instrument:'ETH-USDT-SWAP', limit:1000 }).catch(()=>({configured:false,rows:[]})),
      getMarketCandleCoverageMatrix().catch(()=>({}))
    ]);
    const mhRows=Array.isArray(microHistory.rows)?microHistory.rows:[];
    const mhCompact=mhRows.slice(0,240).map(x=>({
      eventTs:x.event_ts,
      seqId:x.seq_id,
      bestBid:x.best_bid,
      bestAsk:x.best_ask,
      mid:x.mid_price,
      spreadBps:x.spread_bps,
      bidDepth400:x.bid_depth_400,
      askDepth400:x.ask_depth_400,
      depthImbalance400:x.metrics?.depthImbalance400??null,
      notionalImbalance400:x.metrics?.notionalImbalance400??null,
      tradeCount:x.trade_count,
      buySize:x.buy_size,
      sellSize:x.sell_size,
      deltaSize:x.delta_size,
      vwap:x.vwap
    }));
    const mhSummary={
      configured:microHistory.configured===true,
      sampleCount:mhRows.length,
      oldestEventTs:mhRows.length?mhRows.at(-1)?.event_ts??null:null,
      newestEventTs:mhRows.length?mhRows[0]?.event_ts??null:null,
      avgSpreadBps:mhRows.length?mhRows.reduce((s,x)=>s+Number(x.spread_bps||0),0)/mhRows.length:null,
      avgDepthImbalance400:mhRows.length?mhRows.reduce((s,x)=>s+Number(x.metrics?.depthImbalance400||0),0)/mhRows.length:null,
      avgDeltaSize:mhRows.length?mhRows.reduce((s,x)=>s+Number(x.delta_size||0),0)/mhRows.length:null,
      samples:mhCompact,
      rawPersistence:'DEEP_BOOK_AND_RECENT_TRADES_PERSISTED_PER_MINUTE'
    };
    const text=await r.text();let data;try{data=JSON.parse(text)}catch{data=null}
    if(!r.ok||!data?.ok)return res.status(502).json({ok:false,error:data?.error||text.slice(0,500)});
    // DATA-ONLY CONTRACT: expose observations and market data only.
    // Deliberately omit all trading decisions, signals, probabilities, entries, stops, targets and risk gates.
    return res.status(200).json({ok:true,engine:'SCALP-Ω Market Data Feed v3',decisionAuthority:'CHATGPT_CONVERSATIONAL_ONLY',decisionPolicy:'CHATGPT_ONLY',source:data.source,instrument:data.instrument,fetchedAt:data.fetchedAt,analysisMode:'DATA_FOR_CHATGPT',market:data.market,features:data.features,contexts:data.contexts,externalIntelligence:data.externalIntelligence,institutionalLayer:data.institutionalLayer||data.market?.institutionalLayer||null,macroContext:data.macroContext||null,observations:data.observations,dataQuality:data.dataQuality,featureSummary:data.featureSummary,memory:{historicalStore:'SUPABASE',realtimeStore:'UPSTASH_REDIS',upstashConfigured:memory.configured,upstashLiveSnapshotCached:memory.value!==null,upstashUpdatedAt:memory.value?.updatedAt||null,microstructureHistory:mhSummary,historicalCoverageBySource:coverageMatrix}});
  }catch(e){return res.status(502).json({ok:false,error:e?.message||String(e)})}
}
