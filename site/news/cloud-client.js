(() => {
  const fetchPublished = window.fetch.bind(window);
  window.fetch = async (input, options) => {
    const target = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (target.origin !== location.origin || !/\/(?:news|study)\/api\/(?:feed|library|refresh)$/.test(target.pathname)) return fetchPublished(input, options);
    const response = await fetchPublished(new URL('baseline.json', location.href), { cache: 'no-store' });
    if (!response.ok) return response;
    const snapshot = await response.json();
    return new Response(JSON.stringify({ ...snapshot, refreshing: false, busy: false, status: 'published' }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  };
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const response = await fetchPublished('../publish-info.json', { cache: 'no-store' });
      const info = await response.json();
      if (!/^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9_-][a-z0-9_.-]*$/i.test(info.repository || '')) return;
      const link = document.getElementById('update-resources');
      link.href = 'https://github.com/' + info.repository + '/actions/workflows/pages.yml';
      link.hidden = false;
    } catch { /* Local inspection does not require a repository. */ }
  }, { once: true });
})();
