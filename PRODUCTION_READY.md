# SCALP-Ω Production State

Source of truth: GitHub `main` -> Vercel Production.

Architecture:
market data -> SCALP-Ω evidence layer -> ChatGPT analysis -> LONG / SHORT / NO_TRADE

SCALP-Ω collects and validates evidence. ChatGPT is the sole conversational decision authority.

Production readiness means the data feed and deployment are operational; it does not guarantee profitable trades or predictive accuracy.
