(() => {
  const normalize = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]/g, '');
  const safeUrl = (value) => {
    try {
      const url = new URL(value);
      return url.origin === 'https://www.netcarshow.com' && !url.username && !url.password;
    } catch { return false; }
  };
  const validPreview = (photo) => {
    if (!photo || photo.assetBase !== 'previews' || !/^ref-[a-z0-9-]{3,40}$/.test(photo.id)
      || typeof photo.title !== 'string' || typeof photo.credit !== 'string' || typeof photo.license !== 'string'
      || !Array.isArray(photo.colors) || photo.colors.length !== 5 || !photo.colors.every((color) => /^#[0-9A-F]{6}$/i.test(color))) return false;
    try { const source = new URL(photo.source); return source.protocol === 'https:' && !source.username && !source.password; }
    catch { return false; }
  };
  const element = (tag, className, text = '') => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const link = (address, text) => {
    const node = element('a', 'catalog-link', text);
    node.href = address;
    node.target = '_blank';
    node.rel = 'noopener noreferrer';
    return node;
  };

  class NetCarShowCatalog {
    constructor() { this.data = null; }

    async load() {
      const response = await fetch('references.json', { cache: 'no-cache' });
      if (!response.ok) throw new Error('Resource index unavailable');
      const data = await response.json();
      if (!Array.isArray(data.albums) || !data.types) throw new Error('Invalid resource index');
      data.albums = data.albums.filter((album) => typeof album.title === 'string'
        && Array.isArray(album.aliases) && Number.isInteger(album.year) && data.types[album.type] && safeUrl(album.url));
      for (const album of data.albums) album.preview = validPreview(album.preview) ? album.preview : null;
      this.data = data;
      return this;
    }

    matches(entry) {
      if (!this.data) return [];
      const title = normalize(entry.title);
      return this.data.albums.filter((album) => (!entry.type || entry.type === album.type)
        && album.aliases.some((alias) => title.includes(normalize(alias))));
    }

    studyEntries(photos) {
      if (!this.data) return [];
      return this.data.albums.map((album) => {
        const candidates = photos.filter((photo) => photo.type === album.type && this.matches(photo).some((match) => match.id === album.id));
        const preview = album.preview || candidates.find((photo) => photo.view === 'front45') || candidates.find((photo) => photo.view === 'side') || candidates[0] || null;
        return {
          id: 'ncs-' + album.id, modelKey: 'ncs-' + album.id, kind: 'album', title: album.title, type: album.type,
          view: null, year: album.year, source: album.url, exercise: album.exercise, provider: 'NetCarShow',
          preview, aliases: album.aliases,
        };
      });
    }

    photoEntries() {
      if (!this.data) return [];
      return this.data.albums.flatMap((album) => album.preview && ['front', 'side', 'rear', 'front45', 'rear45', 'high'].includes(album.preview.view)
        ? [{ ...album.preview, type: album.type, modelKey: 'ncs-' + album.id }] : []);
    }

    conceptEntries(articles) {
      if (!this.data) return [];
      const latest = this.data.latestConcepts || [];
      return latest.flatMap((record, index) => {
        const album = this.data.albums.find((entry) => entry.id === record.id);
        if (!album || articles.some((article) => article.category === 'concept' && this.matches(article).some((match) => match.id === album.id))) return [];
        return [{
          resourceKind: 'album', category: 'concept', title: album.title, source: 'NetCarShow', url: album.url,
          date: null, modelYear: album.year, reviewedOn: this.data.latestConceptsReviewedOn,
          listingOrder: index, image: album.preview ? '/previews/' + album.preview.id + '.webp' : null,
          credit: album.preview?.credit || null, imageSource: album.preview?.source || null,
          imageLicense: album.preview?.license || null, imageNote: album.preview?.note || null,
          summary: '原站最近更新列表中的概念车图集。' + album.exercise,
          insight: album.exercise, aliases: album.aliases,
        }];
      });
    }

    detailLinks(entry) {
      const matches = this.matches(entry);
      const fallback = this.data?.types[entry.type];
      if (!matches.length && !fallback) return null;
      const box = element('aside', 'catalog-detail');
      box.append(element('strong', '', matches.length ? '更多同车系参考' : '更多同类车型'));
      for (const album of matches.slice(0, 2)) box.append(link(album.url, 'NetCarShow · ' + album.title + ' · ' + album.year + ' 年款 ↗'));
      if (!matches.length) box.append(link(fallback.url, '在 NetCarShow 查看' + fallback.label + ' ↗'));
      box.append(element('p', '', '图集在原站查看；年款、版本和视角可能与当前照片不同。'));
      return box;
    }

    mix(photos, albums, frequency = 4) {
      const output = [];
      let photoIndex = 0, albumIndex = 0;
      while (photoIndex < photos.length || albumIndex < albums.length) {
        for (let slot = 0; slot < frequency && photoIndex < photos.length; slot++) output.push(photos[photoIndex++]);
        if (albumIndex < albums.length) output.push(albums[albumIndex++]);
      }
      return output;
    }
  }
  window.NetCarShowCatalog = NetCarShowCatalog;
})();
