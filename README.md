# SCALP-Ω AI Webhook

SCALP-Ω is an institutional-style ETH-USDT-SWAP market intelligence and decision engine.

## Production endpoints

- `GET /api/institutional` — institutional deterministic decision and derivative/event-risk state.
- `GET /api/confluence` — multi-timeframe market/confluence data plus institutional analysis.
- `GET /api/backtest?depth=5000` — historical institutional backtest with as-of derivative alignment, calibration, walk-forward, and overfitting diagnostics.
- `GET /api/analyze` — AI reasoning layer. GPT explains the deterministic engine and may not override its decision.
- `POST /api/webhook` — fast TradingView webhook receiver. It authenticates, acknowledges immediately, and schedules background institutional processing so the TradingView request is not held open.
- `POST /api/process-signal` — background institutional processor. Returns the deterministic decision and executable plan (MARKET/LIMIT/STOP, entry zone, SL, TP1-3, R:R, expiry, cancellation conditions).
- `GET /api/live-state` and `GET /api/live-stream` — realtime market state.

## Webhook authentication

Set the Vercel environment variable `TV_WEBHOOK_SECRET` and send the same value in the `x-tradingview-secret` header. When the variable is not configured, the endpoint remains compatible but reports authentication as `not_configured`.

## Research integrity

The system uses closed-candle decision data and aligns historical derivatives strictly as-of each decision timestamp. TIMEOUT outcomes remain visible in performance statistics and are not converted into binary losses for calibration.

The current research result is not a validated profitability claim or a guaranteed win rate. Scores and confidence fields are evidence-strength measures, not probabilities of winning.


## Execution decision contract

The institutional layer now separates prediction from execution. A trade is executable only when the deterministic gate returns LONG or SHORT. The execution plan can contain entry mode, entry price/zone, trigger condition, structural stop-loss, up to three targets, cost-adjusted R:R, expiry, cancellation conditions, and an evidence probability. A NO_TRADE result remains a valid and intentional outcome.

## TradingView latency protection

The webhook receiver does not wait for market analysis. It returns 202 with a jobId, then invokes the processor in the background using Vercel waitUntil. For durable delivery and retries beyond the serverless lifecycle, the next production hardening step is a persistent queue such as QStash or Inngest. The current waitUntil fallback is not a durable queue.

## Safety

Set both TV_WEBHOOK_SECRET and SIGNAL_PROCESS_SECRET in Vercel production. Never place exchange withdrawal permissions or private API keys in TradingView alerts.
