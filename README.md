# SCALP-Ω AI Webhook

SCALP-Ω is an ETH-USDT-SWAP market data and feature engine designed to feed a separate AI reasoning layer.

## Decision architecture

The live architecture is intentionally split:

`market data → SCALP-Ω data/feature engine → ChatGPT (GPT-5.6 Luna) → trading decision`

SCALP-Ω does not authorize, select, rank, or output a live trading decision. The final `LONG`, `SHORT`, or `NO_TRADE` decision is generated only by the ChatGPT analysis layer from the supplied evidence.

## Production endpoints

- `GET /api/institutional` — data-only AI feed: 1000 candles per configured timeframe plus indicators, derivatives, order book, trades, liquidations, cross-exchange data, and full Binance market-data coverage. No trading decision, entry, stop, target, probability, or risk-gate output.
- `GET /api/binance` — direct Binance market-data verification endpoint for ETHUSDT. It collects USDⓈ-M Futures + Spot public market data, including ticker/book/trades/aggregate trades, 1000-bar multi-timeframe klines, mark/index/premium series, funding/OI histories, long/short and taker-flow histories, basis, exchange/risk metadata, plus optional API-key protected Binance feeds when `BINANCE_API_KEY` is configured.
- `GET /api/bybit` — direct Bybit V5 market-data verification endpoint for ETHUSDT Linear + Spot. It collects ticker/order book/recent trades, instrument/risk/price limits, funding/OI/long-short histories, 1000-bar multi-timeframe klines, mark/index/premium-index series, delivery metadata, and exposes audit results for each requested endpoint.
- `GET /api/confluence` — legacy/internal market-data pipeline retained for compatibility; the AI decision path does not use its deterministic decision output.
- `GET /api/backtest?depth=5000` — historical research/backtest diagnostics.
- `POST /api/webhook` — fast TradingView webhook receiver. It authenticates, acknowledges immediately, and schedules background processing.
- `POST /api/process-signal` — background data-processing/persistence route.
- `GET /api/live-state` and `GET /api/live-stream` — realtime market state.

## AI data feed contract

The AI feed is explicitly marked with:

- `decisionAuthority: CHATGPT_ONLY`
- `decisionPolicy: NO_DECISION_OUTPUT`
- `analysisMode: DATA_ONLY_CLOSED_CANDLES`

The feed contains historical candles in ascending chronological order and exposes 1000 bars for each configured timeframe where the upstream exchange returns the requested history.

## FRED macro context

- `GET /api/fred` — direct FRED verification endpoint for the configured macro series.
- The primary `/api/institutional` data feed now fetches FRED macro context during the same request when `FRED_API_KEY` is configured.
- FRED is evidence only. It does not bypass deterministic safety gates.

Required Vercel environment variable: `FRED_API_KEY` (Production).

## Deterministic decision engine

SCALP-Ω makes trading decisions locally from its deterministic TITAN/confluence/risk engines. No OpenAI API, model API key, external LLM, or `/api/analyze` route is required.

The decision path is:
`market data → feature/confluence engines → TITAN deterministic gates → LONG/SHORT/NO_TRADE`

The system fails closed to `NO_TRADE` when data quality, event risk, risk/reward, kill-switch, or directional confirmation gates are not satisfied.

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
