import { mean } from './quant-core.js';

export function estimatePBO(matrix) {
  const folds = Array.isArray(matrix) ? matrix : [];
  const variantCount = folds.reduce((m, fold) => Math.max(m, Array.isArray(fold) ? fold.length : 0), 0);
  if (folds.length < 4 || variantCount < 4) {
    return {
      pbo: null,
      folds: folds.length,
      variants: variantCount,
      method: 'insufficient sequential folds/variants',
      warning: 'PBO remains unestimable without multiple comparable strategy variants across multiple chronological folds'
    };
  }

  let bad = 0;
  let total = 0;

  // Sequential selection-bias proxy:
  // for each split, select the best variant on earlier folds and inspect its
  // rank on later folds. This is not full CSCV, but unlike the old placeholder
  // it actually models model-selection against unseen data.
  for (let split = 2; split <= folds.length - 2; split += 1) {
    const train = folds.slice(0, split);
    const test = folds.slice(split);
    const trainMeans = [];

    for (let v = 0; v < variantCount; v += 1) {
      const scores = train.map(f => Number(f?.[v])).filter(Number.isFinite);
      trainMeans.push(scores.length ? mean(scores) : null);
    }

    if (!trainMeans.some(Number.isFinite)) continue;
    const winner = trainMeans.reduce((best, value, index) =>
      Number.isFinite(value) && (!Number.isFinite(trainMeans[best]) || value > trainMeans[best]) ? index : best,
      0
    );

    const oos = [];
    for (let v = 0; v < variantCount; v += 1) {
      const scores = test.map(f => Number(f?.[v])).filter(Number.isFinite);
      oos.push(scores.length ? mean(scores) : null);
    }

    const winnerOos = oos[winner];
    const available = oos.filter(Number.isFinite);
    if (!Number.isFinite(winnerOos) || available.length < 4) continue;

    const rank = available.filter(x => x < winnerOos).length / (available.length - 1 || 1);
    if (rank <= 0.5) bad += 1;
    total += 1;
  }

  return {
    pbo: total ? bad / total : null,
    folds: folds.length,
    variants: variantCount,
    splits: total,
    method: 'sequential walk-forward selection-bias proxy',
    warning: 'diagnostic proxy; not full CSCV/CSCV-PBO'
  };
}

export function detectOverfit({
  inSample = 0,
  outOfSample = 0,
  experiments = 1,
  pbo = null
}) {
  const degradation = inSample
    ? Math.max(0, (inSample - outOfSample) / Math.abs(inSample))
    : 0;

  return {
    degradation,
    experiments,
    pbo,
    risk:
      (pbo != null && pbo > 0.5) || degradation > 0.35
        ? 'HIGH'
        : degradation > 0.2 || experiments > 100
          ? 'MEDIUM'
          : 'LOW'
  };
}
