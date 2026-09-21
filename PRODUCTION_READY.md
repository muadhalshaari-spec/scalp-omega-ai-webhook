# SCALP-Ω Production State

Source of truth: GitHub `main` -> Vercel Production.

Architecture:
market data -> SCALP-Ω evidence layer -> ChatGPT analysis -> LONG / SHORT / NO_TRADE

SCALP-Ω collects and validates evidence. ChatGPT is the sole conversational decision authority.

Production readiness means the data feed and deployment are operational; it does not guarantee profitable trades or predictive accuracy.


## Institutional market-data and validation layer

SCALP-Ω now exposes a dedicated institutional evidence layer to the ChatGPT feed. It combines 1m→1D multi-timeframe data, 1000-candle live windows, persisted coverage diagnostics, 400-level order-book depth, recent trade-flow statistics, derivative history, cross-exchange evidence, deterministic quantitative diagnostics, forward-return studies, a fixed research baseline backtest, rolling walk-forward diagnostics, and current order-book execution/slippage estimates.

The layer is **research/execution evidence only**. It never emits the conversational LONG/SHORT/NO_TRADE decision, does not override ChatGPT, and uses closed candles to avoid look-ahead. Historical depth/CVD remains dependent on continued persistence of live streams; the system reports this explicitly rather than fabricating history.
