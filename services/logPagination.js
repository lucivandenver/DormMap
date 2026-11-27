export async function activityPage(model, where, requestedPage) {
  const order = [['createdAt', 'DESC'], ['id', 'DESC']];
  if (requestedPage === undefined) return { data: await model.findAll({ where, order, limit: 100 }) };
  const pageSize = 5;
  const requested = Math.min(1000000, Math.max(1, Number.parseInt(requestedPage, 10) || 1));
  const result = await model.findAndCountAll({ where, order, limit: pageSize, offset: (requested - 1) * pageSize });
  const pages = Math.max(1, Math.ceil(result.count / pageSize));
  const page = Math.min(pages, requested);
  const data = requested > pages
    ? await model.findAll({ where, order, limit: pageSize, offset: (page - 1) * pageSize })
    : result.rows;
  return { data, pagination: { page, pages, total: result.count } };
}
