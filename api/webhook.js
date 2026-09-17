export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({
      ok: false,
      error: 'Method not allowed'
    });
  }

  const tests = [
    {
      name: 'binance-usdm-futures-ethusdt',
      source: 'Binance USDⓈ-M Futures',
      url: 'https://fapi.binance.com/fapi/v1/klines?symbol=ETHUSDT&interval=15m&limit=100'
    },
    {
      name: 'binance-spot-ethusdt',
      source: 'Binance Spot',
      url: 'https://api.binance.com/api/v3/klines?symbol=ETHUSDT&interval=15m&limit=100'
    },
    {
      name: 'binance-usdm-server-time',
      source: 'Binance USDⓈ-M Futures',
      url: 'https://fapi.binance.com/fapi/v1/time'
    },
    {
      name: 'binance-spot-server-time',
      source: 'Binance Spot',
      url: 'https://api.binance.com/api/v3/time'
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

          const isKline = test.name.includes('ethusdt');
          const success = response.ok && (
            isKline
              ? Array.isArray(data) && data.length > 0
              : typeof data?.serverTime === 'number'
          );

          return {
            name: test.name,
            source: test.source,
            url: test.url,
            httpStatus: response.status,
            statusText: response.statusText,
            success,
            candlesReturned: isKline && Array.isArray(data) ? data.length : null,
            serverTime: !isKline ? data?.serverTime ?? null : null,
            latestCandle: isKline && Array.isArray(data) && data.length > 0
              ? {
                  time: Number(data[data.length - 1][0]),
                  open: Number(data[data.length - 1][1]),
                  high: Number(data[data.length - 1][2]),
                  low: Number(data[data.length - 1][3]),
                  close: Number(data[data.length - 1][4]),
                  volume: Number(data[data.length - 1][5])
                }
              : null,
            elapsedMs: Date.now() - started,
            bodyPreview: text.slice(0, 300)
          };
        } catch (error) {
          return {
            name: test.name,
            source: test.source,
            url: test.url,
            httpStatus: null,
            statusText: null,
            success: false,
            candlesReturned: null,
            serverTime: null,
            latestCandle: null,
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
      source: 'Binance',
      diagnostic: true,
      successfulEndpoints: successful.map(result => result.name),
      tests: results,
      conclusion: successful.length > 0
        ? 'At least one Binance public market-data endpoint is reachable from Vercel.'
        : 'No tested Binance public market-data endpoint returned a successful response from Vercel.'
    });
  } finally {
    clearTimeout(timeout);
  }
}
