# SCALP-Ω TITAN 55 — Engine Architecture

This document is the engineering map for the 55 specialized deterministic engines under `lib/titan/`.

## Runtime contract

Every engine exposes `MODULE`, `evaluate(input)`, `selfTest()`, and a deterministic result contract containing state, gates, metrics, provenance, and diagnostics. The shared kernel enforces timestamp-aware lookahead protection, finite-value normalization, fail-closed behavior, and trace identifiers.

## Pipeline

`SCALP-Ω institutional engine → TITAN-01…55 sequential orchestration → canonical state propagation → deterministic hard gates → final LONG/SHORT/NO_TRADE`

The orchestrator is `lib/titan/index.js`. It imports all 55 engines, feeds downstream engines the accumulated canonical state and prior outputs, maintains a dependency graph, and returns the full trace.

## Engines

01. 01_execution-decision-engine
02. 02_market-understanding-setup-trigger
03. 03_multi-layer-entry-trigger
04. 04_market-entry
05. 05_limit-pending-orders
06. 06_stop-pending-orders
07. 07_smart-stop-loss
08. 08_smart-take-profit
09. 09_probability-engine
10. 10_meta-labeling
11. 11_calibration-engine
12. 12_risk-reward-gate
13. 13_historical-analog-engine
14. 14_regime-engine
15. 15_session-intelligence
16. 16_event-engine
17. 17_data-quality-engine
18. 18_cross-exchange-intelligence
19. 19_cross-exchange-divergence
20. 20_derivatives-intelligence
21. 21_options-intelligence
22. 22_liquidation-intelligence
23. 23_market-microstructure
24. 24_websocket-architecture
25. 25_indicator-feature-extraction
26. 26_ensemble-architecture
27. 27_opportunity-trade-selection
28. 28_entry-quality-framework
29. 29_loss-taxonomy
30. 30_drift-detection
31. 31_walk-forward-research
32. 32_pbo-overfitting-research
33. 33_historical-dataset-pipeline
34. 34_external-history-alignment
35. 35_paper-trading-engine
36. 36_execution-simulator
37. 37_position-management
38. 38_pending-order-cancellation
39. 39_kill-switch
40. 40_tradingview-webhook-architecture
41. 41_qstash-queue-integration
42. 42_redis-state-layer
43. 43_supabase-persistence-schema
44. 44_trade-journal-learning-loop
45. 45_openai-audit-layer
46. 46_gpt-contract
47. 47_api-webhook-processor
48. 48_automated-tests
49. 49_cicd
50. 50_vercel-integration
51. 51_github-audit-repair
52. 52_monitoring-signal-dashboard
53. 53_documentation
54. 54_final-system-audit
55. 55_system-validation-matrix

## Hard operational gates

The live decision is fail-closed on data-quality failure, event-risk blocks, kill-switch activation, risk/reward failure, and directional conflict with the deterministic base decision. Model drift can also hard-block when measured drift reaches the configured severe threshold.

## Research gates

Walk-forward, calibration, meta-labeling, CSCV/PBO, historical dataset alignment, execution simulation, and trade-journal engines are research/validation layers. Their existence does not constitute proof of profitability, predictive accuracy, or live trading success.

## Safety boundaries

- Missing or stale evidence must remain visible; it is never silently converted to certainty.
- Future timestamps relative to the decision timestamp are rejected as lookahead.
- GPT/OpenAI is an audit layer and cannot invent price levels or override deterministic safety gates.
- CoinGlass remains optional/cancelled according to the current project configuration; live REST snapshots are not treated as persisted historical truth for backtests.
- Production promotion remains a separate release step from source implementation and local validation.

## Verification commands

`node scripts/titan-55-quality-gate.mjs`

`node scripts/titan-55-integration.mjs`

The quality gate requires exactly 55 numbered engines, domain-specific implementation markers, valid exports, an acyclic dependency graph, and all 55 self-tests passing.
