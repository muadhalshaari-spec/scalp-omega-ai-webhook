import { buildMarketContext } from '../lib/scalp-engine.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const instId = 'ETH-USDT-SWAP';
  const bars = ['1m', '5m', '15m', '1H', '4H', '1D'];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  const fetchJson = async url => {
    const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'SCALP-Omega-ContextEngine/1.0' }, cache: 'no-store', signal: controller.signal });
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    if (!r.ok || data?.code !== '0') throw new Error(`OKX HTTP ${r.status}: ${data?.msg || text.slice(0, 200)}`);
    return data;
  };

  const normalize = rows => rows.map(c => ({
    time: Number(c[0]), open: Number(c[1]), high: Number(c[2]), low: Number(c[3]), close: Number(c[4]),
    volume: Number(c[5]), volumeBase: Number(c[6]), volumeQuote: Number(c[7]), confirmed: c[8] === '1'
  })).reverse();

  try {
    const results = await Promise.all(bars.map(async bar => {
      const data = await fetchJson(`https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=300`);
      return [bar, normalize(data.data)];
    }));
    const [tickerData, bookData, oiData, fundingData] = await Promise.all([
      fetchJson(`https://www.okx.com/api/v5/market/ticker?instId=${instId}`),
      fetchJson(`https://www.okx.com/api/v5/market/books?instId=${instId}&sz=20`),
      fetchJson(`https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=${instId}`),
      fetchJson(`https://www.okx.com/api/v5/public/funding-rate?instId=${instId}`)
    ]);

    const ticker = tickerData.data?.[0] || null;
    const book = bookData.data?.[0] || null;
    const orderBook = book ? {
      time: Number(book.ts),
      bids: (book.bids || []).map(x => ({ price: Number(x[0]), size: Number(x[1]), orders: Number(x[3] || 0) })),
      asks: (book.asks || []).map(x => ({ price: Number(x[0]), size: Number(x[1]), orders: Number(x[3] || 0) }))
    } : null;

    const candles = Object.fromEntries(results);
    const context = Object.fromEntries(results.map(([bar, data]) => [bar, buildMarketContext(data, orderBook)]));

    return res.status(200).json({
      ok: true,
      engine: 'SCALP-Ω Structure + Liquidity Engine v1',
      source: 'OKX',
      instrument: instId,
      price: ticker ? Number(ticker.last) : null,
      openInterest: oiData.data?.[0] ? Number(oiData.data[0].oi) : null,
      fundingRate: fundingData.data?.[0] ? Number(fundingData.data[0].fundingRate) : null,
      context,
      counts: Object.fromEntries(results.map(([bar, data]) => [bar, data.length]))
    });
  } catch (error) {
    return res.status(502).json({ ok: false, source: 'OKX', error: error?.name === 'AbortError' ? 'OKX request timed out after 15 seconds' : error?.message || String(error) });
  } finally {
    clearTimeout(timeout);
  }
}
