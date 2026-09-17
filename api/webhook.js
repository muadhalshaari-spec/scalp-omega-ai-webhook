export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const response = await fetch(
        'https://api.bybit.com/v5/market/kline?category=linear&symbol=ETHUSDT&interval=15&limit=100'
      );

      const data = await response.json();

      if (!response.ok || data.retCode !== 0) {
        return res.status(502).json({
          ok: false,
          source: 'bybit',
          error: data.retMsg || 'Bybit request failed'
        });
      }

      const candles = data.result.list
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
      console.error('Bybit error:', error);

      return res.status(502).json({
        ok: false,
        source: 'bybit',
        error: 'Failed to connect to Bybit'
      });
    }
  }

  return res.status(405).json({
    ok: false,
    error: 'Method not allowed'
  });
}
