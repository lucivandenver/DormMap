import { Op, col, fn, literal } from 'sequelize';
import { User } from '../models/userModel.js';
import { isReportDay, nextPeriod } from './reportCalendar.js';

const roles = ['tenant', 'boarding_house_owner', 'barangay', 'super_admin', 'bplo_admin'];
const manilaMidnight = day => new Date(day + 'T00:00:00+08:00');

export function registrationFilters({ search = '', role = '', period = 'all', date = '' }) {
  if (typeof search !== 'string' || search.length > 200 || (role !== '' && !roles.includes(role))) return null;
  if (!['all', 'day', 'month', 'year'].includes(period)) return null;
  const where = {};
  if (search.trim()) {
    const pattern = '%' + search.trim().replace(/[\\%_]/g, '\\$&') + '%';
    where[Op.or] = ['fullName', 'email', 'barangay'].map(field => ({ [field]: { [Op.like]: pattern } }));
  }
  if (role) where.accountType = role;
  if (period === 'all') return { where, format: '%Y-%m' };
  const expected = period === 'year' ? /^\d{4}$/ : period === 'month' ? /^\d{4}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}$/;
  if (typeof date !== 'string' || !expected.test(date)) return null;
  const start = period === 'year' ? date + '-01-01' : period === 'month' ? date + '-01' : date;
  if (!isReportDay(start) || start >= '9999-01-01') return null;
  const finish = period === 'year' ? String(Number(date) + 1) + '-01-01' : nextPeriod(start, period);
  where.createdAt = { [Op.gte]: manilaMidnight(start), [Op.lt]: manilaMidnight(finish) };
  return { where, format: period === 'month' ? '%Y-%m-%d' : '%Y-%m', start, finish, period };
}

export async function listRegistrationAnalytics(filters, page, pageSize) {
  const { where, format, start, finish, period } = filters;
  const bucket = fn('DATE_FORMAT', literal('DATE_ADD(`createdAt`, INTERVAL 8 HOUR)'), format);
  const [groups, accounts] = await Promise.all([
    User.findAll({
      where, attributes: [[bucket, 'period'], 'accountType', [fn('COUNT', col('id')), 'count']],
      group: [bucket, 'accountType'], order: [[bucket, 'ASC']], raw: true
    }),
    User.findAll({
      where, attributes: ['id', 'fullName', 'email', 'accountType', 'barangay', 'createdAt', 'isArchived', 'isSuspended'],
      order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: pageSize, offset: (page - 1) * pageSize, raw: true
    })
  ]);
  const byRole = {};
  const series = new Map();
  let total = 0;
  for (const row of groups) {
    const count = Number(row.count);
    byRole[row.accountType] = (byRole[row.accountType] || 0) + count;
    series.set(row.period, (series.get(row.period) || 0) + count);
    total += count;
  }
  if (period === 'month' || period === 'year') {
    const grouping = period === 'month' ? 'day' : 'month';
    for (let date = start; date < finish; date = nextPeriod(date, grouping)) {
      const key = grouping === 'day' ? date : date.slice(0, 7);
      if (!series.has(key)) series.set(key, 0);
    }
  }
  if (period === 'day') {
    series.clear();
    series.set(start, total);
  }
  return {
    accounts, byRole, total, page, pages: Math.max(1, Math.ceil(total / pageSize)),
    trend: [...series].sort(([a], [b]) => a.localeCompare(b)).map(([period, count]) => ({ period, count }))
  };
}
