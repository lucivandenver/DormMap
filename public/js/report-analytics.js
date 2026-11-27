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

  const palette = ['#047857', '#2563eb', '#b45309', '#7c3aed', '#b91c1c', '#475569'];

  function svg(name, attributes) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    return node;
  }

  function figureWithTitle(title) {
    const figure = document.createElement('figure');
    figure.className = 'analytics-chart';
    const caption = document.createElement('figcaption');
    caption.textContent = title;
    figure.append(caption);
    return figure;
  }

  function chartLegend(items) {
    const list = document.createElement('ul');
    list.className = 'analytics-legend';
    items.forEach(({ label, color }) => {
      const item = document.createElement('li');
      const swatch = document.createElement('span');
      swatch.className = 'analytics-swatch';
      swatch.style.backgroundColor = color;
      swatch.setAttribute('aria-hidden', 'true');
      item.append(swatch, label);
      list.append(item);
    });
    return list;
  }

  function plot(title, rows, series, format, mode = 'bar') {
    const figure = figureWithTitle(title);
    if (!rows.length) {
      figure.append('No data for this period.');
      return figure;
    }
    const legend = series.map((item, index) => ({ ...item, color: palette[index % palette.length] }));
    const width = Math.max(640, rows.length * 64 + 104);
    const left = 90, top = 20, bottom = 195;
    const step = (width - left - 12) / rows.length;
    const maximum = Math.max(1, ...rows.map(row => legend.reduce((value, item) => value + Number(row[item.key] || 0), 0)));
    const scale = maximum <= 4 ? 4 : Math.ceil(maximum / 4) * 4;
    const y = value => bottom - value / scale * (bottom - top);
    const x = index => left + step * (index + 0.5);
    const graphic = svg('svg', { viewBox: `0 0 ${width} 230`, 'aria-label': title });
    graphic.style.minWidth = Math.min(width, Math.max(340, rows.length * 58 + 90)) + 'px';

    for (let tick = 0; tick <= 4; tick++) {
      const value = scale * tick / 4;
      graphic.append(svg('line', { x1: left, x2: width - 12, y1: y(value), y2: y(value), stroke: '#dce5ee' }));
      const label = svg('text', { x: left - 8, y: y(value) + 4, 'text-anchor': 'end' });
      label.textContent = format(value);
      graphic.append(label);
    }
    if (mode === 'line') {
      legend.forEach(item => graphic.append(svg('polyline', {
        points: rows.map((row, index) => `${x(index)},${y(row[item.key] || 0)}`).join(' '),
        fill: 'none', stroke: item.color, 'stroke-width': 3, 'stroke-linejoin': 'round'
      })));
    }

    const detail = document.createElement('p');
    detail.className = 'analytics-chart-detail';
    detail.setAttribute('aria-live', 'polite');
    function describe(row) {
      detail.textContent = row.period + ' · ' + legend.map(item => item.label + ' ' + format(row[item.key] || 0)).join(' · ');
    }

    rows.forEach((row, index) => {
      const group = svg('g', { tabindex: '0', role: 'img', 'aria-label':
        row.period + ', ' + legend.map(item => item.label + ' ' + format(row[item.key] || 0)).join(', ') });
      const hit = svg('rect', { x: x(index) - step / 2, y: top, width: step, height: bottom - top, fill: 'transparent' });
      hit.classList.add('analytics-plot-hit');
      group.append(hit);
      let running = 0;
      const barWidth = Math.min(38, step * 0.65);
      for (const item of legend) {
        const value = Number(row[item.key] || 0);
        if (mode === 'line') group.append(svg('circle', { cx: x(index), cy: y(value), r: 4.5, fill: item.color }));
        else if (value) {
          group.append(svg('rect', { x: x(index) - barWidth / 2, y: y(running + value),
            width: barWidth, height: y(running) - y(running + value), fill: item.color }));
          running += value;
        }
      }
      group.addEventListener('focus', () => describe(row));
      group.addEventListener('pointerenter', () => describe(row));
      group.addEventListener('click', () => { group.focus(); describe(row); });
      graphic.append(group);
      const label = svg('text', { x: x(index), y: bottom + 19, 'text-anchor': 'middle' });
      label.textContent = row.period;
      graphic.append(label);
    });

    const viewport = document.createElement('div');
    viewport.className = 'analytics-plot';
    viewport.append(graphic);
    describe(rows.at(-1));
    figure.append(chartLegend(legend), viewport, detail);
    return figure;
  }

  function donut(title, rows, format) {
    const figure = figureWithTitle(title);
    const items = rows.filter(row => row.value > 0);
    const total = items.reduce((sum, row) => sum + row.value, 0);
    if (!total) {
      figure.append('No data for this period.');
      return figure;
    }
    const content = document.createElement('div');
    content.className = 'analytics-donut-content';
    const ring = document.createElement('div');
    ring.className = 'analytics-donut';
    ring.setAttribute('aria-hidden', 'true');
    let position = 0;
    const slices = [];
    const legend = items.map((row, index) => {
      const color = palette[index % palette.length];
      const end = position + row.value / total * 100;
      slices.push(`${color} ${position}% ${end}%`);
      position = end;
      return { label: row.period + ' · ' + format(row.value), color };
    });
    ring.style.backgroundImage = 'conic-gradient(' + slices.join(', ') + ')';
    const center = document.createElement('strong');
    center.textContent = format(total);
    ring.append(center);
    content.append(ring, chartLegend(legend));
    figure.append(content);
    return figure;
  }

  window.DormMapAnalytics = { metrics, chart, plot, donut };
})();
