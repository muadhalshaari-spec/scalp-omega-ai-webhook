export const maxDuration = 60;

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
      fetch(`${baseUrl}/api/confluence`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal
      }),
      fetch(`${baseUrl}/api/live-snapshot`, {
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

    const aiInput = {
      engine: marketData.engine,
      source: marketData.source,
      instrument: marketData.instrument,
      analysisMode: marketData.analysisMode,
      fetchedAt: marketData.fetchedAt,
      market: marketData.market,
      confluence: marketData.confluence,
      dataQuality: marketData.dataQuality,
      featureSummary: marketData.featureSummary,
      realtime: {
        source: liveData.source,
        receivedAt: liveData.receivedAt,
        ticker: liveData.ticker,
        latestTrade: liveData.latestTrade,
        orderBook: liveData.orderBook,
        candles: liveData.candles
      }
    };

    const systemPrompt = `You are the reasoning layer of SCALP-Ω, an institutional-style crypto market analysis engine.

Analyze ETH-USDT-SWAP using only the supplied market data. Do not invent missing data. Treat the deterministic confluence engine as evidence, not as truth.

The realtime block is the freshest market snapshot and may contain an in-progress candle. Never treat an in-progress candle as a confirmed closed-candle signal. Use confirmed featureSummary/confluence for non-repainting decisions, while using realtime data to identify current price, order-book pressure, and immediate microstructure.

Your job is to produce a disciplined trading decision:
- LONG, SHORT, or NO_TRADE.
- Never force a trade when higher-timeframe structure conflicts with execution structure.
- A score is evidence, not a probability of winning.
- Prefer NO_TRADE when evidence is insufficient or contradictory.
- If LONG or SHORT is justified, define setup conditions, entry logic, invalidation, stop-loss logic, and target logic only from supplied levels/features. Do not invent an exact price level unless it can be derived from supplied data.
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

The confidence value is an internal evidence-strength score from 0 to 100, not a win probability.`;

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

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    return res.status(200).send(JSON.stringify({
      ok: true,
      engine: 'SCALP-Ω GPT-5.6 Luna Analysis Engine v2 LIVE',
      model: 'gpt-5.6-luna',
      source: 'OKX',
      instrument: marketData.instrument,
      fetchedAt: marketData.fetchedAt,
      realtimeReceivedAt: liveData.receivedAt,
      realtime: liveData,
      deterministicConfluence: marketData.confluence,
      analysis
    }, null, 2));
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
