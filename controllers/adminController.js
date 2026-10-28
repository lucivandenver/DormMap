import { uploadDir } from '../config/storage.js';
import { Op, fn, col } from 'sequelize';
import { User } from '../models/userModel.js';
import { 
  Barangay, EducationalInstitution, BusinessPermit, AdminAuditLog, 
  Announcement, BarangayNotification, BploDataRequest, BploDataSubmission, 
  BploPermitRenewal, BploSystemSetting 
} from '../models/adminModels.js';
import { OwnerNotification } from '../models/ownerModels.js';
import fs from 'fs';
import path from 'path';
import { buildConsolidatedMasterlistWorkbook, buildBarangayMasterlistWorkbook } from '../services/excelService.js';

const page = (value, fallback = 1) => Math.max(Number.parseInt(value, 10) || fallback, 1);
const audit = (req, action, entityType, entityId, details = {}) => AdminAuditLog.create({
  actorId: req.session.userId, action, entityType, entityId, details, ipAddress: req.ip,
});

export const adminDashboardPage = (req, res) => res.render('adminDashboard', {
  title: 'DormMap | BPLO Administration & Data Management', userName: req.session.userName,
});

export const overview = async (req, res, next) => {
  try {
    const today = new Date();
    const soon = new Date(); soon.setDate(today.getDate() + 30);
    const ownerWhere = { accountType: 'boarding_house_owner', isArchived: false };

    const [
      barangays, institutions, owners, tenants, clients, houses, activeHouses, 
      pendingOwners, availableResult, permits, expiredPermits, expiringPermits, 
      activeRequests, pendingSubmissions, approvedSubmissions, pendingRenewals, 
      recentActivity
    ] = await Promise.all([
      Barangay.count({ where: { isActive: true } }),
      EducationalInstitution.count({ where: { isActive: true } }),
      User.count({ where: ownerWhere }),
      User.count({ where: { accountType: 'tenant', isArchived: false } }),
      User.count({ where: { accountType: { [Op.in]: ['tenant', 'boarding_house_owner'] }, isArchived: false } }),
      User.count({ where: { ...ownerWhere, boardingHouseName: { [Op.ne]: null } } }),
      User.count({ where: { ...ownerWhere, boardingHouseName: { [Op.ne]: null }, applicationStatus: 'approved', emailVerified: true, isSuspended: false } }),
      User.count({ where: { ...ownerWhere, applicationStatus: { [Op.in]: ['pending', 'revision_requested', 'forwarded_to_bplo'] } } }),
      User.sum('roomsAvailable', { where: { ...ownerWhere, applicationStatus: 'approved' } }),
      BusinessPermit.count(),
      BusinessPermit.count({ where: { expirationDate: { [Op.lt]: today } } }),
      BusinessPermit.count({ where: { expirationDate: { [Op.between]: [today, soon] } } }),
      BploDataRequest.count({ where: { status: 'active' } }),
      BploDataSubmission.count({ where: { status: { [Op.in]: ['submitted', 'under_review', 'revision_requested'] } } }),
      BploDataSubmission.count({ where: { status: 'approved' } }),
      BploPermitRenewal.count({ where: { status: { [Op.in]: ['pending_barangay', 'barangay_approved', 'forwarded_to_bplo'] } } }),
      AdminAuditLog.findAll({ order: [['createdAt', 'DESC']], limit: 10 }),
    ]);

    const availableRooms = Number(availableResult || 0);
    const occupiedRooms = 0;

    const monthly = await User.findAll({
      attributes: [[fn('DATE_FORMAT', col('createdAt'), '%Y-%m'), 'month'], [fn('COUNT', col('id')), 'count']],
      where: { createdAt: { [Op.gte]: new Date(today.getFullYear(), today.getMonth() - 5, 1) } },
      group: [fn('DATE_FORMAT', col('createdAt'), '%Y-%m')], order: [[fn('DATE_FORMAT', col('createdAt'), '%Y-%m'), 'ASC']], raw: true,
    });

    const submissionStats = await BploDataSubmission.findAll({
      attributes: ['status', [fn('COUNT', col('id')), 'count']],
      group: ['status'],
      raw: true
    });

    res.json({
      cards: { 
        barangays, houses, activeHouses, pendingOwners, expiredPermits, expiringPermits, 
        owners, tenants, clients, institutions, availableRooms, occupiedRooms, occupancy: 0, 
        permits, activeRequests, pendingSubmissions, approvedSubmissions, pendingRenewals 
      },
      charts: { 
        monthly, 
        permitStatus: await BusinessPermit.findAll({ attributes: ['status', [fn('COUNT', col('id')), 'count']], group: ['status'], raw: true }),
        submissionStats
      },
      recentActivity,
    });
  } catch (error) { next(error); }
};

// ==========================================
// DATA REQUESTS CONTROLLERS (BPLO TO BARANGAY)
// ==========================================

export const listDataRequests = async (req, res, next) => {
  try {
    const where = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.priority) where.priority = req.query.priority;
    if (req.query.category) where.category = req.query.category;
    if (req.query.search) {
      where[Op.or] = [
        { title: { [Op.like]: `%${req.query.search}%` } },
        { purpose: { [Op.like]: `%${req.query.search}%` } }
      ];
    }

    const requests = await BploDataRequest.findAll({
      where,
      order: [['createdAt', 'DESC']]
    });

    // Compute progress stats for each request
    const totalBarangaysCount = await Barangay.count({ where: { isActive: true } });
    const requestsWithStats = await Promise.all(requests.map(async (r) => {
      const plain = r.get({ plain: true });
      let targetCount = totalBarangaysCount;
      let targetList = [];
      try {
        if (plain.targetType === 'selected_barangays' && plain.targetBarangays) {
          targetList = JSON.parse(plain.targetBarangays);
          targetCount = targetList.length;
        }
      } catch (e) {}

      const submissions = await BploDataSubmission.findAll({
        where: { requestId: r.id },
        attributes: ['barangay', 'status', 'createdAt']
      });

      const submittedCount = submissions.filter(s => ['submitted', 'under_review', 'approved'].includes(s.status)).length;
      const approvedCount = submissions.filter(s => s.status === 'approved').length;
      const revisionCount = submissions.filter(s => s.status === 'revision_requested').length;

      const isOverdue = new Date(plain.submissionDeadline) < new Date() && plain.status === 'active';

      return {
        ...plain,
        targetCount,
        submittedCount,
        approvedCount,
        revisionCount,
        pendingCount: Math.max(0, targetCount - submittedCount),
        isOverdue,
      };
    }));

    res.json({ data: requestsWithStats });
  } catch (error) { next(error); }
};

export const createDataRequest = async (req, res, next) => {
  try {
    const { 
      title, category, purpose, reportingPeriod, periodDetails, 
      submissionDeadline, priority, targetType, targetBarangays, 
      requiredFormat, instructions 
    } = req.body;

    if (!title || !purpose || !submissionDeadline) {
      return res.status(422).json({ error: 'Title, purpose, and deadline are required.' });
    }

    let parsedTargets = null;
    if (targetType === 'selected_barangays') {
      if (Array.isArray(targetBarangays)) {
        parsedTargets = JSON.stringify(targetBarangays);
      } else if (typeof targetBarangays === 'string') {
        try {
          parsedTargets = JSON.stringify(JSON.parse(targetBarangays));
        } catch {
          parsedTargets = JSON.stringify([targetBarangays]);
        }
      }
    }

    const requestRecord = await BploDataRequest.create({
      title: title.trim(),
      category: category || 'updated_masterlist',
      purpose: purpose.trim(),
      reportingPeriod: reportingPeriod || 'monthly',
      periodDetails: periodDetails || null,
      submissionDeadline,
      priority: priority || 'normal',
      targetType: targetType || 'all_barangays',
      targetBarangays: parsedTargets,
      requiredFormat: requiredFormat || 'PDF, XLSX, CSV',
      instructions: instructions ? instructions.trim() : null,
      status: 'active',
      createdBy: req.session.userId,
    });

    // Notify targeted Barangay Officials
    try {
      let targetBarangayNames = [];
      if (targetType === 'selected_barangays' && parsedTargets) {
        targetBarangayNames = JSON.parse(parsedTargets);
      } else {
        const allBrgys = await Barangay.findAll({ where: { isActive: true }, attributes: ['name'] });
        targetBarangayNames = allBrgys.map(b => b.name);
      }

      const barangayUsers = await User.findAll({
        where: {
          accountType: 'barangay',
          barangay: { [Op.in]: targetBarangayNames },
          isArchived: false,
        },
        attributes: ['id', 'barangay', 'fullName']
      });

      const priorityLabel = priority === 'urgent' ? '[URGENT] ' : (priority === 'high' ? '[HIGH PRIORITY] ' : '');
      for (const u of barangayUsers) {
        await BarangayNotification.create({
          userId: u.id,
          title: `${priorityLabel}BPLO Data Request: ${title}`,
          body: `The BPLO has issued a new data request (${category || 'Masterlist Update'}). Deadline: ${submissionDeadline}. Purpose: ${purpose}`,
          type: 'data_request',
        });
      }
    } catch (notifErr) {
      console.error('Error sending request notifications:', notifErr);
    }

    await audit(req, 'create_data_request', 'BploDataRequest', requestRecord.id, { title, priority, targetType });
    res.status(201).json({ message: 'Data request created and broadcasted to barangays.', data: requestRecord });
  } catch (error) { next(error); }
};

export const getDataRequestDetails = async (req, res, next) => {
  try {
    const record = await BploDataRequest.findByPk(req.params.id);
    if (!record) return res.status(404).json({ error: 'Data request not found.' });

    const allBarangays = await Barangay.findAll({ where: { isActive: true }, order: [['name', 'ASC']] });
    let targeted = allBarangays.map(b => b.name);
    try {
      if (record.targetType === 'selected_barangays' && record.targetBarangays) {
        targeted = JSON.parse(record.targetBarangays);
      }
    } catch {}

    const submissions = await BploDataSubmission.findAll({
      where: { requestId: record.id },
      order: [['createdAt', 'DESC']]
    });

    // Build complete compliance matrix
    const matrix = allBarangays.map(b => {
      const isTargeted = targeted.includes(b.name);
      const sub = submissions.find(s => s.barangay === b.name);
      const isOverdue = !sub && new Date(record.submissionDeadline) < new Date() && record.status === 'active';

      let status = 'not_applicable';
      if (isTargeted) {
        if (!sub) status = isOverdue ? 'overdue' : 'pending';
        else status = sub.status;
      }

      return {
        barangay: b.name,
        officialName: b.officialName,
        officialEmail: b.officialEmail,
        isTargeted,
        status,
        submission: sub ? sub.get({ plain: true }) : null,
      };
    });

    res.json({ request: record, matrix, submissions });
  } catch (error) { next(error); }
};

export const updateDataRequest = async (req, res, next) => {
  try {
    const record = await BploDataRequest.findByPk(req.params.id);
    if (!record) return res.status(404).json({ error: 'Data request not found.' });

    const allowed = ['title', 'purpose', 'submissionDeadline', 'priority', 'requiredFormat', 'instructions', 'status'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

    await record.update(updates);
    await audit(req, 'update_data_request', 'BploDataRequest', record.id, updates);
    res.json({ message: 'Data request updated successfully.', data: record });
  } catch (error) { next(error); }
};

export const deleteDataRequest = async (req, res, next) => {
  try {
    const record = await BploDataRequest.findByPk(req.params.id);
    if (!record) return res.status(404).json({ error: 'Data request not found.' });
    await record.update({ status: 'cancelled' });
    await audit(req, 'cancel_data_request', 'BploDataRequest', record.id);
    res.json({ message: 'Data request cancelled.' });
  } catch (error) { next(error); }
};

export const sendDataRequestReminder = async (req, res, next) => {
  try {
    const record = await BploDataRequest.findByPk(req.params.id);
    if (!record) return res.status(404).json({ error: 'Data request not found.' });

    let targeted = [];
    if (record.targetType === 'selected_barangays' && record.targetBarangays) {
      try { targeted = JSON.parse(record.targetBarangays); } catch {}
    } else {
      const allB = await Barangay.findAll({ where: { isActive: true }, attributes: ['name'] });
      targeted = allB.map(b => b.name);
    }

    const existingSubmissions = await BploDataSubmission.findAll({
      where: { requestId: record.id, status: { [Op.in]: ['submitted', 'under_review', 'approved'] } },
      attributes: ['barangay']
    });
    const submittedBarangays = new Set(existingSubmissions.map(s => s.barangay));
    const pendingBarangays = targeted.filter(b => !submittedBarangays.has(b));

    const pendingOfficials = await User.findAll({
      where: {
        accountType: 'barangay',
        barangay: { [Op.in]: pendingBarangays },
        isArchived: false,
      }
    });

    for (const u of pendingOfficials) {
      await BarangayNotification.create({
        userId: u.id,
        title: `[REMINDER] Pending BPLO Data Request: ${record.title}`,
        body: `Your barangay (${u.barangay}) has a pending data request due on ${record.submissionDeadline}. Please prepare and submit the required masterlist/information.`,
        type: 'reminder',
      });
    }

    await audit(req, 'send_request_reminder', 'BploDataRequest', record.id, { pendingCount: pendingOfficials.length });
    res.json({ message: `Reminders dispatched to ${pendingOfficials.length} barangay official(s).`, count: pendingOfficials.length });
  } catch (error) { next(error); }
};

// ==========================================
// BARANGAY SUBMISSIONS MANAGEMENT
// ==========================================

export const listSubmissions = async (req, res, next) => {
  try {
    const where = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.barangay) where.barangay = req.query.barangay;
    if (req.query.submissionType) where.submissionType = req.query.submissionType;
    if (req.query.requestId) where.requestId = req.query.requestId;
    if (req.query.search) {
      where[Op.or] = [
        { title: { [Op.like]: `%${req.query.search}%` } },
        { barangay: { [Op.like]: `%${req.query.search}%` } },
        { remarks: { [Op.like]: `%${req.query.search}%` } },
      ];
    }

    const data = await BploDataSubmission.findAll({
      where,
      order: [['createdAt', 'DESC']]
    });

    res.json({ data });
  } catch (error) { next(error); }
};

export const getSubmissionDetails = async (req, res, next) => {
  try {
    const submission = await BploDataSubmission.findByPk(req.params.id);
    if (!submission) return res.status(404).json({ error: 'Submission not found.' });

    let requestInfo = null;
    if (submission.requestId) {
      requestInfo = await BploDataRequest.findByPk(submission.requestId);
    }

    let submitter = await User.findByPk(submission.submittedBy, {
      attributes: ['id', 'fullName', 'email', 'contactNumber', 'barangay']
    });

    // Version history
    const previousVersions = await BploDataSubmission.findAll({
      where: {
        barangay: submission.barangay,
        [Op.or]: [
          { requestId: submission.requestId },
          { title: submission.title }
        ],
        id: { [Op.ne]: submission.id }
      },
      order: [['version', 'DESC']]
    });

    res.json({ submission, requestInfo, submitter, previousVersions });
  } catch (error) { next(error); }
};

export const reviewSubmission = async (req, res, next) => {
  try {
    const submission = await BploDataSubmission.findByPk(req.params.id);
    if (!submission) return res.status(404).json({ error: 'Submission not found.' });

    const { action, adminRemarks } = req.body;
    const statusMap = {
      approve: 'approved',
      reject: 'rejected',
      revision: 'revision_requested',
      under_review: 'under_review',
      archive: 'archived',
    };

    if (!statusMap[action]) {
      return res.status(422).json({ error: 'Invalid review action.' });
    }

    const newStatus = statusMap[action];
    await submission.update({
      status: newStatus,
      adminRemarks: adminRemarks ? adminRemarks.trim() : submission.adminRemarks,
      reviewedBy: req.session.userId,
      reviewedAt: new Date(),
    });

    // Notify submitter / barangay official
    try {
      await BarangayNotification.create({
        userId: submission.submittedBy,
        title: `Submission Status: ${newStatus.replace('_', ' ').toUpperCase()}`,
        body: `Your submission "${submission.title}" has been reviewed by BPLO Admin and marked as ${newStatus}.${adminRemarks ? ` Remarks: ${adminRemarks}` : ''}`,
        type: 'submission_review',
      });
    } catch {}

    await audit(req, `submission_${action}`, 'BploDataSubmission', submission.id, {
      barangay: submission.barangay,
      status: newStatus,
      adminRemarks
    });

    res.json({ message: `Submission marked as ${newStatus}.`, data: submission });
  } catch (error) { next(error); }
};

export const getComplianceMatrix = async (req, res, next) => {
  try {
    const barangays = await Barangay.findAll({ where: { isActive: true }, order: [['name', 'ASC']] });
    const activeRequests = await BploDataRequest.findAll({ where: { status: 'active' }, order: [['submissionDeadline', 'ASC']] });
    const allSubmissions = await BploDataSubmission.findAll({ order: [['createdAt', 'DESC']] });

    const matrix = barangays.map(b => {
      const submissions = allSubmissions.filter(s => s.barangay === b.name);
      const requestStatuses = activeRequests.map(r => {
        let isTarget = true;
        try {
          if (r.targetType === 'selected_barangays' && r.targetBarangays) {
            isTarget = JSON.parse(r.targetBarangays).includes(b.name);
          }
        } catch {}

        if (!isTarget) return { requestId: r.id, title: r.title, status: 'n/a' };

        const sub = submissions.find(s => s.requestId === r.id);
        const isOverdue = !sub && new Date(r.submissionDeadline) < new Date();
        return {
          requestId: r.id,
          title: r.title,
          deadline: r.submissionDeadline,
          status: sub ? sub.status : (isOverdue ? 'overdue' : 'pending'),
          submissionId: sub?.id || null,
        };
      });

      const totalApproved = submissions.filter(s => s.status === 'approved').length;
      const totalPending = requestStatuses.filter(r => r.status === 'pending').length;
      const totalOverdue = requestStatuses.filter(r => r.status === 'overdue').length;

      return {
        barangay: b.name,
        officialName: b.officialName,
        officialEmail: b.officialEmail,
        requestStatuses,
        totalSubmissions: submissions.length,
        totalApproved,
        totalPending,
        totalOverdue,
      };
    });

    res.json({ activeRequests, matrix });
  } catch (error) { next(error); }
};

export const exportConsolidatedData = async (req, res, next) => {
  try {
    const approvedSubmissions = await BploDataSubmission.findAll({
      where: { status: 'approved' },
      order: [['barangay', 'ASC'], ['createdAt', 'DESC']]
    });

    const activeHouses = await User.findAll({
      where: { accountType: 'boarding_house_owner', isArchived: false, applicationStatus: 'approved' },
      attributes: ['id', 'fullName', 'email', 'contactNumber', 'barangay', 'boardingHouseName', 'boardingHouseAddress', 'roomsAvailable', 'occupiedRooms']
    });

    if (req.query.format === 'json') {
      return res.json({
        timestamp: new Date().toISOString(),
        totalApprovedSubmissions: approvedSubmissions.length,
        totalActiveHouses: activeHouses.length,
        houses: activeHouses,
        submissions: approvedSubmissions
      });
    }

    // Generate consolidated Excel workbook
    const wb = await buildConsolidatedMasterlistWorkbook(activeHouses, approvedSubmissions);
    const filename = `dormap_consolidated_masterlist_${new Date().toISOString().slice(0, 10)}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    return res.end();
  } catch (error) { next(error); }
};

export const exportSubmissionExcel = async (req, res, next) => {
  try {
    const submission = await BploDataSubmission.findByPk(req.params.id);
    if (!submission) return res.status(404).json({ error: 'Submission not found.' });

    // If an Excel file is already attached and exists on disk, redirect to it
    if (submission.fileUrl && (submission.fileFormat === 'xlsx' || submission.fileFormat === 'xls')) {
      return res.redirect(submission.fileUrl);
    }

    // Otherwise dynamically compile this barangay's records into a fresh Excel workbook
    const barangay = submission.barangay;
    const ownerFilter = { accountType: 'boarding_house_owner', barangay, isArchived: false };
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

    const wb = await buildBarangayMasterlistWorkbook(barangay, compiledData, submission.summaryData || {});
    const safeBarangay = barangay.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `brgy_${safeBarangay}_masterlist_v${submission.version || 1}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    return res.end();
  } catch (error) { next(error); }
};

// ==========================================
// PERMIT RENEWAL WORKFLOW (BPLO SIDE)
// ==========================================

export const listPermitRenewals = async (req, res, next) => {
  try {
    const where = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.barangay) where.barangay = req.query.barangay;

    const renewals = await BploPermitRenewal.findAll({
      where,
      order: [['createdAt', 'DESC']]
    });

    // Populate owner info
    const ownerIds = renewals.map(r => r.ownerId);
    const owners = await User.findAll({
      where: { id: { [Op.in]: ownerIds.length ? ownerIds : [0] } },
      attributes: ['id', 'fullName', 'email', 'contactNumber', 'boardingHouseName', 'barangay']
    });
    const ownerMap = Object.fromEntries(owners.map(o => [o.id, o]));

    const data = renewals.map(r => ({
      ...r.get({ plain: true }),
      owner: ownerMap[r.ownerId] || null,
    }));

    res.json({ data });
  } catch (error) { next(error); }
};

export const reviewPermitRenewal = async (req, res, next) => {
  try {
    const renewal = await BploPermitRenewal.findByPk(req.params.id);
    if (!renewal) return res.status(404).json({ error: 'Permit renewal record not found.' });

    const { action, bploNotes, newExpirationDate, newPermitNumber } = req.body;
    const statusMap = {
      approve: 'bplo_approved',
      reject: 'rejected',
      revision: 'revision_required',
    };

    if (!statusMap[action]) return res.status(422).json({ error: 'Invalid review action.' });

    const newStatus = statusMap[action];
    await renewal.update({
      status: newStatus,
      bploNotes: bploNotes ? bploNotes.trim() : null,
      reviewedByBplo: req.session.userId,
      reviewedAt: new Date(),
    });

    // If approved, update or create BusinessPermit table
    if (action === 'approve') {
      let permit = await BusinessPermit.findOne({ where: { ownerId: renewal.ownerId } });
      const expDate = newExpirationDate || renewal.requestedRenewalDate || new Date(new Date().setFullYear(new Date().getFullYear() + 1));
      const pNum = newPermitNumber || renewal.permitNumber || `BP-2026-${String(renewal.ownerId).padStart(3, '0')}`;

      if (permit) {
        await permit.update({
          status: 'active',
          expirationDate: expDate,
          issueDate: new Date(),
          permitNumber: pNum,
          notes: bploNotes || permit.notes,
        });
      } else {
        await BusinessPermit.create({
          ownerId: renewal.ownerId,
          permitNumber: pNum,
          issueDate: new Date(),
          expirationDate: expDate,
          status: 'active',
          notes: bploNotes || 'Issued & approved by BPLO Office',
        });
      }

      await OwnerNotification.create({
        ownerId: renewal.ownerId,
        title: 'Business Permit Renewal Approved! 🎉',
        body: `Your business permit renewal request (${pNum}) has been APPROVED by BPLO Bongabong.`,
        type: 'permit',
      }).catch(() => {});
    } else if (action === 'reject') {
      let permit = await BusinessPermit.findOne({ where: { ownerId: renewal.ownerId } });
      if (permit) {
        await permit.update({ status: 'rejected' });
      }
      await OwnerNotification.create({
        ownerId: renewal.ownerId,
        title: 'Business Permit Renewal Rejected',
        body: `Your business permit renewal request was rejected by BPLO. Remarks: ${bploNotes || 'None'}`,
        type: 'permit',
      }).catch(() => {});
    }

    await audit(req, `permit_renewal_${action}`, 'BploPermitRenewal', renewal.id, { action, bploNotes });
    res.json({ message: `Permit renewal marked as ${newStatus}.`, data: renewal });
  } catch (error) { next(error); }
};

// ==========================================
// SYSTEM SETTINGS & CONFIGURATION
// ==========================================

export const getSystemSettings = async (req, res, next) => {
  try {
    const settings = await BploSystemSetting.findAll({ order: [['category', 'ASC'], ['key', 'ASC']] });
    res.json({ data: settings });
  } catch (error) { next(error); }
};

export const updateSystemSettings = async (req, res, next) => {
  try {
    const { settings } = req.body; // array of { key, value }
    if (!Array.isArray(settings)) return res.status(422).json({ error: 'Invalid settings payload.' });

    for (const item of settings) {
      if (item.key && item.value !== undefined) {
        const strVal = typeof item.value === 'object' ? JSON.stringify(item.value) : String(item.value);
        await BploSystemSetting.upsert({
          key: item.key,
          value: strVal,
          updatedBy: req.session.userId,
        });
      }
    }

    await audit(req, 'update_system_settings', 'BploSystemSetting', null, { count: settings.length });
    res.json({ message: 'System settings updated successfully.' });
  } catch (error) { next(error); }
};

// ==========================================
// SYSTEM MAINTENANCE & HEALTH MONITORING
// ==========================================

export const getMaintenanceStatus = async (req, res, next) => {
  try {
    const [dbSizeResult] = await BusinessPermit.sequelize.query(`
      SELECT table_schema "database", 
             ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) "size_mb" 
      FROM information_schema.TABLES 
      WHERE table_schema = DATABASE() 
      GROUP BY table_schema;
    `).catch(() => [[{ size_mb: 'N/A' }]]);

    // Calculate uploads folder size
    let uploadsSizeMb = 0;
    try {
      const uploadPath = uploadDir;
      if (fs.existsSync(uploadPath)) {
        const files = fs.readdirSync(uploadPath);
        let totalBytes = 0;
        files.forEach(f => {
          try { totalBytes += fs.statSync(path.join(uploadPath, f)).size; } catch {}
        });
        uploadsSizeMb = (totalBytes / (1024 * 1024)).toFixed(2);
      }
    } catch {}

    const memoryUsage = process.memoryUsage();
    const uptimeHours = (process.uptime() / 3600).toFixed(1);

    const maintenanceModeSetting = await BploSystemSetting.findByPk('maintenance_mode');
    const isMaintenanceMode = maintenanceModeSetting?.value === 'true';

    const recentAuditErrors = await AdminAuditLog.count({
      where: {
        action: { [Op.like]: '%error%' }
      }
    });

    res.json({
      status: 'operational',
      database: {
        connected: true,
        dialect: 'mysql',
        sizeMb: dbSizeResult?.[0]?.size_mb || '12.4',
      },
      storage: {
        uploadsSizeMb,
        uploadPath: '/uploads',
      },
      server: {
        uptimeHours,
        rssMemoryMb: (memoryUsage.rss / 1024 / 1024).toFixed(1),
        heapUsedMb: (memoryUsage.heapUsed / 1024 / 1024).toFixed(1),
        nodeVersion: process.version,
      },
      isMaintenanceMode,
      recentAuditErrors,
    });
  } catch (error) { next(error); }
};

export const toggleMaintenanceMode = async (req, res, next) => {
  try {
    const setting = await BploSystemSetting.findByPk('maintenance_mode');
    const currentVal = setting?.value === 'true';
    const newVal = !currentVal;

    await BploSystemSetting.upsert({
      key: 'maintenance_mode',
      value: String(newVal),
      category: 'maintenance',
      description: 'System Maintenance Mode Flag',
      updatedBy: req.session.userId,
    });

    await audit(req, newVal ? 'enable_maintenance_mode' : 'disable_maintenance_mode', 'SystemSetting', null);
    res.json({ message: `Maintenance mode ${newVal ? 'ENABLED' : 'DISABLED'}.`, isMaintenanceMode: newVal });
  } catch (error) { next(error); }
};

export const getSystemErrorLogs = async (req, res, next) => {
  try {
    const logs = await AdminAuditLog.findAll({
      order: [['createdAt', 'DESC']],
      limit: 100
    });
    res.json({ data: logs });
  } catch (error) { next(error); }
};

export const triggerDatabaseBackup = async (req, res, next) => {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `dormap_backup_${timestamp}.json`;

    const [users, barangays, institutions, permits, dataRequests, dataSubmissions] = await Promise.all([
      User.findAll({ attributes: { exclude: ['password'] } }),
      Barangay.findAll(),
      EducationalInstitution.findAll(),
      BusinessPermit.findAll(),
      BploDataRequest.findAll(),
      BploDataSubmission.findAll(),
    ]);

    const backupPayload = {
      backupDate: new Date().toISOString(),
      version: '1.0.0',
      database: 'DorMap_Bongabong',
      tables: {
        usersCount: users.length,
        barangaysCount: barangays.length,
        institutionsCount: institutions.length,
        permitsCount: permits.length,
        dataRequestsCount: dataRequests.length,
        dataSubmissionsCount: dataSubmissions.length,
      },
      data: { users, barangays, institutions, permits, dataRequests, dataSubmissions }
    };

    await audit(req, 'database_backup_generated', 'SystemBackup', null, { filename });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.json(backupPayload);
  } catch (error) { next(error); }
};

// ==========================================
// CORE CRUD CONTROLLERS
// ==========================================

export const listOwners = async (req, res, next) => {
  try {
    const current = page(req.query.page); const limit = Math.min(page(req.query.limit, 10), 50);
    const where = { accountType: 'boarding_house_owner', isArchived: false };
    if (req.query.status) where.applicationStatus = req.query.status;
    if (req.query.search) where[Op.or] = ['fullName', 'email', 'boardingHouseName', 'barangay'].map((field) => ({ [field]: { [Op.like]: `%${req.query.search}%` } }));
    const result = await User.findAndCountAll({ where, attributes: { exclude: ['password', 'verificationToken'] }, order: [['createdAt', 'DESC']], limit, offset: (current - 1) * limit });
    res.json({ data: result.rows, pagination: { page: current, limit, total: result.count, pages: Math.ceil(result.count / limit) } });
  } catch (error) { next(error); }
};

export const reviewOwner = async (req, res, next) => {
  try {
    const owner = await User.findOne({ where: { id: req.params.id, accountType: 'boarding_house_owner' } });
    if (!owner) return res.status(404).json({ error: 'Owner application not found.' });
    const action = req.body.action;
    const statusMap = { approve: 'approved', reject: 'rejected', revision: 'revision_requested', suspend: 'suspended', archive: 'archived' };
    if (!statusMap[action]) return res.status(422).json({ error: 'Invalid review action.' });
    await owner.update({
      applicationStatus: statusMap[action], applicationReviewedAt: new Date(), applicationReviewNote: req.body.note?.trim() || null,
      emailVerified: action === 'approve' ? true : owner.emailVerified,
      isSuspended: action === 'suspend', isArchived: action === 'archive',
    });
    await audit(req, `owner_${action}`, 'User', owner.id, { note: req.body.note || null });
    res.json({ message: `Owner application ${statusMap[action]}.`, data: owner });
  } catch (error) { next(error); }
};

const crud = (Model, entityType, fields) => ({
  list: async (req, res, next) => { try { const where = req.query.search ? { name: { [Op.like]: `%${req.query.search}%` } } : {}; res.json({ data: await Model.findAll({ where, order: [['createdAt', 'DESC']] }) }); } catch (e) { next(e); } },
  create: async (req, res, next) => { try { const record = await Model.create(Object.fromEntries(Object.entries(req.body).filter(([k]) => fields.includes(k)))); await audit(req, 'create', entityType, record.id); res.status(201).json({ data: record }); } catch (e) { next(e); } },
  update: async (req, res, next) => { try { const record = await Model.findByPk(req.params.id); if (!record) return res.status(404).json({ error: `${entityType} not found.` }); await record.update(Object.fromEntries(Object.entries(req.body).filter(([k]) => fields.includes(k)))); await audit(req, 'update', entityType, record.id); res.json({ data: record }); } catch (e) { next(e); } },
  remove: async (req, res, next) => { try { const record = await Model.findByPk(req.params.id); if (!record) return res.status(404).json({ error: `${entityType} not found.` }); await record.destroy(); await audit(req, 'delete', entityType, record.id); res.json({ message: 'Record deleted.' }); } catch (e) { next(e); } },
});

export const barangays = crud(Barangay, 'Barangay', ['name', 'officialName', 'officialEmail', 'isActive']);
export const institutions = crud(EducationalInstitution, 'EducationalInstitution', ['name', 'schoolType', 'address', 'latitude', 'longitude', 'barangay', 'isActive']);
export const permits = crud(BusinessPermit, 'BusinessPermit', ['ownerId', 'permitNumber', 'issueDate', 'expirationDate', 'status', 'documentUrl', 'notes']);
export const listAudit = async (req, res, next) => { try { res.json({ data: await AdminAuditLog.findAll({ order: [['createdAt', 'DESC']], limit: 100 }) }); } catch (e) { next(e); } };
export const createAnnouncement = async (req, res, next) => { try { const record = await Announcement.create({ title: req.body.title, message: req.body.message, audience: req.body.audience || 'all', publishedBy: req.session.userId }); await audit(req, 'publish', 'Announcement', record.id); res.status(201).json({ data: record }); } catch (e) { next(e); } };

// ==========================================
// MUNICIPAL GIS MAP CONTROLLER
// ==========================================

const BONGABONG_BARANGAY_COORDS = {
  'Aplaya': { lat: 12.7535, lng: 121.5030 },
  'Bagong Bayan I': { lat: 12.7590, lng: 121.4900 },
  'Bagong Bayan II': { lat: 12.7630, lng: 121.4880 },
  'Poblacion': { lat: 12.7560, lng: 121.4920 },
  'Anilao': { lat: 12.7380, lng: 121.5020 },
  'Batangan': { lat: 12.7480, lng: 121.4420 },
  'Bukal': { lat: 12.7310, lng: 121.4110 },
  'Camantigue': { lat: 12.7650, lng: 121.4650 },
  'Carmundo': { lat: 12.7820, lng: 121.4190 },
  'Cawayan': { lat: 12.7210, lng: 121.4950 },
  'Dayhagan': { lat: 12.7750, lng: 121.5120 },
  'Formon': { lat: 12.7700, lng: 121.4390 },
  'Hagan': { lat: 12.7930, lng: 121.4080 },
  'Hagupit': { lat: 12.7440, lng: 121.4680 },
  'Ipil': { lat: 12.7660, lng: 121.4790 },
  'Kaligtasan': { lat: 12.7490, lng: 121.4820 },
  'Labasan': { lat: 12.7600, lng: 121.5050 },
  'Labonan': { lat: 12.7680, lng: 121.4980 },
  'Libertad': { lat: 12.7880, lng: 121.4620 },
  'Lisap': { lat: 12.8020, lng: 121.4280 },
  'Luna': { lat: 12.7710, lng: 121.4890 },
  'Malitbog': { lat: 12.7850, lng: 121.4510 },
  'Mapang': { lat: 12.7350, lng: 121.4490 },
  'Masaguisi': { lat: 12.6950, lng: 121.5120 },
  'Mina de Oro': { lat: 12.6780, lng: 121.5210 },
  'Morente': { lat: 12.7980, lng: 121.4420 },
  'Ogbot': { lat: 12.7410, lng: 121.4290 },
  'Orconuma': { lat: 12.7010, lng: 121.4720 },
  'Pulosahi': { lat: 12.7290, lng: 121.4620 },
  'Sagana': { lat: 12.7350, lng: 121.4740 },
  'San Isidro': { lat: 12.7150, lng: 121.4680 },
  'San Jose': { lat: 12.7520, lng: 121.4750 },
  'San Juan': { lat: 12.7620, lng: 121.4600 },
  'Sta. Cruz': { lat: 12.7580, lng: 121.4700 },
  'Sigange': { lat: 12.7420, lng: 121.4150 },
  'Tawas': { lat: 12.7480, lng: 121.4580 }
};

const resolveCoordinates = (user, salt = 0) => {
  let lat = Number(String(user.boardingHouseLatitude ?? '').trim());
  let lng = Number(String(user.boardingHouseLongitude ?? '').trim());

  if ((!Number.isFinite(lat) || !Number.isFinite(lng)) && user.mapPin) {
    const match = String(user.mapPin).match(/(?:Lat|Coordinates:)\s*([0-9.-]+)[,\s]+(?:Lon\s*)?([0-9.-]+)/i);
    if (match) {
      lat = Number(match[1]);
      lng = Number(match[2]);
    }
  }

  if ((!Number.isFinite(lat) || !Number.isFinite(lng)) && user.barangay) {
    const brgyName = user.barangay.trim();
    const brgyCoord = BONGABONG_BARANGAY_COORDS[brgyName];
    if (brgyCoord) {
      // Deterministic slight jitter based on id so pins in same barangay do not perfectly stack
      const jitterLat = ((user.id * 17) % 10 - 5) * 0.0006;
      const jitterLng = ((user.id * 23) % 10 - 5) * 0.0006;
      lat = brgyCoord.lat + jitterLat;
      lng = brgyCoord.lng + jitterLng;
    }
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    lat = 12.7563 + (((user.id || salt) * 19) % 10 - 5) * 0.001;
    lng = 121.4920 + (((user.id || salt) * 29) % 10 - 5) * 0.001;
  }

  return { lat, lng };
};

export const adminMapData = async (req, res, next) => {
  try {
    const [rawOwners, rawOfficials, barangaysList] = await Promise.all([
      User.findAll({
        where: {
          accountType: 'boarding_house_owner',
          isArchived: false,
        },
        attributes: [
          'id', 'fullName', 'email', 'contactNumber', 'barangay',
          'boardingHouseName', 'boardingHouseAddress', 'boardingHousePicture',
          'profilePicture', 'roomsAvailable', 'occupiedRooms', 'mapPin',
          'boardingHouseLatitude', 'boardingHouseLongitude', 'applicationStatus',
          'isSuspended', 'paymentMethods', 'gender', 'budgetRange', 'createdAt'
        ],
        order: [['boardingHouseName', 'ASC']]
      }),
      User.findAll({
        where: {
          accountType: 'barangay',
          isArchived: false,
        },
        attributes: [
          'id', 'fullName', 'email', 'contactNumber', 'barangay',
          'positionTitle', 'profilePicture', 'mapPin', 'createdAt'
        ],
        order: [['barangay', 'ASC']]
      }),
      Barangay.findAll({
        where: { isActive: true },
        order: [['name', 'ASC']]
      })
    ]);

    const owners = rawOwners.map(o => {
      const plain = o.get({ plain: true });
      const coords = resolveCoordinates(plain, 1);
      return {
        ...plain,
        lat: coords.lat,
        lng: coords.lng,
        type: 'owner'
      };
    });

    const officials = rawOfficials.map(f => {
      const plain = f.get({ plain: true });
      const coords = resolveCoordinates(plain, 2);
      return {
        ...plain,
        lat: coords.lat,
        lng: coords.lng,
        type: 'official'
      };
    });

    // Also attach standard Bongabong barangay reference list
    const allBarangays = Object.keys(BONGABONG_BARANGAY_COORDS);

    res.json({
      success: true,
      data: {
        owners,
        officials,
        barangays: barangaysList.map(b => b.name),
        allBarangays,
        center: { lat: 12.7563, lng: 121.4920 },
        totalHouses: owners.length,
        totalOfficials: officials.length,
      }
    });
  } catch (error) {
    next(error);
  }
};

