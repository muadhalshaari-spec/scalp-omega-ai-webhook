import assert from 'node:assert/strict';
import { fetchDerivativeData } from '../lib/derivatives-data.js';
import { runInstitutionalBacktest } from '../lib/institutional-backtest.js';
import { buildEventRisk } from '../lib/event-risk-engine.js';

async function main() {
const INST_ID = 'ETH-USDT-SWAP';
const TIMEFRAMES = ['1m', '5m', '15m', '1H', '4H', '1D'];

async function okxJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const r = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'SCALP-Omega-CI/1.0'
      },
      signal: controller.signal
    });
    const body = await r.text();
    if (!r.ok) {
      const error = new Error(`OKX HTTP ${r.status}`);
      error.status = r.status;
      throw error;
    }
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      const error = new Error('OKX_INVALID_JSON');
      error.status = r.status;
      throw error;
    }
    if (String(data.code) !== '0') {
      const error = new Error(`OKX API error: ${data.msg || body.slice(0, 200)}`);
      error.status = r.status;
      throw error;
    }
    return data.data || [];
  } finally {
    clearTimeout(timer);
  }
}

async function candles(bar, target = 1000) {
  const useHistory = bar === '15m';
  const endpoint = useHistory ? 'history-candles' : 'candles';
  const out = [];
  let after = null;

  for (let page = 0; page < (useHistory ? Math.ceil(target / 300) + 2 : 5) && out.length < target; page += 1) {
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
    TIMEFRAMES.map(async tf => [tf, await candles(tf, tf === '15m' ? 1200 : 240)])
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

const derivativesAvailable = derivatives.quality.oi.available && derivatives.quality.funding.available;
if (!derivativesAvailable) {
  console.warn(JSON.stringify({
    ok: true,
    externalCheck: 'DEGRADED',
    reason: 'OKX derivative history unavailable',
    derivativeQuality: derivatives.quality
  }));
  process.exit(0);
}

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
}


try {
  await main();
} catch (error) {
  const message = String(error?.message || error);
  const status = Number(error?.status ?? error?.cause?.status ?? 0);
  const network = error instanceof TypeError || /fetch failed|AbortError|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network|timeout/i.test(message);
  const serviceUnavailable = status === 403 || status === 408 || status === 429 || status >= 500 || /OKX HTTP (403|408|429|5\\d\\d)/i.test(message);
  if (network || serviceUnavailable) {
    console.warn(JSON.stringify({ ok: true, externalCheck: "DEGRADED", reason: message }));
    process.exit(0);
  }
  throw error;
}
