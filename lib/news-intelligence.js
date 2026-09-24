import { upstashConfigured, redisGetJson, redisSetJson, redisSetIfAbsent } from './upstash.js';

const RSS_FEEDS = Object.freeze([
  { name: 'CoinDesk RSS', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { name: 'Cointelegraph RSS', url: 'https://cointelegraph.com/rss' },
  { name: 'Google News RSS', url: 'https://news.google.com/rss/search?q=Ethereum%20OR%20ETH&hl=en-US&gl=US&ceid=US:en' }
]);
const GDELT_URL = 'https://api.gdeltproject.org/api/v2/doc/doc?query=ethereum&mode=ArtList&format=json&maxrecords=20&sort=HybridRel&timespan=24h';
const GDELT_CACHE_KEY = 'scalp-omega:news:gdelt:ethereum:v2';
const GDELT_LOCK_KEY = `${GDELT_CACHE_KEY}:refresh-lock`;
const FRESH_SECONDS = 300;
const STALE_SECONDS = 1800;
const LOCK_SECONDS = 25;
let memoryCache = { at: 0, items: null, nextRetryAt: 0 };

function clean(value) {
  return String(value || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, ' ').replace(/\s+/g, ' ').trim();
}
function tag(xml, name) {
  const match = String(xml).match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return match ? clean(match[1]) : null;
}
function parseRss(xml, source) {
  return [...String(xml).matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map(match => {
    const body = match[1];
    const published = tag(body, 'pubDate') || tag(body, 'published') || tag(body, 'updated');
    const timestamp = published ? Date.parse(published) : null;
    return { source, title: tag(body, 'title'), url: tag(body, 'link') || tag(body, 'guid'), publishedAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null, summary: tag(body, 'description') };
  }).filter(item => item.title && item.url);
}
function relevance(item) {
  const text = `${item.title || ''} ${item.summary || ''}`.toLowerCase();
  const terms = ['ethereum', 'ether', 'eth', 'defi', 'staking', 'sec', 'etf', 'hack', 'exploit', 'liquidation', 'upgrade', 'regulation', 'fed', 'rate'];
  return terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0);
}
function eventTags(item) {
  const text = `${item.title || ''} ${item.summary || ''}`.toLowerCase();
  const tags = [];
  if (/hack|exploit|breach|stolen|attack/.test(text)) tags.push('SECURITY_RISK');
  if (/sec|regulat|lawsuit|ban|approval|etf/.test(text)) tags.push('REGULATORY');
  if (/fed|rate|inflation|cpi|jobs|fomc/.test(text)) tags.push('MACRO');
  if (/upgrade|fork|staking|validator/.test(text)) tags.push('PROTOCOL');
  if (/liquidat|sell.?off|crash|surge|rally/.test(text)) tags.push('MARKET_IMPACT');
  return tags;
}
const POSITIVE_WORDS = ['surge', 'rally', 'gain', 'gains', 'bullish', 'approval', 'adoption', 'growth', 'upgrade', '突破', 'ارتفاع', 'صعود', 'موافقة', 'نمو'];
const NEGATIVE_WORDS = ['hack', 'exploit', 'breach', 'crash', 'plunge', 'drop', 'loss', 'losses', 'bearish', 'lawsuit', 'ban', 'liquidation', 'risk', 'تحذير', 'اختراق', 'انهيار', 'هبوط', 'خسائر', 'حظر', 'مخاطر'];
const POLARIZING_WORDS = ['hack', 'exploit', 'lawsuit', 'ban', 'approval', 'etf', 'regulation', 'crash', 'surge', 'controversy', 'sec', 'fed', 'اختراق', 'حظر', 'تنظيم', 'انهيار', 'ارتفاع'];
function scoreSentiment(item) {
  const text = `${item.title || ''} ${item.summary || ''}`.toLowerCase();
  const positiveHits = POSITIVE_WORDS.filter(word => text.includes(word)).length;
  const negativeHits = NEGATIVE_WORDS.filter(word => text.includes(word)).length;
  const polarizingHits = POLARIZING_WORDS.filter(word => text.includes(word)).length;
  const totalHits = positiveHits + negativeHits;
  const raw = totalHits ? (positiveHits - negativeHits) / totalHits : 0;
  return {
    label: raw > 0.2 ? 'POSITIVE' : raw < -0.2 ? 'NEGATIVE' : 'NEUTRAL',
    polarity: Number(raw.toFixed(3)),
    intensity: Number(Math.min(1, totalHits / 4).toFixed(3)),
    confidence: Number(Math.min(1, totalHits / 3).toFixed(3)),
    polarization: Number(Math.min(1, polarizingHits / 3).toFixed(3)),
    positiveHits,
    negativeHits,
    polarizingHits,
    method: 'LOCAL_LEXICON_CONTEXT_ONLY'
  };
}
async function get(url, signal) {
  const response = await fetch(url, { signal, cache: 'no-store', headers: { Accept: 'application/rss+xml, application/xml, application/json', 'User-Agent': 'SCALP-Omega-News/1.0' } });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return { text, contentType: response.headers.get('content-type') || '' };
}
async function fetchRss(signal) {
  const results = await Promise.allSettled(RSS_FEEDS.map(feed => get(feed.url, signal).then(result => parseRss(result.text, feed.name))));
  return results.flatMap(result => result.status === 'fulfilled' ? result.value : []).map(item => ({ ...item, providerType: 'RSS' }));
}
function parseGdeltArticles(body) {
  return (Array.isArray(body?.articles) ? body.articles : []).map(article => ({ source: article.domain || 'GDELT', providerType: 'GDELT', title: clean(article.title), url: article.url || null, publishedAt: article.seendate ? new Date(String(article.seendate).replace(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6Z')).toISOString() : null, summary: clean(article.socialimage || '') })).filter(item => item.title && item.url);
}
function cacheStatus(entry, now = Date.now()) {
  if (!entry?.items) return { state: 'MISS', ageSeconds: null, fresh: false, stale: false, nextRetryAt: entry?.nextRetryAt || null };
  const ageSeconds = Math.max(0, Math.floor((now - Number(entry.storedAt || now)) / 1000));
  return { state: now < Number(entry.freshUntil || 0) ? 'FRESH' : now < Number(entry.staleUntil || 0) ? 'STALE' : 'EXPIRED', ageSeconds, fresh: now < Number(entry.freshUntil || 0), stale: now >= Number(entry.freshUntil || 0) && now < Number(entry.staleUntil || 0), nextRetryAt: entry.nextRetryAt || null, lastError: entry.lastError || null, shared: upstashConfigured() };
}
async function readGdeltCache(signal) {
  if (upstashConfigured()) {
    try { const result = await redisGetJson(GDELT_CACHE_KEY, { signal }); if (result.value) return result.value; } catch {}
  }
  return memoryCache.items ? { ...memoryCache, storedAt: memoryCache.at, freshUntil: memoryCache.at + FRESH_SECONDS * 1000, staleUntil: memoryCache.at + STALE_SECONDS * 1000 } : null;
}
async function writeGdeltCache(entry, signal) {
  memoryCache = { at: entry.storedAt, items: entry.items, nextRetryAt: entry.nextRetryAt || 0 };
  if (upstashConfigured()) await redisSetJson(GDELT_CACHE_KEY, entry, STALE_SECONDS, { signal }).catch(() => {});
}
async function fetchGdelt(signal) {
  const now = Date.now();
  const cached = await readGdeltCache(signal);
  const status = cacheStatus(cached, now);
  if (status.fresh) return { items: cached.items, cache: status };
  if (cached?.nextRetryAt && now < cached.nextRetryAt && status.stale) return { items: cached.items, cache: { ...status, state: 'STALE_BACKOFF' } };
  let lock = { acquired: true };
  if (upstashConfigured()) lock = await redisSetIfAbsent(GDELT_LOCK_KEY, String(now), LOCK_SECONDS, { signal }).catch(() => ({ acquired: false }));
  if (!lock.acquired) return { items: cached?.items || [], cache: { ...status, state: cached?.items ? 'STALE_REFRESH_IN_PROGRESS' : 'MISS_REFRESH_IN_PROGRESS' } };
  try {
    const { text } = await get(GDELT_URL, signal);
    const body = JSON.parse(text);
    const items = parseGdeltArticles(body);
    const entry = { storedAt: Date.now(), freshUntil: Date.now() + FRESH_SECONDS * 1000, staleUntil: Date.now() + STALE_SECONDS * 1000, nextRetryAt: 0, lastError: null, items };
    await writeGdeltCache(entry, signal);
    return { items, cache: cacheStatus(entry) };
  } catch (error) {
    const nextRetryAt = Date.now() + 5 * 60 * 1000;
    if (cached?.items) await writeGdeltCache({ ...cached, nextRetryAt, lastError: String(error?.message || error) }, signal);
    if (cached?.items) return { items: cached.items, cache: { ...status, state: 'STALE_ERROR_BACKOFF', nextRetryAt, lastError: String(error?.message || error) } };
    throw error;
  }
}
export async function fetchNewsIntelligence({ signal } = {}) {
  const controller = signal ? null : new AbortController();
  const effectiveSignal = signal || controller.signal;
  const timeout = controller ? setTimeout(() => controller.abort(), 9000) : null;
  const [rss, gdelt] = await Promise.allSettled([fetchRss(effectiveSignal), fetchGdelt(effectiveSignal)]);
  const gdeltResult = gdelt.status === 'fulfilled' ? gdelt.value : { items: [], cache: { state: 'ERROR', shared: upstashConfigured(), lastError: String(gdelt.reason?.message || gdelt.reason) } };
  const raw = [...(rss.status === 'fulfilled' ? rss.value : []), ...(gdeltResult.items || [])];
  const seen = new Set();
  const items = raw.map(item => ({ ...item, relevance: relevance(item), eventTags: eventTags(item), sentiment: scoreSentiment(item) })).filter(item => { const key = item.url || item.title; if (seen.has(key)) return false; seen.add(key); return true; }).sort((a, b) => (b.relevance - a.relevance) || String(b.publishedAt || '').localeCompare(String(a.publishedAt || ''))).slice(0, 40);
  const sentimentItems = items.filter(item => item.sentiment?.confidence > 0);
  const sentiment = {
    analyzedCount: items.length,
    scoredCount: sentimentItems.length,
    averagePolarity: sentimentItems.length ? Number((sentimentItems.reduce((sum, item) => sum + item.sentiment.polarity, 0) / sentimentItems.length).toFixed(3)) : 0,
    averageIntensity: sentimentItems.length ? Number((sentimentItems.reduce((sum, item) => sum + item.sentiment.intensity, 0) / sentimentItems.length).toFixed(3)) : 0,
    polarizationRate: items.length ? Number((items.filter(item => item.sentiment?.polarization >= 0.333).length / items.length).toFixed(3)) : 0,
    label: !sentimentItems.length ? 'UNAVAILABLE' : sentimentItems.reduce((sum, item) => sum + item.sentiment.polarity, 0) > 0.2 ? 'POSITIVE_BIAS' : sentimentItems.reduce((sum, item) => sum + item.sentiment.polarity, 0) < -0.2 ? 'NEGATIVE_BIAS' : 'MIXED_NEUTRAL',
    method: 'LOCAL_LEXICON_CONTEXT_ONLY'
  };
  if (timeout) clearTimeout(timeout);
  return { fetchedAt: new Date().toISOString(), sources: { rss: { configured: true, available: rss.status === 'fulfilled', feeds: RSS_FEEDS.map(feed => feed.name) }, gdelt: { configured: true, available: gdelt.status === 'fulfilled', query: 'ethereum, last 24h', cache: gdeltResult.cache, rateLimitNote: 'GDELT requests are shared through Upstash cache and backed off after errors' } }, itemCount: items.length, items, sentiment, dataQuality: { noApiKey: true, readOnly: true, newsIsContextOnly: true, sentimentContextOnly: true, note: 'News sentiment is contextual evidence and must not be treated as a standalone trading signal.' }, errors: { rss: rss.status === 'rejected' ? String(rss.reason?.message || rss.reason) : null, gdelt: gdelt.status === 'rejected' ? String(gdelt.reason?.message || gdelt.reason) : null } };
}
