# SCALP-Ω Production Activation

## Current architecture

market data -> SCALP-Ω collection/feature layer -> ChatGPT analysis -> LONG / SHORT / NO_TRADE

SCALP-Ω is the market-data and evidence layer. It collects, normalizes, validates, and persists market observations. **ChatGPT is the sole decision authority for the conversational trading workflow.**

Supabase stores large historical candle sets and durable market snapshots.
Upstash Redis stores the short-lived realtime snapshot and recent confirmed candles.

Deterministic TITAN modules may derive indicators, statistics, data-quality checks, research diagnostics, and market observations. They are not the final conversational trading authority.

## Vercel environment variables

Required for the data/persistence path:
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY

TradingView webhook path:
- TV_WEBHOOK_SECRET
- SIGNAL_PROCESS_SECRET

Durable queue:
- QSTASH_TOKEN
- QSTASH_DESTINATION_URL

Realtime Redis memory:
- UPSTASH_REDIS_REST_URL
- UPSTASH_REDIS_REST_TOKEN

Optional market/macro connectors may include FRED, Binance, Bybit, and Deribit credentials as configured.

Never commit secret values to GitHub.

## Memory behavior

Every primary market-data request asynchronously upserts the available 1000-bar candle sets into market persistence and stores a compact realtime snapshot.

The candle primary key is source + instrument + timeframe + time_ms, so repeated requests update the same candles instead of creating duplicates.

Upstash Redis stores the latest realtime snapshot and recent confirmed candles with a short TTL.

The previous Upstash snapshot may be read for short-term context without making Redis the authoritative market source.

## ChatGPT data-feed contract

The live feed must expose:
- analysisMode: DATA_FOR_CHATGPT
- decisionAuthority: CHATGPT_CONVERSATIONAL_ONLY
- decisionPolicy: CHATGPT_ONLY

The feed must not emit the final conversational trade decision. It supplies the evidence; ChatGPT performs the reasoning and returns LONG, SHORT, or NO_TRADE.

## Verification

After deployment:
1. Call /api/confluence and confirm HTTP 200 plus the ChatGPT-only contract.
2. Call /api/institutional and confirm it returns market evidence only; this is the ChatGPT data feed.
3. Confirm market candles are available for 1m, 5m, 15m, 1H, 4H and 1D when upstream data is available.
4. Confirm Supabase/Upstash persistence is configured as expected.
5. Confirm no external model API or model key is required by the application for the conversational decision path.

## Research integrity

Closed-candle information is used for structural confirmation to avoid lookahead. Historical alignment remains as-of the relevant decision timestamp in research/backtest modules.

Scores and confidence values are evidence-strength measures, not validated probabilities of winning.


## Institutional market-data and validation layer

SCALP-Ω now exposes a dedicated institutional evidence layer to the ChatGPT feed. It combines 1m→1D multi-timeframe data, 1000-candle live windows, persisted coverage diagnostics, 400-level order-book depth, recent trade-flow statistics, derivative history, cross-exchange evidence, deterministic quantitative diagnostics, forward-return studies, a fixed research baseline backtest, rolling walk-forward diagnostics, and current order-book execution/slippage estimates.

The layer is **research/execution evidence only**. It never emits the conversational LONG/SHORT/NO_TRADE decision, does not override ChatGPT, and uses closed candles to avoid look-ahead. Historical depth/CVD remains dependent on continued persistence of live streams; the system reports this explicitly rather than fabricating history.
