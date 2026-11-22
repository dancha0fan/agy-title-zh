(() => {
  const VERSION = '0.1.0';
  if (globalThis.__agyTitleZhBridge?.version === VERSION) return;

  const fiberOf = element => {
    if (!element) return null;
    const key = Object.keys(element).find(k => k.startsWith('__reactFiber$'));
    return key ? element[key] : null;
  };

  const providersOf = element => {
    const result = [];
    for (let node = fiberOf(element); node; node = node.return) {
      if (node.tag === 10 && node.memoizedProps?.value !== undefined) {
        result.push(node.memoizedProps.value);
      }
    }
    return result;
  };

  const pageAnchor = () =>
    document.querySelector('[aria-label="Message input"],[data-agy-original-aria-label="Message input"]') ||
    document.querySelector('a[href="/customizations"]') ||
    document.querySelector('#root')?.firstElementChild ||
    document.body?.firstElementChild;

  const getStore = () => providersOf(pageAnchor()).map(v => v?.store).find(s => s?.getState && s?.dispatch) || null;
  const getService = () => providersOf(pageAnchor()).find(v => typeof v?.updateConversationAnnotations === 'function') || null;

  const activeConversationId = () => {
    const match = String(location.pathname || '').match(/^\/c\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  };

  function listCandidates() {
    const map = getStore()?.getState?.()?.trajectorySummaries?.summaries;
    if (!map || typeof map !== 'object') return [];
    const activeId = activeConversationId();
    const items = [];
    for (const [id, entry] of Object.entries(map)) {
      if (!entry || entry.annotations?.archived) continue;
      if (entry.parentConversationId || Number(entry.nestingDepth || 0) > 0) continue;
      const summary = String(entry.summary || '').trim();
      const annTitle = String(entry.annotations?.title || '').trim();
      // Preserve manually renamed titles (or titles we already translated).
      if (annTitle && annTitle !== summary) continue;
      if (summary.length < 2 || summary.length > 200) continue;
      if (/[\u4e00-\u9fff]/.test(summary) || !/[A-Za-z]/.test(summary)) continue;
      items.push({ id, summary, modified: Number(entry.lastModifiedTime?.seconds || 0) });
    }
    items.sort((a, b) => {
      if (a.id === activeId && b.id !== activeId) return -1;
      if (b.id === activeId && a.id !== activeId) return 1;
      return b.modified - a.modified;
    });
    return items.map(({ id, summary }) => ({ id, summary }));
  }

  async function applyTitle(conversationId, title) {
    const clean = String(title || '').trim();
    if (!conversationId || !clean) return false;
    const svc = getService();
    if (!svc) return false;
    const current = getStore()?.getState?.()?.trajectorySummaries?.summaries?.[conversationId];
    const currentSummary = String(current?.summary || '').trim();
    const currentAnn = String(current?.annotations?.title || '').trim();
    if (currentAnn && currentAnn !== currentSummary) return false;
    await svc.updateConversationAnnotations([conversationId], { title: clean }, true);
    return true;
  }

  globalThis.__agyTitleZhBridge = {
    version: VERSION,
    listCandidates,
    applyTitle,
    activeConversationId
  };
})();
