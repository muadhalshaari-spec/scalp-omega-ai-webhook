export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const instId = 'ETH-USDT-SWAP';
  const bars = [
    ['1m', 300],
    ['5m', 300],
    ['15m', 300],
    ['1H', 300],
    ['4H', 300],
    ['1D', 300]
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  const fetchJson = async url => {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': 'SCALP-Omega-DataEngine/1.0' },
      cache: 'no-store',
      signal: controller.signal
    });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    if (!response.ok || data?.code !== '0') {
      throw new Error(`OKX HTTP ${response.status}: ${data?.msg || text.slice(0, 200)}`);
    }
    return data;
  };

  const normalizeCandles = rows => rows
    .map(c => ({
      time: Number(c[0]),
      open: Number(c[1]),
      high: Number(c[2]),
      low: Number(c[3]),
      close: Number(c[4]),
      volume: Number(c[5]),
      volumeBase: Number(c[6]),
      volumeQuote: Number(c[7]),
      confirmed: c[8] === '1'
    }))
    .reverse();

  try {
    const candleResults = await Promise.all(
      bars.map(async ([bar, limit]) => {
        const data = await fetchJson(
          `https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=${limit}`
        );
        return [bar, normalizeCandles(data.data)];
      })
    );

    const [tickerData, oiData, fundingData, bookData] = await Promise.all([
      fetchJson(`https://www.okx.com/api/v5/market/ticker?instId=${instId}`),
      fetchJson(`https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=${instId}`),
      fetchJson(`https://www.okx.com/api/v5/public/funding-rate?instId=${instId}`),
      fetchJson(`https://www.okx.com/api/v5/market/books?instId=${instId}&sz=20`)
    ]);

    const ticker = tickerData.data?.[0] || null;
    const oi = oiData.data?.[0] || null;
    const funding = fundingData.data?.[0] || null;
    const book = bookData.data?.[0] || null;

    const orderBook = book ? {
      time: Number(book.ts),
      bids: (book.bids || []).map(x => ({ price: Number(x[0]), size: Number(x[1]), orders: Number(x[3] || 0) })),
      asks: (book.asks || []).map(x => ({ price: Number(x[0]), size: Number(x[1]), orders: Number(x[3] || 0) }))
    } : null;

    return res.status(200).json({
      ok: true,
      source: 'OKX',
      instrument: instId,
      marketType: 'USDT perpetual swap',
      fetchedAt: new Date().toISOString(),
      ticker: ticker ? {
        last: Number(ticker.last),
        bid: Number(ticker.bidPx),
        ask: Number(ticker.askPx),
        high24h: Number(ticker.high24h),
        low24h: Number(ticker.low24h),
        volume24h: Number(ticker.vol24h),
        volume24hBase: Number(ticker.volCcy24h),
        ts: Number(ticker.ts)
      } : null,
      openInterest: oi ? {
        oi: Number(oi.oi),
        oiCcy: Number(oi.oiCcy),
        ts: Number(oi.ts)
      } : null,
      funding: funding ? {
        fundingRate: Number(funding.fundingRate),
        nextFundingRate: funding.nextFundingRate ? Number(funding.nextFundingRate) : null,
        fundingTime: Number(funding.fundingTime),
        nextFundingTime: Number(funding.nextFundingTime)
      } : null,
      orderBook,
      candles: Object.fromEntries(candleResults),
      counts: Object.fromEntries(candleResults.map(([bar, data]) => [bar, data.length]))
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      source: 'OKX',
      error: error?.name === 'AbortError' ? 'OKX request timed out after 15 seconds' : error?.message || String(error)
    });
  } finally {
    clearTimeout(timeout);
  }
}
