# SCALP-Ω Production Activation

## Already applied

- Supabase persistence migrations are applied to the production database.
- Supabase RLS is enabled on TITAN persistence tables.
- TITAN 55 CI quality gate, integration test, and core smoke test pass on the current branch.
- Liquidation ingestion uses the public Binance USDⓈ-M force-order WebSocket stream.
- Vercel deployment function count is kept within the Hobby limit.

## Vercel environment variables

Set these in the Vercel Production environment:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TV_WEBHOOK_SECRET`
- `SIGNAL_PROCESS_SECRET`

Optional QStash mode:

- `QSTASH_TOKEN`
- `QSTASH_DESTINATION_URL` (defaults to `https://<deployment-host>/api/process-signal`)

Optional protected liquidation-history read:

- `LIQUIDATION_CRON_SECRET`

Never commit any of these values to Git.

## TradingView alert body

The webhook endpoint is:

`/api/webhook`

Use HTTPS and send JSON containing at minimum:

```json
{
  "symbol": "ETHUSDT",
  "direction": "LONG",
  "timestamp": 1770000000000,
  "secret": "<TV_WEBHOOK_SECRET>"
}
```

The server accepts the same secret through `secret`, `token`, or `webhookSecret`, or through the supported webhook headers.

## QStash mode

When `QSTASH_TOKEN` is present, `/api/webhook` publishes to QStash and does not silently downgrade to direct background execution.

The QStash destination must be HTTPS and the destination must have `SIGNAL_PROCESS_SECRET` configured.

## Liquidation feed

The live stream endpoint is:

`/api/live-stream`

The liquidation collector subscribes to Binance:

`wss://fstream.binance.com/ws/ethusdt@forceOrder`

Events are persisted into:

`public.titan_liquidations`

The read endpoint `/api/liquidations` requires `LIQUIDATION_CRON_SECRET`.

## Final verification sequence

1. Configure the required Vercel production environment variables.
2. Configure the TradingView alert with the same webhook secret.
3. Configure QStash only when durable queue delivery is desired.
4. Trigger one test TradingView alert.
5. Verify the alert is stored in `public.signal_events`.
6. Verify the institutional response remains fail-closed and deterministic.
7. Verify live liquidation events appear in `public.titan_liquidations`.
8. Run the post-merge production audit.

Do not treat a deployment as fully production-ready until the live endpoint, webhook authentication, and persisted liquidation path have all been observed successfully.
