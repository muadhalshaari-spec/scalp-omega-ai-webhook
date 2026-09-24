const RSS_FEEDS = Object.freeze([
  { name: 'CoinDesk RSS', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { name: 'Cointelegraph RSS', url: 'https://cointelegraph.com/rss' }
]);
const GDELT_URL = 'https://api.gdeltproject.org/api/v2/doc/doc?query=ethereum&mode=ArtList&format=json&maxrecords=20&sort=HybridRel&timespan=24h';
let gdeltCache = { at: 0, items: null };

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
async function fetchGdelt(signal) {
  if (gdeltCache.items && Date.now() - gdeltCache.at < 5 * 60 * 1000) return gdeltCache.items;
  const { text } = await get(GDELT_URL, signal);
  const body = JSON.parse(text);
  const items = (Array.isArray(body?.articles) ? body.articles : []).map(article => ({ source: article.domain || 'GDELT', providerType: 'GDELT', title: clean(article.title), url: article.url || null, publishedAt: article.seendate ? new Date(String(article.seendate).replace(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6Z')).toISOString() : null, summary: clean(article.socialimage || '') })).filter(item => item.title && item.url);
  gdeltCache = { at: Date.now(), items };
  return items;
}
export async function fetchNewsIntelligence({ signal } = {}) {
  const controller = signal ? null : new AbortController();
  const effectiveSignal = signal || controller.signal;
  const timeout = controller ? setTimeout(() => controller.abort(), 9000) : null;
  const [rss, gdelt] = await Promise.allSettled([fetchRss(effectiveSignal), fetchGdelt(effectiveSignal)]);
  const raw = [...(rss.status === 'fulfilled' ? rss.value : []), ...(gdelt.status === 'fulfilled' ? gdelt.value : [])];
  const seen = new Set();
  const items = raw.map(item => ({ ...item, relevance: relevance(item), eventTags: eventTags(item) })).filter(item => { const key = item.url || item.title; if (seen.has(key)) return false; seen.add(key); return true; }).sort((a, b) => (b.relevance - a.relevance) || String(b.publishedAt || '').localeCompare(String(a.publishedAt || ''))).slice(0, 40);
  if (timeout) clearTimeout(timeout);
  return { fetchedAt: new Date().toISOString(), sources: { rss: { configured: true, available: rss.status === 'fulfilled', feeds: RSS_FEEDS.map(feed => feed.name) }, gdelt: { configured: true, available: gdelt.status === 'fulfilled', query: 'ethereum, last 24h', rateLimitNote: 'GDELT requests should be spaced to respect public-service limits' } }, itemCount: items.length, items, dataQuality: { noApiKey: true, readOnly: true, newsIsContextOnly: true, note: 'News is contextual evidence and must not be treated as a standalone trading signal.' }, errors: { rss: rss.status === 'rejected' ? String(rss.reason?.message || rss.reason) : null, gdelt: gdelt.status === 'rejected' ? String(gdelt.reason?.message || gdelt.reason) : null } };
}
