import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';
import { getRecentMarketCandles } from '../lib/supabase.js';

const BASE_URL = String(
  process.env.SCALP_PUBLIC_BASE_URL ||
  (process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'https://scalp-omega-ai-webhook.vercel.app')
).replace(/\/$/, '');

const INSTRUCTIONS = [
  'SCALP-Ω is a read-only evidence gateway for ChatGPT.',
  'ChatGPT is the conversational decision authority; this MCP server never emits an executable trade order and never exposes withdrawal capability.',
  'All market evidence is time-sensitive. Check fetchedAt/asOf and dataQuality before using it.',
  'OHLC candles alone cannot prove an account fill or the intrabar order of entry and stop events.',
  'A trading setup is not persistent: old entries must be revalidated against current regime, microstructure, cross-exchange state, derivatives, macro, and news before any new decision.',
  'When evidence is incomplete or stale, prefer NO_TRADE rather than inventing certainty.'
].join(' ');

async function fetchJson(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50_000);
  try {
    const response = await fetch(BASE_URL + path, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'SCALP-Omega-MCP/1.0' }
    });
    const body = await response.text();
    let data = null;
    try { data = JSON.parse(body); } catch {}
    if (!response.ok || !data?.ok) throw new Error('SCALP-Ω upstream ' + response.status + ': ' + (data?.error || body.slice(0, 300)));
    return data;
  } finally { clearTimeout(timer); }
}

const jsonResult = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
const finite = (v) => Number.isFinite(Number(v)) ? Number(v) : null;
const parseMs = (value) => { const ms = Date.parse(String(value)); return Number.isFinite(ms) ? ms : null; };

const handler = createMcpHandler(
  (server) => {
    server.registerTool('scalp_omega_live_market', {
      title: 'SCALP-Ω Live Market',
      description: 'Read-only unified live market evidence for ETH-USDT-SWAP: multi-timeframe candles, indicators, derivatives, order book/trades, cross-exchange verification, liquidations, institutional layer, macro/news/on-chain context, and data quality.',
      inputSchema: z.object({ compact: z.boolean().optional().default(true) })
    }, async ({ compact }) => jsonResult(await fetchJson(compact ? '/api/institutional?compact=1' : '/api/institutional')));

    server.registerTool('scalp_omega_provider_health', {
      title: 'SCALP-Ω Provider Health',
      description: 'Read-only provider and data-quality audit. Missing credentials, partial providers, freshness, coverage, and quality gates are reported without secrets.',
      inputSchema: z.object({})
    }, async () => {
      const data = await fetchJson('/api/confluence?compact=1');
      return jsonResult({
        fetchedAt: data.fetchedAt || null,
        instrument: data.instrument || 'ETH-USDT-SWAP',
        engine: data.engine || null,
        dataQuality: data.dataQuality || null,
        indicatorPersistence: data.indicatorPersistence || null,
        qualityGates: data.qualityGates || null,
        crossExchange: data.externalIntelligence?.crossExchange || null,
        providers: data.externalIntelligence?.providers || null,
        note: 'Read-only health snapshot; secrets are never returned.'
      });
    });

    server.registerTool('scalp_omega_external_context', {
      title: 'SCALP-Ω External Context',
      description: 'Read-only external context: cross-exchange derivatives, Deribit options, CoinGlass when configured, on-chain providers, macro series, news, and contextual sentiment.',
      inputSchema: z.object({})
    }, async () => {
      const data = await fetchJson('/api/institutional?compact=1');
      return jsonResult({
        fetchedAt: data.fetchedAt || null,
        crossExchange: data.externalIntelligence?.crossExchange || null,
        providers: data.externalIntelligence?.providers || null,
        onchain: data.externalIntelligence?.onchain || null,
        news: data.externalIntelligence?.news || null,
        macroContext: data.macroContext || null,
        dataQuality: data.externalIntelligence?.dataQuality || null,
        contextPolicy: 'Context only; combine with current market structure and data-quality gates.'
      });
    });

    server.registerTool('scalp_omega_trade_audit', {
      title: 'SCALP-Ω Trade Audit',
      description: 'Read-only historical audit of a proposed ETH-USDT-SWAP setup. Finds the first post-placement candle eligible to touch entry, stop and targets, and flags same-candle ambiguity. It never claims an account fill.',
      inputSchema: z.object({
        orderPlacementUtc: z.string().describe('UTC ISO-8601 timestamp, e.g. 2026-09-24T18:45:00Z'),
        entryPrice: z.number().positive(),
        stopLossPrice: z.number().positive(),
        takeProfitPrices: z.array(z.number().positive()).optional().default([]),
        timeframe: z.enum(['1m', '5m', '15m', '1H', '4H', '1D']).optional().default('15m'),
        source: z.string().optional().default('OKX'),
        instrument: z.string().optional().default('ETH-USDT-SWAP'),
        lookbackBars: z.number().int().min(50).max(1000).optional().default(1000)
      })
    }, async ({ orderPlacementUtc, entryPrice, stopLossPrice, takeProfitPrices, timeframe, source, instrument, lookbackBars }) => {
      const placementMs = parseMs(orderPlacementUtc);
      if (placementMs == null) return jsonResult({ ok: false, error: 'Invalid orderPlacementUtc. Use ISO-8601 UTC.' });

      const result = await getRecentMarketCandles({ source, instrument, timeframe, limit: lookbackBars });
      const candles = (result.rows || []).map(c => ({
        time_ms: finite(c.time_ms), open: finite(c.open), high: finite(c.high), low: finite(c.low), close: finite(c.close),
        volume: finite(c.volume), confirmed: c.confirmed === true
      })).filter(c => Number.isFinite(c.time_ms) && c.time_ms >= placementMs &&
        [c.open,c.high,c.low,c.close].every(Number.isFinite)).sort((a,b) => a.time_ms - b.time_ms);

      const side = stopLossPrice > entryPrice ? 'SHORT' : stopLossPrice < entryPrice ? 'LONG' : 'UNKNOWN';
      const touches = (c, price, kind) => kind === 'entry'
        ? (side === 'SHORT' ? c.high >= price : c.low <= price)
        : (side === 'SHORT' ? c.high >= price : c.low <= price);
      const firstEntry = candles.find(c => touches(c, entryPrice, 'entry')) || null;
      let firstStop = null;
      if (firstEntry) {
        const idx = candles.findIndex(c => c.time_ms === firstEntry.time_ms);
        firstStop = candles.slice(idx).find(c => touches(c, stopLossPrice, 'stop')) || null;
      }
      const targetAudit = takeProfitPrices.map(price => ({
        price,
        firstEligibleCandle: candles.find(c => side === 'SHORT' ? c.low <= price : c.high >= price) || null
      }));

      return jsonResult({
        ok: true,
        source, instrument, timeframe, orderPlacementUtc, placementMs,
        inferredSide: side, entryPrice, stopLossPrice, takeProfitPrices,
        candleCountAfterPlacement: candles.length,
        firstEntryEligibleCandle: firstEntry,
        firstStopEligibleAfterEntry: firstStop,
        sameCandleStopEligible: Boolean(firstEntry && firstStop && firstEntry.time_ms === firstStop.time_ms),
        intrabarSequenceProven: false,
        intrabarSequenceWarning: Boolean(firstEntry && firstStop && firstEntry.time_ms === firstStop.time_ms)
          ? 'Entry and stop are in the same candle; OHLC does not prove the intrabar sequence.'
          : null,
        takeProfitEligibility: targetAudit,
        accountFillStatus: 'UNVERIFIED_WITH_MARKET_DATA_ONLY',
        accountFillProofRequired: 'Exchange order/fill history',
        dataSourceConfigured: result.configured === true
      });
    });
  },
  {
    serverInfo: { name: 'SCALP-Ω MCP', version: '1.0.0' },
    instructions: INSTRUCTIONS
  }
);

export { handler as GET, handler as POST };
