import { getLiveMemory } from '../lib/market-memory.js';
import { getMarketCandleCoverageMatrix, getMicrostructureHistory, insertTitanSnapshot, insertTitanFeature, insertTitanSystemEvent } from '../lib/supabase.js';
import { buildInstitutionalAnalysis } from '../lib/institutional-engine.js';
import { getBybitPrivateAccount } from '../lib/bybit-private.js';
import { persistBybitAccountSnapshot } from '../lib/bybit-account-store.js';
import { compactAiInput } from '../lib/ai-context-compact.js';

// Bybit private egress is pinned via vercel.json region configuration.
export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const includeBybitAccount = req.query?.includeAccount === '1';
  const host=typeof req.headers.host==='string'?req.headers.host:'scalp-omega-ai-webhook.vercel.app';
  try{
    const r=await fetch('https://'+host+'/api/confluence?dataOnly=1&ts='+Date.now(),{cache:'no-store',headers:{Accept:'application/json'}});
    const [memory, microHistory, coverageMatrix, bybitAccountResult] = await Promise.all([
      getLiveMemory().catch(()=>({configured:false,value:null})),
      getMicrostructureHistory({ source:'OKX', instrument:'ETH-USDT-SWAP', limit:1000 }).catch(()=>({configured:false,rows:[]})),
      getMarketCandleCoverageMatrix().catch(()=>({})),
      includeBybitAccount
        ? getBybitPrivateAccount().catch(error => ({
            configured: Boolean(process.env.BYBIT_API_KEY && process.env.BYBIT_API_SECRET),
            available: false,
            source: 'BYBIT_PRIVATE',
            error: error?.message || String(error)
          }))
        : null
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
    const bybitPersistence = includeBybitAccount && bybitAccountResult?.available === true
      ? await persistBybitAccountSnapshot(bybitAccountResult).catch(error => ({configured:true,persisted:false,status:'ERROR',error:error?.message||String(error)}))
      : null;
    const bybitPrivateAccountStatus = includeBybitAccount ? {
      requested: true,
      configured: bybitAccountResult?.configured === true,
      available: bybitAccountResult?.available === true,
      source: bybitAccountResult?.source || 'BYBIT_PRIVATE',
      environment: bybitAccountResult?.environment || null,
      fetchedAt: bybitAccountResult?.fetchedAt || null,
      positionPresent: bybitAccountResult?.position ? true : false,
      openOrderCount: Number(bybitAccountResult?.openOrders?.count ?? 0),
      persistence: bybitPersistence || {configured:false,persisted:false,status:'NOT_REQUESTED'},
      accountDataReturned: false,
      error: bybitAccountResult?.available === false ? (bybitAccountResult?.error || null) : null
    } : {requested:false,accountDataReturned:false};
    const text=await r.text();let data;try{data=JSON.parse(text)}catch{data=null}
    if(!r.ok||!data?.ok)return res.status(502).json({ok:false,error:data?.error||text.slice(0,500)});
    const liveTitan = buildInstitutionalAnalysis({
      candlesByTf: data.market?.candlesByTf || {},
      market: data.market || {},
      realtime: {
        price: data.market?.price ?? null,
        orderBook: data.market?.orderBook || null,
        trades: data.market?.trades || []
      },
      externalEvents: data.externalIntelligence?.events || [],
      calibration: null,
      thresholds: { long: 0.72, short: 0.72, minEdge: 0.12 },
      timestamp: Date.parse(data.fetchedAt || new Date().toISOString()) || Date.now(),
      mode: 'live',
      historicalAnalogs: [],
      externalIntelligence: data.externalIntelligence || null
    });

    const titan = liveTitan.titan || {};
    const outputs = titan.outputs || {};
    const moduleStatus = Object.fromEntries(Object.entries(outputs).map(([id, o]) => [id, {
      status: o?.state?.status || null,
      direction: o?.state?.direction || null,
      warnings: o?.diagnostics?.warnings || [],
      errors: o?.diagnostics?.errors || []
    }]));
    const titan55 = {
      engine: titan.engine || 'SCALP-Ω TITAN 55',
      version: titan.version || '1.0.0',
      decision: null,
      deterministicDecision: null,
      blocked: titan.blocked ?? true,
      blockers: titan.blockers || [],
      score: titan.score ?? null,
      confidence: titan.confidence ?? null,
      summary: titan.summary || null,
      qualityGates: liveTitan.qualityGates || null,
      moduleStatus,
      chatgptAuthority: 'CHATGPT_ONLY',
      decisionSource: 'CHATGPT',
      systemDecisionEnabled: false
    };

    const persistencePayload = {
      timestamp: data.fetchedAt || new Date().toISOString(),
      instrument: data.instrument || 'ETH-USDT-SWAP',
      decision: null,
      titanDecision: null,
      blockers: titan55.blockers,
      summary: titan55.summary,
      moduleStatus
    };
    const persistAt = persistencePayload.timestamp;
    const featurePayload = {
      timestamp: persistAt,
      instrument: persistencePayload.instrument,
      featureSummary: data.featureSummary || {},
      indicatorFeatures: data.indicatorFeatures || null,
      dataQuality: data.dataQuality || {},
      market: { price: data.market?.price ?? null, openInterest: data.market?.openInterest ?? null, fundingRate: data.market?.fundingRate ?? null },
      titan55: { decision: null, score: titan55.score, confidence: titan55.confidence }
    };
    const persistResults = await Promise.allSettled([
      insertTitanSnapshot({ event_ts: persistAt, instrument: persistencePayload.instrument, decision: null, payload: persistencePayload }),
      insertTitanFeature({ event_ts: persistAt, instrument: persistencePayload.instrument, features: featurePayload }),
      insertTitanSystemEvent({ event_type: 'TITAN_LIVE_AUDIT', payload: persistencePayload })
    ]);
    const titanPersistence = {
      snapshot: persistResults[0].status === 'fulfilled' ? persistResults[0].value : { persisted: false, status: 'ERROR', error: String(persistResults[0].reason?.message || persistResults[0].reason) },
      feature: persistResults[1].status === 'fulfilled' ? persistResults[1].value : { persisted: false, status: 'ERROR', error: String(persistResults[1].reason?.message || persistResults[1].reason) },
      systemEvent: persistResults[2].status === 'fulfilled' ? persistResults[2].value : { persisted: false, status: 'ERROR', error: String(persistResults[2].reason?.message || persistResults[2].reason) }
    };

    const responsePayload={ok:true,engine:'SCALP-Ω Market Data Feed v5',bybitPrivateAccountStatus,decisionAuthority:'CHATGPT_CONVERSATIONAL_ONLY',decisionPolicy:'CHATGPT_ONLY',source:data.source,instrument:data.instrument,fetchedAt:data.fetchedAt,analysisMode:'DATA_FOR_CHATGPT',market:data.market,features:data.features,contexts:data.contexts,externalIntelligence:data.externalIntelligence,institutionalLayer:data.institutionalLayer||data.market?.institutionalLayer||null,macroContext:data.macroContext||null,observations:data.observations,dataQuality:data.dataQuality,featureSummary:data.featureSummary,indicatorFeatures:data.indicatorFeatures||null,titan55,titanPersistence,qualityGates:liveTitan.qualityGates||null,memory:{historicalStore:'SUPABASE',realtimeStore:'UPSTASH_REDIS',upstashConfigured:memory.configured,upstashLiveSnapshotCached:memory.value!==null,upstashUpdatedAt:memory.value?.updatedAt||null,microstructureHistory:mhSummary,historicalCoverageBySource:coverageMatrix}};
    if(req.query?.compact==='1') return res.status(200).json({...compactAiInput(responsePayload),ok:true,titan55,indicatorPersistence:{configured:true,persisted:true},bybitPrivateAccountStatus});
    return res.status(200).json(responsePayload);
  }catch(e){return res.status(502).json({ok:false,error:e?.message||String(e)})}
}
