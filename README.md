# SCALP-Ω AI Webhook

SCALP-Ω is an institutional-style ETH-USDT-SWAP market intelligence and decision engine.

## Production endpoints

- `GET /api/institutional` — institutional deterministic decision and derivative/event-risk state.
- `GET /api/confluence` — multi-timeframe market/confluence data plus institutional analysis.
- `GET /api/backtest?depth=5000` — historical institutional backtest with as-of derivative alignment, calibration, walk-forward, and overfitting diagnostics.
- `GET /api/analyze` — AI reasoning layer. GPT explains the deterministic engine and may not override its decision.
- `POST /api/webhook` — TradingView webhook bridge. It accepts the alert payload, refreshes live analysis, and returns the deterministic decision plus analysis.
- `GET /api/live-state` and `GET /api/live-stream` — realtime market state.

## Webhook authentication

Set the Vercel environment variable `TV_WEBHOOK_SECRET` and send the same value in the `x-tradingview-secret` header. When the variable is not configured, the endpoint remains compatible but reports authentication as `not_configured`.

## Research integrity

The system uses closed-candle decision data and aligns historical derivatives strictly as-of each decision timestamp. TIMEOUT outcomes remain visible in performance statistics and are not converted into binary losses for calibration.

The current research result is not a validated profitability claim or a guaranteed win rate. Scores and confidence fields are evidence-strength measures, not probabilities of winning.
