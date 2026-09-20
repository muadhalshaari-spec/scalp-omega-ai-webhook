function tsOf(row) {
  const ts = Number(row?.timestamp ?? row?.sourceTimestamp ?? row?.ts ?? row?.time);
  return Number.isFinite(ts) ? ts : null;
}

export function normalizeExternalHistory(rows, {
  provider,
  instrument = 'ETH-USDT-SWAP',
  metric
} = {}) {
  return (Array.isArray(rows) ? rows : [])
    .map(row => ({
      provider,
      instrument,
      metric,
      value: row?.value ?? null,
      timestamp: tsOf(row),
      sourceTimestamp: tsOf(row),
      fetchedAt: Number(row?.fetchedAt) || null
    }))
    .filter(row => row.timestamp != null)
    .sort((a, b) => a.timestamp - b.timestamp);
}

export function asOfExternal(rows, decisionTimestamp) {
  const source = Array.isArray(rows) ? rows : [];
  let lo = 0, hi = source.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (source[mid].sourceTimestamp <= decisionTimestamp) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 ? source[lo - 1] : null;
}

export function alignExternalHistory(histories, decisionTimestamps) {
  const output = [];
  for (const decisionTimestamp of decisionTimestamps || []) {
    const metrics = {};
    for (const [key, rows] of Object.entries(histories || {})) {
      const row = asOfExternal(rows, decisionTimestamp);
      metrics[key] = row
        ? { ...row, asOf: decisionTimestamp, lookaheadSafe: row.sourceTimestamp <= decisionTimestamp }
        : { value: null, asOf: decisionTimestamp, lookaheadSafe: true, status: 'MISSING' };
    }
    output.push({ decisionTimestamp, metrics });
  }
  return output;
}

export function externalHistoryQuality(histories, decisionTimestamps) {
  const timestamps = decisionTimestamps || [];
  const keys = Object.keys(histories || {});
  let available = 0, violations = 0;
  for (const ts of timestamps) {
    for (const key of keys) {
      const row = asOfExternal(histories[key], ts);
      if (row) {
        available += 1;
        if (row.sourceTimestamp > ts) violations += 1;
      }
    }
  }
  const expected = timestamps.length * keys.length;
  const coverage = expected ? available / expected : 0;
  return {
    status: violations ? 'INVALID' : coverage === 1 ? 'COMPLETE' : coverage > 0 ? 'PARTIAL' : 'MISSING',
    coverage,
    availableObservations: available,
    expectedObservations: expected,
    lookaheadSafe: violations === 0
  };
}
