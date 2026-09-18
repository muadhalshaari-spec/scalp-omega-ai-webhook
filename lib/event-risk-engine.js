import { utcHour, n } from './quant-core.js';

function fundingWindowState(timestamp, funding = {}) {
  const ts = n(timestamp, Date.now());
  const fundingTime = n(funding.fundingTime);
  const nextFundingTime = n(funding.nextFundingTime);

  if (!Number.isFinite(fundingTime) && !Number.isFinite(nextFundingTime)) {
    return {
      available: false,
      active: false,
      minutesToFunding: null,
      minutesFromFunding: null,
      source: 'funding_timestamp_unavailable'
    };
  }

  const candidates = [fundingTime, nextFundingTime].filter(Number.isFinite);
  let nearest = null;
  let delta = Infinity;

  for (const t of candidates) {
    const d = Math.abs(ts - t);
    if (d < delta) {
      delta = d;
      nearest = t;
    }
  }

  const minutes = delta / 60000;

  return {
    available: true,
    active: minutes <= 15,
    nearestFundingTime: nearest,
    minutesToFunding: nearest >= ts ? minutes : null,
    minutesFromFunding: nearest < ts ? minutes : null,
    source: 'OKX funding timestamps'
  };
}

export function buildEventRisk({
  timestamp,
  funding = {},
  externalEvents = []
} = {}) {
  const ts = n(timestamp, Date.now());
  const fundingState = fundingWindowState(ts, funding);
  const activeEvents = (externalEvents || []).filter((event) =>
    Number(event.startTs) <= ts &&
    Number(event.endTs) >= ts
  );
  const highImpact = activeEvents.some((event) => event.impact === 'HIGH');

  const flags = [];
  if (fundingState.active) flags.push('FUNDING_WINDOW');
  if (highImpact) flags.push('HIGH_IMPACT_EXTERNAL_EVENT');

  return {
    riskLevel: highImpact ? 'HIGH' : flags.length ? 'MEDIUM' : 'LOW',
    funding: fundingState,
    externalEvents: activeEvents,
    flags,
    tradeAllowed: !highImpact
  };
}