import { readFile, stat, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = import.meta.dirname;
const read = async (name) => JSON.parse(await readFile(path.join(root, name), 'utf8'));
const curated = await read('site/study/library.json');
const study = await read('site/study/baseline.json');
const news = await read('site/news/baseline.json');
const references = await read('site/study/references.json');
const files = ['site/index.html', 'site/.nojekyll', 'site/publish-info.json', '.github/workflows/pages.yml'];
for (const name of ['news', 'study']) for (const file of ['index.html', 'app.js', 'style.css', 'cloud-client.js', 'baseline.json', 'references.json', 'references.js', 'references.css']) files.push('site/' + name + '/' + file);
for (const photo of curated) for (const suffix of ['', '-small']) files.push('site/study/assets/' + photo.id + suffix + '.webp');
for (const photo of study.photos) {
  if (!/^wm-\d+$/.test(photo.id)) throw new Error('Unsupported imported image id');
  for (const suffix of ['', '-small']) files.push('site/study/' + (photo.assetBase === 'cloud-images' ? 'cloud-images/' : 'online/') + photo.id + suffix + '.webp');
}
for (const album of references.albums) if (album.preview) for (const name of ['news', 'study']) for (const suffix of ['', '-small']) files.push('site/' + name + '/previews/' + album.preview.id + suffix + '.webp');
for (const file of files) if (!(await stat(path.join(root, file))).isFile()) throw new Error('Missing file: ' + file);
const roots = await readdir(path.join(root, 'site'));
if (roots.some((name) => !['index.html', 'news', 'study', '.nojekyll', 'publish-info.json'].includes(name))) throw new Error('Unexpected public content');
if (!news.articles.length || references.albums.length !== 24) throw new Error('Content missing');
console.log('GitHub Pages verified: ' + files.length + ' resources, ' + news.articles.length + ' articles, ' + (curated.length + study.photos.length) + ' photographs, 24 reference albums.');
