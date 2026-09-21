import { waitUntil } from '@vercel/functions';
import { getLiveMemory, persistMarketMemory } from '../lib/market-memory.js';
import { compactAiInput } from '../lib/ai-context-compact.js';

export const maxDuration = 60;

const LIVE_MAX_AGE_MS = 30_000;

function trimBook(book, limit = 20) {
  if (!book) return null;
  return {
    time: book.time ?? book.ts ?? null,
    seqId: book.seqId ?? book.seqNum ?? null,
    bids: Array.isArray(book.bids) ? book.bids.slice(0, limit) : [],
    asks: Array.isArray(book.asks) ? book.asks.slice(0, limit) : []
  };
}

function buildAiInput(dataFeed, liveData) {
  const market = dataFeed.market || {};
  const ticker = liveData?.ticker || {};

  return {
    engine: dataFeed.engine,
    decisionAuthority: dataFeed.decisionAuthority || 'CHATGPT_ONLY',
    decisionPolicy: dataFeed.decisionPolicy || 'NO_DECISION_OUTPUT',
    source: dataFeed.source,
    instrument: dataFeed.instrument,
    analysisMode: dataFeed.analysisMode,
    fetchedAt: dataFeed.fetchedAt,
    market: {
      price: market.price ?? null,
      openInterest: market.openInterest ?? null,
      fundingRate: market.fundingRate ?? null,
      fundingTime: market.fundingTime ?? null,
      nextFundingTime: market.nextFundingTime ?? null,
      nextFundingRate: market.nextFundingRate ?? null,
      oiHistory: Array.isArray(market.oiHistory) ? market.oiHistory : [],
      fundingHistory: Array.isArray(market.fundingHistory) ? market.fundingHistory : [],
      longShortHistory: Array.isArray(market.longShortHistory) ? market.longShortHistory : [],
      takerVolumeHistory: Array.isArray(market.takerVolumeHistory) ? market.takerVolumeHistory : [],
      orderBook: trimBook(market.orderBook),
      trades: Array.isArray(market.trades) ? market.trades.slice(0, 100) : [],
      candlesByTf: market.candlesByTf || {},
      candlesByExchange: market.candlesByExchange || {},
      liquidations: Array.isArray(market.liquidations) ? market.liquidations.slice(0, 200) : [],
      liquidationHistory: Array.isArray(market.liquidationHistory) ? market.liquidationHistory.slice(0, 200) : []
    },
    features: dataFeed.features || {},
    contexts: dataFeed.contexts || {},
    externalIntelligence: dataFeed.externalIntelligence || dataFeed.market?.externalIntelligence || null,
    dataQuality: dataFeed.dataQuality || {},
    featureSummary: dataFeed.featureSummary || {},
    macroContext: dataFeed.macroContext || null,
    realtime: {
      source: liveData?.source || null,
      receivedAt: liveData?.updatedAt || null,
      connected: liveData?.connected === true,
      ticker: liveData?.ticker ? {
        last: ticker.last ?? ticker.lastPrice ?? ticker.lastPx ?? null,
        bid: ticker.bid ?? ticker.bidPx ?? null,
        ask: ticker.ask ?? ticker.askPx ?? null,
        markPrice: ticker.markPrice ?? ticker.markPx ?? null
      } : null,
      latestTrade: liveData?.latestTrade || null,
      orderBook: trimBook(liveData?.orderBook)
    }
  };
}

function buildDecisionInput(dataFeed, liveData, previousMemory) {
  const market = dataFeed.market || {};
  const featureSummary = dataFeed.featureSummary || {};
  const features = Object.fromEntries(Object.entries(featureSummary).map(([tf,f]) => [tf, {
    c:f?.lastCandle?.close ?? null,
    i:f?.indicators ? {
      e20:f.indicators.ema20 ?? null,e50:f.indicators.ema50 ?? null,e200:f.indicators.ema200 ?? null,
      r:f.indicators.rsi14 ?? null,a:f.indicators.atr14 ?? null,m:f.indicators.macdHistogram ?? null,v:f.indicators.volumeRatio20 ?? null
    } : null,
    p:f?.momentum?.priceChangePct1 ?? null
  }]));
  const ext = dataFeed.externalIntelligence || {};
  const providers = Object.fromEntries(Object.entries(ext.providers || {}).map(([name,p]) => [name, p ? {
    available:p.available === true, price:p.price ?? null, fundingRate:p.fundingRate ?? p.currentFunding ?? null, openInterest:p.openInterest ?? null
  } : null]));
  const macro = dataFeed.macroContext || {};
  const macroLatest = Object.fromEntries(Object.entries(macro.series || {}).map(([id,s]) => {
    const o = Array.isArray(s?.observations) ? s.observations.at(-1) : null;
    return [id, o ? { date:o.date ?? null, value:o.value ?? o.val ?? null } : null];
  }));
  const liveTicker = liveData?.ticker || {};
  const book = liveData?.orderBook || market.orderBook || null;
  return {
    engine:dataFeed.engine, decisionAuthority:dataFeed.decisionAuthority || 'CHATGPT_ONLY', instrument:dataFeed.instrument,
    market:{ price:market.price ?? null, openInterest:market.openInterest ?? null, fundingRate:market.fundingRate ?? null,
      bid:liveTicker.bid ?? liveTicker.bidPx ?? null, ask:liveTicker.ask ?? liveTicker.askPx ?? null,
      orderBookTop:book ? { b:book.bids?.[0] ?? null, a:book.asks?.[0] ?? null } : null },
    timeframes:features, external:{providers},
    macro:{status:macro.status ?? null},
    dataQuality:{candlesPerTimeframe:dataFeed.dataQuality?.candlesPerTimeframe ?? {}},
    realtime:{connected:liveData?.connected === true, latestTrade:liveData?.latestTrade ?? null},
    memory:{upstashConfigured:previousMemory?.configured === true, cached:previousMemory?.value != null}
  };
}
async function readJson(response) {
  const text = await response.text();
  try { return JSON.parse(text); } catch { return null; }
}

const systemPrompt = `You are SCALP-Ω's sole trading-decision layer. Data is upstream-only; you alone choose LONG, SHORT, or NO_TRADE. Do not invent data or trust upstream signals/probabilities. Use 1D/4H/1H context and 15m/5m/1m execution. Ignore unconfirmed candles. Prefer NO_TRADE for stale, conflicting, incomplete, or non-actionable evidence. For trades give precise entry condition, invalidation, stop loss, and targets based on structure/liquidity/volatility. Confidence is evidence strength, not win probability. Return strict JSON with exactly: {"decision":"LONG|SHORT|NO_TRADE","confidence":0,"marketRegime":"","summary":"","evidence":[""],"conflicts":[""],"entryCondition":"","invalidation":"","stopLoss":"","targets":[""],"riskNote":""}`;

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ ok: false, error: 'OPENAI_API_KEY is not configured' });

  const baseUrl = `https://${req.headers.host}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55_000);

  try {
    const [dataResponse, liveResponse, previousMemory] = await Promise.all([
      fetch(`${baseUrl}/api/institutional?ts=${Date.now()}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal
      }),
      fetch(`${baseUrl}/api/live-state?ts=${Date.now()}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal
      }),
      getLiveMemory({ signal: controller.signal })
    ]);

    const [dataFeed, liveData] = await Promise.all([
      readJson(dataResponse),
      readJson(liveResponse)
    ]);

    if (!dataResponse.ok || !dataFeed?.ok) {
      return res.status(502).json({ ok: false, stage: 'DATA_FEED', error: dataFeed?.error || 'Data feed unavailable' });
    }

    if (!liveResponse.ok || !liveData?.ok) {
      return res.status(502).json({ ok: false, stage: 'LIVE_MARKET_DATA', error: liveData?.error || 'Live market data unavailable' });
    }

    const liveUpdatedAt = Date.parse(liveData.updatedAt || '');
    const liveAgeMs = Number.isFinite(liveUpdatedAt) ? Math.max(0, Date.now() - liveUpdatedAt) : null;

    if (!liveData.connected || liveAgeMs == null || liveAgeMs > LIVE_MAX_AGE_MS) {
      return res.status(503).json({
        ok: false,
        stage: 'LIVE_MARKET_DATA',
        error: 'Live market state is stale or disconnected; no AI trading decision was generated.',
        live: {
          connected: Boolean(liveData.connected),
          updatedAt: liveData.updatedAt || null,
          ageMs: liveAgeMs,
          maxAgeMs: LIVE_MAX_AGE_MS
        }
      });
    }

    const rawAiInput = buildAiInput(dataFeed, liveData);
    const aiInput = buildDecisionInput(dataFeed, liveData, previousMemory);

    // Historical persistence and realtime cache are non-authoritative infrastructure.
    waitUntil(persistMarketMemory(dataFeed, liveData).catch(() => null));

    const openaiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-5.6-luna',
        input: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify(aiInput) }
        ],
        max_output_tokens: 110,
        text: { format: { type: 'json_object' } }
      }),
      signal: controller.signal
    });

    const openaiText = await openaiResponse.text();
    let openaiData = null;
    try { openaiData = JSON.parse(openaiText); } catch {}

    if (!openaiResponse.ok) {
      return res.status(openaiResponse.status === 429 ? 429 : 502).json({
        ok: false,
        stage: 'OPENAI',
        error: openaiData?.error?.message || openaiText.slice(0, 1000),
        decisionGenerated: false
      });
    }

    function extractDecision(value, depth = 0) {
      if (depth > 8 || value == null) return null;
      if (typeof value === 'object') {
        if (typeof value.decision === 'string' && ['LONG', 'SHORT', 'NO_TRADE'].includes(value.decision)) return value;
        const values = Array.isArray(value) ? value : Object.values(value);
        for (const item of values) {
          const found = extractDecision(item, depth + 1);
          if (found) return found;
        }
        return null;
      }
      if (typeof value === 'string') {
        const raw = value.trim();
        try {
          const parsed = JSON.parse(raw);
          const found = extractDecision(parsed, depth + 1);
          if (found) return found;
        } catch {}
        const first = raw.indexOf('{');
        const last = raw.lastIndexOf('}');
        if (first >= 0 && last > first) {
          try {
            const parsed = JSON.parse(raw.slice(first, last + 1));
            const found = extractDecision(parsed, depth + 1);
            if (found) return found;
          } catch {}
        }
      }
      return null;
    }

    const analysis = extractDecision(openaiData);
    if (!analysis || !['LONG', 'SHORT', 'NO_TRADE'].includes(analysis.decision)) {
      return res.status(502).json({
        ok: false,
        stage: 'OPENAI_PARSE',
        error: 'OpenAI returned an invalid trading-decision JSON object',
        decisionGenerated: false
      });
    }

    const currentPrice = liveData.ticker
      ? Number(liveData.ticker.last ?? liveData.ticker.lastPrice ?? liveData.ticker.lastPx)
      : null;

    return res.status(200).json({
      ok: true,
      engine: 'SCALP-Ω GPT-5.6 Luna Decision Layer v2',
      model: 'gpt-5.6-luna',
      decisionAuthority: 'CHATGPT_ONLY',
      decisionPolicy: 'UPSTREAM_DATA_ONLY_GPT_DECIDES',
      source: dataFeed.source,
      instrument: dataFeed.instrument,
      dataFetchedAt: dataFeed.fetchedAt,
      realtimeReceivedAt: liveData.updatedAt,
      liveAgeMs,
      currentPrice: Number.isFinite(currentPrice) ? currentPrice : null,
      memory: {
        historicalStore: 'SUPABASE',
        realtimeStore: 'UPSTASH_REDIS',
        upstashConfigured: previousMemory.configured,
        rawHistoricalCandlesSentToModel: false
      },
      analysis
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      stage: 'ANALYSIS',
      error: error?.name === 'AbortError'
        ? 'AI analysis request timed out after 55 seconds'
        : error?.message || String(error),
      decisionGenerated: false
    });
  } finally {
    clearTimeout(timeout);
  }
}
