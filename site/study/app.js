const types = { all: '全部车型', hatch: '两厢', wagon: '猎装', suv: 'SUV', mpv: 'MPV', coupe: '轿跑 / GT', supercar: '超跑', roadster: '敞篷' };
const views = {
  all: ['全部视角', 'grid'], front: ['正视图', 'front'], side: ['侧视图', 'side'],
  rear: ['后视图', 'rear'], front45: ['前 45°', 'angle'], rear45: ['后 45°', 'angleBack'],
  high: ['高机位', 'high'],
};
const practice = {
  front: '先画车身中线，再用灯组和轮距找左右对称关系。',
  side: '先定前后轮轴，再对照车顶最高点和前后悬。',
  rear: '先抓尾部最宽处，再画后窗、尾灯与下包围的层次。',
  front45: '先定远近两只前轮的大小，再看车头平面如何转向侧面。',
  rear45: '先区分车尾平面和后轮肩，再用明暗表现转折。',
  high: '先画车顶和机盖的平面轮廓，再处理近宽远窄的透视。',
};
const icons = {
  refresh: '<path d="M19 8a8 8 0 0 0-13-2L4 8m0-5v5h5m-4 8a8 8 0 0 0 13 2l2-2m0 5v-5h-5"/>',
  calendar: '<rect x="4" y="6" width="16" height="14" rx="2"/><path d="M8 4v4m8-4v4M4 11h16m-13 4h2m3 0h2"/>',
  spark: '<path d="M12 2c1 6 4 9 10 10-6 1-9 4-10 10-1-6-4-9-10-10 6-1 9-4 10-10Z"/>',
  grid: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
  front: '<path d="m5 11 2-5h10l2 5m-14 0h14v6H5zm2 6v2m10-2v2M8 14h1m6 0h1"/>',
  side: '<path d="M3 14l3-3 4-3h5l4 3 2 1v4h-2m-12 0H3v-2m8 2h4"/><circle cx="9" cy="16" r="2"/><circle cx="17" cy="16" r="2"/>',
  rear: '<path d="m5 10 2-4h10l2 4v7H5zm2 7v2m10-2v2M7 13h3m4 0h3m-6 2h2"/>',
  angle: '<path d="m4 10 8-5 8 4-8 5zm0 0v6l8 4 8-5V9m-8 5v6"/>',
  angleBack: '<path d="m4 9 8-4 8 5-8 4zm0 0v6l8 5 8-4v-6m-8 4v6"/>',
  high: '<path d="M8 5h8l3 4v8l-3 2H8l-3-2V9zM8 10h8m-7 5h6"/>',
  expand: '<path d="M10 5H5v5m9-5h5v5m0 4v5h-5m-9-5v5h5"/>',
  external: '<path d="M12 5h7v7m0-7-9 9m8 1v4H5V6h4"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
};
const toneNames = ['深阴影', '暗部', '中间调', '受光面', '高光'];
const byId = (name) => document.getElementById(name);
const dialog = byId('detail');
const gallery = byId('grid');
const dateFormatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
const pageSize = 9;
const swatchPattern = /^#[0-9A-F]{6}$/i;
let day = dateFormatter.format(new Date());
let catalog = [];
let curated = [];
let imports = [];
let activeType = 'all';
let activeView = 'all';
let rotation = 0;
let results = [];
let visible = 0;
let ready = false;
let syncing = false;
let requesting = false;
let seenSync = null;
let pollTimer;

function element(tag, className = '', label = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (label) node.textContent = label;
  return node;
}

function button(label, className = '') {
  const node = element('button', className, label);
  node.type = 'button';
  return node;
}

function setIcon(node, name) {
  node.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + icons[name] + '</svg>';
}

function icon(name, className = '') {
  const node = element('span', className);
  setIcon(node, name);
  return node;
}

function asset(entry, small = false) {
  if (entry.assetBase === 'previews' && /^ref-[a-z0-9-]{3,40}$/.test(entry.id)) return 'previews/' + entry.id + (small ? '-small' : '') + '.webp';
  const directory = entry.assetBase === 'cloud-images' && /^wm-\d+$/.test(entry.id) ? 'cloud-images/' : entry.provider === 'Wikimedia Commons' && /^wm-\d+$/.test(entry.id) ? 'online/' : 'assets/';
  return directory + entry.id + (small ? '-small' : '') + '.webp';
}

function hash(text) {
  let value = 2166136261;
  for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  value ^= value >>> 16;
  return Math.imul(value, 0x45d9f3b) >>> 0;
}

function recordIsValid(entry) {
  return entry && /^[a-z][a-z0-9-]{2,35}$/.test(entry.id) && Object.hasOwn(types, entry.type)
    && Object.hasOwn(views, entry.view) && entry.type !== 'all' && entry.view !== 'all'
    && Array.isArray(entry.colors) && entry.colors.length === 5
    && entry.colors.every((color) => swatchPattern.test(color));
}

function entriesForGallery() {
  const photos = [...catalog, ...referenceLibrary.photoEntries()];
  return [...photos, ...referenceLibrary.studyEntries(photos)];
}

function firstPageMix(entries) {
  const daily = [...entries].sort((a, b) => hash(day + '/' + a.id) - hash(day + '/' + b.id));
  if (daily.length < 2) return daily;
  const fresh = daily.filter((entry) => entry.importedAt?.slice(0, 10) === day);
  if (fresh.length) {
    const remaining = daily.filter((entry) => entry.importedAt?.slice(0, 10) !== day);
    const rotate = (items) => {
      const offset = rotation % (items.length || 1);
      return [...items.slice(offset), ...items.slice(0, offset)];
    };
    const newer = rotate(fresh);
    const older = rotate(remaining);
    return [...newer.slice(0, 6), ...older.slice(0, 3), ...newer.slice(6), ...older.slice(3)];
  }
  const offset = (rotation * Math.min(7, daily.length - 1)) % daily.length;
  const shifted = [...daily.slice(offset), ...daily.slice(0, offset)];
  const picked = [];
  const seen = new Set();
  const key = activeType === 'all' && activeView === 'all' ? 'type' : 'modelKey';
  shifted.forEach((entry) => {
    if (seen.has(entry[key])) return;
    seen.add(entry[key]);
    picked.push(entry);
  });
  const leaders = new Set(picked.map((entry) => entry.id));
  return [...picked, ...shifted.filter((entry) => !leaders.has(entry.id))];
}

function updateDate() {
  const display = byId('today');
  display.dateTime = day;
  display.textContent = day.replaceAll('-', ' / ');
}

function mountFilters() {
  const bar = byId('types');
  for (const [type, label] of Object.entries(types)) {
    const control = button(label, 'type-btn');
    control.dataset.type = type;
    control.addEventListener('click', () => {
      activeType = type;
      rotation = 0;
      rebuild();
      if (window.scrollY > 0) byId('gallery').scrollIntoView({ block: 'start' });
    });
    bar.append(control);
  }
  for (const [view, [label, symbol]] of Object.entries(views)) {
    const control = button('', 'view-btn');
    control.dataset.view = view;
    control.append(icon(symbol, 'view-icon'), element('span', '', label), element('span', 'view-count', '—'));
    control.addEventListener('click', () => {
      activeView = view;
      rotation = 0;
      rebuild();
      if (window.scrollY > 0) byId('gallery').scrollIntoView({ block: 'start' });
    });
    byId('views').append(control);
  }
  updateFilters();
}

function updateFilters(typeEntries = []) {
  byId('types').querySelectorAll('button').forEach((node) => node.setAttribute('aria-pressed', String(node.dataset.type === activeType)));
  byId('views').querySelectorAll('button').forEach((node) => {
    const key = node.dataset.view;
    node.setAttribute('aria-pressed', String(key === activeView));
    const photos = typeEntries.filter((entry) => entry.kind !== 'album');
    node.querySelector('.view-count').textContent = ready ? String(key === 'all' ? photos.length : photos.filter((entry) => entry.view === key).length) : '—';
  });
}

function tint(node, color) {
  node.style.backgroundColor = color;
}

function card(entry, order) {
  if (entry.kind === 'album') return albumCard(entry);
  const node = byId('photo-card').content.firstElementChild.cloneNode(true);
  node.dataset.kind = 'photo';
  node.dataset.type = entry.type;
  node.dataset.view = entry.view;
  node.dataset.provider = entry.provider || 'curated';
  const image = node.querySelector('img');
  if (order < 6) image.loading = 'eager';
  image.src = asset(entry, true);
  node.querySelector('.view-badge').textContent = views[entry.view][0];
  node.querySelector('.vehicle-type').textContent = types[entry.type];
  node.querySelector('h3').textContent = entry.title;
  setIcon(node.querySelector('.open-icon'), 'expand');
  const preview = node.querySelector('.card-palette');
  entry.colors.forEach((color) => {
    const chip = element('i');
    tint(chip, color);
    preview.append(chip);
  });
  if (referenceLibrary.matches(entry).length) {
    node.querySelector('.card-text > div').append(element('small', 'source-association', '可查看 NetCarShow 同车系图集'));
  }
  node.querySelector('button').addEventListener('click', () => showDetail(entry));
  return node;
}

function albumCard(entry) {
  const node = byId('photo-card').content.firstElementChild.cloneNode(true);
  node.classList.add('album-card');
  node.dataset.kind = 'album';
  node.dataset.type = entry.type;
  node.dataset.provider = 'NetCarShow';
  const image = node.querySelector('img');
  if (entry.preview) {
    image.src = asset(entry.preview, true);
    image.alt = entry.preview.title + ' · ' + entry.preview.credit;
  } else {
    image.remove();
    const cover = element('div', 'album-cover');
    cover.append(element('span', '', 'NETCARSHOW'), element('strong', '', types[entry.type]), element('small', '', '原站外链 · 尚未导入图片'));
    node.querySelector('.photo').append(cover);
  }
  node.querySelector('.view-badge').textContent = '原站图集 · 视角待选';
  node.querySelector('.vehicle-type').textContent = types[entry.type] + ' / ' + entry.year + ' 年款';
  node.querySelector('h3').textContent = entry.title;
  const palette = node.querySelector('.card-palette');
  if (entry.preview) {
    palette.title = '五色来自当前本站预览照片，点击卡片查看色值';
    for (const color of entry.preview.colors) {
      const chip = element('i');
      tint(chip, color);
      palette.append(chip);
    }
  } else {
    palette.remove();
  }
  node.querySelector('.card-text > div').append(element('small', 'source-association', entry.preview ? entry.preview.note || '预览为本站同车系照片 · 年款可能不同' : '图片在 NetCarShow 原站查看'));
  setIcon(node.querySelector('.open-icon'), 'external');
  node.querySelector('button').addEventListener('click', () => showAlbum(entry));
  return node;
}

function showAlbum(entry) {
  const head = element('div', 'detail-head');
  const titleBlock = element('div');
  const title = element('h2', '', entry.title);
  title.id = 'dialog-title';
  titleBlock.append(element('p', '', types[entry.type] + ' / ' + entry.year + ' 年款 / NetCarShow 图集'), title);
  const close = button('', 'close glass');
  close.setAttribute('aria-label', '关闭详情');
  close.append(icon('close'));
  close.addEventListener('click', () => dialog.close());
  head.append(titleBlock, close);
  const main = element('div', 'detail-main');
  const figure = element('figure', 'detail-figure');
  if (entry.preview) {
    const image = element('img');
    image.src = asset(entry.preview);
    image.alt = entry.preview.title + ' · ' + entry.preview.credit;
    const caption = element('figcaption');
    caption.append('图片：' + entry.preview.credit + ' · ', external(entry.preview.source, '图片来源'), ' · ',
      external(entry.preview.licenseUrl, entry.preview.license), '。' + (entry.preview.note || '本站同车系参考照片；年款、版本可能不同。'));
    figure.append(image, caption);
  }
  figure.append(element('p', 'album-description', entry.exercise));
  const original = external(entry.source, '打开 NetCarShow 完整图集 ↗');
  original.className = 'album-original glass';
  figure.append(original);
  const panel = element('aside', 'detail-side glass');
  if (entry.preview) {
    panel.append(element('h3', '', '本站预览照片色卡'), element('p', '', '以下五色来自当前本站预览照片，不是原站其他图片的取色结果。'), ...makeSwatches(entry.preview));
  } else {
    panel.append(element('h3', '', '尚无本站图片与色卡'), element('p', '', '当前只收录了这个车系的原站图集链接。尚未导入可取色的图片，因此没有图片预览和五色色卡。可用下方按钮打开原站图集。'));
  }
  panel.append(element('p', 'detail-tip', '图集没有已核对的逐张视角标签，因此仅在“全部视角”显示；单一视角筛选仍使用已标注的本站照片。'));
  main.append(figure, panel);
  byId('detail-body').replaceChildren(head, main, ...(entry.preview ? [similarReferences(entry.preview)] : []));
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
}

function appendResults(focus = false) {
  if (visible >= results.length) return;
  const next = results.slice(visible, visible + pageSize).map((entry, index) => card(entry, visible + index));
  gallery.append(...next);
  visible += next.length;
  const more = visible < results.length;
  byId('load').hidden = !more;
  byId('end').textContent = more ? '' : '已浏览完这个筛选下的素材';
  if (focus) next[0]?.querySelector('button').focus({ preventScroll: false });
}

function rebuild() {
  if (!ready) return;
  const entries = entriesForGallery();
  const typeEntries = activeType === 'all' ? entries : entries.filter((entry) => entry.type === activeType);
  const filtered = activeView === 'all' ? typeEntries : typeEntries.filter((entry) => entry.view === activeView);
  updateFilters(typeEntries);
  const photos = firstPageMix(filtered.filter((entry) => entry.kind !== 'album'));
  const albums = firstPageMix(filtered.filter((entry) => entry.kind === 'album'));
  results = referenceLibrary.mix(photos, albums);
  visible = 0;
  byId('gallery-title').textContent = activeType === 'all' && activeView === 'all'
    ? filtered.some((entry) => entry.importedAt?.slice(0, 10) === day) ? '今日新图与推荐' : '今日推荐'
    : activeView === 'all' ? types[activeType] : views[activeView][0];
  byId('crumb').textContent = '参考图库 / ' + types[activeType] + (activeView === 'all' ? '' : ' / ' + views[activeView][0]);
  byId('count').textContent = photos.length + ' 张' + (albums.length ? ' · ' + albums.length + ' 套图集' : '');
  gallery.replaceChildren();
  byId('end').textContent = '';
  byId('load').hidden = true;
  gallery.setAttribute('aria-busy', 'false');
  if (!results.length) {
    gallery.append(element('p', 'empty', '这个搭配暂时没有素材，可用“更新资源”入口启动新一轮抓取。'));
  } else {
    appendResults();
  }
}

function refreshDate() {
  const currentDay = dateFormatter.format(new Date());
  if (currentDay !== day) {
    day = currentDay;
    rotation = 0;
    updateDate();
    rebuild();
  }
}

function applySync(snapshot, force = false) {
  if (!Array.isArray(snapshot.photos)) throw new Error('Invalid online library');
  const photos = snapshot.photos.filter(recordIsValid);
  const changed = photos.length !== imports.length || seenSync !== snapshot.lastCheckedAt;
  imports = photos;
  seenSync = snapshot.lastCheckedAt;
  syncing = Boolean(snapshot.busy);
  byId('refresh').setAttribute('aria-busy', String(syncing));
  byId('refresh-label').textContent = syncing ? '正在找图' : '刷新图片';
  const latest = snapshot.lastCheckedAt?.slice(0, 10).replaceAll('-', '.');
  byId('sync-status').textContent = syncing ? '正在从 Commons 找图'
    : snapshot.failed ? '本次未能同步 · 保留图库'
      : latest ? latest + ' · 本次新增 ' + snapshot.lastAdded + ' 张' : '等待首次同步';
  if (changed) {
    catalog = [...curated, ...imports];
    if (!dialog.open && (force || window.scrollY < 160 || !results.length)) rebuild();
    else byId('announce').textContent = '在线图库已更新，重新选择筛选可浏览新图。';
  }
}

async function syncLibrary(manual = false) {
  if (requesting || (manual && syncing)) {
    if (manual) byId('announce').textContent = '正在读取已发布图库，请稍候。';
    return;
  }
  window.clearTimeout(pollTimer);
  requesting = true;
  if (manual) {
    byId('refresh').setAttribute('aria-busy', 'true');
    byId('refresh-label').textContent = '正在找图';
    byId('sync-status').textContent = '正在读取最新已发布图库';
    if (ready && results.length > 1) {
      rotation += 1;
      rebuild();
    }
    window.scrollTo(0, 0);
  }
  try {
    const request = manual ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: activeType, view: activeView }) } : { cache: 'no-store' };
    const response = await fetch(manual ? 'api/refresh' : 'api/library', request);
    if (!response.ok) throw new Error('Import unavailable');
    const snapshot = await response.json();
    applySync(snapshot, manual);
    if (manual && snapshot.status === 'published') byId('announce').textContent = '已读取发布版本；抓取新资源请使用“更新资源”入口。';
    if (snapshot.status === 'cooldown') byId('announce').textContent = '刚才已找过一批图片，请稍后再试。';
  } catch {
    syncing = false;
    byId('refresh').setAttribute('aria-busy', 'false');
    byId('refresh-label').textContent = '刷新图片';
    byId('sync-status').textContent = '同步服务未连接 · 显示已载入图库';
  } finally {
    requesting = false;
    pollTimer = window.setTimeout(() => syncLibrary(), syncing ? 2_500 : 30_000);
  }
}

function external(url, label) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return element('span', '', label);
    const node = element('a', '', label);
    node.href = parsed.href;
    node.target = '_blank';
    node.rel = 'noopener noreferrer';
    return node;
  } catch {
    return element('span', '', label);
  }
}

function recommendations(entry) {
  const candidates = [...catalog, ...referenceLibrary.photoEntries()].filter((candidate) => candidate.id !== entry.id);
  const rank = (candidate) => {
    if (candidate.type === entry.type && candidate.view === entry.view && candidate.modelKey !== entry.modelKey) return 4;
    if (candidate.modelKey === entry.modelKey && candidate.view !== entry.view) return 3;
    if (candidate.type === entry.type && candidate.modelKey !== entry.modelKey) return 2;
    if (candidate.view === entry.view) return 1;
    return 0;
  };
  const ordered = candidates.filter((candidate) => rank(candidate)).sort((first, second) => rank(second) - rank(first));
  const keys = new Set();
  const mixed = [...ordered.filter((candidate) => {
    const key = candidate.modelKey + '/' + candidate.view;
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  })];
  return mixed.slice(0, 4).map((candidate) => ({
    candidate,
    reason: rank(candidate) === 4 ? '同车型类别 · 同视角' : rank(candidate) === 3 ? '同款车型 · 另一视角'
      : rank(candidate) === 2 ? '同车型类别 · ' + views[candidate.view][0] : '相同视角',
  }));
}

function makeSwatches(entry) {
  const swatches = element('div', 'swatches');
  const status = element('span', 'copy-response');
  status.setAttribute('role', 'status');
  entry.colors.forEach((color, index) => {
    const control = button('', 'swatch glass');
    control.setAttribute('aria-label', '复制' + toneNames[index] + '色值 ' + color);
    const sample = element('span');
    tint(sample, color);
    control.append(sample, element('span', '', toneNames[index]), element('strong', '', color));
    control.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(color);
        status.textContent = '已复制 ' + color;
      } catch {
        status.textContent = '可手动记录色值 ' + color;
      }
    });
    swatches.append(control);
  });
  return [swatches, status];
}

function showDetail(entry) {
  const head = element('div', 'detail-head');
  const headings = element('div');
  const title = element('h2', '', entry.title);
  title.id = 'dialog-title';
  headings.append(element('p', '', types[entry.type] + ' / ' + views[entry.view][0]), title);
  const close = button('', 'close glass');
  close.setAttribute('aria-label', '关闭详情');
  close.append(icon('close'));
  close.addEventListener('click', () => dialog.close());
  head.append(headings, close);

  const photo = element('figure', 'detail-figure');
  const picture = element('img');
  picture.alt = entry.title + ' · ' + views[entry.view][0];
  picture.src = asset(entry);
  picture.width = entry.width;
  picture.height = entry.height;
  const topLink = external(entry.original, '');
  if (topLink.tagName === 'A') {
    topLink.setAttribute('aria-label', '打开原始图片');
    topLink.append(picture);
    photo.append(topLink);
  } else {
    photo.append(picture);
  }
  const caption = element('figcaption');
  caption.append('图片：' + entry.credit + ' · ', external(entry.source, '图源'), ' · ', external(entry.licenseUrl, entry.license));
  if (entry.cropped) caption.append(' · 练习图裁切');
  if (entry.provider) caption.append(' · 站内图已缩放');
  photo.append(caption);
  const trails = element('div', 'external-references', '站外找更多：');
  const angles = { front: 'front view', side: 'side profile', rear: 'rear view', front45: 'front three quarter', rear45: 'rear three quarter', high: 'high angle' };
  const search = encodeURIComponent(entry.title + ' ' + angles[entry.view]);
  trails.append(
    external('https://www.pinterest.com/search/pins/?q=' + search, 'Pinterest'),
    external('https://www.behance.net/search/projects?search=' + search, 'Behance'),
  );
  photo.append(trails);
  const modelReferences = referenceLibrary.detailLinks(entry);
  if (modelReferences) photo.append(modelReferences);

  const panel = element('aside', 'detail-side glass');
  panel.append(
    element('h3', '', '五色临摹色卡'),
    element('p', '', '从车身区域提取，按明度从暗到亮排列。点击色块复制色值。'),
    ...makeSwatches(entry),
    element('p', 'detail-tip', practice[entry.view]),
  );
  const main = element('div', 'detail-main');
  main.append(photo, panel);

  byId('detail-body').replaceChildren(head, main, similarReferences(entry));
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
  close.focus();
}

function similarReferences(entry) {
  const similar = element('section', 'recommend glass');
  similar.append(element('h3', '', '相似参考'), element('p', '', '比较相近车身比例，或用同一视角练习不同车形。'));
  const links = element('div', 'similar-grid');
  for (const { candidate, reason } of recommendations(entry)) {
    const control = button('', 'similar glass');
    const image = element('img');
    image.alt = '';
    image.src = asset(candidate, true);
    const name = element('span', '', candidate.title);
    name.append(element('small', '', reason));
    control.append(image, name);
    control.addEventListener('click', () => showDetail(candidate));
    links.append(control);
  }
  similar.append(links);
  return similar;
}

function pullToRefresh() {
  const indicator = byId('pull');
  let start = null;
  let distance = 0;
  document.addEventListener('touchstart', (event) => {
    const isControl = event.target instanceof Element && event.target.closest('button, a, nav');
    start = window.scrollY <= 0 && !isControl && event.touches.length === 1 && !dialog.open ? event.touches[0] : null;
    distance = 0;
  }, { passive: true });
  document.addEventListener('touchmove', (event) => {
    if (!start || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const vertical = touch.clientY - start.clientY;
    if (Math.abs(touch.clientX - start.clientX) > Math.max(20, vertical)) {
      start = null;
      distance = 0;
      indicator.classList.remove('visible');
      return;
    }
    distance = window.scrollY <= 0 ? Math.max(0, vertical) : 0;
    indicator.classList.toggle('visible', distance > 22);
    indicator.lastElementChild.textContent = distance >= 68 ? '松开读取已发布图库' : '下拉刷新图片';
  }, { passive: true });
  function clear() {
    indicator.classList.remove('visible');
    start = null;
    distance = 0;
  }
  document.addEventListener('touchend', () => { if (start && distance >= 68) syncLibrary(true); clear(); }, { passive: true });
  document.addEventListener('touchcancel', clear, { passive: true });
}

async function loadCatalog() {
  try {
    const response = await fetch('library.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error('Library unavailable');
    const entries = await response.json();
    curated = entries.filter(recordIsValid);
    if (!curated.length) throw new Error('No valid photos');
    catalog = [...curated, ...imports];
    ready = true;
    rebuild();
  } catch {
    gallery.setAttribute('aria-busy', 'false');
    gallery.replaceChildren(element('p', 'empty', '图库暂时无法加载，请确认网站服务正在运行后重试。'));
  }
}

const referenceLibrary = new window.NetCarShowCatalog();
referenceLibrary.load().then(() => {
  if (!dialog.open) rebuild();
}).catch(() => {});
document.querySelectorAll('[data-icon]').forEach((node) => setIcon(node, node.dataset.icon));
updateDate();
mountFilters();
byId('load').addEventListener('click', () => appendResults(true));
byId('refresh').addEventListener('click', () => syncLibrary(true));
dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver((changes) => {
    if (changes.some((change) => change.isIntersecting) && ready && !dialog.open) appendResults();
  }, { rootMargin: '0px 0px 160px' });
  observer.observe(byId('sentinel'));
}
pullToRefresh();
window.setInterval(refreshDate, 30_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshDate(); });
loadCatalog();
syncLibrary();
