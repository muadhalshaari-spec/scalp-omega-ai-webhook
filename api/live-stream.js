import { createServer } from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';

export const config = {
  maxDuration: 300
};

const OKX_PUBLIC_WS = 'wss://ws.okx.com:8443/ws/v5/public';
const OKX_BUSINESS_WS = 'wss://ws.okx.com:8443/ws/v5/business';
const INST_ID = 'ETH-USDT-SWAP';
const TIMEFRAMES = ['1m', '5m', '15m', '1H', '4H', '1D'];
const REQUIRED_CANDLE_AGE_MS = 180_000;
const LIVE_WAIT_MS = 8_000;

let okxPublic = null;
let okxBusiness = null;
let reconnectTimer = null;
let heartbeatTimer = null;
const readyWaiters = new Set();

const state = {
  ok: true,
  engine: 'SCALP-Ω Live Market Engine v5',
  source: 'OKX WebSocket',
  instrument: INST_ID,
  realtime: true,
  connected: false,
  dataReady: false,
  updatedAt: null,
  ticker: null,
  latestTrade: null,
  orderBook: null,
  candles: Object.fromEntries(TIMEFRAMES.map(tf => [tf, null])),
  channelStatus: {
    ticker: false,
    trades: false,
    orderBook: false,
    candles: Object.fromEntries(TIMEFRAMES.map(tf => [tf, false]))
  },
  missingChannels: []
};

const clients = new Set();

function snapshot() {
  return JSON.parse(JSON.stringify(state));
}

function candleFresh(row) {
  const ts = Number(row?.[0]);
  return Number.isFinite(ts) && (Date.now() - ts) <= REQUIRED_CANDLE_AGE_MS;
}

function refreshReadiness() {
  const candleStatus = Object.fromEntries(
    TIMEFRAMES.map(tf => [tf, Boolean(state.candles[tf] && candleFresh(state.candles[tf]))])
  );

  state.channelStatus = {
    ticker: Boolean(state.ticker),
    trades: Boolean(state.latestTrade),
    orderBook: Boolean(state.orderBook),
    candles: candleStatus
  };

  const missing = [];
  if (!state.ticker) missing.push('ticker');
  if (!state.latestTrade) missing.push('trades');
  if (!state.orderBook) missing.push('books5');
  for (const tf of TIMEFRAMES) {
    if (!candleStatus[tf]) missing.push(`candle${tf}`);
  }

  state.missingChannels = missing;
  state.dataReady = missing.length === 0;
}

function hasLiveData() {
  refreshReadiness();
  return state.dataReady;
}

function waitForLiveData(timeoutMs = LIVE_WAIT_MS) {
  refreshReadiness();
  if (state.dataReady) return Promise.resolve(true);

  return new Promise(resolve => {
    const waiter = { resolve, timer: null };
    waiter.timer = setTimeout(() => {
      readyWaiters.delete(waiter);
      refreshReadiness();
      resolve(state.dataReady);
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
  refreshReadiness();
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

function resetPublicState() {
  state.ticker = null;
  state.latestTrade = null;
  state.orderBook = null;
}

function resetCandleState() {
  for (const tf of TIMEFRAMES) state.candles[tf] = null;
}

function connectSocket(url, args, kind) {
  const ws = new WebSocket(url, {
    handshakeTimeout: 10000,
    perMessageDeflate: false
  });

  ws.on('open', () => {
    try {
      ws.send(JSON.stringify({ op: 'subscribe', args }));
    } catch {
      try { ws.close(); } catch {}
      return;
    }

    if (kind === 'public') {
      okxPublic = ws;
      resetPublicState();
    } else {
      okxBusiness = ws;
      resetCandleState();
    }

    state.connected = Boolean(okxPublic && okxBusiness);
    state.updatedAt = new Date().toISOString();
    broadcast();
  });

  ws.on('message', raw => {
    try {
      const text = raw.toString();
      if (text === 'pong') return;

      const msg = JSON.parse(text);
      const event = msg?.event;
      if (event === 'error') {
        state.updatedAt = new Date().toISOString();
        broadcast();
        return;
      }

      const channel = msg?.arg?.channel;
      const rows = Array.isArray(msg?.data) ? msg.data : [];
      const row = rows[rows.length - 1];
      if (!channel || !row) return;

      if (channel === 'tickers') state.ticker = row;
      else if (channel === 'trades') state.latestTrade = row;
      else if (channel === 'books5') state.orderBook = row;
      else if (channel.startsWith('candle')) {
        const tf = channel.slice('candle'.length);
        if (TIMEFRAMES.includes(tf)) state.candles[tf] = row;
      }

      state.connected = Boolean(okxPublic && okxBusiness);
      state.updatedAt = new Date().toISOString();
      refreshReadiness();
      resolveReadyWaiters();
      broadcast();
    } catch {}
  });

  ws.on('close', () => {
    if (kind === 'public' && okxPublic === ws) {
      okxPublic = null;
      resetPublicState();
    }
    if (kind === 'business' && okxBusiness === ws) {
      okxBusiness = null;
      resetCandleState();
    }

    state.connected = false;
    state.updatedAt = new Date().toISOString();
    refreshReadiness();
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
      refreshReadiness();
    }, 20000);
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (req.method === 'GET' && (url.pathname === '/api/live-stream' || url.pathname === '/api/live-state')) {
    const ready = await waitForLiveData();
    const payload = snapshot();

    if (!ready) {
      sendJson(res, {
        ...payload,
        ok: false,
        dataReady: false,
        error: 'Live market channels are not fully ready',
        requiredChannels: ['ticker', 'trades', 'books5', ...TIMEFRAMES.map(tf => `candle${tf}`)]
      }, 503);
      return;
    }

    sendJson(res, payload);
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
  refreshReadiness();
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
