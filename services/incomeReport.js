import { confirmedRentAmount } from './paymentAmounts.js';
import { nextPeriod, periodStart, reportDay, shiftReportDay } from './reportCalendar.js';

export function incomeEntries(payments, reservations) {
  return [
    ...payments.filter(payment => payment.status === 'paid').map(payment => ({
      date: payment.paidDate,
      month: payment.month,
      kind: 'rent',
      cents: Math.round(confirmedRentAmount(payment) * 100)
    })),
    ...reservations.map(reservation => ({
      date: reportDay(reservation.reservationApprovedAt),
      kind: 'reservation',
      cents: Math.round(Number(reservation.reservationAmountPaid ?? reservation.reservationFee) * 100)
    }))
  ];
}

function includesDate(date, from, to) {
  return Boolean(date && (!from || date >= from) && (!to || date <= to));
}

export function groupIncome(entries, grouping = 'month', from = '', to = '') {
  const totals = new Map();
  for (const entry of entries) {
    if ((from || to || grouping !== 'month') && !includesDate(entry.date, from, to)) continue;
    const period = entry.date ? periodStart(entry.date, grouping) : entry.month || 'Unknown';
    const label = grouping === 'month' ? period.slice(0, 7) : period;
    totals.set(label, (totals.get(label) || 0) + entry.cents);
  }
  return new Map([...totals].map(([period, cents]) => [period, cents / 100]));
}

export function incomeAnalytics(entries, grouping, from, to, today = reportDay()) {
  const dated = entries.filter(entry => entry.date);
  const matching = dated.filter(entry => includesDate(entry.date, from, to));
  const bounds = matching.reduce(({ first, last }, { date }) => ({
    first: first && first < date ? first : date,
    last: last && last > date ? last : date
  }), { first: '', last: '' });
  const selected = entries.filter(entry =>
    (from || to || grouping !== 'month') ? includesDate(entry.date, from, to) : true
  );
  const rent = selected.reduce((sum, entry) => sum + (entry.kind === 'rent' ? entry.cents : 0), 0);
  const reservations = selected.reduce((sum, entry) => sum + (entry.kind === 'reservation' ? entry.cents : 0), 0);
  const sum = (start, end) => dated.reduce((total, entry) => total + (includesDate(entry.date, start, end) ? entry.cents : 0), 0);
  let currentFrom, currentTo, previousFrom, previousTo;

  if (from || to) {
    currentFrom = from || bounds.first || to;
    currentTo = to || (bounds.last > today ? bounds.last : today);
    if (currentTo < currentFrom) currentTo = currentFrom;
    const days = (Date.parse(currentTo) - Date.parse(currentFrom)) / 86400000 + 1;
    previousFrom = shiftReportDay(currentFrom, -days);
    previousTo = shiftReportDay(currentFrom, -1);
  } else {
    currentFrom = periodStart(today, grouping);
    currentTo = today;
    previousTo = shiftReportDay(currentFrom, -1);
    previousFrom = periodStart(previousTo, grouping);
    const elapsed = (Date.parse(today) - Date.parse(currentFrom)) / 86400000;
    previousTo = [previousTo, shiftReportDay(previousFrom, elapsed)].sort()[0];
  }

  const current = sum(currentFrom, currentTo);
  const previous = sum(previousFrom, previousTo);
  const trend = [];
  const trendStart = periodStart(from || bounds.first || currentFrom, grouping);
  const trendEnd = to || bounds.last || currentTo;
  let period = periodStart(trendEnd, grouping);
  while (period >= trendStart && trend.length < 12) {
    const end = shiftReportDay(nextPeriod(period, grouping), -1);
    trend.unshift({ period, total: sum(from > period ? from : period, end > trendEnd ? trendEnd : end) / 100 });
    period = periodStart(shiftReportDay(period, -1), grouping);
  }

  return {
    total: (rent + reservations) / 100,
    rent: rent / 100,
    reservations: reservations / 100,
    trend,
    comparison: {
      currentFrom, currentTo, previousFrom, previousTo, current: current / 100, previous: previous / 100,
      change: (current - previous) / 100,
      percent: previous ? (current - previous) / previous * 100 : null
    }
  };
}
