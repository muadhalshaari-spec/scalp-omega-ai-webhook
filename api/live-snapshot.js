import WebSocket from 'ws';

export const maxDuration = 10;

const OKX_PUBLIC_WS = 'wss://ws.okx.com:8443/ws/v5/public';
const OKX_BUSINESS_WS = 'wss://ws.okx.com:8443/ws/v5/business';
const INST_ID = 'ETH-USDT-SWAP';

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function connectAndSubscribe(url, args) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const messages = [];
    let opened = false;
    let settled = false;

    const finish = (err = null) => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch {}
      if (err) reject(err);
      else resolve(messages);
    };

    const timer = setTimeout(() => finish(new Error('OKX WebSocket snapshot timeout')), 7000);

    ws.on('open', () => {
      opened = true;
      ws.send(JSON.stringify({ op: 'subscribe', args }));
    });

    ws.on('message', data => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg?.data?.length) messages.push(msg);
      } catch {}
    });

    ws.on('error', err => {
      clearTimeout(timer);
      finish(err);
    });

    ws.on('close', () => {
      clearTimeout(timer);
      if (!settled) {
        if (opened) finish();
        else finish(new Error('OKX WebSocket closed before connection'));
      }
    });

    setTimeout(() => {
      clearTimeout(timer);
      finish();
    }, 1200);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const publicArgs = [
      { channel: 'tickers', instId: INST_ID },
      { channel: 'trades', instId: INST_ID },
      { channel: 'books5', instId: INST_ID }
    ];

    const candleArgs = ['1m', '5m', '15m', '1H', '4H', '1D'].map(bar => ({
      channel: `candle${bar}`,
      instId: INST_ID
    }));

    const [publicMessages, candleMessages] = await Promise.all([
      connectAndSubscribe(OKX_PUBLIC_WS, publicArgs),
      connectAndSubscribe(OKX_BUSINESS_WS, candleArgs)
    ]);

    const all = [...publicMessages, ...candleMessages];
    const latest = {};

    for (const msg of all) {
      const channel = msg?.arg?.channel;
      if (!channel) continue;
      const row = msg.data?.[msg.data.length - 1];
      if (row) latest[channel] = row;
    }

    const ticker = latest.tickers || null;
    const trade = latest.trades || null;
    const book = latest.books5 || null;

    const candles = {};
    for (const tf of ['1m', '5m', '15m', '1H', '4H', '1D']) {
      candles[tf] = latest[`candle${tf}`] || null;
    }

    return res.status(200).json({
      ok: true,
      engine: 'SCALP-Ω Live Market Data Engine v1',
      source: 'OKX WebSocket',
      instrument: INST_ID,
      receivedAt: new Date().toISOString(),
      realtime: true,
      ticker,
      latestTrade: trade,
      orderBook: book,
      candles
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      engine: 'SCALP-Ω Live Market Data Engine v1',
      error: error?.message || String(error)
    });
  }
}
