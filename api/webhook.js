export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const tests = [
    { name: 'okx-swap-ethusdt', source: 'OKX SWAP', url: 'https://www.okx.com/api/v5/market/candles?instId=ETH-USDT-SWAP&bar=15m&limit=100' },
    { name: 'okx-spot-ethusdt', source: 'OKX Spot', url: 'https://www.okx.com/api/v5/market/candles?instId=ETH-USDT&bar=15m&limit=100' },
    { name: 'kucoin-spot-ethusdt', source: 'KuCoin Spot', url: 'https://api.kucoin.com/api/v1/market/candles?symbol=ETH-USDT&type=15min' },
    { name: 'gate-spot-ethusdt', source: 'Gate Spot', url: 'https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=ETH_USDT&interval=15m&limit=100' },
    { name: 'gate-futures-ticker', source: 'Gate Futures', url: 'https://fx-api.gateio.ws/api/v4/futures/usdt/tickers' }
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const results = await Promise.all(tests.map(async test => {
      const started = Date.now();
      try {
        const response = await fetch(test.url, {
          method: 'GET',
          headers: { Accept: 'application/json', 'User-Agent': 'SCALP-Omega-Diagnostic/1.0' },
          cache: 'no-store',
          signal: controller.signal
        });
        const text = await response.text();
        let data = null;
        try { data = JSON.parse(text); } catch {}

        let success = false;
        let latestCandle = null;
        let candlesReturned = null;

        if (test.name.startsWith('okx-')) {
          candlesReturned = Array.isArray(data?.data) ? data.data.length : null;
          success = response.ok && data?.code === '0' && candlesReturned > 0;
          if (success) {
            const c = data.data[0];
            latestCandle = { time: Number(c[0]), open: Number(c[1]), high: Number(c[2]), low: Number(c[3]), close: Number(c[4]), volume: Number(c[5]) };
          }
        } else if (test.name === 'kucoin-spot-ethusdt') {
          candlesReturned = Array.isArray(data?.data) ? data.data.length : null;
          success = response.ok && data?.code === '200000' && candlesReturned > 0;
          if (success) {
            const c = data.data[0];
            latestCandle = { time: Number(c[0]) * 1000, open: Number(c[1]), close: Number(c[2]), high: Number(c[3]), low: Number(c[4]), volume: Number(c[5]) };
          }
        } else if (test.name === 'gate-spot-ethusdt') {
          candlesReturned = Array.isArray(data) ? data.length : null;
          success = response.ok && candlesReturned > 0;
          if (success) {
            const c = data[data.length - 1];
            latestCandle = { time: Number(c[0]) * 1000, volumeQuote: Number(c[1]), close: Number(c[2]), high: Number(c[3]), low: Number(c[4]), open: Number(c[5]), volumeBase: Number(c[6]) };
          }
        } else if (test.name === 'gate-futures-ticker') {
          success = response.ok && Array.isArray(data) && data.length > 0;
        }

        return { name: test.name, source: test.source, httpStatus: response.status, statusText: response.statusText, success, candlesReturned, latestCandle, elapsedMs: Date.now() - started, bodyPreview: text.slice(0, 500) };
      } catch (error) {
        return { name: test.name, source: test.source, httpStatus: null, statusText: null, success: false, candlesReturned: null, latestCandle: null, elapsedMs: Date.now() - started, error: error?.name === 'AbortError' ? 'Request timed out' : error?.message || String(error) };
      }
    }));

    const successful = results.filter(r => r.success);
    return res.status(200).json({
      ok: successful.length > 0,
      diagnostic: true,
      successfulEndpoints: successful.map(r => r.name),
      tests: results,
      conclusion: successful.length > 0 ? 'At least one alternative public crypto market-data endpoint is reachable from Vercel.' : 'No tested OKX, KuCoin, or Gate public endpoint returned a successful response from Vercel.'
    });
  } finally {
    clearTimeout(timeout);
  }
}
