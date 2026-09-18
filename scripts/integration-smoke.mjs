import assert from 'node:assert/strict';
import { fetchDerivativeData } from '../lib/derivatives-data.js';
import { runInstitutionalBacktest } from '../lib/institutional-backtest.js';
import { buildEventRisk } from '../lib/event-risk-engine.js';

const INST_ID = 'ETH-USDT-SWAP';
const TIMEFRAMES = ['1m', '5m', '15m', '1H', '4H', '1D'];

async function okxJson(url) {
  const r = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'SCALP-Omega-CI/1.0'
    }
  });
  const text = await r.text();
  const data = JSON.parse(text);
  assert.equal(r.ok, true, `OKX HTTP ${r.status}`);
  assert.equal(data.code, '0', `OKX API error: ${data.msg || text.slice(0, 200)}`);
  return data.data || [];
}

async function candles(bar, target = 1000) {
  const useHistory = bar === '15m';
  const endpoint = useHistory ? 'history-candles' : 'candles';
  const out = [];
  let after = null;

  for (let page = 0; page < (useHistory ? 6 : 5) && out.length < target; page += 1) {
    const q = new URLSearchParams({
      instId: INST_ID,
      bar,
      limit: '300'
    });
    if (after != null) q.set('after', String(after));

    const rows = await okxJson(`https://www.okx.com/api/v5/market/${endpoint}?${q}`);
    if (!rows.length) break;

    out.push(...rows);
    const oldest = Number(rows.at(-1)?.[0]);
    assert.equal(Number.isFinite(oldest), true, `invalid ${bar} timestamp`);
    if (oldest === after) break;
    after = oldest;
    if (rows.length < 300) break;
  }

  const unique = new Map(out.map(row => [String(row[0]), row]));
  return [...unique.values()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .slice(-target)
    .map(c => ({
      time: Number(c[0]),
      open: Number(c[1]),
      high: Number(c[2]),
      low: Number(c[3]),
      close: Number(c[4]),
      volume: Number(c[5]),
      confirmed: c[8] === '1'
    }));
}

const candlesByTf = Object.fromEntries(
  await Promise.all(
    TIMEFRAMES.map(async tf => [tf, await candles(tf, tf === '15m' ? 2000 : 1000)])
  )
);

for (const tf of TIMEFRAMES) {
  assert.ok(candlesByTf[tf].length >= 220, `${tf} history too short`);
  assert.equal(
    candlesByTf[tf][0].time <= candlesByTf[tf].at(-1).time,
    true,
    `${tf} is not chronological`
  );
}

const base15m = candlesByTf['15m'];
const derivatives = await fetchDerivativeData({
  instId: INST_ID,
  begin: base15m[0].time,
  end: base15m.at(-1).time,
  mode: 'backtest'
});

assert.ok(derivatives.quality.oi.available, 'OI history unavailable');
assert.ok(derivatives.quality.funding.available, 'funding history unavailable');

for (const row of derivatives.history.funding) {
  assert.equal(
    row.nextFundingTime == null,
    true,
    'historical funding row contains inferred future nextFundingTime'
  );
}

const result = runInstitutionalBacktest({
  candlesByTf,
  derivatives,
  horizonBars: 48,
  feesBps: 5,
  slippageBps: 2
});

assert.ok(Number.isFinite(result.summary.netR), 'backtest netR is not finite');
assert.ok(result.summary.trades >= 0, 'backtest trade count invalid');
assert.ok(result.walkForward.windows.length >= 4, 'walk-forward did not produce enough chronological windows');
assert.equal(result.methodology.lookahead, 'closed candles only');
assert.equal(
  result.methodology.derivativesAlignment,
  'as-of-only; no future derivative observation used'
);

const irregularFundingRisk = buildEventRisk({
  timestamp: 1_800_000,
  funding: {
    fundingTime: 0,
    nextFundingTime: 3_600_000
  }
});
assert.equal(irregularFundingRisk.funding.available, true);
assert.equal(irregularFundingRisk.funding.active, false);

console.log(JSON.stringify({
  ok: true,
  candles: Object.fromEntries(TIMEFRAMES.map(tf => [tf, candlesByTf[tf].length])),
  derivativeQuality: derivatives.quality,
  summary: result.summary,
  calibrationReady: result.calibration.ready,
  walkForwardWindows: result.walkForward.windows.length,
  pbo: result.pbo.pbo,
  irregularFundingRisk: irregularFundingRisk.funding
}, null, 2));
