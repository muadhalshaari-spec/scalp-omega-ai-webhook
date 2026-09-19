const DERIBIT_BASE_URL = 'https://www.deribit.com/api/v2';

function credentials() {
  return {
    clientId: process.env.DERIBIT_CLIENT_ID || '',
    clientSecret: process.env.DERIBIT_CLIENT_SECRET || ''
  };
}

export function deribitConfigured() {
  const { clientId, clientSecret } = credentials();
  return Boolean(clientId && clientSecret);
}

async function rpc(method, params = {}) {
  const url = new URL(DERIBIT_BASE_URL + '/public/' + method);
  if (Object.keys(params).length) {
    url.search = new URLSearchParams(params).toString();
  }

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  });
  const body = await response.text();
  let data;
  try { data = JSON.parse(body); } catch {}

  if (!response.ok || data?.error) {
    throw new Error(`Deribit HTTP ${response.status}: ${data?.error?.message || body.slice(0, 300)}`);
  }

  return data?.result ?? null;
}

async function privateRpc(method, params = {}) {
  const { clientId, clientSecret } = credentials();
  if (!clientId || !clientSecret) throw new Error('DERIBIT_CLIENT_ID/DERIBIT_CLIENT_SECRET are not configured');

  const tokenUrl = new URL(DERIBIT_BASE_URL + '/public/auth');
  tokenUrl.search = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret
  }).toString();

  const tokenResponse = await fetch(tokenUrl, {
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  });
  const tokenBody = await tokenResponse.text();
  let tokenData;
  try { tokenData = JSON.parse(tokenBody); } catch {}

  if (!tokenResponse.ok || tokenData?.error || !tokenData?.result?.access_token) {
    throw new Error(`Deribit auth HTTP ${tokenResponse.status}: ${tokenData?.error?.message || tokenBody.slice(0, 300)}`);
  }

  const response = await fetch(DERIBIT_BASE_URL + '/private/' + method, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${tokenData.result.access_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'private/' + method, params })
  });

  const body = await response.text();
  let data;
  try { data = JSON.parse(body); } catch {}

  if (!response.ok || data?.error) {
    throw new Error(`Deribit private HTTP ${response.status}: ${data?.error?.message || body.slice(0, 300)}`);
  }

  return data?.result ?? null;
}

export async function getDeribitMarket(instrument = 'ETH-PERPETUAL') {
  const [ticker, book, summary] = await Promise.all([
    rpc('ticker', { instrument_name: instrument }),
    rpc('get_order_book', { instrument_name: instrument, depth: 20 }),
    rpc('get_book_summary_by_instrument', { instrument_name: instrument })
  ]);

  return {
    instrument,
    ticker,
    orderBook: book,
    summary: Array.isArray(summary) ? summary[0] || null : summary
  };
}

export async function getDeribitAccount(currency = 'ETH') {
  return privateRpc('get_account_summary', { currency, extended: true });
}

export async function testDeribitCredentials() {
  const account = await getDeribitAccount('ETH');
  return {
    authenticated: true,
    currency: account?.currency || 'ETH',
    accountType: account?.type || null,
    equity: account?.equity ?? null,
    availableFunds: account?.available_funds ?? null
  };
}
