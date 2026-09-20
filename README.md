# SCALP-Ω AI Webhook

SCALP-Ω is an ETH-USDT-SWAP market data and feature engine designed to feed a separate AI reasoning layer.

## Decision architecture

The live architecture is intentionally split:

`market data → SCALP-Ω data/feature engine → ChatGPT (GPT-5.6 Luna) → trading decision`

SCALP-Ω does not authorize, select, rank, or output a live trading decision. The final `LONG`, `SHORT`, or `NO_TRADE` decision is generated only by the ChatGPT analysis layer from the supplied evidence.

## Production endpoints

- `GET /api/institutional` — data-only AI feed: 1000 candles per timeframe plus indicators, derivatives, order book, trades, liquidations, cross-exchange data, contexts, and data-quality metadata. No trading decision, entry, stop, target, probability, or risk-gate output.
- `GET /api/confluence` — legacy/internal market-data pipeline retained for compatibility; the AI decision path does not use its deterministic decision output.
- `GET /api/backtest?depth=5000` — historical research/backtest diagnostics.
- `GET /api/analyze` — GPT-5.6 Luna reasoning and trading-decision layer. GPT independently decides LONG/SHORT/NO_TRADE from the data feed.
- `POST /api/webhook` — fast TradingView webhook receiver. It authenticates, acknowledges immediately, and schedules background processing.
- `POST /api/process-signal` — background data-processing/persistence route.
- `GET /api/live-state` and `GET /api/live-stream` — realtime market state.

## AI data feed contract

The AI feed is explicitly marked with:

- `decisionAuthority: CHATGPT_ONLY`
- `decisionPolicy: NO_DECISION_OUTPUT`
- `analysisMode: DATA_ONLY_CLOSED_CANDLES`

The feed contains historical candles in ascending chronological order and exposes 1000 bars for each configured timeframe where the upstream exchange returns the requested history.

## OpenAI

Set the Vercel environment variable `OPENAI_API_KEY`. The `/api/analyze` endpoint sends the data feed and live market state to GPT-5.6 Luna. If OpenAI is unavailable or rate-limited, the endpoint returns an error and does not substitute a deterministic engine decision.

## Webhook authentication

Set the Vercel environment variable `TV_WEBHOOK_SECRET` and send the same value in the `x-tradingview-secret` header. When the variable is not configured, the endpoint reports authentication as `not_configured`.

## Research integrity

Closed-candle information is used for structural confirmation to avoid lookahead. Historical derivative alignment is kept as-of the relevant decision timestamp in the research/backtest modules.

Scores and confidence values are evidence-strength measures, not validated probabilities of winning.

## TradingView latency protection

The webhook receiver does not wait for market analysis. It returns 202 with a jobId, then invokes background processing using Vercel waitUntil. For durable retries beyond the serverless lifecycle, a persistent queue such as QStash or Inngest can be added later.

## Safety

Set both `TV_WEBHOOK_SECRET` and `SIGNAL_PROCESS_SECRET` in Vercel production. Never place exchange withdrawal permissions or private API keys in TradingView alerts.
