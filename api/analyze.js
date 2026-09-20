export const maxDuration = 60;

const LIVE_MAX_AGE_MS = 30_000;

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
  const timeout = setTimeout(() => controller.abort(), 45000);

  try {
    const [marketResponse, liveResponse] = await Promise.all([
      fetch(`${baseUrl}/api/confluence?ts=${Date.now()}`, {
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

    const marketText = await marketResponse.text();
    const liveText = await liveResponse.text();
    let marketData = null;
    let liveData = null;
    try { marketData = JSON.parse(marketText); } catch {}
    try { liveData = JSON.parse(liveText); } catch {}

    if (!marketResponse.ok || !marketData?.ok) {
      return res.status(502).json({
        ok: false,
        stage: 'CONFLUENCE',
        error: marketData?.error || marketText.slice(0, 500)
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
    const liveAgeMs = Number.isFinite(liveUpdatedAt) ? Math.max(0, Date.now() - liveUpdatedAt) : null;

    if (!liveData.connected || liveAgeMs == null || liveAgeMs > LIVE_MAX_AGE_MS) {
      return res.status(503).json({
        ok: false,
        stage: 'LIVE_MARKET_DATA',
        error: 'Live market state is stale or disconnected; no live trading decision was generated.',
        live: {
          connected: Boolean(liveData.connected),
          updatedAt: liveData.updatedAt || null,
          ageMs: liveAgeMs,
          maxAgeMs: LIVE_MAX_AGE_MS
        }
      });
    }

    const livePrice = liveData.ticker?.last != null ? Number(liveData.ticker.last) : null;

    const institutional = marketData.institutional || null;
    const deterministicDecision = institutional?.decision || marketData.confluence?.directionBias || 'NO_TRADE';

    const compactProvider = (p) => p ? ({
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
    }) : null;

    const compactInstitutional = institutional ? {
      version: institutional.version,
      decision: institutional.decision,
      deterministicDecision: institutional.deterministicDecision,
      titanDecision: institutional.titanDecision,
      probability: institutional.probability,
      setup: institutional.setup,
      setupCandidates: Array.isArray(institutional.setupCandidates) ? institutional.setupCandidates.slice(0, 3) : [],
      regime: institutional.regime,
      structure: institutional.structure,
      structure1H: institutional.structure1H,
      liquidity: institutional.liquidity,
      zones: institutional.zones,
      sequence: institutional.sequence,
      micro: institutional.micro,
      derivatives: institutional.derivatives ? {
        pressure: institutional.derivatives.pressure,
        openInterest: institutional.derivatives.openInterest,
        funding: institutional.derivatives.funding,
        oi: institutional.derivatives.oi,
        taker: institutional.derivatives.taker,
        longShort: institutional.derivatives.longShort
      } : null,
      eventRisk: institutional.eventRisk,
      risk: institutional.risk,
      executionPlan: institutional.executionPlan,
      ensemble: institutional.ensemble,
      meta: institutional.meta,
      externalIntelligence: institutional.externalIntelligence ? {
        ok: institutional.externalIntelligence.ok,
        fetchedAt: institutional.externalIntelligence.fetchedAt,
        crossExchange: institutional.externalIntelligence.crossExchange,
        featureSignals: institutional.externalIntelligence.featureSignals,
        dataQuality: institutional.externalIntelligence.dataQuality,
        providers: Object.fromEntries(Object.entries(institutional.externalIntelligence.providers || {}).map(([k,v]) => [k, compactProvider(v)]))
      } : null,
      titan: institutional.titan ? {
        engine: institutional.titan.engine,
        version: institutional.titan.version,
        decision: institutional.titan.decision,
        baseDecision: institutional.titan.baseDecision,
        supportDirection: institutional.titan.supportDirection,
        blocked: institutional.titan.blocked,
        blockers: institutional.titan.blockers,
        score: institutional.titan.score,
        confidence: institutional.titan.confidence,
        summary: institutional.titan.summary,
        traces: Array.isArray(institutional.titan.traces) ? institutional.titan.traces : []
      } : null
    } : null;

    const externalRaw = marketData.externalIntelligence || marketData.market?.externalIntelligence || null;
    const compactExternal = externalRaw ? {
      ok: externalRaw.ok,
      fetchedAt: externalRaw.fetchedAt,
      crossExchange: externalRaw.crossExchange,
      featureSignals: externalRaw.featureSignals,
      dataQuality: externalRaw.dataQuality,
      providers: Object.fromEntries(Object.entries(externalRaw.providers || {}).map(([k,v]) => [k, compactProvider(v)]))
    } : null;

    const trimBook = (book) => book ? {
      time: book.time ?? null,
      bids: Array.isArray(book.bids) ? book.bids.slice(0, 10) : [],
      asks: Array.isArray(book.asks) ? book.asks.slice(0, 10) : []
    } : null;

    const aiInput = {
      engine: marketData.engine,
      source: marketData.source,
      instrument: marketData.instrument,
      analysisMode: marketData.analysisMode,
      fetchedAt: marketData.fetchedAt,
      market: {
        price: marketData.market?.price ?? null,
        openInterest: marketData.market?.openInterest ?? null,
        fundingRate: marketData.market?.fundingRate ?? null,
        fundingTime: marketData.market?.fundingTime ?? null,
        nextFundingTime: marketData.market?.nextFundingTime ?? null,
        nextFundingRate: marketData.market?.nextFundingRate ?? null
      },
      confluence: marketData.confluence,
      institutional: compactInstitutional,
      deterministicDecision,
      externalIntelligence: compactExternal,
      dataQuality: marketData.dataQuality,
      featureSummary: marketData.featureSummary,
      realtime: {
        source: liveData.source,
        receivedAt: liveData.updatedAt,
        connected: liveData.connected,
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

    const systemPrompt = `You are the reasoning layer of SCALP-Ω, an institutional-style crypto market analysis engine.

Analyze ETH-USDT-SWAP using only the supplied market data. Do not invent missing data. The institutional engine is the deterministic gate; treat its decision and no-trade reasons as hard constraints for the final trading decision.

DATA PRIORITY:
1. realtime.ticker is the freshest current price snapshot.
2. realtime.latestTrade and realtime.orderBook describe current microstructure.
3. realtime.candles may contain an in-progress candle and must NOT be used as a confirmed signal.
4. confluence and featureSummary are closed-candle-only confirmation and are authoritative for non-repainting setup confirmation.

Never report the confluence fetchedAt time as the current market time. The current live timestamp is realtime.receivedAt. The live state has already passed a freshness gate before reaching you.

Your job is to produce a disciplined trading decision:
- LONG, SHORT, or NO_TRADE.
- The final decision MUST equal deterministicDecision. GPT is the reasoning/explanation layer, not the signal-generator override.
- Never force a trade when higher-timeframe structure conflicts with execution structure.
- A score is evidence, not a probability of winning.
- Prefer NO_TRADE when evidence is insufficient or contradictory.
- If LONG or SHORT is justified, audit the supplied executionPlan first. It is deterministic and must not be replaced by invented levels. Explain Market vs Limit vs Stop, entry zone, structural SL, TP1-3, expiry and invalidation only from supplied data.
- Historical analogs and cross-exchange data are contextual evidence; never treat unavailable providers as confirmed evidence.
- Distinguish confirmed facts from conditions that must happen before entry.
- The system is non-repainting: closed-candle information controls confirmation.

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

The confidence value is an internal evidence-strength score from 0 to 100, not a win probability. If institutional.probability.probabilityKind is MODEL_ESTIMATE, explicitly state that it is not a validated win probability. Never convert confidence or score into probability.`;

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
        max_output_tokens: 1800,
        text: { format: { type: 'json_object' } }
      }),
      signal: controller.signal
    });

    const openaiText = await openaiResponse.text();
    let openaiData = null;
    try { openaiData = JSON.parse(openaiText); } catch {}

    if (!openaiResponse.ok) {
      return res.status(502).json({
        ok: false,
        stage: 'OPENAI',
        error: openaiData?.error?.message || openaiText.slice(0, 1000)
      });
    }

    const outputText = openaiData?.output_text ||
      openaiData?.output?.flatMap(item => item.content || [])
        ?.map(item => item.text)
        ?.filter(Boolean)
        ?.join('') || '';

    let analysis = null;
    try { analysis = JSON.parse(outputText); } catch {}

    if (!analysis) {
      return res.status(502).json({
        ok: false,
        stage: 'OPENAI_PARSE',
        error: 'OpenAI returned a response that was not valid JSON',
        rawOutput: outputText.slice(0, 5000)
      });
    }

    const result = {
      ok: true,
      engine: 'SCALP-Ω GPT-5.6 Luna Analysis Engine v4 LIVE',
      model: 'gpt-5.6-luna',
      source: 'OKX',
      instrument: marketData.instrument,
      fetchedAt: marketData.fetchedAt,
      realtimeReceivedAt: liveData.updatedAt,
      liveAgeMs,
      currentPrice: livePrice,
      realtime: liveData,
      deterministicConfluence: marketData.confluence,
      institutionalDecision: deterministicDecision,
      institutional,
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
      error: error?.name === 'AbortError' ? 'Analysis request timed out after 45 seconds' : error?.message || String(error)
    });
  } finally {
    clearTimeout(timeout);
  }
}
