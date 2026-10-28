import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';

/**
 * Builds a professionally formatted Excel Workbook for a single Barangay's Boarding House Masterlist
 */
export const buildBarangayMasterlistWorkbook = async (barangay, records = [], summary = {}) => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DorMap - BPLO Bongabong';
  wb.lastModifiedBy = 'DorMap BPLO System';
  wb.created = new Date();
  wb.modified = new Date();

  const ws = wb.addWorksheet(`${barangay.slice(0, 25)} Masterlist`, {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 6 }],
    properties: { defaultRowHeight: 20 }
  });

  // 1. Header Banner - Main Title
  ws.mergeCells('A1:N1');
  const r1 = ws.getCell('A1');
  r1.value = 'MUNICIPALITY OF BONGABONG — BUSINESS PERMIT & LICENSING OFFICE (BPLO)';
  r1.font = { name: 'Arial', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
  r1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF064E3B' } }; // Dark Emerald
  r1.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 34;

  // 2. Subtitle - Barangay Jurisdiction
  ws.mergeCells('A2:N2');
  const r2 = ws.getCell('A2');
  r2.value = `OFFICIAL BOARDING HOUSE & DORMITORY MASTERLIST — BARANGAY ${barangay.toUpperCase()}`;
  r2.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FF065F46' } };
  r2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECFDF5' } }; // Light Emerald
  r2.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(2).height = 24;

  // 3. Metadata & Generation Info
  ws.mergeCells('A3:N3');
  const r3 = ws.getCell('A3');
  const genDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  r3.value = `Generated: ${genDate} | Total Establishments: ${records.length} | Reporting Cycle: ${summary.reportingPeriod || 'Current Cycle'}`;
  r3.font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF475569' } };
  r3.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(3).height = 18;

  // 4. Summary Row (Mini KPI block)
  ws.mergeCells('A4:C4');
  ws.getCell('A4').value = `Total Houses: ${summary.totalHouses ?? records.length}`;
  ws.getCell('A4').font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF0F172A' } };
  ws.getCell('A4').alignment = { horizontal: 'center', vertical: 'middle' };

  ws.mergeCells('D4:F4');
  ws.getCell('D4').value = `Compliant / Approved: ${summary.registeredHouses ?? records.filter(r => r.complianceStatus?.includes('Compliant') || r.applicationStatus === 'approved').length}`;
  ws.getCell('D4').font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF047857' } };
  ws.getCell('D4').alignment = { horizontal: 'center', vertical: 'middle' };

  ws.mergeCells('G4:I4');
  ws.getCell('G4').value = `Vacant Rooms: ${summary.vacantRooms ?? 0} | Occupied: ${summary.occupiedRooms ?? 0}`;
  ws.getCell('G4').font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF0F172A' } };
  ws.getCell('G4').alignment = { horizontal: 'center', vertical: 'middle' };

  ws.mergeCells('J4:L4');
  ws.getCell('J4').value = `Active Permits: ${summary.activePermits ?? 0} | Expired: ${summary.expiredPermits ?? 0}`;
  ws.getCell('J4').font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FFB45309' } };
  ws.getCell('J4').alignment = { horizontal: 'center', vertical: 'middle' };

  ws.mergeCells('M4:N4');
  ws.getCell('M4').value = `Official Jurisdiction: Bongabong LGU`;
  ws.getCell('M4').font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF64748B' } };
  ws.getCell('M4').alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(4).height = 20;

  ws.getRow(5).height = 8; // Spacer

  // 5. Table Column Headers (Row 6)
  const headers = [
    'Item No.',
    'Establishment Name',
    'Owner Full Name',
    'Complete Address',
    'Contact Number',
    'Email Address',
    'Rooms Vacant',
    'Rooms Occupied',
    'Total Rooms',
    'Monthly Rates',
    'BPLO Permit No.',
    'Permit Status',
    'Expiration Date',
    'Compliance Status'
  ];

  const headerRow = ws.getRow(6);
  headerRow.values = headers;
  headerRow.height = 28;

  headerRow.eachCell((cell) => {
    cell.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF047857' } }; // Emerald
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = {
      top: { style: 'medium', color: { argb: 'FF064E3B' } },
      bottom: { style: 'medium', color: { argb: 'FF064E3B' } },
      left: { style: 'thin', color: { argb: 'FF065F46' } },
      right: { style: 'thin', color: { argb: 'FF065F46' } }
    };
  });

  // 6. Data Rows
  if (records.length === 0) {
    const emptyRow = ws.getRow(7);
    ws.mergeCells('A7:N7');
    emptyRow.getCell(1).value = 'No registered boarding houses found in this barangay.';
    emptyRow.getCell(1).font = { name: 'Arial', size: 10, italic: true, color: { argb: 'FF94A3B8' } };
    emptyRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    emptyRow.height = 32;
  } else {
    records.forEach((r, idx) => {
      const rowNumber = 7 + idx;
      const row = ws.getRow(rowNumber);
      const totalRooms = (Number(r.roomsVacant || r.roomsAvailable || 0) + Number(r.roomsOccupied || 0));

      const rates = r.rates 
        ? r.rates 
        : (r.rentalPriceMin ? `₱${r.rentalPriceMin} - ₱${r.rentalPriceMax || r.rentalPriceMin}` : 'Contact Owner');

      const permitNo = r.bploPermitNo || r.permitNumber || 'Unregistered / No Permit';
      const permitStatus = (r.permitStatus || r.status || 'No Record').toUpperCase();
      const compliance = (r.complianceStatus || (r.applicationStatus === 'approved' ? 'BPLO Compliant' : 'Pending / Non-Compliant'));

      row.values = [
        idx + 1,
        r.establishmentName || r.boardingHouseName || 'N/A',
        r.ownerName || r.fullName || 'N/A',
        r.address || r.boardingHouseAddress || barangay,
        r.contact || r.contactNumber || 'N/A',
        r.email || 'N/A',
        Number(r.roomsVacant ?? r.roomsAvailable ?? 0),
        Number(r.roomsOccupied ?? 0),
        totalRooms,
        rates,
        permitNo,
        permitStatus,
        r.permitExpires || r.expirationDate || 'N/A',
        compliance
      ];

      row.height = 22;

      // Zebra striping
      const isEven = idx % 2 === 0;
      const rowBg = isEven ? 'FFFFFFFF' : 'FFF8FAFC';

      row.eachCell((cell, colIndex) => {
        cell.font = { name: 'Arial', size: 9 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
        };

        // Alignments
        // 1=No, 5=Contact, 7=Vacant, 8=Occupied, 9=Total, 10=Rates, 11=PermitNo, 12=PermitStatus, 13=Expiration, 14=Compliance
        const centerCols = [1, 5, 7, 8, 9, 10, 11, 12, 13, 14];
        cell.alignment = {
          vertical: 'middle',
          horizontal: centerCols.includes(colIndex) ? 'center' : 'left'
        };

        // Styling for Statuses
        if (colIndex === 12) { // Permit status
          if (permitStatus === 'ACTIVE') {
            cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF166534' } };
          } else if (permitStatus === 'EXPIRED') {
            cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF991B1B' } };
          } else {
            cell.font = { name: 'Arial', size: 9, color: { argb: 'FF64748B' } };
          }
        } else if (colIndex === 14) { // Compliance
          if (compliance.includes('Compliant') || compliance === 'approved') {
            cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF166534' } };
          } else {
            cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FFB45309' } };
          }
        }
      });
    });
  }

  // Column Widths
  const columnWidths = [
    8,   // 1. Item No.
    28,  // 2. Establishment Name
    24,  // 3. Owner Name
    32,  // 4. Complete Address
    16,  // 5. Contact Number
    26,  // 6. Email Address
    14,  // 7. Rooms Vacant
    15,  // 8. Rooms Occupied
    13,  // 9. Total Rooms
    20,  // 10. Monthly Rates
    22,  // 11. BPLO Permit No.
    15,  // 12. Permit Status
    16,  // 13. Expiration Date
    24   // 14. Compliance Status
  ];

  columnWidths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  return wb;
};

/**
 * Builds a Consolidated Municipal Excel Workbook (for BPLO Admin)
 */
export const buildConsolidatedMasterlistWorkbook = async (houses = [], submissions = []) => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DorMap - BPLO Bongabong';
  wb.created = new Date();

  // Sheet 1: Complete Municipal Boarding Houses
  const ws1 = wb.addWorksheet('Municipal Masterlist', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 5 }]
  });

  ws1.mergeCells('A1:L1');
  const t1 = ws1.getCell('A1');
  t1.value = 'MUNICIPALITY OF BONGABONG — BPLO CONSOLIDATED BOARDING HOUSE REGISTRY';
  t1.font = { name: 'Arial', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
  t1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF064E3B' } };
  t1.alignment = { horizontal: 'center', vertical: 'middle' };
  ws1.getRow(1).height = 34;

  ws1.mergeCells('A2:L2');
  const t2 = ws1.getCell('A2');
  t2.value = `Official Municipal Consolidation — 28 Barangays | Total Registered Houses: ${houses.length}`;
  t2.font = { name: 'Arial', size: 10.5, bold: true, color: { argb: 'FF065F46' } };
  t2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECFDF5' } };
  t2.alignment = { horizontal: 'center', vertical: 'middle' };
  ws1.getRow(2).height = 22;

  ws1.mergeCells('A3:L3');
  ws1.getCell('A3').value = `Consolidated On: ${new Date().toLocaleString()} | DorMap Official Registry Dataset`;
  ws1.getCell('A3').font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF64748B' } };
  ws1.getCell('A3').alignment = { horizontal: 'center', vertical: 'middle' };
  ws1.getRow(3).height = 18;

  ws1.getRow(4).height = 8;

  const headers = [
    'No.', 'Barangay', 'Establishment Name', 'Owner Name', 
    'Address / Landmark', 'Contact Number', 'Email Address', 
    'Vacant Rooms', 'Occupied Rooms', 'Total Rooms', 'Permit Status', 'Compliance'
  ];

  const hRow = ws1.getRow(5);
  hRow.values = headers;
  hRow.height = 26;
  hRow.eachCell(cell => {
    cell.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF047857' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  });

  houses.forEach((h, idx) => {
    const row = ws1.getRow(6 + idx);
    const vacant = Number(h.roomsAvailable || 0);
    const occupied = Number(h.occupiedRooms || 0);
    row.values = [
      idx + 1,
      h.barangay || '—',
      h.boardingHouseName || 'N/A',
      h.fullName || 'N/A',
      h.boardingHouseAddress || h.barangay || '—',
      h.contactNumber || 'N/A',
      h.email || 'N/A',
      vacant,
      occupied,
      vacant + occupied,
      h.permitStatus || 'Active',
      h.applicationStatus === 'approved' ? 'Compliant' : 'Pending'
    ];
    row.height = 20;
    const isEven = idx % 2 === 0;
    row.eachCell((cell, colIndex) => {
      cell.font = { name: 'Arial', size: 9 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isEven ? 'FFFFFFFF' : 'FFF8FAFC' } };
      cell.border = { top: { style: 'thin', color: { argb: 'FFE2E8F0' } }, bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } }, left: { style: 'thin', color: { argb: 'FFE2E8F0' } }, right: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
      cell.alignment = { vertical: 'middle', horizontal: [1, 2, 6, 8, 9, 10, 11, 12].includes(colIndex) ? 'center' : 'left' };
    });
  });

  [8, 18, 28, 22, 30, 16, 25, 14, 15, 13, 15, 16].forEach((w, i) => ws1.getColumn(i + 1).width = w);

  // Sheet 2: Barangay Submissions History
  const ws2 = wb.addWorksheet('Barangay Submissions', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 2 }]
  });

  ws2.mergeCells('A1:H1');
  const s1 = ws2.getCell('A1');
  s1.value = 'BARANGAY OFFICIAL SUBMISSIONS LOG';
  s1.font = { name: 'Arial', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
  s1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF064E3B' } };
  s1.alignment = { horizontal: 'center', vertical: 'middle' };
  ws2.getRow(1).height = 28;

  const subHeaders = ['No.', 'Barangay', 'Submission Title', 'Type', 'Period', 'Status', 'File Name', 'Submitted Date'];
  const subHRow = ws2.getRow(2);
  subHRow.values = subHeaders;
  subHRow.height = 24;
  subHRow.eachCell(c => {
    c.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF047857' } };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  submissions.forEach((s, i) => {
    const row = ws2.getRow(3 + i);
    row.values = [
      i + 1,
      s.barangay,
      s.title,
      s.submissionType,
      s.reportingPeriod || '—',
      s.status,
      s.fileName || 'Live Data',
      new Date(s.createdAt).toLocaleDateString()
    ];
    row.height = 20;
    row.eachCell((c, colIndex) => {
      c.font = { name: 'Arial', size: 9 };
      c.alignment = { vertical: 'middle', horizontal: [1, 2, 4, 5, 6, 8].includes(colIndex) ? 'center' : 'left' };
      c.border = { top: { style: 'thin', color: { argb: 'FFE2E8F0' } }, bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } }, left: { style: 'thin', color: { argb: 'FFE2E8F0' } }, right: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
    });
  });

  [8, 18, 30, 20, 16, 16, 30, 15].forEach((w, i) => ws2.getColumn(i + 1).width = w);

  return wb;
};

/**
 * Saves a generated Barangay Masterlist Excel workbook directly to a file on disk
 */
export const saveBarangayMasterlistToFile = async (barangay, records, summary, targetFilePath) => {
  const dir = path.dirname(targetFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const wb = await buildBarangayMasterlistWorkbook(barangay, records, summary);
  await wb.xlsx.writeFile(targetFilePath);
  const stats = fs.statSync(targetFilePath);
  return {
    filePath: targetFilePath,
    fileSize: stats.size
  };
};
