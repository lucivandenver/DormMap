import { Op } from 'sequelize';
import { User } from '../models/userModel.js';
import { BusinessPermit, BploDataRequest, BploDataSubmission } from '../models/adminModels.js';
import { OwnerInquiry, OwnerPayment, OwnerRoom, OwnerTenant } from '../models/ownerModels.js';
import { TenantApplication } from '../models/tenantModels.js';
import { barangayInventoryOwners, inventorySummary, municipalInventory, ownerRoomCounts } from './inventorySummaryService.js';
import { groupIncome, incomeEntries } from './incomeReport.js';
import { approvedReservations } from './ownerIncomeRecords.js';
import { awaitingBploOwnerStatuses, submittedOwnerWhere } from './registrationPolicy.js';
import { periodStart, reportDay, shiftReportDay } from './reportCalendar.js';

const integer = new Intl.NumberFormat('en-PH');
const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });

const ownerRooms = async ({ userId }) => ownerRoomCounts(await OwnerRoom.findAll({
  where: { ownerId: userId }, attributes: ['status', 'availableSlots'], raw: true
}));
const barangayInventory = async ({ barangay }) => inventorySummary(await barangayInventoryOwners(barangay), { barangay });

function inventoryMetrics(load, tenants) {
  return {
    totalRooms: { label: 'Total rooms', read: async scope => (await load(scope)).totalRooms },
    availableRooms: { label: 'Available rooms', read: async scope => (await load(scope)).availableRooms },
    occupiedRooms: { label: 'Occupied rooms', read: async scope => (await load(scope)).occupiedRooms },
    tenants: { label: 'Active tenants', read: tenants }
  };
}

function ownerCollections(previousMonth) {
  return async ({ userId }) => {
    const [payments, reservations] = await Promise.all([
      OwnerPayment.findAll({ where: { ownerId: userId, status: 'paid' }, raw: true }),
      approvedReservations(userId)
    ]);
    const today = reportDay();
    const month = (previousMonth ? shiftReportDay(periodStart(today, 'month'), -1) : today).slice(0, 7);
    return groupIncome(incomeEntries(payments, reservations)).get(month) ?? 0;
  };
}

const owner = {
  ...inventoryMetrics(ownerRooms, ({ userId }) => OwnerTenant.count({ where: { ownerId: userId, status: 'active' } })),
  inquiries: { label: 'Pending inquiries', read: ({ userId }) => OwnerInquiry.count({
    where: { ownerId: userId, status: 'new', isArchived: false }
  }) },
  pendingApplications: { label: 'Pending rental applications', read: ({ userId }) => TenantApplication.count({
    where: { ownerId: userId, status: 'pending_owner' }
  }) },
  monthlyCollections: { label: 'Confirmed rent and reservation collections this month', read: ownerCollections(false), format: peso },
  previousMonthlyCollections: { label: 'Confirmed rent and reservation collections last month', read: ownerCollections(true), format: peso }
};

const barangay = {
  ...inventoryMetrics(barangayInventory, async scope => (await barangayInventory(scope)).tenants),
  houses: { label: 'Boarding houses and branches recorded in your barangay', read: async scope => (await barangayInventory(scope)).houses },
  pendingApplications: { label: 'Owner applications pending barangay review or revision', read: ({ barangay }) => User.count({
    where: { accountType: 'boarding_house_owner', barangay, isArchived: false, applicationStatus: { [Op.in]: ['pending', 'revision_requested'] } }
  }) }
};

const bplo = {
  ...inventoryMetrics(municipalInventory, async () => (await municipalInventory()).tenants),
  houses: { label: 'Boarding houses and branches recorded in the municipality', read: async () => (await municipalInventory()).houses },
  activeHouses: { label: 'Active boarding houses and branches', read: async () => (await municipalInventory()).activeHouses },
  owners: { label: 'Registered owner accounts with submitted property details', read: () => User.count({ where: submittedOwnerWhere }) },
  clients: { label: 'Tenant and owner accounts on record', read: () => User.count({
    where: { accountType: { [Op.in]: ['tenant', 'boarding_house_owner'] }, isArchived: false }
  }) },
  pendingApplications: { label: 'Pending owner applications', read: () => User.count({
    where: { ...submittedOwnerWhere, applicationStatus: { [Op.in]: ['pending', 'revision_requested', ...awaitingBploOwnerStatuses] } }
  }) },
  expiredPermits: { label: 'Expired business permits', read: () => BusinessPermit.count({
    where: { expirationDate: { [Op.lt]: reportDay() } }
  }) },
  activeRequests: { label: 'Active BPLO data requests', read: () => BploDataRequest.count({ where: { status: 'active' } }) },
  pendingSubmissions: { label: 'Pending barangay submissions', read: () => BploDataSubmission.count({
    where: { status: { [Op.in]: ['submitted', 'under_review', 'revision_requested'] } }
  }) }
};

const metrics = new Map([['owner', owner], ['barangay', barangay], ['bplo', bplo]]);

export function dormigoMetrics(scope) {
  return metrics.get(scope);
}

export async function answerDormigoMetric(metric, scope) {
  const value = await metric.read(scope);
  return `**${metric.label}**: ${(metric.format ?? integer).format(value)}.`;
}
