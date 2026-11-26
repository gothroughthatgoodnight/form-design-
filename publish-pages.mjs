import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileStore } from './lib/local-store.mjs';
import { newsSnapshot, refreshNews } from './lib/news.mjs';
import { studySnapshot, refreshStudy } from './lib/study.mjs';

export async function publishPages({ root = path.dirname(fileURLToPath(import.meta.url)), refresh = false, env = process.env, overrides = {} } = {}) {
  const store = new FileStore(path.join(root, 'data', 'store'));
  if (refresh) {
    for (const [name, update] of [['news', () => refreshNews(store, overrides)], ['study', () => refreshStudy(store, 'all', 'all', overrides)]]) {
      try { await update(); } catch { console.warn(name + ': retained previously saved content'); }
    }
  }
  const news = { ...await newsSnapshot(store), refreshing: false };
  const study = { ...await studySnapshot(store), busy: false };
  const photos = [];
  for (const photo of study.photos) {
    if (photo.assetBase === 'cloud-images') {
      if (!/^wm-\d+$/.test(photo.id)) continue;
      const pair = await Promise.all(['', '-small'].map((suffix) => store.get('images/' + photo.id + suffix + '.webp', { type: 'arrayBuffer' })));
      if (pair.some((bytes) => !bytes)) continue;
      const directory = path.join(root, 'site', 'study', 'cloud-images');
      await mkdir(directory, { recursive: true });
      for (let index = 0; index < pair.length; index++) await writeFile(path.join(directory, photo.id + (index ? '-small' : '') + '.webp'), Buffer.from(pair[index]));
    }
    photos.push(photo);
  }
  study.photos = photos;
  for (const [site, snapshot] of [['news', news], ['study', study]]) await writeFile(path.join(root, 'site', site, 'baseline.json'), JSON.stringify(snapshot));
  const repository = /^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9_-][a-z0-9_.-]*$/i.test(env.GITHUB_REPOSITORY || '') ? env.GITHUB_REPOSITORY : null;
  await writeFile(path.join(root, 'site', 'publish-info.json'), JSON.stringify({ repository, publishedAt: new Date().toISOString() }));
  await writeFile(path.join(root, 'site', '.nojekyll'), '');
  const summary = { articles: news.articles.length, importedPhotos: photos.length, repository, refreshed: refresh };
  console.log(JSON.stringify(summary));
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await publishPages({ refresh: process.argv.includes('--refresh') });
