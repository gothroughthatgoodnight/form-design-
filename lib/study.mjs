import sharp from 'sharp';
import rules from './rules.json' with { type: 'json' };
import initial from './snapshot.json' with { type: 'json' };
import { download, parallel, plain, webUrl, dayKey, iso, nextDay, lease, busy } from './common.mjs';

const config = rules.study;
const hosts = new Set(['commons.wikimedia.org', 'upload.wikimedia.org', 'thumb.wikimedia.org']);
const licenseHosts = new Set(['creativecommons.org', 'www.creativecommons.org']);
const excluded = new RegExp(config.EXCLUDE, 'i');
const licenses = new RegExp('^(?:' + config.LICENSE + ')$', 'i');
const angles = config.VIEWS.map(([name, pattern]) => [name, new RegExp(pattern, 'i')]);
const sequence = ['front45', 'rear', 'side', 'rear45', 'front', 'high'];
const normalized = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const luminance = (pixel) => pixel[0] * .2126 + pixel[1] * .7152 + pixel[2] * .0722;
const pixelKey = (pixel) => '#' + pixel.map((color) => color.toString(16).padStart(2, '0')).join('').toUpperCase();

export function detectView(title, description = '') {
  for (const text of [title, description.slice(0, 300)]) {
    for (const [name, pattern] of angles) {
      if (pattern.test(text.replaceAll('_', ' '))) return name;
    }
  }
  return null;
}

export function parseCandidates(payload, category, model, view) {
  if (payload.error) throw new Error('Commons API error');
  const output = [];
  for (const page of (payload.query?.pages || []).sort((first, second) => first.index - second.index)) {
    const image = page.imageinfo?.[0] || {};
    const title = page.title?.replace(/^File:/, '') || '';
    if (!Number.isSafeInteger(page.pageid) || page.pageid <= 0 || excluded.test(title) || !normalized(title).includes(normalized(model))) continue;
    if (/\b(and|together with|compared to|versus)\b/i.test(title)) continue;
    if (category === 'hatch' && /\b(estate|wagon|sportwagen|variant|sedan|saloon|coup[eé]|cabriolet|touring car|rally|polo)\b/i.test(title)) continue;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(image.mime) || image.width < 920 || image.height < 460 || image.width / image.height < 1.2 || image.width / image.height > 2.65) continue;
    const metadata = image.extmetadata || {};
    const license = plain(metadata.LicenseShortName?.value);
    const credit = plain(metadata.Artist?.value);
    const licenseUrl = webUrl(metadata.LicenseUrl?.value, licenseHosts);
    if (!licenses.test(license) || (/^cc by/i.test(license) && (!credit || !licenseUrl))) continue;
    const angle = detectView(title, plain(metadata.ImageDescription?.value));
    if (!angle || !(angle === view || (['front', 'rear'].includes(view) && angle.startsWith(view)))) continue;
    const original = webUrl(image.url, hosts);
    const thumb = webUrl(image.thumburl || image.url, hosts);
    const source = webUrl(image.descriptionurl, hosts);
    if (!original || !thumb || !source) continue;
    output.push({
      id: 'wm-' + page.pageid, modelKey: normalized(model), title: model, type: category, view: angle,
      source, original, thumb, credit: credit.slice(0, 300) || 'Wikimedia Commons',
      license, licenseUrl, provider: 'Wikimedia Commons', sha1: image.sha1,
    });
  }
  return { candidates: output, nextOffset: payload.continue?.gsroffset || 0 };
}

export function selectQueries(state, category = 'all', view = 'all') {
  const turn = state.jobs || 0;
  return Object.entries(config.MODELS).flatMap(([kind, models], index) => {
    if (category !== 'all' && kind !== category) return [];
    const shifts = category === kind ? [0, 1, 2, 3] : [0];
    return shifts.map((shift) => [
      kind,
      models[(category === kind ? turn + shift : Math.floor(turn / sequence.length)) % models.length],
      config.VIEW_QUERY[view] ? view : sequence[(turn + index + shift) % sequence.length],
    ]);
  });
}

export function palette(pixels) {
  const histogram = new Map();
  for (let offset = 0; offset < pixels.length; offset += 3) {
    const color = [pixels[offset], pixels[offset + 1], pixels[offset + 2]].map((value) => Math.round(value / 16) * 16).map((value) => Math.min(255, value));
    const key = pixelKey(color);
    const entry = histogram.get(key) || { color, count: 0 };
    entry.count++;
    histogram.set(key, entry);
  }
  const entries = [...histogram.values()].sort((first, second) => luminance(first.color) - luminance(second.color));
  if (entries.length < 5) return null;
  const low = luminance(entries[0].color);
  const high = luminance(entries.at(-1).color);
  const used = new Set();
  const colors = [];
  for (const point of [.03, .24, .48, .72, .96]) {
    const target = low + (high - low) * point;
    const chosen = entries.filter((entry) => !used.has(pixelKey(entry.color))).sort((first, second) =>
      (Math.abs(luminance(first.color) - target) - Math.min(400, first.count) * .012)
      - (Math.abs(luminance(second.color) - target) - Math.min(400, second.count) * .012))[0];
    used.add(pixelKey(chosen.color));
    colors.push(chosen.color);
  }
  return colors.sort((first, second) => luminance(first) - luminance(second)).map(pixelKey);
}

export async function preparePhoto(entry, { fetcher = fetch, timeout = 4_000 } = {}) {
  const bytes = await download(entry.thumb, { hosts, limit: 10_000_000, binary: true, timeout, fetcher });
  const image = sharp(bytes, { limitInputPixels: 24_000_000, failOn: 'error' }).rotate().removeAlpha().toColourspace('srgb');
  const { data: sample } = await image.clone().resize(100, 100, { fit: 'fill' })
    .extract({ left: 23, top: 31, width: 54, height: 44 }).raw().toBuffer({ resolveWithObject: true });
  const light = [];
  for (let offset = 0; offset < sample.length; offset += 3) light.push(luminance([sample[offset], sample[offset + 1], sample[offset + 2]]));
  const mean = light.reduce((sum, value) => sum + value, 0) / light.length;
  const contrast = Math.sqrt(light.reduce((sum, value) => sum + (value - mean) ** 2, 0) / light.length);
  if (mean < 48 || mean > 225 || contrast < 24) return null;
  const colors = palette(sample);
  if (!colors) return null;
  const full = await image.clone().resize({ width: 1680, height: 1100, fit: 'inside', withoutEnlargement: true }).webp({ quality: 87 }).toBuffer({ resolveWithObject: true });
  if (full.info.width < 640 || full.info.height < 330) return null;
  const small = await sharp(full.data).resize({ width: 840, height: 540, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  const { thumb, ...metadata } = entry;
  return { photo: { ...metadata, colors, width: full.info.width, height: full.info.height, importedAt: iso(), assetBase: 'cloud-images' }, full: full.data, small };
}

function combinedPhotos(state) {
  return [...new Map([...initial.study.photos, ...state.photos].map((photo) => [photo.id, photo])).values()];
}

export async function studySnapshot(store) {
  const state = await store.get('study', { type: 'json' }) || initial.study;
  return { ...state, photos: combinedPhotos(state), busy: await busy(store, 'study') };
}

export async function refreshStudy(store, category = 'all', view = 'all', { fetcher = fetch, now = Date.now() } = {}) {
  if (!['all', ...Object.keys(config.MODELS)].includes(category) || !['all', ...Object.keys(config.VIEW_QUERY)].includes(view)) throw new Error('Invalid study selection');
  const lock = await lease(store, 'study', now);
  if (lock.status !== 'started') return { ...await studySnapshot(store), status: lock.status };
  const deadline = Date.now() + 23_000;
  try {
    const previous = await studySnapshot(store);
    const cursors = { ...(previous.cursors || {}) };
    const results = await parallel(selectQueries(previous, category, view), 3, async (query) => {
      const [kind, model, angle] = query;
      const key = query.join('/');
      if (Date.now() >= deadline - 3_000) return { ok: false, candidates: [] };
      const params = new URLSearchParams({
        action: 'query', format: 'json', formatversion: '2', generator: 'search', gsrnamespace: '6', gsrlimit: '17',
        gsroffset: String(cursors[key] || 0), gsrsearch: 'intitle:"' + model + '" ' + config.VIEW_QUERY[angle] + ' filetype:bitmap -interior -dashboard',
        prop: 'imageinfo', iiprop: 'url|size|extmetadata|mime|sha1', iiurlwidth: '1280',
        iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl|ImageDescription',
      });
      try {
        const payload = await download('https://commons.wikimedia.org/w/api.php?' + params, { hosts, limit: 1_500_000, timeout: 3_500, fetcher });
        const result = parseCandidates(JSON.parse(payload), kind, model, angle);
        cursors[key] = result.nextOffset;
        return { ok: true, candidates: result.candidates.slice(0, 3) };
      } catch {
        return { ok: false, candidates: [] };
      }
    });
    const known = [...initial.curated, ...previous.photos];
    const ids = new Set(known.map((photo) => photo.id));
    const hashes = new Set(known.map((photo) => photo.sha1).filter(Boolean));
    const urls = new Set(known.map((photo) => photo.original));
    const candidates = results.flatMap((result) => result.candidates).filter((photo) => {
      if (ids.has(photo.id) || (photo.sha1 && hashes.has(photo.sha1)) || urls.has(photo.original)) return false;
      ids.add(photo.id);
      if (photo.sha1) hashes.add(photo.sha1);
      urls.add(photo.original);
      return true;
    }).slice(0, 6);
    const prepared = await parallel(candidates, 2, async (candidate) => {
      if (Date.now() >= deadline - 3_000) return null;
      try {
        const result = await preparePhoto(candidate, { fetcher, timeout: Math.min(4_000, deadline - Date.now() - 1_000) });
        if (!result) return null;
        await store.set('images/' + candidate.id + '.webp', result.full.buffer.slice(result.full.byteOffset, result.full.byteOffset + result.full.byteLength));
        await store.set('images/' + candidate.id + '-small.webp', result.small.buffer.slice(result.small.byteOffset, result.small.byteOffset + result.small.byteLength));
        return result.photo;
      } catch {
        return null;
      }
    });
    const added = prepared.filter(Boolean);
    const ended = Date.now();
    const failed = !results.some((result) => result.ok);
    const state = {
      ...previous, photos: [...previous.photos, ...added], cursors, busy: false,
      jobs: (previous.jobs || 0) + (failed ? 0 : 1),
      lastAdded: added.length, lastCheckedAt: iso(ended), failed,
      nextCheckAt: failed ? iso(ended + 30 * 60_000) : nextDay(ended),
    };
    await store.setJSON('study', state);
    return { ...state, status: 'complete' };
  } finally {
    await lock.release();
  }
}
