# SCALP-Ω Production Activation

## Current memory architecture

market data -> SCALP-Ω -> deterministic TITAN/confluence/risk engines -> trading decision

Supabase stores the large historical candle set and durable market snapshots.
Upstash Redis stores the short-lived realtime snapshot and recent confirmed candles.
The deterministic decision engine consumes the live market feed and applies hard safety gates. No external model is required.

## Vercel environment variables

Required:
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

Never commit secret values to GitHub.

## Memory behavior

Every AI analysis request asynchronously upserts the available 1000-bar candle sets into public.market_candles and stores a compact snapshot in public.market_snapshots.

The candle primary key is source + instrument + timeframe + time_ms, so repeated requests update the same candles instead of creating duplicates.

Upstash Redis stores the latest realtime snapshot and the last 20 confirmed candles per timeframe with a short TTL.

The previous Upstash snapshot may be read for short-term context without making Redis the authoritative market source.

## Verification

After deployment:
1. Call /api/memory and check the Redis configuration state.
2. Trigger `/api/confluence` or the institutional data pipeline.
3. Confirm market_candles receives 1m, 5m, 15m, 1H, 4H and 1D rows for the active source.
4. Confirm market_snapshots receives a current row.
5. Confirm the deterministic TITAN decision and hard gates are present.
6. Confirm no external model/API is required for a trading decision.
