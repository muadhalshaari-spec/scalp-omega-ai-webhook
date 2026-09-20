export const maxDuration = 60;

const LIVE_MAX_AGE_MS = 30_000;

function compactProvider(p) {
  return p ? {
    available: p.available === true,
    source: p.source || null,
    timestamp: p.timestamp || null,
    price: p.price ?? null,
    markPrice: p.markPrice ?? null,
    indexPrice: p.indexPrice ?? null,
    fundingRate: p.fundingRate ?? p.currentFunding ?? null,
    nextFundingRate: p.nextFundingRate ?? null,
    openInterest: p.openInterest ?? null,
    book: p.book ? {
      bestBid: p.book.bestBid ?? null,
      bestAsk: p.book.bestAsk ?? null,
      mid: p.book.mid ?? null,
      spread: p.book.spread ?? null,
      spreadBps: p.book.spreadBps ?? null,
      bidDepth: p.book.bidDepth ?? null,
      askDepth: p.book.askDepth ?? null,
      imbalance: p.book.imbalance ?? null
    } : null,
    options: p.options ? {
      instrumentCount: p.options.instrumentCount ?? null,
      totalOI: p.options.totalOI ?? null,
      callOI: p.options.callOI ?? null,
      putOI: p.options.putOI ?? null,
      putCallOI: p.options.putCallOI ?? null,
      weightedIV: p.options.weightedIV ?? null,
      topExpiries: Array.isArray(p.options.topExpiries) ? p.options.topExpiries.slice(0, 6) : []
    } : null
  } : null;
}

function trimBook(book) {
  return book ? {
    time: book.time ?? null,
    seqId: book.seqId ?? null,
    bids: Array.isArray(book.bids) ? book.bids.slice(0, 20) : [],
    asks: Array.isArray(book.asks) ? book.asks.slice(0, 20) : []
  } : null;
}

function buildAiInput(dataFeed, liveData) {
  const externalRaw = dataFeed.externalIntelligence || dataFeed.market?.externalIntelligence || null;

  const compactExternal = externalRaw ? {
    ok: externalRaw.ok,
    fetchedAt: externalRaw.fetchedAt,
    crossExchange: externalRaw.crossExchange,
    featureSignals: externalRaw.featureSignals,
    dataQuality: externalRaw.dataQuality,
    providers: Object.fromEntries(
      Object.entries(externalRaw.providers || {}).map(([k, v]) => [k, compactProvider(v)])
    )
  } : null;

  const market = dataFeed.market || {};

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
    externalIntelligence: compactExternal,
    dataQuality: dataFeed.dataQuality || {},
    featureSummary: dataFeed.featureSummary || {},
    realtime: {
      source: liveData.source || null,
      receivedAt: liveData.updatedAt || null,
      connected: liveData.connected === true,
      ticker: liveData.ticker ? {
        last: liveData.ticker.last ?? null,
        bid: liveData.ticker.bid ?? null,
        ask: liveData.ticker.ask ?? null,
        markPrice: liveData.ticker.markPrice ?? null
      } : null,
      latestTrade: liveData.latestTrade || null,
      orderBook: trimBook(liveData.orderBook)
    }
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ ok: false, error: 'OPENAI_API_KEY is not configured' });
  }

  const baseUrl = `https://${req.headers.host}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55_000);

  try {
    const [dataResponse, liveResponse] = await Promise.all([
      fetch(`${baseUrl}/api/institutional?ts=${Date.now()}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal
      }),
      fetch(`${baseUrl}/api/live-state?ts=${Date.now()}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal
      })
    ]);

    const dataText = await dataResponse.text();
    const liveText = await liveResponse.text();

    let dataFeed = null;
    let liveData = null;

    try { dataFeed = JSON.parse(dataText); } catch {}
    try { liveData = JSON.parse(liveText); } catch {}

    if (!dataResponse.ok || !dataFeed?.ok) {
      return res.status(502).json({
        ok: false,
        stage: 'DATA_FEED',
        error: dataFeed?.error || dataText.slice(0, 500)
      });
    }

    if (!liveResponse.ok || !liveData?.ok) {
      return res.status(502).json({
        ok: false,
        stage: 'LIVE_MARKET_DATA',
        error: liveData?.error || liveText.slice(0, 500)
      });
    }

    const liveUpdatedAt = Date.parse(liveData.updatedAt || '');
    const liveAgeMs = Number.isFinite(liveUpdatedAt)
      ? Math.max(0, Date.now() - liveUpdatedAt)
      : null;

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

    const aiInput = buildAiInput(dataFeed, liveData);

    const systemPrompt = `You are the sole trading-decision and reasoning layer for SCALP-Ω.

The upstream SCALP-Ω application is DATA-ONLY. It collects, normalizes, and calculates market observations/features, but it does NOT authorize or generate trading decisions for you.

DECISION AUTHORITY:
- The final trading decision belongs to you (GPT) only.
- Do not copy, inherit, obey, or treat any upstream decision/signal/probability/risk gate as authoritative.
- The upstream feed is evidence only.
- You may independently conclude LONG, SHORT, or NO_TRADE from the supplied data.
- Never claim that the SCALP-Ω data engine made the decision.
- Never convert a model score into a win probability.
- Do not invent unavailable data.

DATA PRIORITY:
1. realtime.ticker is the freshest current price snapshot.
2. realtime.latestTrade and realtime.orderBook describe current microstructure.
3. market.candlesByTf contains historical OHLCV; use confirmed/closed candles for structural confirmation.
4. features and featureSummary are calculated observations derived from closed candles.
5. market.candlesByExchange provides cross-exchange context.
6. derivatives, liquidations, funding, open-interest, taker-volume, and externalIntelligence are contextual evidence and must be checked for freshness/availability.

ANALYSIS STANDARD:
- Analyze ETH-USDT-SWAP using the entire supplied evidence set.
- Use 1D, 4H, 1H for regime/context and 15m, 5m, 1m for execution.
- Inspect structure, trend, liquidity, support/resistance, supply/demand, volatility, momentum, volume, derivatives, order-book imbalance, trade flow, liquidations, and cross-exchange agreement where data exists.
- Do not use an in-progress candle as confirmed structural evidence.
- Distinguish facts, conditions, and your own inference.
- A trade is allowed only when the evidence supports an executable plan; otherwise return NO_TRADE.
- If LONG or SHORT, give a precise entry method and exact levels only when they are supported by the supplied market structure/data.
- Use a structural invalidation for the stop. Targets must be consistent with nearby liquidity/structure and current volatility.
- Never manufacture a level merely to satisfy the requested format.

Return strict JSON with exactly these keys:
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
}

The confidence value is an evidence-strength score from 0 to 100, NOT a validated probability of profit or win rate.`;

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
      const message = openaiData?.error?.message || openaiText.slice(0, 1000);
      return res.status(openaiResponse.status === 429 ? 429 : 502).json({
        ok: false,
        stage: 'OPENAI',
        error: message,
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
        decisionGenerated: false,
        rawOutput: outputText.slice(0, 5000)
      });
    }

    const result = {
      ok: true,
      engine: 'SCALP-Ω GPT-5.6 Luna Decision Layer v1',
      model: 'gpt-5.6-luna',
      decisionAuthority: 'CHATGPT_ONLY',
      decisionPolicy: 'UPSTREAM_DATA_ONLY_GPT_DECIDES',
      source: dataFeed.source,
      instrument: dataFeed.instrument,
      dataFetchedAt: dataFeed.fetchedAt,
      realtimeReceivedAt: liveData.updatedAt,
      liveAgeMs,
      currentPrice: liveData.ticker?.last != null ? Number(liveData.ticker.last) : null,
      dataFeed,
      realtime: liveData,
      analysis
    };

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store');

    return res.status(200).send(JSON.stringify(result, null, 2));
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
