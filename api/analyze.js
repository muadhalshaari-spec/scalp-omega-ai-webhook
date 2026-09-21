import { waitUntil } from '@vercel/functions';
import { getLiveMemory, persistMarketMemory } from '../lib/market-memory.js';

export const maxDuration = 60;
const LIVE_MAX_AGE_MS = 30_000;

function topOfBook(book) {
  if (!book) return null;
  return {
    bid: Array.isArray(book.bids) ? book.bids[0] ?? null : null,
    ask: Array.isArray(book.asks) ? book.asks[0] ?? null : null
  };
}

function compactTimeframes(summary = {}) {
  return Object.fromEntries(Object.entries(summary).map(([tf, f]) => [tf, {
    candle: f?.lastCandle ? {
      o: f.lastCandle.open ?? null, h: f.lastCandle.high ?? null,
      l: f.lastCandle.low ?? null, c: f.lastCandle.close ?? null
    } : null,
    i: f?.indicators ? {
      e20: f.indicators.ema20 ?? null, e50: f.indicators.ema50 ?? null,
      e200: f.indicators.ema200 ?? null, r: f.indicators.rsi14 ?? null,
      a: f.indicators.atr14 ?? null, m: f.indicators.macdHistogram ?? null,
      v: f.indicators.volumeRatio20 ?? null
    } : null,
    p: f?.momentum?.priceChangePct1 ?? null
  }])); 
}

function compactProviders(external = {}) {
  return Object.fromEntries(Object.entries(external.providers || {}).map(([name, p]) => [name, p ? {
    ok: p.available === true,
    px: p.price ?? null,
    fr: p.fundingRate ?? p.currentFunding ?? null,
    oi: p.openInterest ?? null
  } : null]));
}

function buildDecisionInput(dataFeed, liveData, previousMemory) {
  const market = dataFeed.market || {};
  const ext = dataFeed.externalIntelligence || {};
  const book = liveData?.orderBook || market.orderBook || null;
  const ticker = liveData?.ticker || {};
  const timeframeContext = Object.fromEntries(
    Object.entries(market.candlesByTf || {}).map(([tf, rows]) => {
      const closed = (Array.isArray(rows) ? rows : []).filter(x =>
        x?.confirmed === true || x?.confirmed === '1' || x?.[8] === '1'
      ).slice(-1000);
      const first = closed[0];
      const last = closed.at(-1);
      return [tf, {
        n: closed.length,
        newest: last?.time ?? last?.[0] ?? null,
        hi: closed.length ? Math.max(...closed.map(x => Number(x?.high ?? x?.[2]) || -Infinity)) : null,
        lo: closed.length ? Math.min(...closed.map(x => Number(x?.low ?? x?.[3]) || Infinity)) : null,
        chg: first && last
          ? (((Number(last?.close ?? last?.[4]) - Number(first?.close ?? first?.[4])) / Number(first?.close ?? first?.[4])) * 100)
          : null
      }];
    })
  );

  return {
    instrument: dataFeed.instrument,
    price: market.price ?? null,
    oi: market.openInterest ?? null,
    funding: market.fundingRate ?? null,
    book: topOfBook(book),
    trade: liveData?.latestTrade ?? null,
    tf: compactTimeframes(dataFeed.featureSummary || {}),
    providers: compactProviders(ext),
    candles: timeframeContext,
    data: {
      quality: dataFeed.dataQuality?.candlesPerTimeframe ?? {},
      macroStatus: dataFeed.macroContext?.status ?? null,
      memory: previousMemory?.configured === true ? 'UPSTASH_READY' : 'UPSTASH_UNCONFIGURED'
    }
  };
}

function extractDecision(value, depth = 0) {
  if (depth > 10 || value == null) return null;
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
    for (const candidate of [raw, raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)]) {
      if (!candidate || !candidate.startsWith('{')) continue;
      try {
        const parsed = JSON.parse(candidate);
        const found = extractDecision(parsed, depth + 1);
        if (found) return found;
      } catch {}
    }
  }
  return null;
}

const SYSTEM_PROMPT = `You are SCALP-Ω's sole trading-decision layer. Upstream provides market evidence; you alone choose LONG, SHORT, or NO_TRADE. Use 1D/4H/1H for context and 15m/5m/1m for execution. Ignore unconfirmed candles. Prefer NO_TRADE when evidence conflicts, is stale, or non-actionable. For a trade give a precise conditional entry, invalidation, stop loss, and targets. Confidence is evidence strength, not guaranteed win probability. Return JSON only with exactly these keys: decision, confidence, marketRegime, summary, evidence, conflicts, entryCondition, invalidation, stopLoss, targets, riskNote.`;

async function callModel(apiKey, model, aiInput, signal) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      input: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(aiInput) }
      ],
      max_output_tokens: 110,
      text: { format: { type: 'json_object' } }
    }),
    signal
  });
  const raw = await response.text();
  let body = null;
  try { body = JSON.parse(raw); } catch {}
  return { response, raw, body };
}

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
      fetch(`${baseUrl}/api/institutional?ts=${Date.now()}`, { headers: { Accept: 'application/json' }, cache: 'no-store', signal: controller.signal }),
      fetch(`${baseUrl}/api/live-state?ts=${Date.now()}`, { headers: { Accept: 'application/json' }, cache: 'no-store', signal: controller.signal }),
      getLiveMemory({ signal: controller.signal })
    ]);

    const [dataFeed, liveData] = await Promise.all([dataResponse.json(), liveResponse.json()]);

    if (!dataResponse.ok || !dataFeed?.ok) {
      return res.status(502).json({ ok: false, stage: 'DATA_FEED', error: dataFeed?.error || 'Data feed unavailable', decisionGenerated: false });
    }
    if (!liveResponse.ok || !liveData?.ok) {
      return res.status(502).json({ ok: false, stage: 'LIVE_MARKET_DATA', error: liveData?.error || 'Live market data unavailable', decisionGenerated: false });
    }

    const liveUpdatedAt = Date.parse(liveData.updatedAt || '');
    const liveAgeMs = Number.isFinite(liveUpdatedAt) ? Math.max(0, Date.now() - liveUpdatedAt) : null;
    if (!liveData.connected || liveAgeMs == null || liveAgeMs > LIVE_MAX_AGE_MS) {
      return res.status(503).json({
        ok: false, stage: 'LIVE_MARKET_DATA',
        error: 'Live market state is stale or disconnected; no AI trading decision was generated.',
        live: { connected: Boolean(liveData.connected), updatedAt: liveData.updatedAt || null, ageMs: liveAgeMs, maxAgeMs: LIVE_MAX_AGE_MS }
      });
    }

    const aiInput = buildDecisionInput(dataFeed, liveData, previousMemory);
    waitUntil(persistMarketMemory(dataFeed, liveData).catch(() => null));

    const models = ['gpt-5.6-luna', 'gpt-5.6-terra'];
    let selectedModel = null;
    let analysis = null;
    let lastError = null;

    for (const model of models) {
      const result = await callModel(apiKey, model, aiInput, controller.signal);
      if (!result.response.ok) {
        lastError = result.body?.error?.message || result.raw.slice(0, 1000);
        if (result.response.status === 429 && model === 'gpt-5.6-luna') continue;
        return res.status(result.response.status === 429 ? 429 : 502).json({
          ok: false, stage: 'OPENAI', error: lastError, decisionGenerated: false, model
        });
      }
      analysis = extractDecision(result.body);
      if (analysis) { selectedModel = model; break; }
      lastError = 'OpenAI returned an invalid trading-decision JSON object';
      if (model === 'gpt-5.6-luna') continue;
    }

    if (!analysis) {
      return res.status(502).json({
        ok: false, stage: 'OPENAI_PARSE', error: lastError || 'Invalid trading decision', decisionGenerated: false
      });
    }

    const currentPrice = Number(liveData.ticker?.last ?? liveData.ticker?.lastPrice ?? liveData.ticker?.lastPx);
    return res.status(200).json({
      ok: true,
      engine: 'SCALP-Ω GPT-5.6 Decision Layer v3',
      model: selectedModel,
      decisionAuthority: 'CHATGPT_ONLY',
      decisionPolicy: 'UPSTREAM_DATA_ONLY_GPT_DECIDES',
      source: dataFeed.source,
      instrument: dataFeed.instrument,
      realtimeReceivedAt: liveData.updatedAt,
      liveAgeMs,
      currentPrice: Number.isFinite(currentPrice) ? currentPrice : null,
      memory: {
        historicalStore: 'SUPABASE',
        realtimeStore: 'UPSTASH_REDIS',
        upstashConfigured: previousMemory.configured,
        rawHistoricalCandlesSentToModel: false,
        fullHistoricalDataPersisted: true
      },
      analysis
    });
  } catch (error) {
    return res.status(502).json({
      ok: false, stage: 'ANALYSIS',
      error: error?.name === 'AbortError' ? 'AI analysis request timed out after 55 seconds' : error?.message || String(error),
      decisionGenerated: false
    });
  } finally {
    clearTimeout(timeout);
  }
}
