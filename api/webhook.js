export default async function handler(req, res) {
  if (req.method === 'GET') {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const params = new URLSearchParams({
        category: 'linear',
        symbol: 'ETHUSDT',
        interval: '15',
        limit: '100'
      });

      const url = `https://api.bybit.com/v5/market/kline?${params.toString()}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json'
        },
        cache: 'no-store',
        signal: controller.signal
      });

      const text = await response.text();
      let data;

      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }

      if (!response.ok || !data || data.retCode !== 0) {
        console.error('Bybit HTTP/API error:', {
          status: response.status,
          statusText: response.statusText,
          body: text.slice(0, 1000)
        });

        return res.status(502).json({
          ok: false,
          source: 'bybit',
          httpStatus: response.status,
          error: data?.retMsg || `Bybit HTTP ${response.status} ${response.statusText}`,
          detail: data ? undefined : text.slice(0, 500)
        });
      }

      const list = data?.result?.list;

      if (!Array.isArray(list)) {
        return res.status(502).json({
          ok: false,
          source: 'bybit',
          error: 'Bybit returned an unexpected response format'
        });
      }

      const candles = list
        .reverse()
        .map(candle => ({
          time: Number(candle[0]),
          open: Number(candle[1]),
          high: Number(candle[2]),
          low: Number(candle[3]),
          close: Number(candle[4]),
          volume: Number(candle[5]),
          turnover: Number(candle[6])
        }));

      return res.status(200).json({
        ok: true,
        source: 'Bybit',
        symbol: 'ETHUSDT',
        timeframe: '15m',
        candlesReturned: candles.length,
        candles
      });
    } catch (error) {
      console.error('Bybit connection error:', error);

      return res.status(502).json({
        ok: false,
        source: 'bybit',
        error: error?.name === 'AbortError'
          ? 'Bybit request timed out after 10 seconds'
          : 'Failed to connect to Bybit',
        detail: error?.message || String(error)
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  return res.status(405).json({
    ok: false,
    error: 'Method not allowed'
  });
}
