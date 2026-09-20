const rawUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

function supabaseBaseUrl() {
  if (!rawUrl) return '';
  // Accept either the Supabase project URL or a URL that already includes /rest/v1.
  return rawUrl.replace(/\/+$/, '').replace(/\/rest\/v1$/i, '');
}

export function supabaseConfigured() {
  return Boolean(supabaseBaseUrl() && key);
}

export async function insertSignalEvent(row) {
  const baseUrl = supabaseBaseUrl();
  if (!baseUrl || !key) return { configured: false };

  const response = await fetch(`${baseUrl}/rest/v1/signal_events`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify(row),
    cache: 'no-store'
  });

  if (!response.ok) {
    const text = await response.text();
    if (response.status === 404) {
      return {
        configured: true,
        persisted: false,
        status: 'TABLE_MISSING',
        migrationRequired: 'supabase/schema.sql'
      };
    }
    throw new Error(`Supabase HTTP ${response.status}: ${text.slice(0, 500)}`);
  }

  return { configured: true, persisted: true, status: 'PERSISTED' };
}

export async function insertLiquidationEvents(rows) {
  const baseUrl = supabaseBaseUrl();
  if (!baseUrl || !key) return { configured: false, persisted: false, status: 'NOT_CONFIGURED' };
  if (!Array.isArray(rows) || rows.length === 0) return { configured: true, persisted: true, status: 'NO_EVENTS', inserted: 0 };

  const response = await fetch(`${baseUrl}/rest/v1/titan_liquidations?on_conflict=id`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=minimal'
    },
    body: JSON.stringify(rows),
    cache: 'no-store'
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase liquidation persistence HTTP ${response.status}: ${text.slice(0, 500)}`);
  }

  return { configured: true, persisted: true, status: 'PERSISTED', inserted: rows.length };
}

export async function getRecentLiquidations({ limit = 200, sinceMs = 3600000 } = {}) {
  const baseUrl = supabaseBaseUrl();
  if (!baseUrl || !key) return { configured: false, rows: [] };
  const since = new Date(Date.now() - sinceMs).toISOString();
  const q = new URLSearchParams({
    select: '*',
    event_ts: `gte.${since}`,
    order: 'event_ts.desc',
    limit: String(Math.max(1, Math.min(1000, limit)))
  });
  const response = await fetch(`${baseUrl}/rest/v1/titan_liquidations?${q.toString()}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
    cache: 'no-store'
  });
  if (!response.ok) throw new Error(`Supabase liquidation read HTTP ${response.status}`);
  const rows = await response.json();
  return { configured: true, rows: Array.isArray(rows) ? rows : [] };
}
