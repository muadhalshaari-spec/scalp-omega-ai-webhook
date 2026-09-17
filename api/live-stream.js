import { createServer } from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';

export const config = {
  maxDuration: 300
};

const OKX_PUBLIC_WS = 'wss://ws.okx.com:8443/ws/v5/public';
const OKX_BUSINESS_WS = 'wss://ws.okx.com:8443/ws/v5/business';
const INST_ID = 'ETH-USDT-SWAP';
const TIMEFRAMES = ['1m', '5m', '15m', '1H', '4H', '1D'];

let okxPublic = null;
let okxBusiness = null;
let reconnectTimer = null;
let heartbeatTimer = null;
const readyWaiters = new Set();

const state = {
  ok: true,
  engine: 'SCALP-Ω Live Market Engine v4',
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

function snapshot() {
  return JSON.parse(JSON.stringify(state));
}

function hasLiveData() {
  return Boolean(state.ticker || state.latestTrade || state.orderBook || Object.values(state.candles).some(Boolean));
}

function waitForLiveData(timeoutMs = 2500) {
  if (hasLiveData()) return Promise.resolve(true);
  return new Promise(resolve => {
    const waiter = { resolve, timer: null };
    waiter.timer = setTimeout(() => {
      readyWaiters.delete(waiter);
      resolve(hasLiveData());
    }, timeoutMs);
    readyWaiters.add(waiter);
  });
}

function resolveReadyWaiters() {
  if (!hasLiveData()) return;
  for (const waiter of readyWaiters) {
    clearTimeout(waiter.timer);
    waiter.resolve(true);
  }
  readyWaiters.clear();
}

function sendJson(res, payload, status = 200) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'Pragma': 'no-cache'
  });
  res.end(body);
}

function broadcast() {
  const payload = JSON.stringify(snapshot());
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      try { client.send(payload); } catch {}
    }
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectOKX();
  }, 1500);
}

function connectSocket(url, args, kind) {
  const ws = new WebSocket(url, {
    handshakeTimeout: 10000,
    perMessageDeflate: false
  });

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
      const text = raw.toString();
      if (text === 'pong') return;
      const msg = JSON.parse(text);
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
      resolveReadyWaiters();
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

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (req.method === 'GET' && (url.pathname === '/api/live-stream' || url.pathname === '/api/live-state')) {
    await waitForLiveData();
    sendJson(res, snapshot());
    return;
  }

  sendJson(res, {
    ok: false,
    error: 'WebSocket endpoint. Connect using wss://.../api/live-stream or query /api/live-state.'
  }, 404);
});

const wss = new WebSocketServer({ server });

wss.on('connection', ws => {
  clients.add(ws);
  try { ws.send(JSON.stringify(snapshot())); } catch {}

  ws.on('message', raw => {
    if (raw.toString() === 'ping') {
      try { ws.send('pong'); } catch {}
    }
  });

  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

connectOKX();

export default server;
