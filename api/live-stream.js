import { createServer } from 'http';
import WebSocket, { WebSocketServer } from 'ws';

const OKX_PUBLIC_WS = 'wss://ws.okx.com:8443/ws/v5/public';
const OKX_BUSINESS_WS = 'wss://ws.okx.com:8443/ws/v5/business';
const INST_ID = 'ETH-USDT-SWAP';
const TIMEFRAMES = ['1m', '5m', '15m', '1H', '4H', '1D'];

let okxPublic = null;
let okxBusiness = null;
let reconnectTimer = null;
let heartbeatTimer = null;

const state = {
  ok: true,
  engine: 'SCALP-Ω Live Market Engine v2',
  source: 'OKX WebSocket',
  instrument: INST_ID,
  realtime: true,
  connected: false,
  updatedAt: null,
  ticker: null,
  latestTrade: null,
  orderBook: null,
  candles: Object.fromEntries(TIMEFRAMES.map(tf => [tf, null]))
};

const clients = new Set();

function broadcast() {
  const payload = JSON.stringify(state);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectOKX();
  }, 1500);
}

function closeSocket(ws) {
  try { ws?.removeAllListeners(); } catch {}
  try { ws?.close(); } catch {}
}

function connectSocket(url, args, kind) {
  const ws = new WebSocket(url);

  ws.on('open', () => {
    ws.send(JSON.stringify({ op: 'subscribe', args }));
    if (kind === 'public') okxPublic = ws;
    else okxBusiness = ws;
    state.connected = Boolean(okxPublic && okxBusiness);
    state.updatedAt = new Date().toISOString();
    broadcast();
  });

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw.toString());
      const channel = msg?.arg?.channel;
      const row = msg?.data?.[msg.data.length - 1];
      if (!channel || !row) return;

      if (channel === 'tickers') state.ticker = row;
      else if (channel === 'trades') state.latestTrade = row;
      else if (channel === 'books5') state.orderBook = row;
      else if (channel.startsWith('candle')) {
        const tf = channel.slice('candle'.length);
        if (TIMEFRAMES.includes(tf)) state.candles[tf] = row;
      }

      state.updatedAt = new Date().toISOString();
      broadcast();
    } catch {}
  });

  ws.on('close', () => {
    if (kind === 'public' && okxPublic === ws) okxPublic = null;
    if (kind === 'business' && okxBusiness === ws) okxBusiness = null;
    state.connected = false;
    state.updatedAt = new Date().toISOString();
    broadcast();
    scheduleReconnect();
  });

  ws.on('error', () => {
    try { ws.close(); } catch {}
  });
}

function connectOKX() {
  if (!okxPublic || okxPublic.readyState !== WebSocket.OPEN) {
    connectSocket(OKX_PUBLIC_WS, [
      { channel: 'tickers', instId: INST_ID },
      { channel: 'trades', instId: INST_ID },
      { channel: 'books5', instId: INST_ID }
    ], 'public');
  }

  if (!okxBusiness || okxBusiness.readyState !== WebSocket.OPEN) {
    connectSocket(OKX_BUSINESS_WS, TIMEFRAMES.map(tf => ({
      channel: `candle${tf}`,
      instId: INST_ID
    })), 'business');
  }

  if (!heartbeatTimer) {
    heartbeatTimer = setInterval(() => {
      for (const ws of [okxPublic, okxBusiness]) {
        if (ws?.readyState === WebSocket.OPEN) {
          try { ws.send('ping'); } catch {}
        }
      }
    }, 20000);
  }
}

const server = createServer((req, res) => {
  if (req.url === '/api/live-stream') {
    res.writeHead(426, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      ok: false,
      error: 'WebSocket upgrade required',
      websocket: 'wss://scalp-omega-ai-webhook.vercel.app/api/live-stream'
    }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server });

wss.on('connection', ws => {
  clients.add(ws);
  ws.send(JSON.stringify(state));

  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

connectOKX();

export default server;
