const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function supabaseConfigured() {
  return Boolean(url && key);
}

export async function insertSignalEvent(row) {
  if (!supabaseConfigured()) return { configured: false };

  const response = await fetch(`${url}/rest/v1/signal_events`, {
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
    throw new Error(`Supabase HTTP ${response.status}: ${text.slice(0, 500)}`);
  }

  return { configured: true, persisted: true };
}
