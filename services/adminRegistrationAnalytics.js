import { Op, col, fn, literal, where as sqlWhere } from 'sequelize';
import { User } from '../models/userModel.js';
import { isReportDay, nextPeriod } from './reportCalendar.js';

const roles = ['tenant', 'boarding_house_owner', 'barangay', 'super_admin', 'bplo_admin'];
const manilaMidnight = day => new Date(day + 'T00:00:00+08:00');

// Resolve the same barangay for display and search, before grouping or pagination.
const registrationBarangay = literal(`CASE WHEN \`User\`.accountType = 'tenant' THEN COALESCE(
  (SELECT COALESCE(NULLIF(TRIM(house.barangay), ''), NULLIF(TRIM(owner.barangay), ''))
   FROM TenantApplications AS application
   LEFT JOIN BoardingHouses AS house ON house.id = application.boardingHouseId
   LEFT JOIN Users AS owner ON owner.id = application.ownerId
   WHERE application.tenantId = \`User\`.id
     AND application.status IN ('confirmed', 'accepted_by_owner', 'pending_owner')
     AND (application.status = 'confirmed' OR NULLIF(\`User\`.selectedBoardingHouse, '') IS NULL
          OR application.boardingHouseName = \`User\`.selectedBoardingHouse
          OR CONCAT('bh-', house.id) = \`User\`.selectedBoardingHouse
          OR CONCAT('owner-', owner.id) = \`User\`.selectedBoardingHouse)
   ORDER BY (application.status = 'confirmed') DESC, application.createdAt DESC, application.id DESC
   LIMIT 1),
  (SELECT CASE WHEN COUNT(DISTINCT COALESCE(NULLIF(TRIM(house.barangay), ''), NULLIF(TRIM(owner.barangay), ''))) = 1
          THEN MAX(COALESCE(NULLIF(TRIM(house.barangay), ''), NULLIF(TRIM(owner.barangay), ''))) END
   FROM BoardingHouses AS house
   LEFT JOIN Users AS owner ON owner.id = house.ownerId
   WHERE house.name = \`User\`.selectedBoardingHouse OR CONCAT('bh-', house.id) = \`User\`.selectedBoardingHouse),
  (SELECT CASE WHEN COUNT(DISTINCT NULLIF(TRIM(owner.barangay), '')) = 1
          THEN MAX(NULLIF(TRIM(owner.barangay), '')) END
   FROM Users AS owner
   WHERE owner.accountType = 'boarding_house_owner'
     AND (CONCAT('owner-', owner.id) = \`User\`.selectedBoardingHouse OR (
       owner.boardingHouseName = \`User\`.selectedBoardingHouse
       AND NOT EXISTS (SELECT 1 FROM BoardingHouses WHERE name = \`User\`.selectedBoardingHouse)
     ))),
  \`User\`.barangay
) ELSE \`User\`.barangay END`);

export function registrationFilters({ search = '', role = '', period = 'all', date = '' }) {
  if (typeof search !== 'string' || search.length > 200 || (role !== '' && !roles.includes(role))) return null;
  if (!['all', 'day', 'month', 'year'].includes(period)) return null;
  const where = {};
  if (search.trim()) {
    const pattern = '%' + search.trim().replace(/[\\%_]/g, '\\$&') + '%';
    where[Op.or] = [
      { fullName: { [Op.like]: pattern } },
      { email: { [Op.like]: pattern } },
      sqlWhere(registrationBarangay, Op.like, pattern)
    ];
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
      where, attributes: ['id', 'fullName', 'email', 'accountType', [registrationBarangay, 'barangay'], 'createdAt', 'isArchived', 'isSuspended'],
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
