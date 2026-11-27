(() => {
  function render(container, headers, rows) {
    if (!rows.length) {
      const message = document.createElement('p');
      message.className = 'dormmap-report-empty';
      message.textContent = 'No records are available for this report.';
      container.replaceChildren(message);
      return;
    }

    const table = document.createElement('table');
    table.className = 'dormmap-report-table';
    const headings = table.createTHead().insertRow();
    for (const label of headers) {
      const heading = document.createElement('th');
      heading.scope = 'col';
      heading.textContent = label;
      headings.append(heading);
    }
    const body = table.createTBody();
    body.setAttribute('data-paginate', '');
    for (const row of rows) {
      const cells = body.insertRow();
      for (const value of row) cells.insertCell().textContent = value ?? '—';
    }
    container.replaceChildren(table);
  }

  function print(title, context, contents) {
    document.querySelector('.dormmap-print-sheet')?.remove();
    const sheet = document.createElement('article');
    sheet.className = 'dormmap-print-sheet';
    const header = document.createElement('header');
    const brand = document.createElement('p');
    brand.className = 'dormmap-print-brand';
    brand.textContent = 'DormMap';
    const heading = document.createElement('h1');
    heading.textContent = title.textContent;
    const details = document.createElement('p');
    const date = new Intl.DateTimeFormat('en-PH', { dateStyle: 'long', timeZone: 'Asia/Manila' }).format(new Date());
    details.textContent = [context, `Printed ${date}`].filter(Boolean).join(' · ');
    header.append(brand, heading, details);
    sheet.append(header, ...Array.from(contents.children, node => node.cloneNode(true)));
    document.body.append(sheet);
    document.body.classList.add('dormmap-printing-report');

    const clean = () => {
      sheet.remove();
      if (!document.querySelector('.dormmap-print-sheet')) document.body.classList.remove('dormmap-printing-report');
    };
    window.addEventListener('afterprint', clean, { once: true });
    window.print();
  }

  window.DormMapReports = { render, print };
})();
