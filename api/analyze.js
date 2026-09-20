import { waitUntil } from '@vercel/functions';
import { getLiveMemory, persistMarketMemory } from '../lib/market-memory.js';
import { compactAiInput } from '../lib/ai-context.js';

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

async function readJson(response) {
  const text = await response.text();
  try { return JSON.parse(text); } catch { return null; }
}

const systemPrompt = `You are the sole trading-decision and reasoning layer for SCALP-Ω.

The SCALP-Ω upstream application is DATA-ONLY for this request. It collects, normalizes, validates, and summarizes market observations. It does not have decision authority.

DECISION AUTHORITY:
- The final trading decision belongs to you (GPT) only.
- Never copy, inherit, obey, or treat an upstream decision, signal, probability, risk gate, entry, stop, or target as authoritative.
- Upstream data is evidence only.
- You independently decide LONG, SHORT, or NO_TRADE.
- Never claim that SCALP-Ω made the trading decision.
- Never invent unavailable data.
- Confidence is evidence strength, not a validated win probability.

DATA ARCHITECTURE:
- Supplied candle history may be compressed from a larger historical store.
- candleContext contains representative historical anchors plus the most recent confirmed candles.
- realtime is the freshest market snapshot.
- Use 1D, 4H, 1H for context and 15m, 5m, 1m for execution.
- Check source availability, timestamps, cross-exchange agreement, derivatives, order book, trades, liquidations, momentum, volume, volatility, market structure, liquidity, and zones where available.
- In-progress candles must not be treated as confirmed structural evidence.

DECISION STANDARD:
- Return NO_TRADE when evidence is conflicting, stale, incomplete, or not actionable.
- If LONG or SHORT, provide a precise executable entry condition and structural invalidation.
- Stop and targets must be supported by current structure/liquidity/volatility.
- Do not manufacture levels to satisfy a format.

Return strict JSON with exactly:
{
  "decision": "LONG|SHORT|NO_TRADE",
  "confidence": 0,
  "marketRegime": "string",
  "summary": "string",
  "evidence": ["string"],
  "conflicts": ["string"],
  "entryCondition": "string",
  "invalidation": "string",
  "stopLoss": "string",
  "targets": ["string"],
  "riskNote": "string"
}`;

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
    const aiInput = compactAiInput(rawAiInput, { previousLive: previousMemory });

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
        max_output_tokens: 2200,
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

    const outputText =
      openaiData?.output_text ||
      openaiData?.output?.flatMap(item => item.content || [])
        ?.map(item => item.text)
        ?.filter(Boolean)
        ?.join('') ||
      '';

    let analysis = null;
    try { analysis = JSON.parse(outputText); } catch {}

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
