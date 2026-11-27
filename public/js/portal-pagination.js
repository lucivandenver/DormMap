(() => {
  const pageSize = 5;
  const lists = new Map();
  const serverLists = new WeakMap();

  function controls(anchor) {
    const nav = document.createElement('nav');
    nav.className = 'portal-pagination';
    nav.setAttribute('aria-label', 'List pagination');
    const previous = document.createElement('button');
    const next = document.createElement('button');
    const label = document.createElement('span');
    previous.type = next.type = 'button';
    previous.textContent = 'Previous';
    next.textContent = 'Next';
    label.setAttribute('aria-live', 'polite');
    nav.append(previous, label, next);
    anchor.after(nav);
    return { nav, previous, next, label };
  }

  function describe(widget, page, pages) {
    widget.nav.hidden = pages <= 1;
    widget.label.textContent = `Page ${page} of ${pages}`;
    widget.previous.disabled = page <= 1;
    widget.next.disabled = page >= pages;
  }

  function attach(list) {
    if (lists.has(list) || list.closest('.dormmap-print-sheet')) return;
    const widget = controls(list.closest('table') || list);
    let page = list.hasAttribute('data-page-last') ? Infinity : 1;
    let lastPage = 1;

    function update() {
      const items = [...list.children].filter(item =>
        !item.hasAttribute('data-page-detail') && !item.hidden && !item.classList.contains('hidden') &&
        (item.tagName !== 'TR' || !(item.cells.length === 1 && item.cells[0].colSpan > 1))
      );
      const indexByItem = new Map(items.map((item, index) => [item, index]));
      const count = items.length;
      lastPage = Math.max(1, Math.ceil(count / pageSize));
      const currentPage = Math.min(page, lastPage);
      let index;
      for (const item of list.children) {
        if (!item.hasAttribute('data-page-detail')) index = indexByItem.get(item);
        item.toggleAttribute('data-page-off', index !== undefined && Math.floor(index / pageSize) + 1 !== currentPage);
      }
      describe(widget, currentPage, lastPage);
    }

    widget.previous.onclick = () => { page = Math.max(1, Math.min(page, lastPage) - 1); update(); };
    widget.next.onclick = () => { page = Math.min(lastPage, page + 1); update(); };
    const observer = new MutationObserver(changes => {
      if (changes.some(change => change.target === list || change.target.parentElement === list)) update();
    });
    observer.observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] });
    lists.set(list, { observer, reset() { page = list.hasAttribute('data-page-last') ? Infinity : 1; update(); } });
    update();
  }

  function discover(node) {
    if (node.nodeType !== Node.ELEMENT_NODE && node !== document) return;
    if (node.matches?.('[data-paginate]')) attach(node);
    for (const list of node.querySelectorAll('[data-paginate]')) attach(list);
  }

  // Some reports and dialogs replace the whole table after filters change.
  new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) discover(node);
    for (const [list, entry] of lists) {
      if (list.isConnected) continue;
      entry.observer.disconnect();
      lists.delete(list);
    }
  }).observe(document.documentElement, { subtree: true, childList: true });
  discover(document);
  window.DormMapPagination = {
    reset(list) { lists.get(list)?.reset(); },
    server(list, { page, pages }, load) {
      let widget = serverLists.get(list);
      if (!widget) {
        widget = controls(list.closest('table') || list);
        serverLists.set(list, widget);
      }
      describe(widget, page, pages);
      widget.previous.onclick = () => load(page - 1);
      widget.next.onclick = () => load(page + 1);
    }
  };
})();
