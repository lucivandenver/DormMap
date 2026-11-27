const manilaDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Manila' });

export const reportDay = (date = new Date()) => manilaDate.format(date);

export function isReportDay(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    value >= '1000-01-01' && Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
}

export function shiftReportDay(date, days) {
  const shifted = new Date(date);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

export function periodStart(date, grouping) {
  if (grouping === 'week') return shiftReportDay(date, -((new Date(date).getUTCDay() + 6) % 7));
  if (grouping === 'month') return date.slice(0, 7) + '-01';
  return date;
}

export function nextPeriod(date, grouping) {
  if (grouping === 'month') {
    const next = new Date(date);
    next.setUTCMonth(next.getUTCMonth() + 1);
    return next.toISOString().slice(0, 10);
  }
  return shiftReportDay(date, grouping === 'week' ? 7 : 1);
}
