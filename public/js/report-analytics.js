(() => {
  function metrics(items) {
    const list = document.createElement('dl');
    list.className = 'analytics-metrics';
    for (const { label, value, note, direction } of items) {
      const card = document.createElement('div');
      const term = document.createElement('dt');
      term.textContent = label;
      const amount = document.createElement('dd');
      amount.textContent = value;
      if (direction) amount.className = 'analytics-' + direction;
      card.append(term, amount);
      for (const line of note || []) {
        const detail = document.createElement('dd');
        detail.className = 'analytics-note';
        detail.textContent = line;
        card.append(detail);
      }
      list.append(card);
    }
    return list;
  }

  function chart(title, rows, format) {
    const figure = document.createElement('figure');
    figure.className = 'analytics-chart';
    const caption = document.createElement('figcaption');
    caption.textContent = title;
    figure.append(caption);
    if (!rows.length) return figure;
    const list = document.createElement('ul');
    const maximum = rows.reduce((max, row) => Math.max(max, row.value), 1);
    for (const { period, value } of rows) {
      const item = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = period;
      const track = document.createElement('span');
      track.className = 'analytics-track';
      track.setAttribute('aria-hidden', 'true');
      const bar = document.createElement('span');
      bar.className = 'analytics-bar';
      bar.style.width = (value / maximum * 100) + '%';
      track.append(bar);
      const amount = document.createElement('strong');
      amount.textContent = format(value);
      item.append(label, track, amount);
      list.append(item);
    }
    figure.append(list);
    return figure;
  }

  window.DormMapAnalytics = { metrics, chart };
})();
