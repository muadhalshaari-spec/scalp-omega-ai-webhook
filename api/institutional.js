import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';

const MCP_INSTRUCTIONS = [
  'SCALP-Ω is a read-only evidence gateway for ChatGPT.',
  'ChatGPT is the conversational decision authority; this server never emits an executable trade order and never exposes withdrawal capability.',
  'Market evidence is time-sensitive; always inspect fetchedAt/asOf and dataQuality.',
  'OHLC candles alone cannot prove account fills or the intrabar sequence of entry and stop events.',
  'A setup is time-bounded and must be revalidated against current regime, microstructure, cross-exchange state, derivatives, macro, and news before use.',
  'When evidence is stale or incomplete, prefer NO_TRADE rather than inventing certainty.'
].join(' ');

const MCP_BASE_URL = String(
  process.env.SCALP_PUBLIC_BASE_URL ||
  (process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'https://scalp-omega-ai-webhook.vercel.app')
).replace(/\/$/, '');

async function mcpFetchJson(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50_000);
  try {
    const response = await fetch(MCP_BASE_URL + path, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'SCALP-Omega-MCP/1.0' }
    });
    const body = await response.text();
    let data = null;
    try { data = JSON.parse(body); } catch {}
    if (!response.ok || !data?.ok) {
      throw new Error('SCALP-Ω upstream ' + response.status + ': ' + (data?.error || body.slice(0, 300)));
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

const mcpResult = value => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
const mcpNum = value => Number.isFinite(Number(value)) ? Number(value) : null;
const mcpMs = value => { const ms = Date.parse(String(value)); return Number.isFinite(ms) ? ms : null; };

const scalpMcpHandler = createMcpHandler(
  server => {
    server.registerTool('scalp_omega_live_market', {
      title: 'SCALP-Ω Live Market',
      description: 'Read-only unified live market evidence for ETH-USDT-SWAP: multi-timeframe candles, indicators, derivatives, order book/trades, cross-exchange verification, liquidations, institutional layer, macro/news/on-chain context, and data quality.',
      inputSchema: z.object({ compact: z.boolean().optional().default(true) })
    }, async ({ compact }) => mcpResult(await mcpFetchJson(compact ? '/api/institutional?compact=1' : '/api/institutional')));

    server.registerTool('scalp_omega_provider_health', {
      title: 'SCALP-Ω Provider Health',
      description: 'Read-only provider and freshness audit. Missing credentials, partial providers, coverage, and quality gates are reported without secrets.',
      inputSchema: z.object({})
    }, async () => {
      const data = await mcpFetchJson('/api/confluence?compact=1');
      return mcpResult({
        fetchedAt: data.fetchedAt || null,
        instrument: data.instrument || 'ETH-USDT-SWAP',
        engine: data.engine || null,
        dataQuality: data.dataQuality || null,
        indicatorPersistence: data.indicatorPersistence || null,
        qualityGates: data.qualityGates || null,
        crossExchange: data.externalIntelligence?.crossExchange || null,
        providers: data.externalIntelligence?.providers || null,
        note: 'Read-only health snapshot; secrets are never returned.'
      });
    });

    server.registerTool('scalp_omega_external_context', {
      title: 'SCALP-Ω External Context',
      description: 'Read-only external context: cross-exchange derivatives, Deribit options, CoinGlass when configured, on-chain providers, macro series, news, and contextual sentiment.',
      inputSchema: z.object({})
    }, async () => {
      const data = await mcpFetchJson('/api/institutional?compact=1');
      return mcpResult({
        fetchedAt: data.fetchedAt || null,
        crossExchange: data.externalIntelligence?.crossExchange || null,
        providers: data.externalIntelligence?.providers || null,
        onchain: data.externalIntelligence?.onchain || null,
        news: data.externalIntelligence?.news || null,
        macroContext: data.macroContext || null,
        dataQuality: data.externalIntelligence?.dataQuality || null,
        contextPolicy: 'Context only; combine with current market structure and data-quality gates.'
      });
    });

    server.registerTool('scalp_omega_trade_audit', {
      title: 'SCALP-Ω Trade Audit',
      description: 'Read-only historical setup audit. Finds the first post-placement candle eligible to touch entry, stop and targets, and flags same-candle ambiguity. It never claims an account fill.',
      inputSchema: z.object({
        orderPlacementUtc: z.string().describe('UTC ISO-8601 timestamp, e.g. 2026-09-24T18:45:00Z'),
        entryPrice: z.number().positive(),
        stopLossPrice: z.number().positive(),
        takeProfitPrices: z.array(z.number().positive()).optional().default([]),
        timeframe: z.enum(['1m', '5m', '15m', '1H', '4H', '1D']).optional().default('15m'),
        source: z.string().optional().default('OKX'),
        instrument: z.string().optional().default('ETH-USDT-SWAP'),
        lookbackBars: z.number().int().min(50).max(1000).optional().default(1000)
      })
    }, async ({ orderPlacementUtc, entryPrice, stopLossPrice, takeProfitPrices, timeframe, source, instrument, lookbackBars }) => {
      const placementMs = mcpMs(orderPlacementUtc);
      if (placementMs == null) return mcpResult({ ok: false, error: 'Invalid orderPlacementUtc. Use ISO-8601 UTC.' });
      const result = await getRecentMarketCandles({ source, instrument, timeframe, limit: lookbackBars });
      const candles = (result.rows || []).map(c => ({
        time_ms: mcpNum(c.time_ms), open: mcpNum(c.open), high: mcpNum(c.high), low: mcpNum(c.low), close: mcpNum(c.close),
        volume: mcpNum(c.volume), confirmed: c.confirmed === true
      })).filter(c => Number.isFinite(c.time_ms) && c.time_ms >= placementMs && [c.open,c.high,c.low,c.close].every(Number.isFinite))
        .sort((a,b) => a.time_ms - b.time_ms);
      const side = stopLossPrice > entryPrice ? 'SHORT' : stopLossPrice < entryPrice ? 'LONG' : 'UNKNOWN';
      const firstEntry = candles.find(c => side === 'SHORT' ? c.high >= entryPrice : c.low <= entryPrice) || null;
      let firstStop = null;
      if (firstEntry) {
        const idx = candles.findIndex(c => c.time_ms === firstEntry.time_ms);
        firstStop = candles.slice(idx).find(c => side === 'SHORT' ? c.high >= stopLossPrice : c.low <= stopLossPrice) || null;
      }
      const targets = takeProfitPrices.map(price => ({
        price,
        firstEligibleCandle: candles.find(c => side === 'SHORT' ? c.low <= price : c.high >= price) || null
      }));
      const sameCandle = Boolean(firstEntry && firstStop && firstEntry.time_ms === firstStop.time_ms);
      return mcpResult({
        ok: true, source, instrument, timeframe, orderPlacementUtc, placementMs, inferredSide: side,
        entryPrice, stopLossPrice, takeProfitPrices, candleCountAfterPlacement: candles.length,
        firstEntryEligibleCandle: firstEntry, firstStopEligibleAfterEntry: firstStop,
        sameCandleStopEligible: sameCandle, intrabarSequenceProven: false,
        intrabarSequenceWarning: sameCandle ? 'Entry and stop are in the same candle; OHLC does not prove the intrabar sequence.' : null,
        takeProfitEligibility: targets,
        accountFillStatus: 'UNVERIFIED_WITH_MARKET_DATA_ONLY',
        accountFillProofRequired: 'Exchange order/fill history',
        dataSourceConfigured: result.configured === true
      });
    });
  },
  {
    serverInfo: { name: 'SCALP-Ω MCP', version: '1.0.0' },
    instructions: MCP_INSTRUCTIONS
  }
);

async function runMcpOnNodeRequest(req, res) {
  const protocol = String(req.headers?.['x-forwarded-proto'] || 'https');
  const host = String(req.headers?.host || new URL(MCP_BASE_URL).host);
  const requestUrl = protocol + '://' + host + String(req.url || '/api/mcp');
  let body;
  if (!['GET','HEAD'].includes(String(req.method || '').toUpperCase())) {
    if (req.body !== undefined) {
      body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    } else {
      body = await new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', chunk => chunks.push(Buffer.from(chunk)));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
      });
    }
  }
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers || {})) {
    if (Array.isArray(value)) for (const v of value) headers.append(key, String(v));
    else if (value != null) headers.set(key, String(value));
  }
  const webRequest = new Request(requestUrl, { method: req.method || 'GET', headers, body });
  const webResponse = await scalpMcpHandler(webRequest);
  res.statusCode = webResponse.status;
  webResponse.headers.forEach((value, key) => res.setHeader(key, value));
  if (!webResponse.body) { res.end(); return; }
  for await (const chunk of webResponse.body) res.write(Buffer.from(chunk));
  res.end();
}

import { getLiveMemory } from '../lib/market-memory.js';
import { getMarketCandleCoverageMatrix, getMicrostructureHistory, insertTitanSnapshot, insertTitanFeature, insertTitanSystemEvent } from '../lib/supabase.js';
import { buildInstitutionalAnalysis } from '../lib/institutional-engine.js';
import { getBybitPrivateAccount } from '../lib/bybit-private.js';
import { persistBybitAccountSnapshot } from '../lib/bybit-account-store.js';
import { compactAiInput } from '../lib/ai-context-compact.js';

// Bybit private egress is pinned via vercel.json region configuration.
export default async function handler(req,res){
  if (req.query?.mcp === '1') return runMcpOnNodeRequest(req,res);
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const includeBybitAccount = req.query?.includeAccount === '1';
  const host=typeof req.headers.host==='string'?req.headers.host:'scalp-omega-ai-webhook.vercel.app';
  try{
    const r=await fetch('https://'+host+'/api/confluence?dataOnly=1&ts='+Date.now(),{cache:'no-store',headers:{Accept:'application/json'}});
    const [memory, microHistory, coverageMatrix, bybitAccountResult, liveStreamResult] = await Promise.all([
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
        : null,
      fetch('https://'+host+'/api/live-state?ts='+Date.now(),{cache:'no-store',headers:{Accept:'application/json'}})
        .then(async response => ({ ok: response.ok, value: await response.json().catch(() => null) }))
        .catch(() => ({ ok:false, value:null }))
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
    const liveMemory = memory.value ? memory : await getLiveMemory().catch(() => memory);
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
    const liveStream = liveStreamResult?.ok ? liveStreamResult.value : null;
    const liveStreamUpdatedAtMs = Date.parse(liveStream?.updatedAt || '') || null;
    const liveStreamAgeMs = liveStreamUpdatedAtMs ? Math.max(0, Date.now() - liveStreamUpdatedAtMs) : null;
    const realtimeQuality = {
      available: Boolean(liveStream),
      connected: liveStream?.connected === true,
      dataReady: liveStream?.dataReady === true,
      ageMs: liveStreamAgeMs,
      freshWithin30s: liveStreamAgeMs != null && liveStreamAgeMs <= 30_000,
      missingChannels: Array.isArray(liveStream?.missingChannels) ? liveStream.missingChannels : []
    };

    const responsePayload={ok:true,engine:'SCALP-Ω Market Data Feed v5',bybitPrivateAccountStatus,decisionAuthority:'CHATGPT_CONVERSATIONAL_ONLY',decisionPolicy:'CHATGPT_ONLY',source:data.source,instrument:data.instrument,fetchedAt:data.fetchedAt,analysisMode:'DATA_FOR_CHATGPT',market:data.market,features:data.features,contexts:data.contexts,externalIntelligence:data.externalIntelligence,institutionalLayer:data.institutionalLayer||data.market?.institutionalLayer||null,macroContext:data.macroContext||null,observations:data.observations,dataQuality:{...(data.dataQuality||{}),realtimeQuality},featureSummary:data.featureSummary,indicatorFeatures:data.indicatorFeatures||null,titan55,titanPersistence,qualityGates:liveTitan.qualityGates||null,realtimeMemory:{configured:liveMemory.configured,key:liveMemory.key,value:liveMemory.value},realtimeStream:liveStream || { ok:false, error:'LIVE_STREAM_UNAVAILABLE' },memory:{historicalStore:'SUPABASE',realtimeStore:'UPSTASH_REDIS',upstashConfigured:liveMemory.configured,upstashLiveSnapshotCached:liveMemory.value!==null,upstashUpdatedAt:liveMemory.value?.updatedAt||null,microstructureHistory:mhSummary,historicalCoverageBySource:coverageMatrix}};
    if(req.query?.compact==='1') return res.status(200).json({...compactAiInput(responsePayload),ok:true,titan55,qualityGates:responsePayload.qualityGates,indicatorPersistence:{configured:true,persisted:true},bybitPrivateAccountStatus});
    return res.status(200).json(responsePayload);
  }catch(e){return res.status(502).json({ok:false,error:e?.message||String(e)})}
}
