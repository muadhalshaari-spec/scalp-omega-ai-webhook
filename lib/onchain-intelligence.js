const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
const ETHERSCAN_BASE = 'https://api.etherscan.io/v2/api';
const ALCHEMY_BASE = 'https://eth-mainnet.g.alchemy.com/v2';

function num(value) {
  const x = Number(value);
  return Number.isFinite(x) ? x : null;
}

async function readJson(url, options = {}) {
  const response = await fetch(url, { cache: 'no-store', ...options });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return body;
}

async function fetchCoinGecko(signal) {
  const key = process.env.COINGECKO_API_KEY;
  if (!key) return { configured: false, available: false, source: 'CoinGecko' };
  const url = `${COINGECKO_BASE}/simple/price?ids=ethereum,bitcoin&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true&include_last_updated_at=true`;
  const body = await readJson(url, { signal, headers: { Accept: 'application/json', 'x-cg-demo-api-key': key } });
  const eth = body?.ethereum || {};
  const btc = body?.bitcoin || {};
  return {
    configured: true,
    available: num(eth.usd) != null,
    source: 'CoinGecko',
    fetchedAt: new Date().toISOString(),
    ethereum: { priceUsd: num(eth.usd), marketCapUsd: num(eth.usd_market_cap), volume24hUsd: num(eth.usd_24h_vol), change24hPct: num(eth.usd_24h_change), lastUpdatedAt: num(eth.last_updated_at) ? num(eth.last_updated_at) * 1000 : null },
    bitcoin: { priceUsd: num(btc.usd), marketCapUsd: num(btc.usd_market_cap), volume24hUsd: num(btc.usd_24h_vol), change24hPct: num(btc.usd_24h_change), lastUpdatedAt: num(btc.last_updated_at) ? num(btc.last_updated_at) * 1000 : null }
  };
}

async function fetchAlchemy(signal) {
  const key = process.env.ALCHEMY_API_KEY;
  if (!key) return { configured: false, available: false, source: 'Alchemy' };
  const url = `${ALCHEMY_BASE}/${encodeURIComponent(key)}`;
  const request = async (method, params = []) => {
    const body = await readJson(url, { method: 'POST', signal, headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }) });
    if (body?.error) throw new Error(body.error.message || 'Alchemy JSON-RPC error');
    return body?.result ?? null;
  };
  const [blockHex, gasHex] = await Promise.all([request('eth_blockNumber'), request('eth_gasPrice')]);
  return { configured: true, available: Boolean(blockHex), source: 'Alchemy', network: 'ethereum-mainnet', fetchedAt: new Date().toISOString(), latestBlock: blockHex ? parseInt(blockHex, 16) : null, gasPriceWei: gasHex ? parseInt(gasHex, 16) : null, gasPriceGwei: gasHex ? parseInt(gasHex, 16) / 1e9 : null };
}

async function fetchEtherscan(signal) {
  const key = process.env.ETHERSCAN_API_KEY;
  if (!key) return { configured: false, available: false, source: 'Etherscan' };
  const params = new URLSearchParams({ chainid: '1', module: 'gastracker', action: 'gasoracle', apikey: key });
  const body = await readJson(`${ETHERSCAN_BASE}?${params.toString()}`, { signal, headers: { Accept: 'application/json' } });
  const result = body?.result || {};
  const available = String(body?.status) === '1' && num(result.SafeGasPrice) != null;
  return { configured: true, available, source: 'Etherscan', network: 'ethereum-mainnet', fetchedAt: new Date().toISOString(), gasOracle: available ? { safeGwei: num(result.SafeGasPrice), proposeGwei: num(result.ProposeGasPrice), fastGwei: num(result.FastGasPrice), suggestBaseFeeGwei: num(result.suggestBaseFee), lastBlock: num(result.LastBlock) } : null, error: available ? null : (result?.message || body?.message || 'Etherscan gas oracle unavailable') };
}

export async function fetchOnchainIntelligence({ signal } = {}) {
  const controller = signal ? null : new AbortController();
  const effectiveSignal = signal || controller.signal;
  const timeout = controller ? setTimeout(() => controller.abort(), 9000) : null;
  const tasks = await Promise.allSettled([fetchCoinGecko(effectiveSignal), fetchAlchemy(effectiveSignal), fetchEtherscan(effectiveSignal)]);
  const names = ['coingecko', 'alchemy', 'etherscan'];
  const providers = {};
  tasks.forEach((task, index) => {
    const name = names[index];
    providers[name] = task.status === 'fulfilled' ? task.value : { configured: Boolean(process.env[{ coingecko: 'COINGECKO_API_KEY', alchemy: 'ALCHEMY_API_KEY', etherscan: 'ETHERSCAN_API_KEY' }[name]]), available: false, source: name[0].toUpperCase() + name.slice(1), error: String(task.reason?.message || task.reason || 'provider error') };
  });
  if (timeout) clearTimeout(timeout);
  return { fetchedAt: new Date().toISOString(), providers, availableCount: Object.values(providers).filter(x => x.available === true).length, configuredCount: Object.values(providers).filter(x => x.configured === true).length, dataQuality: { readOnly: true, historical: false, note: 'On-chain providers are live context inputs; they do not replace persisted market history or prove trading performance.' } };
}
