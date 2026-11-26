const categories = {
  all: '全部资讯', styling: '外饰造型', launch: '新车发布',
  concept: '概念车', materials: '材料应用', interview: '设计师访谈',
};

const icons = {
  search: '<circle cx="10.8" cy="10.8" r="6.3"/><path d="m16 16 4 4"/>',
  bookmark: '<path d="M6.5 4h11v16l-5.5-3.7L6.5 20z"/>',
  refresh: '<path d="M19.5 8a8 8 0 0 0-13-2L4 8m0-5v5h5m-4.5 8a8 8 0 0 0 13 2L20 16m0 5v-5h-5"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  external: '<path d="M12 5h7v7m0-7-9 9m8 1v4H5V6h4"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  sort: '<path d="M4 6h16M4 12h11M4 18h6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  spark: '<path d="M12 2.5c.8 5.1 3.4 7.7 8.5 8.5-5.1.8-7.7 3.4-8.5 8.5-.8-5.1-3.4-7.7-8.5-8.5 5.1-.8 7.7-3.4 8.5-8.5Z"/>',
};

const byId = (name) => document.getElementById(name);
const dateTime = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Shanghai',
});
const calendarDate = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Shanghai' });
const dialog = byId('dialog');
const pageSize = 9;
const savedKey = 'form-index.bookmarks.1';
let activeCategory = 'all';
let savedOnly = false;
let keyword = '';
let limit = pageSize;
let feed = { articles: [], sources: [] };
let hasFeed = false;
let feedAvailable = false;
let feedRequest = false;
let manualPending = false;
let syncTimer;
let syncNotice = '';
let saved = [];

try {
  const entries = JSON.parse(localStorage.getItem(savedKey) || '[]');
  saved = Array.isArray(entries) ? entries.filter((entry) => typeof entry === 'string') : [];
} catch {
  saved = [];
}

function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function icon(name) {
  const span = element('span');
  setIcon(span, name);
  return span;
}

function setIcon(node, name) {
  node.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${icons[name]}</svg>`;
}

function button(text, className = '') {
  const node = element('button', className, text);
  node.type = 'button';
  return node;
}

function iconButton(name, label, className = '') {
  const node = button('', `icon-button ${className}`);
  node.dataset.icon = name;
  node.title = label;
  node.setAttribute('aria-label', label);
  setIcon(node, name);
  return node;
}

function safeLink(value, allowLocal = false) {
  if (!value) return null;
  if (allowLocal && /^\/(?:assets|previews)\/[a-z0-9.-]+$/i.test(value)) return value.slice(1);
  try {
    const parsed = new URL(value);
    return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : null;
  } catch {
    return null;
  }
}

function externalLink(node, url) {
  const link = safeLink(url);
  if (!link) {
    node.hidden = true;
    return node;
  }
  node.href = link;
  node.target = '_blank';
  node.rel = 'noopener noreferrer';
  return node;
}

function original(article, className = 'original', text = '查看原文') {
  const node = externalLink(element('a', className, text), article.url);
  node.append(icon('external'));
  return node;
}

function setImage(node, article) {
  const url = safeLink(article.image, true);
  node.hidden = !url;
  if (!url) return;
  node.addEventListener('error', () => { node.hidden = true; }, { once: true });
  node.src = url;
}

function saveButton(node, article) {
  node.dataset.article = article.url;
  const refresh = (target) => {
    const marked = saved.includes(article.url);
    const label = marked ? '取消收藏' : '收藏报道';
    target.setAttribute('aria-pressed', String(marked));
    target.setAttribute('aria-label', label);
    target.title = label;
  };
  refresh(node);
  node.addEventListener('click', () => {
    saved = saved.includes(article.url) ? saved.filter((url) => url !== article.url) : [...saved, article.url];
    try { localStorage.setItem(savedKey, JSON.stringify(saved)); } catch { }
    document.querySelectorAll('[data-article]').forEach((target) => {
      if (target.dataset.article === article.url) refresh(target);
    });
    if (savedOnly) {
      const focusedCard = !dialog.open && document.activeElement === node;
      render();
      if (focusedCard) byId('saved-open').focus();
    }
  });
  return node;
}

function changeView(category, bookmarks = false) {
  activeCategory = category;
  savedOnly = bookmarks;
  keyword = '';
  limit = pageSize;
  render();
  window.scrollTo(0, 0);
}

function mountNavigation() {
  const navigation = byId('navigation');
  Object.entries(categories).forEach(([id, label]) => {
    const node = button(label, 'nav-button');
    node.dataset.category = id;
    node.addEventListener('click', () => changeView(id));
    navigation.append(node);
  });
  byId('home').addEventListener('click', () => changeView('all'));
  byId('saved-open').addEventListener('click', () => changeView('all', !savedOnly));
}

function articleMeta(article) {
  if (article.resourceKind === 'album') return article.source + ' / ' + article.modelYear + ' 年款 · 发布日期未确认';
  return `${article.source}  /  ${formatDate(article.date)}`;
}

function formatDate(value) {
  return calendarDate.format(new Date(value)).replaceAll('/', '.');
}

function chooseFeature(entries) {
  if (activeCategory !== 'all' || savedOnly || keyword) return null;
  const curated = entries.find((article) => article.featured);
  if (!curated) return null;
  const cutoff = Date.parse(curated.date) + 14 * 86_400_000;
  const recentConcepts = entries.filter((article) => article.category === 'concept' && article.image && Date.parse(article.date) >= cutoff);
  return recentConcepts.reduce((latest, article) => Date.parse(article.date) > Date.parse(latest.date) ? article : latest, curated);
}

function renderFeature(article) {
  const host = byId('featured');
  host.hidden = !article;
  host.replaceChildren();
  if (!article) return;
  const image = element('img', 'feature-photo');
  image.alt = '';
  image.fetchPriority = 'high';
  setImage(image, article);
  const inner = element('div', 'feature-inner');
  const top = element('div', 'feature-top');
  const mark = element('span', 'feature-marker', '焦点报道');
  mark.prepend(icon('spark'));
  top.append(mark);
  const copy = element('div', 'feature-copy');
  copy.append(element('p', 'meta', `${categories[article.category]}  /  ${articleMeta(article)}`));
  const splitAt = article.title.indexOf('：');
  const heading = element('h2', '', splitAt < 0 ? article.title : article.title.slice(0, splitAt));
  if (splitAt >= 0) heading.append(element('br'), article.title.slice(splitAt + 1));
  const summary = element('p', '', article.summary);
  if (article.automatic) {
    heading.lang = 'en';
    summary.lang = 'en';
  }
  copy.append(heading, summary);
  const actions = element('div', 'feature-actions');
  const read = button('阅读焦点', 'primary');
  read.append(icon('arrow'));
  read.addEventListener('click', () => showArticle(article));
  actions.append(read, saveButton(iconButton('bookmark', '收藏报道'), article));
  copy.append(actions);
  inner.append(top, copy);
  host.append(image, inner);
  if (article.credit) host.append(element('span', 'feature-credit', `IMAGE © ${article.credit}`));
}

function articleCard(article) {
  const card = byId('article-template').content.firstElementChild.cloneNode(true);
  card.dataset.source = article.source;
  card.dataset.kind = article.resourceKind || 'article';
  card.dataset.category = article.category;
  setImage(card.querySelector('img'), article);
  if (article.resourceKind === 'album') {
    card.classList.add('concept-album');
    if (!article.image) {
    const cover = element('div', 'catalog-story-cover');
    cover.append(element('small', '', 'NETCARSHOW / CONCEPT'), element('strong', '', article.title), element('span', '', '原站概念车图集 ↗'));
    card.querySelector('.story-media').prepend(cover);
    }
  }
  const tag = card.querySelector('.tag');
  tag.dataset.category = article.category;
  tag.textContent = categories[article.category];
  card.querySelector('.meta').textContent = articleMeta(article);
  const title = card.querySelector('.story-title');
  title.textContent = article.title;
  const excerpt = card.querySelector('.story-summary');
  excerpt.textContent = article.summary || '阅读原文了解更多。';
  externalLink(card.querySelector('.original'), article.url);
  if (article.resourceKind === 'album') {
    card.querySelector('.original').replaceChildren('查看原站图集 ', icon('external'));
  } else if (article.category === 'concept') {
    const matched = referenceLibrary.matches(article)[0];
    if (matched) {
      const related = externalLink(element('a', 'related-source', 'NetCarShow 同车系图集 ↗'), matched.url);
      card.querySelector('.story-summary').after(related);
    }
  }
  saveButton(card.querySelector('.story-save'), article);
  card.querySelectorAll('[data-icon]').forEach((node) => setIcon(node, node.dataset.icon));
  [title, card.querySelector('.story-open')].forEach((node) => node.addEventListener('click', () => showArticle(article)));
  if (article.automatic) {
    title.lang = 'en';
    excerpt.lang = 'en';
  }
  return card;
}

function filteredArticles() {
  const words = keyword.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const entries = [...feed.articles, ...referenceLibrary.conceptEntries(savedOnly ? [] : feed.articles)];
  return entries.filter((article) => {
    if (savedOnly && !saved.includes(article.url)) return false;
    if (activeCategory !== 'all' && activeCategory !== article.category) return false;
    const slug = new URL(article.url).pathname.replace(/[-_]+/g, ' ');
    const searchable = [article.title, article.summary, article.source, article.insight, categories[article.category], slug, ...(article.aliases || [])].join(' ').toLocaleLowerCase();
    return words.every((word) => searchable.includes(word));
  }).sort((first, second) => {
    if (activeCategory === 'concept' && byId('sort').value === 'latest' && first.resourceKind !== second.resourceKind) {
      return first.resourceKind === 'album' ? -1 : 1;
    }
    if (first.resourceKind === 'album' && second.resourceKind === 'album') return first.listingOrder - second.listingOrder;
    if (!first.date || !second.date) return first.date ? -1 : 1;
    const difference = (Date.parse(second.date) || 0) - (Date.parse(first.date) || 0);
    return byId('sort').value === 'oldest' ? -difference : difference;
  });
}

function render() {
  if (!hasFeed) return;
  const entries = filteredArticles();
  const lead = chooseFeature(entries);
  const stories = entries.filter((article) => article !== lead);
  document.querySelectorAll('.nav-button').forEach((node) => {
    if (!savedOnly && !keyword && node.dataset.category === activeCategory) node.setAttribute('aria-current', 'page');
    else node.removeAttribute('aria-current');
  });
  byId('saved-open').setAttribute('aria-pressed', String(savedOnly));
  renderFeature(lead);
  byId('feed-title').textContent = keyword ? '搜索结果' : savedOnly ? '我的收藏' : activeCategory === 'all' ? '近期资讯' : categories[activeCategory];
  byId('count').textContent = `${stories.length} 条`;
  const search = byId('active-search');
  search.hidden = !keyword;
  search.replaceChildren();
  if (keyword) {
    const clear = iconButton('close', '清除搜索');
    clear.addEventListener('click', () => changeView('all'));
    search.append(element('span', '', `关键词「${keyword}」`), clear);
  }
  const cards = byId('cards');
  cards.setAttribute('aria-busy', 'false');
  const empty = savedOnly ? '还没有收藏，可用报道卡片上的书签按钮添加。' : keyword ? '没有匹配的报道，试试品牌、车型或设计师姓名。' : '这个分类暂时没有报道。';
  cards.replaceChildren(...(stories.length ? stories.slice(0, limit).map(articleCard) : [element('p', 'empty', empty)]));
  byId('more').hidden = stories.length <= limit;
  updateSyncUI();
}

function updateSyncUI() {
  const busy = manualPending || Boolean(feedAvailable && feed.refreshing);
  const control = byId('refresh-now');
  control.disabled = busy;
  control.setAttribute('aria-busy', String(busy));
  control.setAttribute('aria-label', busy ? '正在刷新资讯' : '立即刷新资讯');
  control.title = busy ? '正在检查资讯源，请稍候' : '检查最新已发布内容';
  byId('refresh-label').textContent = busy ? '刷新中' : '刷新';
  let status = '等待首次同步';
  if (busy) status = '正在读取已发布资讯…';
  else if (!feedAvailable) status = '暂未连接 · 显示已载入资讯';
  else if (syncNotice) status = syncNotice;
  else if (feed.refreshError) status = '同步失败 · 已保留资讯，稍后重试';
  else if (feed.sources.some((source) => source.ok === false)) status = '部分来源未连接 · 稍后重试';
  else if (feed.lastUpdatedAt) status = '最近同步 ' + formatDate(feed.lastUpdatedAt) + ' · 新增 ' + (feed.lastAdded || 0) + ' 条';
  byId('sync-label').textContent = status;
}

function shellDialog(title) {
  const heading = element('h2', '', title);
  heading.id = 'dialog-title';
  const header = element('div', 'dialog-head');
  const close = iconButton('close', '关闭');
  close.addEventListener('click', () => dialog.close());
  header.append(heading, close);
  const content = element('div', 'dialog-content');
  byId('dialog-body').replaceChildren(header, content);
  return content;
}

function showArticle(article) {
  const content = shellDialog(article.title);
  if (article.automatic) byId('dialog-title').lang = 'en';
  content.append(element('p', 'meta', `${categories[article.category]}  /  ${articleMeta(article)}`));
  const image = element('img', 'detail-image');
  image.alt = '';
  setImage(image, article);
  content.append(image);
  if (article.credit) {
    const credit = element('p', 'credit', '图片来源 · ' + article.credit);
    if (article.imageSource) credit.append(' · ', externalLink(element('a', '', '查看图源 ↗'), article.imageSource));
    if (article.imageLicense) credit.append(' · ' + article.imageLicense);
    if (article.imageNote) credit.append(' · ' + article.imageNote);
    content.append(credit);
  }
  const summary = element('p', 'detail-summary', article.summary || '阅读原文了解更多。');
  if (article.resourceKind === 'album') {
    content.append(element('p', 'credit', '列入 NetCarShow 最近更新页面；目录核对日期 ' + article.reviewedOn + '。车型年款不是发布日期，本站不推定原始发布时间。'));
  }
  if (article.automatic && article.summary) summary.lang = 'en';
  content.append(summary);
  if (article.insight) {
    const aside = element('aside', 'insight');
    aside.append(element('strong', '', '外饰观察'), element('p', '', article.insight));
    content.append(aside);
  }
  const actions = element('div', 'dialog-actions');
  actions.append(original(article, 'primary', article.resourceKind === 'album' ? '查看原站完整图集' : '查看原文'), saveButton(iconButton('bookmark', '收藏报道'), article));
  content.append(actions);
  const modelReferences = referenceLibrary.detailLinks(article);
  if (modelReferences && article.resourceKind !== 'album') content.append(modelReferences);
  if (article.automatic) content.append(element('p', 'sync-note', '标题与摘要来自订阅源，分类由关键词自动匹配。'));
  dialog.showModal();
}

function showSearch() {
  const content = shellDialog('搜索资讯');
  const form = element('form', 'search-form');
  const input = element('input');
  input.type = 'search';
  input.value = keyword;
  input.maxLength = 100;
  input.placeholder = '品牌、车型或设计师姓名';
  input.setAttribute('aria-label', '搜索关键词');
  const submit = button('搜索', 'primary');
  submit.type = 'submit';
  form.append(input, submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    keyword = input.value.trim();
    activeCategory = 'all';
    savedOnly = false;
    limit = pageSize;
    dialog.close();
    render();
    window.scrollTo(0, 0);
  });
  content.append(form);
  dialog.showModal();
  input.focus();
  input.select();
}

function syncTime(value, fallback) {
  return value ? dateTime.format(new Date(value)) : fallback;
}

function showSources() {
  const content = shellDialog('资讯更新与来源');
  const times = element('dl', 'sync-details');
  [
    ['最近成功同步', syncTime(feed.lastUpdatedAt, '暂无记录')],
    ['下次检查', syncTime(feed.nextCheckAt, feedAvailable ? '等待首次同步' : '订阅服务未连接')],
  ].forEach(([label, value]) => {
    const row = element('div');
    row.append(element('dt', '', label), element('dd', '', value));
    times.append(row);
  });
  const sources = element('ul', 'source-list');
  feed.sources.forEach((source) => {
    const item = element('li');
    const status = source.ok === true ? `已读取 · ${source.count} 条匹配` : source.ok === false ? '本次失败 · 等待重试' : '等待同步';
    item.append(original(source, '', source.name), element('span', '', status));
    sources.append(item);
  });
  if (referenceLibrary.data) {
    const item = element('li');
    item.append(
      original({url:referenceLibrary.data.latestConceptsSource}, '', 'NetCarShow 概念车参考'),
      element('span', '', '原站近期目录 · 核对 ' + referenceLibrary.data.latestConceptsReviewedOn),
    );
    sources.append(item);
  }
  content.append(times, sources, element('p', 'sync-note', 'GitHub Actions 每天运行抓取并发布；顶部刷新读取最新已发布版本。需要提前抓取时，使用“更新资源”入口，登录 GitHub 后点击 Run workflow。来源失败时保留已有资料，下一次运行重试。NetCarShow 图集目录按标注核对日整理，不将年款作为发布时间。'));
  dialog.showModal();
}

async function loadFeed(manual = false) {
  if (feedRequest) return;
  feedRequest = true;
  window.clearTimeout(syncTimer);
  if (manual) {
    manualPending = true;
    syncNotice = '';
    updateSyncUI();
  }
  try {
    const options = manual
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
      : { cache: 'no-store' };
    const response = await fetch(manual ? 'api/refresh' : 'api/feed', options);
    if (!response.ok) throw new Error('feed unavailable');
    const next = await response.json();
    if (!Array.isArray(next.articles) || !Array.isArray(next.sources)) throw new Error('invalid feed');
    const changed = !feedAvailable || feed.lastCheckedAt !== next.lastCheckedAt || !hasFeed;
    feed = next;
    feedAvailable = true;
    hasFeed = true;
    if (changed) syncNotice = '';
    if (next.status === 'cooldown') syncNotice = '刚刚检查过，请稍后再试';
    if (manual && next.status === 'published') syncNotice = '已读取发布版本 · 抓取新资源请使用“更新资源”';
    if (changed) render();
  } catch {
    if (hasFeed) {
      feedAvailable = false;
      return;
    }
    try {
      const response = await fetch('seed.json');
      if (!response.ok) throw new Error('seed unavailable');
      feed.articles = await response.json();
      hasFeed = true;
      render();
    } catch {
      byId('cards').setAttribute('aria-busy', 'false');
      byId('cards').replaceChildren(element('p', 'empty', '资讯暂时无法载入，请刷新页面重试。'));
      byId('sync-label').textContent = '连接异常';
    }
  } finally {
    feedRequest = false;
    manualPending = false;
    updateSyncUI();
    syncTimer = window.setTimeout(() => loadFeed(), feedAvailable && feed.refreshing ? 2_000 : 60_000);
  }
}

const referenceLibrary = new window.NetCarShowCatalog();
referenceLibrary.load().then(() => {
  if (!dialog.open) render();
}).catch(() => {});
document.querySelectorAll('[data-icon]').forEach((node) => setIcon(node, node.dataset.icon));
mountNavigation();
byId('search-open').addEventListener('click', showSearch);
byId('sync-open').addEventListener('click', showSources);
byId('refresh-now').addEventListener('click', () => loadFeed(true));
byId('sources-open').addEventListener('click', showSources);
byId('sort').addEventListener('change', () => { limit = pageSize; render(); });
byId('more').addEventListener('click', () => {
  const firstNew = limit;
  limit += pageSize;
  render();
  byId('cards').children[firstNew]?.querySelector('.story-title')?.focus();
});
dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadFeed(); });
loadFeed();
