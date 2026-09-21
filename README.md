# SCALP-Ω Market Data Webhook

SCALP-Ω is the ETH-USDT-SWAP live market-data and feature collection layer. It gathers market evidence for **ChatGPT**, which performs the discretionary reasoning and emits the final trading decision.

## Decision architecture

`market data → SCALP-Ω collection/feature layer → ChatGPT analysis → LONG / SHORT / NO_TRADE`

SCALP-Ω does **not** own the final trading decision. Its job is to collect, normalize, validate, and expose the evidence. **ChatGPT is the sole decision authority for the conversational workflow.**

## Production endpoints

- `GET /api/institutional` — live ChatGPT data feed: 1000 candles per configured timeframe plus indicators, derivatives, order book, trades, liquidations, cross-exchange data, macro context, and market memory. It emits market evidence only; it does not emit the final trade decision.
- `GET /api/binance` — direct Binance market-data verification endpoint for ETHUSDT. It collects USDⓈ-M Futures + Spot public market data, including ticker/book/trades/aggregate trades, 1000-bar multi-timeframe klines, mark/index/premium series, funding/OI histories, long/short and taker-flow histories, basis, exchange/risk metadata, plus optional API-key protected Binance feeds when `BINANCE_API_KEY` is configured.
- `GET /api/bybit` — direct Bybit V5 market-data verification endpoint for ETHUSDT Linear + Spot. It collects ticker/order book/recent trades, instrument/risk/price limits, funding/OI/long-short histories, 1000-bar multi-timeframe klines, mark/index/premium-index series, delivery metadata, and exposes audit results for each requested endpoint.
- `GET /api/confluence` — primary live market-data collection endpoint. Its output is evidence for ChatGPT and contains no final trade decision.
- `GET /api/backtest?depth=5000` — historical research/backtest diagnostics.
- `POST /api/webhook` — fast TradingView webhook receiver. It authenticates, acknowledges immediately, and schedules background processing.
- `POST /api/process-signal` — background data-processing/persistence route.
- `GET /api/live-state` and `GET /api/live-stream` — realtime market state.

## ChatGPT data-feed contract

The data feed is explicitly marked with:

- `decisionAuthority: CHATGPT_CONVERSATIONAL_ONLY`
- `decisionPolicy: CHATGPT_ONLY`
- `analysisMode: DATA_FOR_CHATGPT`

The feed is observational/data-oriented. It does not authorize a local engine to emit a trading signal. ChatGPT receives the live evidence and is the only component that decides `LONG`, `SHORT`, or `NO_TRADE`.

The feed contains historical candles in ascending chronological order and exposes 1000 bars for each configured timeframe where the upstream exchange returns the requested history.

## FRED macro context

- `GET /api/fred` — direct FRED verification endpoint for the configured macro series.
- The primary `/api/institutional` data feed now fetches FRED macro context during the same request when `FRED_API_KEY` is configured.
- FRED is evidence only. It does not bypass deterministic safety gates.

Required Vercel environment variable: `FRED_API_KEY` (Production).

## Decision responsibility

Deterministic calculations may still be used to derive indicators, statistics, data-quality checks, and market observations. They are not the final trading authority. The final decision is produced by ChatGPT from the complete live evidence set.

## Webhook authentication

Set the Vercel environment variable `TV_WEBHOOK_SECRET` and send the same value in the `x-tradingview-secret` header. When the variable is not configured, the endpoint reports authentication as `not_configured`.

## Research integrity

Closed-candle information is used for structural confirmation to avoid lookahead. Historical derivative alignment is kept as-of the relevant decision timestamp in the research/backtest modules.

Scores and confidence values are evidence-strength measures, not validated probabilities of winning.

## TradingView latency protection

The webhook receiver does not wait for market analysis. It returns 202 with a jobId, then invokes background processing using Vercel waitUntil. For durable retries beyond the serverless lifecycle, a persistent queue such as QStash or Inngest can be added later.

## Deployment

The `main` branch is the source of truth for the Vercel Production deployment.

## Safety

Set both `TV_WEBHOOK_SECRET` and `SIGNAL_PROCESS_SECRET` in Vercel production. Never place exchange withdrawal permissions or private API keys in TradingView alerts.


<!-- ChatGPT decision bridge deployment marker -->
