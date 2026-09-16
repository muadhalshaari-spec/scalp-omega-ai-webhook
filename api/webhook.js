export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      service: 'SCALP-Ω AI Webhook',
      status: 'online'
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      ok: false,
      error: 'Method not allowed'
    });
  }

  try {
    // ==============================
    // 1. Webhook authentication
    // ==============================
    const configuredSecret = process.env.WEBHOOK_SECRET;
    const suppliedSecret = req.query?.secret;

    if (!configuredSecret || suppliedSecret !== configuredSecret) {
      return res.status(401).json({
        ok: false,
        error: 'Unauthorized'
      });
    }

    // ==============================
    // 2. Check OpenAI API key
    // ==============================
    const openaiKey = process.env.OPENAI_API_KEY;

    if (!openaiKey) {
      return res.status(500).json({
        ok: false,
        error: 'OPENAI_API_KEY is not configured'
      });
    }

    // ==============================
    // 3. Receive TradingView data
    // ==============================
    const body = req.body ?? {};

    // Never log secrets
    console.log('TradingView webhook received:', body);

    // ==============================
    // 4. Send data to GPT-5.6 Luna
    // ==============================
    const openaiResponse = await fetch(
      'https://api.openai.com/v1/responses',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-5.6-luna',

          instructions: `
You are SCALP-Ω AI Engine.

Analyze the trading data provided by the webhook.

For this connection test:
1. Confirm that you received the market data.
2. Identify the symbol if available.
3. Identify the timeframe if available.
4. Identify the signal if available.
5. Identify the current price if available.
6. Give a short technical observation.

Do not invent missing data.
If a field is missing, explicitly say it is unavailable.
`,

          input: JSON.stringify(body)
        })
      }
    );

    // ==============================
    // 5. Handle OpenAI errors
    // ==============================
    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();

      console.error('OpenAI API error:', errorText);

      return res.status(502).json({
        ok: false,
        error: 'OpenAI API request failed'
      });
    }

    // ==============================
    // 6. Read OpenAI response
    // ==============================
    const aiData = await openaiResponse.json();

    let analysis = '';

    if (typeof aiData.output_text === 'string') {
      analysis = aiData.output_text;
    } else if (Array.isArray(aiData.output)) {
      analysis = aiData.output
        .flatMap(item => item.content ?? [])
        .filter(item => item.type === 'output_text')
        .map(item => item.text)
        .join('\n');
    }

    // ==============================
    // 7. Return result
    // ==============================
    return res.status(200).json({
      ok: true,
      received: true,
      model: 'gpt-5.6-luna',
      analysis,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Webhook error:', error);

    return res.status(500).json({
      ok: false,
      error: 'Internal server error'
    });
  }
}
