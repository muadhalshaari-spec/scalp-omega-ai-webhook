export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({
      ok: false,
      error: 'Method not allowed'
    });
  }

  const tests = [
    {
      name: 'main-bybit-kline',
      url: 'https://api.bybit.com/v5/market/kline?category=linear&symbol=ETHUSDT&interval=15&limit=1'
    },
    {
      name: 'main-bytick-kline',
      url: 'https://api.bytick.com/v5/market/kline?category=linear&symbol=ETHUSDT&interval=15&limit=1'
    },
    {
      name: 'main-bybit-server-time',
      url: 'https://api.bybit.com/v5/market/time'
    },
    {
      name: 'main-bytick-server-time',
      url: 'https://api.bytick.com/v5/market/time'
    },
    {
      name: 'demo-server-time',
      url: 'https://api-demo.bybit.com/v5/market/time'
    },
    {
      name: 'testnet-server-time',
      url: 'https://api-testnet.bybit.com/v5/market/time'
    }
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const results = await Promise.all(
      tests.map(async test => {
        const started = Date.now();

        try {
          const response = await fetch(test.url, {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              'User-Agent': 'SCALP-Omega-Diagnostic/1.0'
            },
            cache: 'no-store',
            signal: controller.signal
          });

          const text = await response.text();
          let data = null;

          try {
            data = JSON.parse(text);
          } catch {}

          return {
            name: test.name,
            url: test.url,
            httpStatus: response.status,
            statusText: response.statusText,
            retCode: data?.retCode ?? null,
            retMsg: data?.retMsg ?? null,
            success: response.ok && data?.retCode === 0,
            elapsedMs: Date.now() - started,
            bodyPreview: text.slice(0, 300)
          };
        } catch (error) {
          return {
            name: test.name,
            url: test.url,
            httpStatus: null,
            statusText: null,
            retCode: null,
            retMsg: null,
            success: false,
            elapsedMs: Date.now() - started,
            error: error?.name === 'AbortError'
              ? 'Request timed out'
              : error?.message || String(error)
          };
        }
      })
    );

    const successful = results.filter(result => result.success);

    return res.status(200).json({
      ok: successful.length > 0,
      source: 'Bybit',
      diagnostic: true,
      successfulEndpoints: successful.map(result => result.name),
      tests: results,
      conclusion: successful.length > 0
        ? 'At least one Bybit endpoint is reachable from Vercel.'
        : 'No tested Bybit endpoint returned a successful public response from Vercel.'
    });
  } finally {
    clearTimeout(timeout);
  }
}
