const URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';

export function upstashConfigured() {
  return Boolean(URL && TOKEN);
}

async function command(parts, { signal } = {}) {
  if (!upstashConfigured()) return { configured: false, result: null };
  const response = await fetch(URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(parts),
    cache: 'no-store',
    signal
  });
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  if (!response.ok) {
    throw new Error(`Upstash Redis HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  return { configured: true, result: data?.result ?? null };
}

export async function redisGetJson(key, { signal } = {}) {
  const r = await command(['GET', key], { signal });
  if (!r.configured || r.result == null) return { ...r, value: null };
  try {
    return { ...r, value: JSON.parse(r.result) };
  } catch {
    return { ...r, value: null };
  }
}

export async function redisSetJson(key, value, ttlSeconds = 120, { signal } = {}) {
  const r = await command(['SET', key, JSON.stringify(value), 'EX', String(Math.max(1, ttlSeconds))], { signal });
  return { ...r, stored: r.configured && r.result === 'OK' };
}

export async function redisSet(key, value, ttlSeconds = 120, { signal } = {}) {
  const r = await command(['SET', key, String(value), 'EX', String(Math.max(1, ttlSeconds))], { signal });
  return { ...r, stored: r.configured && r.result === 'OK' };
}
