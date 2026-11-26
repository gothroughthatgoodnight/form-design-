import rules from './rules.json' with { type: 'json' };
import initial from './snapshot.json' with { type: 'json' };
import { download, list, plain, webUrl, urlKey, xml, iso, nextDay, lease, busy } from './common.mjs';

const config = rules.news;
const categories = Object.fromEntries(Object.entries(config.CATEGORY_TERMS).map(([name, pattern]) => [name, new RegExp(pattern, 'i')]));
const context = new RegExp(config.AUTO_CONTEXT, 'i');
const noise = new RegExp(config.NOISE, 'i');
const hosts = new Set(config.SOURCES.flatMap(([, address, homepage]) => [new URL(address).hostname, new URL(homepage).hostname]));
const aliases = new Set(initial.seeds.flatMap((entry) => entry.alternateUrls || []).map(urlKey));

export function classify(title, description, source) {
  const combined = title + ' ' + description.slice(0, 380);
  if (noise.test(title) || (source !== 'Auto&Design' && !context.test(combined))) return null;
  for (const text of [title, combined]) {
    for (const name of ['interview', 'materials', 'concept', 'launch', 'styling']) {
      if (categories[name].test(text)) return name;
    }
  }
  return source === 'Auto&Design' && context.test(combined) && !/hall of fame|obituary|awards/i.test(title) ? 'styling' : null;
}

export function merge(older, newer) {
  const indexed = new Map([...older, ...newer].filter((entry) => !aliases.has(urlKey(entry.url))).map((entry) => [urlKey(entry.url), entry]));
  for (const entry of initial.seeds) indexed.set(urlKey(entry.url), entry);
  return [...indexed.values()].sort((first, second) => Date.parse(second.date) - Date.parse(first.date));
}

function imageFromMarkup(input) {
  const match = String(input || '').match(/<img\b[^>]*\b(?:src|data-src)=["']([^"']+)["']/i);
  return match ? webUrl(match[1].replaceAll('&amp;', '&')) : null;
}

export function parseFeed(payload, source, now = Date.now()) {
  if (/<!DOCTYPE|<!ENTITY/i.test(payload)) throw new Error('Unexpected feed declaration');
  const channel = xml.parse(payload)?.rss?.channel;
  if (!channel) throw new Error('Expected RSS channel');
  const output = [];
  for (const entry of list(channel.item).slice(0, 70)) {
    const title = plain(entry.title);
    const address = webUrl(entry.link);
    const published = Date.parse(entry.pubDate);
    if (!title || !address || !Number.isFinite(published) || published < now - 120 * 86_400_000 || published > now + 300_000) continue;
    const description = plain(entry.description);
    const category = classify(title, description, source);
    if (!category) continue;
    if (category === 'launch' && source !== 'Auto&Design' && !/unveil|reveal|debut|premiere|facelift|redesign|first look|all[- ]new|design|styling|(?:toyota|ford|nissan|kia|hyundai|bmw|honda)\S{0,2} new/i.test(title)) continue;
    const media = [...list(entry['media:content']), ...list(entry['media:thumbnail']), ...list(entry.enclosure)];
    const asset = media.find((item) => (item['@_medium'] || 'image') === 'image' && (item['@_type'] || 'image/').startsWith('image/') && webUrl(item['@_url']));
    const image = asset ? webUrl(asset['@_url']) : imageFromMarkup(entry.description) || imageFromMarkup(entry['content:encoded']);
    output.push({
      title: title.length > 180 ? title.slice(0, 179) + '…' : title,
      url: address, category, source, date: iso(published), image, credit: image ? source : null,
      summary: description.length > 190 ? description.slice(0, 189) + '…' : description, automatic: true,
    });
  }
  return output.slice(0, 30);
}

export async function newsSnapshot(store) {
  const state = await store.get('news', { type: 'json' }) || initial.news;
  return { ...state, articles: merge(state.articles || [], []), refreshing: await busy(store, 'news'), schedule: 'daily-beijing' };
}

export async function refreshNews(store, { fetcher = fetch, now = Date.now() } = {}) {
  const lock = await lease(store, 'news', now);
  if (lock.status !== 'started') return { ...await newsSnapshot(store), status: lock.status };
  try {
    const prior = await newsSnapshot(store);
    const results = await Promise.all(config.SOURCES.map(async ([name, address, homepage]) => {
      try {
        const payload = await download(address, { hosts, fetcher });
        const articles = parseFeed(payload, name, now);
        return { source: { name, url: homepage, ok: true, count: articles.length }, articles };
      } catch {
        return { source: { name, url: homepage, ok: false, count: 0 }, articles: [] };
      }
    }));
    const sources = results.map((result) => result.source);
    const merged = merge(prior.articles, results.flatMap((result) => result.articles));
    const known = new Set(prior.articles.map((entry) => urlKey(entry.url)));
    const ended = Date.now();
    const any = sources.some((source) => source.ok);
    const state = {
      articles: merged.filter((entry) => entry.automatic).slice(0, 360), sources,
      lastCheckedAt: iso(ended), lastUpdatedAt: any ? iso(ended) : prior.lastUpdatedAt,
      nextCheckAt: sources.every((source) => source.ok) ? nextDay(ended) : iso(ended + 30 * 60_000),
      lastAdded: merged.filter((entry) => !known.has(urlKey(entry.url))).length,
      refreshError: !any, schedule: 'daily-beijing',
    };
    await store.setJSON('news', state);
    return { ...state, articles: merge(state.articles, []), refreshing: false, status: 'complete' };
  } finally {
    await lock.release();
  }
}
