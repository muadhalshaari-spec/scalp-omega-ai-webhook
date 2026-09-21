# SCALP-Ω TITAN 55 — Engine Architecture

This document is the engineering map for the 55 specialized deterministic engines under `lib/titan/`.

## Runtime contract

Every engine exposes `MODULE`, `evaluate(input)`, `selfTest()`, and a deterministic result contract containing state, gates, metrics, provenance, and diagnostics. The shared kernel enforces timestamp-aware lookahead protection, finite-value normalization, fail-closed behavior, and trace identifiers.

## Pipeline

`market data -> SCALP-Ω collection/feature layer -> TITAN deterministic calculations/research -> ChatGPT final conversational reasoning -> LONG / SHORT / NO_TRADE`

The orchestrator is `lib/titan/index.js`. It imports all 55 engines, feeds downstream engines the accumulated canonical state and prior outputs, maintains a dependency graph, and returns the full trace.

The TITAN layer remains available for deterministic calculations, diagnostics, research, validation, and market observations. It is **not** the final decision authority for the conversational workflow.

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
45. 45_deterministic-audit-layer
46. 46_decision-contract
47. 47_api-webhook-processor
48. 48_automated-tests
49. 49_cicd
50. 50_vercel-integration
51. 51_github-audit-repair
52. 52_monitoring-signal-dashboard
53. 53_documentation
54. 54_final-system-audit
55. 55_system-validation-matrix

## Operational role

Deterministic engines may calculate structure, indicators, risk observations, data quality, research diagnostics, and other evidence. They are not the final conversational trading authority.

## Research integrity

Walk-forward, calibration, meta-labeling, CSCV/PBO, historical dataset alignment, execution simulation, and trade-journal engines are research/validation layers. Their existence does not constitute proof of profitability, predictive accuracy, or live trading success.

## Safety boundaries

- Missing or stale evidence must remain visible; it is never silently converted to certainty.
- Future timestamps relative to the analysis timestamp are rejected as lookahead.
- Deterministic modules cannot invent live market facts.
- Optional providers may be unavailable; their absence must remain visible in data-quality output.
- Production promotion remains a separate release step from source implementation and validation.

## Verification commands

`node scripts/titan-55-quality-gate.mjs`

`node scripts/titan-55-integration.mjs`
