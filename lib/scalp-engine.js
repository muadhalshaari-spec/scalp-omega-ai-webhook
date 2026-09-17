export function buildStructure(candles, left = 3, right = 3) {
  const highs = [], lows = [];
  for (let i = left; i < candles.length - right; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j !== i && candles[j].high >= candles[i].high) isHigh = false;
      if (j !== i && candles[j].low <= candles[i].low) isLow = false;
    }
    if (isHigh) highs.push({ index: i, price: candles[i].high, time: candles[i].time });
    if (isLow) lows.push({ index: i, price: candles[i].low, time: candles[i].time });
  }
  const classifyHighs = points => points.slice(-8).map((p, i, a) => ({ ...p, type: i === 0 ? 'INITIAL' : p.price > a[i - 1].price ? 'HH' : p.price < a[i - 1].price ? 'LH' : 'EQH' }));
  const classifyLows = points => points.slice(-8).map((p, i, a) => ({ ...p, type: i === 0 ? 'INITIAL' : p.price > a[i - 1].price ? 'HL' : p.price < a[i - 1].price ? 'LL' : 'EQL' }));
  const H = classifyHighs(highs), L = classifyLows(lows);
  const last = candles[candles.length - 1];
  const prevHigh = H.length ? H[H.length - 1] : null;
  const prevLow = L.length ? L[L.length - 1] : null;
  const previousHigh = H.length > 1 ? H[H.length - 2] : null;
  const previousLow = L.length > 1 ? L[L.length - 2] : null;
  const breakHigh = prevHigh && last.close > prevHigh.price;
  const breakLow = prevLow && last.close < prevLow.price;
  let event = 'NONE';
  if (breakHigh) event = previousHigh && previousHigh.type === 'LH' ? 'BOS_BULLISH' : 'BREAK_HIGH';
  if (breakLow) event = previousLow && previousLow.type === 'HL' ? 'BOS_BEARISH' : 'BREAK_LOW';
  return {
    highs: H,
    lows: L,
    currentPrice: last.close,
    latestSwingHigh: prevHigh,
    latestSwingLow: prevLow,
    structureEvent: event,
    protectedHigh: previousHigh?.price ?? null,
    protectedLow: previousLow?.price ?? null
  };
}

export function buildLiquidity(candles, tolerancePct = 0.0015) {
  const structure = buildStructure(candles);
  const price = candles[candles.length - 1].close;
  const highs = structure.highs || [];
  const lows = structure.lows || [];
  const pools = [];
  const addEqualPools = (points, side) => {
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i].price, b = points[j].price;
        const mid = (a + b) / 2;
        if (Math.abs(a - b) / mid <= tolerancePct) {
          pools.push({ side, type: side === 'HIGH' ? 'EQH' : 'EQL', price: mid, distancePct: ((price - mid) / mid) * 100, sourceTimes: [points[i].time, points[j].time] });
        }
      }
    }
  };
  addEqualPools(highs, 'HIGH');
  addEqualPools(lows, 'LOW');
  const recentHigh = highs.at(-1)?.price ?? null;
  const recentLow = lows.at(-1)?.price ?? null;
  const sweptHigh = recentHigh != null && candles.at(-1).high > recentHigh && candles.at(-1).close < recentHigh;
  const sweptLow = recentLow != null && candles.at(-1).low < recentLow && candles.at(-1).close > recentLow;
  return {
    pools: pools.slice(-12),
    nearestHighLiquidity: pools.filter(x => x.side === 'HIGH').sort((a,b) => Math.abs(a.price-price) - Math.abs(b.price-price))[0] || null,
    nearestLowLiquidity: pools.filter(x => x.side === 'LOW').sort((a,b) => Math.abs(a.price-price) - Math.abs(b.price-price))[0] || null,
    recentSwingHigh: recentHigh,
    recentSwingLow: recentLow,
    sweep: sweptHigh ? 'BUY_SIDE_SWEPT' : sweptLow ? 'SELL_SIDE_SWEPT' : 'NONE'
  };
}

export function buildOrderBookContext(orderBook, levels = 20) {
  if (!orderBook) return null;
  const bids = (orderBook.bids || []).slice(0, levels);
  const asks = (orderBook.asks || []).slice(0, levels);
  const bidSize = bids.reduce((s, x) => s + Number(x.size || 0), 0);
  const askSize = asks.reduce((s, x) => s + Number(x.size || 0), 0);
  const total = bidSize + askSize;
  const imbalance = total ? (bidSize - askSize) / total : 0;
  const largestBid = bids.reduce((a, b) => !a || b.size > a.size ? b : a, null);
  const largestAsk = asks.reduce((a, b) => !a || b.size > a.size ? b : a, null);
  return {
    bidSize, askSize, imbalance,
    bias: imbalance > 0.15 ? 'BID_DOMINANT' : imbalance < -0.15 ? 'ASK_DOMINANT' : 'BALANCED',
    largestBid, largestAsk,
    spread: bids[0] && asks[0] ? asks[0].price - bids[0].price : null,
    mid: bids[0] && asks[0] ? (asks[0].price + bids[0].price) / 2 : null
  };
}

export function buildMarketContext(candles, orderBook) {
  const last = candles.at(-1);
  const structure = buildStructure(candles);
  return {
    structure,
    liquidity: buildLiquidity(candles),
    orderBook: buildOrderBookContext(orderBook),
    location: {
      price: last.close,
      rangeHigh300: Math.max(...candles.map(c => c.high)),
      rangeLow300: Math.min(...candles.map(c => c.low)),
      rangePositionPct: ((last.close - Math.min(...candles.map(c => c.low))) / (Math.max(...candles.map(c => c.high)) - Math.min(...candles.map(c => c.low)))) * 100
    }
  };
}
