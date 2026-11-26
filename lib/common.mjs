import { XMLParser } from 'fast-xml-parser';

export const xml = new XMLParser({ ignoreAttributes: false, trimValues: false, parseTagValue: false, processEntities: true });
export const list = (value) => value == null ? [] : Array.isArray(value) ? value : [value];
export const iso = (moment = Date.now()) => new Date(moment).toISOString();
export const dayKey = (moment = Date.now()) => iso(moment + 8 * 3_600_000).slice(0, 10);
export const nextDay = (moment = Date.now()) => iso(Date.parse(dayKey(moment) + 'T16:00:00Z'));
export const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});

export function plain(input) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: "'", lsquo: "'", ndash: '–', mdash: '—' };
  return String(input ?? '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (original, entity) => {
      if (entity.startsWith('#')) {
        const value = entity.startsWith('#x') ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
        return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : '';
      }
      return named[entity] ?? original;
    }).replace(/\s+/g, ' ').trim();
}

export function webUrl(input, hosts = null) {
  try {
    const parsed = new URL(input);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || !parsed.hostname.includes('.')) return null;
    if (hosts && (parsed.protocol !== 'https:' || !hosts.has(parsed.hostname) || parsed.port)) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

export function urlKey(input) {
  const url = new URL(input);
  url.hash = '';
  for (const name of [...url.searchParams.keys()]) {
    if (/^utm_|^(fbclid|gclid)$/.test(name)) url.searchParams.delete(name);
  }
  url.searchParams.sort();
  return url.hostname.replace(/^www\./, '') + url.pathname.replace(/\/$/, '') + '?' + url.searchParams;
}

export async function download(address, { hosts, limit = 2_500_000, timeout = 8_000, fetcher = fetch, binary = false } = {}) {
  let target = webUrl(address, hosts);
  if (!target) throw new Error('Unsupported source');
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetcher(target, {
      redirect: 'manual', signal: AbortSignal.timeout(timeout),
      headers: { 'User-Agent': 'FORM-Workspace/2.0 (personal automotive design library)', Accept: binary ? 'image/*' : '*/*' },
    });
    if (response.status >= 300 && response.status < 400) {
      const next = new URL(response.headers.get('location') || '', target).href;
      await response.body?.cancel();
      target = webUrl(next, hosts);
      if (!target) throw new Error('Unsupported source redirect');
      continue;
    }
    if (!response.ok) throw new Error('Source returned ' + response.status);
    if (Number(response.headers.get('content-length')) > limit) {
      await response.body?.cancel();
      throw new Error('Source payload is too large');
    }
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > limit) throw new Error('Source payload is too large');
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel();
      throw error;
    }
    const buffer = Buffer.concat(chunks);
    return binary ? buffer : buffer.toString('utf8');
  }
  throw new Error('Too many source redirects');
}

export async function parallel(items, count, task) {
  const output = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(count, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await task(items[index], index);
    }
  }));
  return output;
}

export async function lease(store, name, now = Date.now()) {
  const key = 'lease/' + name;
  const prior = await store.getWithMetadata(key, { type: 'json' });
  if (prior && prior.data.expiresAt > now) return { status: 'busy' };
  if (prior && prior.data.after > now) return { status: 'cooldown' };
  const state = { expiresAt: now + 45_000, after: now + 60_000 };
  const result = await store.setJSON(key, state, prior ? { onlyIfMatch: prior.etag } : { onlyIfNew: true });
  if (!result.modified) return { status: 'busy' };
  return { status: 'started', release: () => store.setJSON(key, { ...state, expiresAt: 0 }, { onlyIfMatch: result.etag }) };
}

export async function busy(store, name) {
  const state = await store.get('lease/' + name, { type: 'json' });
  return Boolean(state && state.expiresAt > Date.now());
}
