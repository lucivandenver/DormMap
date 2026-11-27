import { isRequestTargeted } from '../services/dataRequestTargets.js';
import { activityPage } from '../services/logPagination.js';
import { storeReviewFile } from '../services/reviewFileService.js';
import { tenantBranchAssignments } from '../services/propertyBranchesService.js';
import { namedMessages } from '../services/messageIdentityService.js';
import { listApprovedBranchPins, listBarangayBranches, reviewBranch } from '../services/branchReviewService.js';
import { OwnerTenant, OwnerRoom, BoardingHouse, OwnerGallery } from '../models/ownerModels.js';
import { inventorySummary } from '../services/inventorySummaryService.js';
import { setPublicMapStatus } from '../services/publicMapStatusService.js';
import path from 'path';
import { Op, fn, col } from 'sequelize';
import { User } from '../models/userModel.js';
import { 
  BusinessPermit, AdminAuditLog, Announcement, BarangayMessage, 
  BarangayNotification, BploDataRequest, BploDataSubmission, BploPermitRenewal 
} from '../models/adminModels.js';
import { buildBarangayMasterlistWorkbook } from '../services/excelService.js';

const barangayOf = async req => {
  if (req.officialBarangay) return req.officialBarangay;
  req.barangayLookup ||= User.findByPk(req.session.userId, { attributes: ['barangay'] });
  return (await req.barangayLookup)?.barangay;
};
const audit = async (req, action, entityType, entityId, details = {}) =>
  AdminAuditLog.create({ actorId: req.session.userId, action, entityType, entityId,
    details: { ...details, barangay: details.barangay || await barangayOf(req) }, ipAddress: req.ip });
const ownersWhere = (barangay) => ({ accountType: 'boarding_house_owner', barangay, isArchived: false });

export const barangayDashboardPage = async (req, res, next) => {
  try {
    const user = await User.findByPk(req.session.userId, { attributes: ['fullName', 'email', 'profilePicture'] });
    res.render('barangayDashboard', {
      title: 'DormMap | Barangay Dashboard',
      userName: user?.fullName || req.session.userName || 'Barangay Official',
      userEmail: user?.email || '',
      profilePicture: user?.profilePicture || '',
    });
  } catch (error) { next(error); }
};

export const overview = async (req, res, next) => {
  try {
    const barangay = await barangayOf(req);
    if (!barangay) return res.status(422).json({ error: 'Your official account has no assigned barangay.' });

    const today = new Date();
    const next30 = new Date();
    next30.setDate(today.getDate() + 30);

    const ownerFilter = ownersWhere(barangay);
    const owners = await User.findAll({ 
      where: ownerFilter, 
      attributes: ['id', 'roomsAvailable', 'occupiedRooms', 'applicationStatus', 'boardingHouseName', 'createdAt', 'isSuspended', 'publicMapUnregistered'],
      raw: true 
    });
    
    const ownerIds = owners.map((x) => x.id);
    const permitWhere = { ownerId: { [Op.in]: ownerIds.length ? ownerIds : [0] } };

    // Fetch active BPLO data requests count for this barangay
    const allActiveRequests = await BploDataRequest.findAll({ where: { status: 'active' } });
    const targetRequests = allActiveRequests.filter(request => isRequestTargeted(request, barangay));

    const mySubmissions = await BploDataSubmission.findAll({ where: { barangay } });
    const submittedReqIds = new Set(mySubmissions.map(s => s.requestId));
    const pendingDataRequests = targetRequests.filter(r => !submittedReqIds.has(r.id)).length;
    const revisionSubmissionsCount = mySubmissions.filter(s => s.status === 'revision_requested').length;

    const inventory = await inventorySummary(owners);
    const [tenants, unreadMessages, expiredPermits, expiringPermits, permitStatus, monthly, tenantStats, pendingRenewalsCount] = await Promise.all([
      Promise.resolve(inventory.tenants),
      BarangayMessage.count({ where: { recipientId: req.session.userId, isRead: false } }),
      BusinessPermit.count({ where: { ...permitWhere, expirationDate: { [Op.lt]: today } } }),
      BusinessPermit.count({ where: { ...permitWhere, expirationDate: { [Op.between]: [today, next30] } } }),
      BusinessPermit.findAll({ 
        where: permitWhere, 
        attributes: ['status', [fn('COUNT', col('id')), 'count']], 
        group: ['status'], 
        raw: true 
      }),
      User.findAll({ 
        attributes: [
          [fn('DATE_FORMAT', col('createdAt'), '%b %Y'), 'month'], 
          [fn('COUNT', col('id')), 'count']
        ], 
        where: { ...ownerFilter, createdAt: { [Op.gte]: new Date(today.getFullYear(), today.getMonth() - 5, 1) } }, 
        group: [fn('DATE_FORMAT', col('createdAt'), '%b %Y')], 
        raw: true 
      }),
      OwnerTenant.findAll({
        attributes: [[fn('DATE_FORMAT', col('createdAt'), '%b'), 'month'], [fn('COUNT', col('id')), 'count']],
        where: { ownerId: { [Op.in]: ownerIds }, createdAt: { [Op.gte]: new Date(today.getFullYear(), today.getMonth()-5, 1) } },
        group: [fn('DATE_FORMAT', col('createdAt'), '%b')], raw: true
      }),
      BploPermitRenewal.count({ where: { barangay, status: { [Op.in]: ['pending_barangay', 'revision_required'] } } })
    ]);

    const vacantRooms = inventory.availableRooms;
    const occupiedRooms = inventory.occupiedRooms;
    const currentMonthStr = today.toLocaleString('default', { month: 'short', year: 'numeric' });
    const currentMonthRegs = monthly.find(m => m.month === currentMonthStr)?.count || 0;

    // Historical occupancy cannot be reconstructed from current tenant records.
    const occupancyTrends = [{ month: 'Current', occupied: occupiedRooms, vacant: vacantRooms }];

    res.json({ 
      barangay, 
      cards: { 
        houses: inventory.houses,
        pending: owners.filter(x => ['pending', 'revision_requested'].includes(x.applicationStatus)).length, 
        activeOwners: owners.filter(x => x.applicationStatus === 'approved' || x.applicationStatus === 'approved_barangay').length, 
        expiredPermits, 
        expiringPermits, 
        tenants, 
        vacantRooms, 
        occupiedRooms, 
        monthlyRegistrations: currentMonthRegs, 
        unreadMessages,
        pendingDataRequests,
        revisionSubmissionsCount,
        pendingRenewalsCount,
      }, 
      charts: { 
        monthly, 
        occupancyTrends,
        permitStatus,
        availableRooms: { vacant: vacantRooms, occupied: occupiedRooms },
        tenantStats: {
          total: tenants,
          monthly: tenantStats
        }
      } 
    });
  } catch (error) { next(error); }
};

// ==========================================
// DATA REQUESTS (BARANGAY INBOX)
// ==========================================

export const getBarangayDataRequests = async (req, res, next) => {
  try {
    const barangay = await barangayOf(req);
    if (!barangay) return res.status(422).json({ error: 'No assigned barangay.' });

    const allRequests = await BploDataRequest.findAll({
      order: [['submissionDeadline', 'ASC'], ['createdAt', 'DESC']]
    });

    const submissions = await BploDataSubmission.findAll({
      where: { barangay },
      order: [['createdAt', 'DESC']]
    });

    const applicableRequests = allRequests.filter(request => isRequestTargeted(request, barangay)).map(r => {
      const plain = r.get({ plain: true });
      const sub = submissions.find(s => s.requestId === r.id);
      const today = new Date();
      const deadline = new Date(plain.submissionDeadline);
      const diffDays = Math.ceil((deadline - today) / (1000 * 60 * 60 * 24));
      const isOverdue = !sub && diffDays < 0 && plain.status === 'active';

      let status = 'pending_submission';
      if (sub) status = sub.status;
      else if (isOverdue) status = 'overdue';

      return {
        ...plain,
        daysRemaining: diffDays,
        isOverdue,
        submissionStatus: status,
        latestSubmission: sub ? sub.get({ plain: true }) : null,
      };
    });

    res.json({ data: applicableRequests });
  } catch (error) { next(error); }
};

// ==========================================
// DATA SUBMISSIONS (BY BARANGAY TO BPLO)
// ==========================================

export const submitBarangayData = async (req, res, next) => {
  try {
    const barangay = await barangayOf(req);
    if (!barangay) return res.status(422).json({ error: 'No assigned barangay.' });

    const { requestId, submissionType, title, reportingPeriod, remarks, previousSubmissionId } = req.body;

    if (!title || !title.trim()) {
      return res.status(422).json({ error: 'Submission title is required.' });
    }

    const rawReqId = requestId ? Number(requestId) : null;
    if (rawReqId !== null) {
      if (!Number.isSafeInteger(rawReqId) || rawReqId < 1) return res.status(422).json({ error: 'Invalid data request.' });
      const dataRequest = await BploDataRequest.findOne({ where: { id: rawReqId, status: 'active' } });
      if (!dataRequest || !isRequestTargeted(dataRequest, barangay)) {
        return res.status(404).json({ error: 'This data request is unavailable for your barangay.' });
      }
    }
    const previous = previousSubmissionId && await BploDataSubmission.findOne({
      where: { id: previousSubmissionId, barangay, requestId: rawReqId }
    });
    if (previousSubmissionId && !previous) return res.status(404).json({ error: 'Previous submission not found.' });

    // Auto-calculate summary data for this barangay
    const ownerFilter = ownersWhere(barangay);
    const owners = await User.findAll({ 
      where: ownerFilter, 
      attributes: ['id', 'roomsAvailable', 'occupiedRooms', 'applicationStatus'] 
    });
    const ownerIds = owners.map(x => x.id);

    const [tenantsCount, permits] = await Promise.all([
      User.count({ where: { accountType: 'tenant', barangay, isArchived: false } }),
      ownerIds.length > 0 
        ? BusinessPermit.findAll({ where: { ownerId: { [Op.in]: ownerIds } } })
        : Promise.resolve([])
    ]);

    const totalHouses = owners.length;
    const registeredHouses = owners.filter(o => o.applicationStatus === 'approved' || o.applicationStatus === 'approved_barangay').length;
    const pendingHouses = owners.filter(o => ['pending', 'revision_requested', 'forwarded_to_bplo'].includes(o.applicationStatus)).length;
    const vacantRooms = owners.reduce((s, o) => s + Math.max(0, Number(o.roomsAvailable || 0)), 0);
    const occupiedRooms = owners.reduce((s, o) => s + Math.max(0, Number(o.occupiedRooms || 0)), 0);
    const activePermits = permits.filter(p => p.status === 'active').length;
    const expiredPermits = permits.filter(p => p.status === 'expired' || (p.expirationDate && new Date(p.expirationDate) < new Date())).length;

    const summaryData = {
      totalHouses,
      registeredHouses,
      pendingHouses,
      vacantRooms,
      occupiedRooms,
      tenantsCount,
      activePermits,
      expiredPermits,
      generatedAt: new Date().toISOString()
    };

    let fileUrl = null;
    let fileName = null;
    let fileFormat = null;
    let fileSize = null;

    if (req.file) {
      fileUrl = await storeReviewFile(req.file, req.session.userId, 'barangay-submission');
      fileName = req.file.originalname;
      fileFormat = path.extname(req.file.originalname).replace('.', '').toLowerCase();
      fileSize = req.file.size;
    } else {
      // Auto-generate official, structured Excel masterlist file from live records
      try {
        const safeBarangay = barangay.replace(/[^a-zA-Z0-9_-]/g, '_');
        const dateStr = new Date().toISOString().slice(0, 10);
        const autoFileName = `brgy_${safeBarangay}_masterlist_${dateStr}.xlsx`;

        const compiledForExcel = owners.map((h, i) => {
          const p = permits.find(x => x.ownerId === h.id);
          return {
            itemNo: i + 1,
            establishmentName: h.boardingHouseName || 'N/A',
            ownerName: h.fullName,
            address: h.boardingHouseAddress || barangay,
            contact: h.contactNumber || 'N/A',
            email: h.email || 'N/A',
            roomsVacant: h.roomsAvailable || 0,
            roomsOccupied: h.occupiedRooms || 0,
            rates: h.rentalPriceMin ? `₱${h.rentalPriceMin} - ₱${h.rentalPriceMax || h.rentalPriceMin}` : 'Contact Owner',
            bploPermitNo: p?.permitNumber || 'Unregistered / No Permit',
            permitStatus: p?.status || 'No Record',
            permitExpires: p?.expirationDate || 'N/A',
            complianceStatus: h.applicationStatus === 'approved' ? 'BPLO Compliant' : 'Pending / Non-Compliant',
          };
        });

        const workbook = await buildBarangayMasterlistWorkbook(barangay, compiledForExcel, summaryData);
        const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
        fileUrl = await storeReviewFile({ originalname: autoFileName, buffer }, req.session.userId, 'barangay-submission');
        fileName = autoFileName;
        fileFormat = 'xlsx';
        fileSize = buffer.length;
      } catch (excelGenErr) {
        console.error('Error auto-generating Excel masterlist for submission:', excelGenErr);
      }
    }

    // Versioning and Request ID sanitization
    let version = 1;
    let prevId = previous?.id || null;

    if (previous) {
      version = (previous.version || 1) + 1;
    } else if (rawReqId) {
      const prevReqSub = await BploDataSubmission.findOne({
        where: { requestId: rawReqId, barangay },
        order: [['version', 'DESC']]
      });
      if (prevReqSub) {
        version = (prevReqSub.version || 1) + 1;
        prevId = prevReqSub.id;
      }
    }

    const submission = await BploDataSubmission.create({
      requestId: rawReqId,
      barangay,
      submittedBy: req.session.userId,
      submissionType: submissionType || (rawReqId ? 'requested_report' : 'general_update'),
      title: title.trim(),
      reportingPeriod: reportingPeriod && reportingPeriod.trim() ? reportingPeriod.trim() : 'Current Cycle',
      status: 'submitted',
      fileUrl,
      fileName,
      fileFormat,
      fileSize,
      summaryData,
      remarks: remarks ? remarks.trim() : null,
      version,
      previousSubmissionId: prevId,
    });

    // Notify BPLO Super Admins
    try {
      const admins = await User.findAll({ where: { accountType: 'super_admin' }, attributes: ['id'] });
      for (const adm of admins) {
        await BarangayNotification.create({
          userId: adm.id,
          title: `New Barangay Submission: ${barangay}`,
          body: `Barangay ${barangay} submitted a report: "${title}" (Version ${version}). Type: ${submissionType || 'Requested Report'}.`,
          type: 'submission_received',
        });
      }
    } catch (err) {
      console.error('Error notifying admin of submission:', err);
    }

    try {
      await audit(req, 'submit_barangay_data', 'BploDataSubmission', submission.id, {
        barangay,
        title,
        requestId: rawReqId,
        version
      });
    } catch (auditErr) {
      console.error('Error logging submission audit:', auditErr);
    }

    return res.status(201).json({
      message: `Data successfully submitted to BPLO (Version ${version}).`,
      data: submission
    });
  } catch (error) {
    console.error('❌ Error in submitBarangayData:', error);
    return res.status(500).json({ error: error.message || 'Failed to submit data to BPLO Admin.' });
  }
};

export const getBarangaySubmissions = async (req, res, next) => {
  try {
    const barangay = await barangayOf(req);
    if (!barangay) return res.status(422).json({ error: 'No assigned barangay.' });

    const submissions = await BploDataSubmission.findAll({
      where: { barangay },
      order: [['createdAt', 'DESC']]
    });

    res.json({ data: submissions });
  } catch (error) { next(error); }
};

export const generateMasterlistExport = async (req, res, next) => {
  try {
    const barangay = await barangayOf(req);
    if (!barangay) return res.status(422).json({ error: 'No assigned barangay.' });

    const ownerFilter = ownersWhere(barangay);
    const houses = await User.findAll({
      where: ownerFilter,
      attributes: [
        'id', 'fullName', 'email', 'contactNumber', 'boardingHouseName', 
        'boardingHouseAddress', 'barangay', 'roomsAvailable', 'occupiedRooms', 
        'rentalPriceMin', 'rentalPriceMax', 'applicationStatus', 'createdAt'
      ],
      order: [['boardingHouseName', 'ASC']]
    });

    const permits = await BusinessPermit.findAll({
      where: {
        ownerId: { [Op.in]: houses.map(h => h.id).length ? houses.map(h => h.id) : [0] }
      }
    });
    const permitMap = Object.fromEntries(permits.map(p => [p.ownerId, p]));

    const compiledData = houses.map((h, i) => {
      const p = permitMap[h.id];
      return {
        itemNo: i + 1,
        establishmentName: h.boardingHouseName || 'N/A',
        ownerName: h.fullName,
        address: h.boardingHouseAddress || h.barangay,
        contact: h.contactNumber || 'N/A',
        email: h.email || 'N/A',
        roomsVacant: h.roomsAvailable || 0,
        roomsOccupied: h.occupiedRooms || 0,
        rates: h.rentalPriceMin ? `₱${h.rentalPriceMin} - ₱${h.rentalPriceMax || h.rentalPriceMin}` : 'Contact Owner',
        bploPermitNo: p?.permitNumber || 'Unregistered / No Permit',
        permitStatus: p?.status || 'No Record',
        permitExpires: p?.expirationDate || 'N/A',
        complianceStatus: h.applicationStatus === 'approved' ? 'BPLO Compliant' : 'Pending / Non-Compliant',
      };
    });

    if (req.query.format === 'json') {
      return res.json({
        barangay,
        generatedAt: new Date().toISOString(),
        totalEstablishments: compiledData.length,
        data: compiledData,
      });
    }

    // Generate organized Excel (.xlsx) file
    const summary = {
      totalHouses: houses.length,
      registeredHouses: houses.filter(h => h.applicationStatus === 'approved' || h.applicationStatus === 'approved_barangay').length,
      vacantRooms: houses.reduce((s, h) => s + Math.max(0, Number(h.roomsAvailable || 0)), 0),
      occupiedRooms: houses.reduce((s, h) => s + Math.max(0, Number(h.occupiedRooms || 0)), 0),
      activePermits: permits.filter(p => p.status === 'active').length,
      expiredPermits: permits.filter(p => p.status === 'expired' || (p.expirationDate && new Date(p.expirationDate) < new Date())).length,
      reportingPeriod: 'Current Cycle'
    };

    const wb = await buildBarangayMasterlistWorkbook(barangay, compiledData, summary);
    const safeBarangay = barangay.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `brgy_${safeBarangay}_masterlist_${new Date().toISOString().slice(0, 10)}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    return res.end();
  } catch (error) { next(error); }
};

// ==========================================
// PER-SUBMISSION EXCEL EXPORT (BARANGAY SIDE)
// ==========================================

export const exportSubmissionExcel = async (req, res, next) => {
  try {
    const barangay = await barangayOf(req);
    if (!barangay) return res.status(422).json({ error: 'No assigned barangay.' });

    const submission = await BploDataSubmission.findOne({
      where: { id: req.params.id, barangay }  // enforce barangay scoping
    });
    if (!submission) return res.status(404).json({ error: 'Submission not found.' });

    // If xlsx file already attached, redirect to it
    if (submission.fileUrl && (submission.fileFormat === 'xlsx' || submission.fileFormat === 'xls')) {
      return res.redirect(submission.fileUrl);
    }

    // Otherwise generate fresh Excel from live data
    const ownerFilter = ownersWhere(barangay);
    const houses = await User.findAll({
      where: ownerFilter,
      attributes: ['id', 'fullName', 'email', 'contactNumber', 'boardingHouseName', 'boardingHouseAddress', 'barangay', 'roomsAvailable', 'occupiedRooms', 'rentalPriceMin', 'rentalPriceMax', 'applicationStatus', 'createdAt'],
      order: [['boardingHouseName', 'ASC']]
    });
    const ownerIds = houses.map(h => h.id);
    const permits = ownerIds.length > 0 ? await BusinessPermit.findAll({ where: { ownerId: { [Op.in]: ownerIds } } }) : [];
    const permitMap = Object.fromEntries(permits.map(p => [p.ownerId, p]));

    const compiledData = houses.map((h, i) => {
      const p = permitMap[h.id];
      return {
        itemNo: i + 1,
        establishmentName: h.boardingHouseName || 'N/A',
        ownerName: h.fullName,
        address: h.boardingHouseAddress || h.barangay,
        contact: h.contactNumber || 'N/A',
        email: h.email || 'N/A',
        roomsVacant: h.roomsAvailable || 0,
        roomsOccupied: h.occupiedRooms || 0,
        rates: h.rentalPriceMin ? `₱${h.rentalPriceMin} - ₱${h.rentalPriceMax || h.rentalPriceMin}` : 'Contact Owner',
        bploPermitNo: p?.permitNumber || 'Unregistered / No Permit',
        permitStatus: p?.status || 'No Record',
        permitExpires: p?.expirationDate || 'N/A',
        complianceStatus: h.applicationStatus === 'approved' ? 'BPLO Compliant' : 'Pending / Non-Compliant',
      };
    });

    const summary = {
      totalHouses: houses.length,
      registeredHouses: houses.filter(h => h.applicationStatus === 'approved').length,
      vacantRooms: houses.reduce((s, h) => s + Math.max(0, Number(h.roomsAvailable || 0)), 0),
      occupiedRooms: houses.reduce((s, h) => s + Math.max(0, Number(h.occupiedRooms || 0)), 0),
      activePermits: permits.filter(p => p.status === 'active').length,
      expiredPermits: permits.filter(p => p.status === 'expired').length,
      reportingPeriod: submission.reportingPeriod || 'Current Cycle'
    };

    const wb = await buildBarangayMasterlistWorkbook(barangay, compiledData, summary);
    const safeBarangay = barangay.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `brgy_${safeBarangay}_submission_v${submission.version || 1}_${new Date().toISOString().slice(0, 10)}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    return res.end();
  } catch (error) { next(error); }
};

// ==========================================
// PERMIT RENEWALS & ENDORSEMENTS (BARANGAY SIDE)
// ==========================================

export const getPermitRenewals = async (req, res, next) => {
  try {
    const barangay = await barangayOf(req);
    if (!barangay) return res.status(422).json({ error: 'No assigned barangay.' });

    const renewals = await BploPermitRenewal.findAll({
      where: { barangay },
      order: [['createdAt', 'DESC']]
    });

    // Also get all permits in barangay with expiration alerts
    const ownerIds = (await User.findAll({ where: ownersWhere(barangay), attributes: ['id'], raw: true })).map(x => x.id);
    const permits = await BusinessPermit.findAll({
      where: { ownerId: { [Op.in]: ownerIds.length ? ownerIds : [0] } },
      order: [['expirationDate', 'ASC']]
    });

    const today = new Date();
    const permitAlerts = permits.map(p => {
      const days = Math.ceil((new Date(p.expirationDate) - today) / (1000 * 60 * 60 * 24));
      return {
        ...p.get({ plain: true }),
        daysRemaining: days,
        isExpired: days < 0,
        isExpiringSoon: days >= 0 && days <= 30,
      };
    });

    res.json({ renewals, permitAlerts });
  } catch (error) { next(error); }
};

export const submitPermitRenewal = async (req, res, next) => {
  try {
    const barangay = await barangayOf(req);
    if (!barangay) return res.status(422).json({ error: 'No assigned barangay.' });

    const { ownerId, permitNumber, currentExpirationDate, requestedRenewalDate, barangayNotes } = req.body;

    if (!ownerId) return res.status(422).json({ error: 'Boarding house owner selection is required.' });
    if (!await User.findOne({ where: { id: ownerId, ...ownersWhere(barangay) } })) return res.status(403).json({ error: 'This owner is outside your assigned barangay.' });

    let documents = {};
    if (req.file) {
      documents.uploadedDocument = await storeReviewFile(req.file, req.session.userId, 'barangay-renewal');
    }

    const renewal = await BploPermitRenewal.create({
      ownerId: Number(ownerId),
      barangay,
      permitNumber: permitNumber || null,
      currentExpirationDate: currentExpirationDate || null,
      requestedRenewalDate: requestedRenewalDate || null,
      status: 'forwarded_to_bplo',
      documents,
      barangayNotes: barangayNotes ? barangayNotes.trim() : null,
      reviewedByBarangay: req.session.userId,
      reviewedAt: new Date(),
    });

    // Notify BPLO Super Admin
    try {
      const admins = await User.findAll({ where: { accountType: 'super_admin' }, attributes: ['id'] });
      for (const adm of admins) {
        await BarangayNotification.create({
          userId: adm.id,
          title: `Permit Renewal Endorsed: Barangay ${barangay}`,
          body: `Barangay ${barangay} has endorsed a business permit renewal for Owner ID #${ownerId}.`,
          type: 'permit_renewal_endorsed',
        });
      }
    } catch {}

    await audit(req, 'endorse_permit_renewal', 'BploPermitRenewal', renewal.id, { barangay, ownerId });
    return res.status(201).json({ message: 'Permit renewal endorsed and forwarded to BPLO Admin.', data: renewal });
  } catch (error) {
    console.error('❌ Error in submitPermitRenewal:', error);
    return res.status(500).json({ error: error.message || 'Failed to endorse permit renewal.' });
  }
};

export const updatePermitRenewalStatus = async (req, res, next) => {
  try {
    const barangay = await barangayOf(req);
    const renewal = await BploPermitRenewal.findOne({ where: { id: req.params.id, barangay } });
    if (!renewal) return res.status(404).json({ error: 'Permit renewal not found.' });

    const { status, barangayNotes } = req.body;
    await renewal.update({
      status: status || renewal.status,
      barangayNotes: barangayNotes ? barangayNotes.trim() : renewal.barangayNotes,
      reviewedByBarangay: req.session.userId,
      reviewedAt: new Date(),
    });

    await audit(req, 'update_renewal_status', 'BploPermitRenewal', renewal.id, { status, barangayNotes });
    res.json({ message: 'Permit renewal status updated.', data: renewal });
  } catch (error) { next(error); }
};

// ==========================================
// CORE BARANGAY OPERATIONS
// ==========================================

export const applications = async (req, res, next) => {
  try {
    const barangay = await barangayOf(req); 
    const where = ownersWhere(barangay);
    if (req.query.status) where.applicationStatus = req.query.status;
    if (req.query.search) {
      where[Op.or] = ['fullName', 'email', 'boardingHouseName'].map((field) => ({ [field]: { [Op.like]: `%${req.query.search}%` } }));
    }
    const owners = await User.findAll({
      where, order: [['createdAt', 'DESC']],
      attributes: ['id', 'fullName', 'email', 'profilePicture', 'publicMapUnregistered', 'boardingHouseName', 'boardingHouseAddress', 'barangay', 'mapPin', 'galleryImages', 'boardingHouseLatitude', 'boardingHouseLongitude',
        'validIdPicture', 'businessPermit', 'barangayClearance', 'proofOfOwnership', 'rentalPermit', 'supportingDocuments', 'applicationStatus', 'applicationReviewNote', 'createdAt']
    });
    const houses = await BoardingHouse.findAll({
      where: { ownerId: owners.map(owner => owner.id) },
      attributes: ['id', 'ownerId', 'name', 'isPrimary', 'address', 'barangay', 'registrationSubmission', 'declaredRooms', 'floorCount'],
      order: [['id', 'ASC']]
    });
    const photos = await OwnerGallery.findAll({
      where: { boardingHouseId: houses.map(house => house.id) },
      attributes: ['boardingHouseId', 'sortOrder', 'imageUrl']
    });
    const galleryByHouse = new Map();
    for (const photo of photos) {
      if (photo.sortOrder < 1 || photo.sortOrder > 10) continue;
      if (!galleryByHouse.has(photo.boardingHouseId)) galleryByHouse.set(photo.boardingHouseId, Array(10).fill(null));
      galleryByHouse.get(photo.boardingHouseId)[photo.sortOrder - 1] = photo.imageUrl;
    }
    const data = owners.map(owner => {
      const { id, applicationStatus, applicationReviewNote, createdAt, ...legacy } = owner.get({ plain: true });
      const ownerHouses = houses.filter(property => property.ownerId === id);
      const house = ownerHouses.find(property => property.isPrimary);
      const submission = house?.registrationSubmission || {
        ...legacy,
        branches: house?.declaredRooms ? [{ floors: house.floorCount, rooms: house.declaredRooms }] : []
      };
      const mainLocation = {
        barangay: submission.barangay, address: house?.address || legacy.boardingHouseAddress, latitude: legacy.boardingHouseLatitude, longitude: legacy.boardingHouseLongitude,
        galleryImages: galleryByHouse.get(house?.id) || legacy.galleryImages || submission.galleryImages
      };
      const branches = (submission.branches || []).map((branch, index) => {
        if (!index) return { ...branch, ...mainLocation };
        const property = ownerHouses.find(item => item.id === branch.boardingHouseId) ||
          ownerHouses.find(item => item.registrationSubmission?.submittedWithOwner &&
            item.name.endsWith(` — Branch ${index + 1}`) && item.barangay === branch.barangay);
        return { ...branch, address: property?.address || branch.address, galleryImages: galleryByHouse.get(property?.id) || branch.galleryImages };
      }).filter((branch, index) => index === 0 || branch.barangay);
      if (!branches.length) branches.push(mainLocation);
      return { ...submission, branches, id, applicationStatus, applicationReviewNote, createdAt,
        profilePicture: legacy.profilePicture, publicMapUnregistered: legacy.publicMapUnregistered,
        validIdPicture: legacy.validIdPicture || submission.validIdPicture,
        businessPermit: legacy.businessPermit || submission.businessPermit,
        barangayClearance: legacy.barangayClearance || submission.barangayClearance,
        proofOfOwnership: legacy.proofOfOwnership,
        rentalPermit: legacy.rentalPermit,
        supportingDocuments: legacy.supportingDocuments };
    });

    res.json({ data });
  } catch (error) { next(error); }
};

export const reviewApplication = async (req, res, next) => {
  try {
    const barangay = await barangayOf(req); 
    const owner = await User.findOne({ where: { id: req.params.id, ...ownersWhere(barangay) } });
    if (!owner) return res.status(404).json({ error: 'Application not found in your barangay.' });

    const actionMap = { 
      approve: 'approved_barangay', 
      reject: 'rejected', 
      revision: 'revision_requested', 
      forward: 'forwarded_to_bplo', 
      suspend: 'suspended' 
    };

    if (!actionMap[req.body.action]) return res.status(422).json({ error: 'Invalid application action.' });
    
    const action = req.body.action; 
    const newStatus = actionMap[action];
    
    await owner.update({ 
      applicationStatus: newStatus, 
      applicationReviewedAt: new Date(), 
      applicationReviewNote: req.body.note?.trim() || null, 
      isSuspended: action === 'suspend' 
    });

    await BarangayNotification.create({
      userId: owner.id,
      title: `Application Status Updated: ${newStatus.replace('_', ' ').toUpperCase()}`,
      body: `Your boarding house application status for ${owner.boardingHouseName || 'your property'} has been updated to ${newStatus}.${req.body.note ? ` Note: ${req.body.note}` : ''}`,
      type: 'application_update'
    });

    await audit(req, `barangay_owner_${action}`, 'User', owner.id, { barangay, status: newStatus, note: req.body.note || null });
    res.json({ data: owner, message: `Application ${action}ed successfully.` });
  } catch (error) { next(error); }
};

export const houses = async (req, res, next) => {
  try { 
    const barangay = await barangayOf(req); 
    const data = await User.findAll({ 
      where: { ...ownersWhere(barangay), boardingHouseName: { [Op.ne]: null } }, 
      attributes: { exclude: ['password', 'verificationToken'] }, 
      order: [['boardingHouseName', 'ASC']] 
    }); 
    res.json({ data }); 
  } catch (error) { next(error); }
};

export const changeHouseStatus = async (req, res, next) => {
  try { 
    const barangay = await barangayOf(req); 
    const owner = await User.findOne({ where: { id: req.params.id, ...ownersWhere(barangay) } }); 
    if (!owner) return res.status(404).json({ error: 'Boarding house not found.' }); 
    
    if (typeof req.body.isSuspended !== 'boolean') return res.status(422).json({ error: 'isSuspended must be true or false.' });
    const isSuspended = req.body.isSuspended;
    await owner.update({ 
      isSuspended, 
      applicationStatus: isSuspended ? 'suspended' : owner.applicationStatus === 'suspended' ? 'pending' : owner.applicationStatus
    }); 
    
    await audit(req, isSuspended ? 'suspend_house' : 'activate_house', 'User', owner.id, { barangay, isSuspended }); 
    res.json({ data: owner, message: isSuspended ? 'Establishment suspended.' : 'Establishment activated.' }); 
  } catch (error) { next(error); }
};

export const permits = async (req, res, next) => {
  try { 
    const barangay = await barangayOf(req); 
    const ownerIds = (await User.findAll({ where: ownersWhere(barangay), attributes: ['id'], raw: true })).map(x => x.id); 
    const data = await BusinessPermit.findAll({ 
      where: { ownerId: { [Op.in]: ownerIds.length ? ownerIds : [0] } }, 
      order: [['expirationDate', 'ASC']] 
    }); 
    res.json({ data }); 
  } catch (error) { next(error); }
};

export const updatePermit = async (req, res, next) => {
  try {
    const barangay = await barangayOf(req);
    const permit = await BusinessPermit.findByPk(req.params.id);
    if (!permit) return res.status(404).json({ error: 'Permit record not found.' });

    const owner = await User.findOne({ where: { id: permit.ownerId, ...ownersWhere(barangay) } });
    if (!owner) return res.status(403).json({ error: 'Permit does not belong to your barangay.' });

    const updates = {};
    if (req.body.permitNumber) updates.permitNumber = req.body.permitNumber.trim();
    if (req.body.issueDate) updates.issueDate = req.body.issueDate;
    if (req.body.expirationDate) updates.expirationDate = req.body.expirationDate;
    if (req.body.status) updates.status = req.body.status;
    if (req.body.notes) updates.notes = req.body.notes;

    await permit.update(updates);
    await audit(req, 'update_permit', 'BusinessPermit', permit.id, { barangay, updates });

    res.json({ data: permit, message: 'Permit updated successfully.' });
  } catch (error) { next(error); }
};

export const expiringNotifications = async (req, res, next) => {
  try { 
    const barangay = await barangayOf(req); 
    const ownerIds = (await User.findAll({ where: ownersWhere(barangay), attributes: ['id'], raw: true })).map(x => x.id); 
    const permits = await BusinessPermit.findAll({ where: { ownerId: { [Op.in]: ownerIds.length ? ownerIds : [0] } } }); 
    const today = new Date(); 
    const alerts = permits.map(p => ({ 
      ...p.get({ plain: true }), 
      days: Math.ceil((new Date(p.expirationDate) - today) / 86400000) 
    })).filter(p => [30, 15, 7, 1, 0].includes(p.days) || p.days < 0); 
    
    res.json({ barangay, data: alerts }); 
  } catch (error) { next(error); }
};

export const mapHouses = async (req, res, next) => { 
  try { 
    const barangay = await barangayOf(req); 
    const data = await User.findAll({ 
      where: { 
        ...ownersWhere(barangay), 
        boardingHouseName: { [Op.ne]: null }, 
        boardingHouseLatitude: { [Op.ne]: null }, 
        boardingHouseLongitude: { [Op.ne]: null } 
      }, 
      attributes: ['id', 'fullName', 'profilePicture', 'boardingHouseName', 'boardingHouseAddress', 'boardingHouseLatitude', 'boardingHouseLongitude', 'roomsAvailable', 'occupiedRooms', 'contactNumber', 'applicationStatus', 'isSuspended', 'publicMapUnregistered']
    }); 
    const branches = await listApprovedBranchPins(barangay);
    res.json({ data: [...data, ...branches] });
  } catch (e) { next(e); } 
};

export const messages = async (req, res, next) => { 
  try { 
    const data = await BarangayMessage.findAll({ 
      where: { [Op.or]: [{ senderId: req.session.userId }, { recipientId: req.session.userId }] }, 
      order: [['createdAt', 'DESC']] 
    }); 
    await BarangayMessage.update({ isRead: true }, { where: { recipientId: req.session.userId, isRead: false } }); 
    res.json({ data: await namedMessages(data, req.session.userId) });
  } catch (e) { next(e); } 
};

export const sendMessage = async (req, res, next) => { 
  try { 
    const barangay = await barangayOf(req); 
    const recipient = await User.findOne({ where: { id: req.body.recipientId, ...ownersWhere(barangay) } }); 
    if (!recipient) return res.status(422).json({ error: 'Recipient must be an owner in your barangay.' }); 
    
    const data = await BarangayMessage.create({ 
      senderId: req.session.userId, 
      recipientId: recipient.id, 
      subject: req.body.subject || null, 
      message: req.body.message 
    }); 
    
    await audit(req, 'send_message', 'BarangayMessage', data.id, { recipientId: recipient.id }); 
    res.status(201).json({ data, message: 'Message sent successfully.' }); 
  } catch (e) { next(e); } 
};

export const notifications = async (req, res, next) => { 
  try { 
    res.json({ data: await BarangayNotification.findAll({ where: { userId: req.session.userId }, order: [['createdAt', 'DESC']] }) }); 
  } catch (e) { next(e); } 
};

export const auditLogs = async (req, res, next) => { 
  try { 
    res.json(await activityPage(AdminAuditLog, { actorId: req.session.userId }, req.query.page));
  } catch (e) { next(e); } 
};

export const publishAnnouncement = async (req, res, next) => { 
  try { 
    const barangay = await barangayOf(req); 
    const data = await Announcement.create({ 
      title: req.body.title, 
      message: req.body.message, 
      audience: `owners:${barangay}`, 
      publishedBy: req.session.userId 
    }); 
    
    await audit(req, 'barangay_announcement', 'Announcement', data.id, { barangay, title: req.body.title }); 
    res.status(201).json({ data, message: 'Announcement broadcasted.' }); 
  } catch (e) { next(e); } 
};

const scopedTenantRows = (barangay, search = '') => barangay ? tenantBranchAssignments({ barangay, search }) : [];

export const tenants = async (req, res, next) => {
  try {
    const rows = await scopedTenantRows(await barangayOf(req), req.query.search);
    const users = await User.findAll({
      where: { id: { [Op.in]: rows.map(row => row.tenantUserId).filter(Boolean) }, accountType: 'tenant' },
      attributes: ['id', 'profilePicture']
    });
    const photos = new Map(users.map(user => [user.id, user.profilePicture]));
    res.json({ data: rows.map(row => ({
      fullName: row.fullName, email: row.email, contactNumber: row.contactNumber,
      status: row.status, roomNumber: row.roomNumber, selectedBoardingHouse: row.selectedBoardingHouse, branchNumber: row.branchNumber,
      moveInDate: row.moveInDate, createdAt: row.createdAt, profilePicture: photos.get(row.tenantUserId) || null
    })) });
  }
  catch (error) { next(error); }
};

export const getReportsData = async (req, res, next) => {
  try {
    const barangay = await barangayOf(req);
    const type = req.query.type || 'houses';
    const ownerFilter = ownersWhere(barangay);

    if (type === 'houses' || type === 'occupancy' || type === 'available_rooms') {
      const housesData = await User.findAll({ 
        where: { ...ownerFilter, boardingHouseName: { [Op.ne]: null } },
        attributes: ['id', 'fullName', 'boardingHouseName', 'boardingHouseAddress', 'roomsAvailable', 'occupiedRooms', 'contactNumber', 'applicationStatus', 'createdAt']
      });
      return res.json({ barangay, type, data: housesData });
    }

    if (type === 'permits') {
      const owners = await User.findAll({ where: ownerFilter, attributes: ['id', 'boardingHouseName'], raw: true });
      const ownerNames = new Map(owners.map(owner => [owner.id, owner.boardingHouseName]));
      const ownerIds = [...ownerNames.keys()];
      const permitsData = await BusinessPermit.findAll({
        where: { ownerId: { [Op.in]: ownerIds.length ? ownerIds : [0] } },
        order: [['expirationDate', 'ASC']]
      });
      return res.json({ barangay, type, data: permitsData.map(permit => ({ ...permit.toJSON(), boardingHouseName: ownerNames.get(permit.ownerId) })) });
    }

    if (type === 'tenants') {
      const tenantsData = await scopedTenantRows(barangay);
      return res.json({ barangay, type, data: tenantsData });
    }

    if (type === 'registrations') {
      const registrationsData = await User.findAll({
        where: ownerFilter,
        attributes: ['id', 'fullName', 'email', 'boardingHouseName', 'contactNumber', 'applicationStatus', 'createdAt']
      });
      return res.json({ barangay, type, data: registrationsData });
    }

    res.status(400).json({ error: 'Invalid report type.' });
  } catch (error) { next(error); }
};

export const getProfile = async (req, res, next) => {
  try {
    const user = await User.findByPk(req.session.userId, {
      attributes: { exclude: ['password', 'verificationToken'] },
    });
    if (!user) return res.status(404).json({ error: 'Profile not found.' });
    res.json({ data: user });
  } catch (error) { next(error); }
};

export const updateProfile = async (req, res, next) => {
  try {
    const user = await User.findByPk(req.session.userId);
    if (!user) return res.status(404).json({ error: 'Profile not found.' });
    const allowed = ['contactNumber', 'positionTitle'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    await user.update(updates);
    await AdminAuditLog.create({
      actorId: req.session.userId,
      action: 'update_profile',
      entityType: 'User',
      entityId: user.id,
      details: updates,
      ipAddress: req.ip,
    });
    res.json({ data: user.get({ plain: true }), message: 'Profile updated.' });
  } catch (error) { next(error); }
};

export const updatePublicMapStatus = async (req, res, next) => {
  try {
    const where = { id: req.params.id, accountType: 'boarding_house_owner' };
    where.barangay = await barangayOf(req);
    const owner = await User.findOne({ where });
    if (!owner) return res.status(404).json({ error: 'Establishment not found in your jurisdiction.' });
    const data = await setPublicMapStatus(owner, req.body.action);
    await audit(req, 'public_map_status', 'User', owner.id, { action: req.body.action, ...data });
    res.json({ data, message: 'Public map status updated.' });
  } catch (error) { next(error); }
};

export const listBranches = async (req, res, next) => {
  try { res.json(await listBarangayBranches(await barangayOf(req))); } catch (error) { next(error); }
};
export const reviewBranchApplication = async (req, res, next) => {
  try { const data = await reviewBranch(req.params.id, req.body.action, req.body.note, await barangayOf(req)); await audit(req, 'branch_review', 'BoardingHouse', data.id, { action: req.body.action }); res.json({ data, message: 'Branch review saved.' }); } catch (error) { next(error); }
};
