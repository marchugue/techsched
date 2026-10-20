const ExcelJS = require('exceljs');

// Colours sampled from the reference sheet.
const C = {
  titleBg: 'FF0A2230', titleFg: 'FFA6A6A6',
  headBg: 'FF1F4E5A', headFg: 'FFBFBFBF',
  dateBg: 'FF6FCAD4',
  eventBg: 'FFFFFF00',
  cellBg: 'FFFFFFFF',
  emptyBg: 'FFF2F2F2',
  border: 'FFD9D9D9',
  ink: 'FF000000'
};

const thin = { style: 'thin', color: { argb: C.border } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };

function paint(cell, { bg, fg = C.ink, size = 10, bold = true, italic = false }) {
  cell.font = { name: 'Arial', size, bold, italic, color: { argb: fg } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  cell.border = BORDER;
}

async function writeExcel(model, filePath) {
  const rh = model.rowHeights;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'TechSched';
  wb.created = new Date();

  const ws = wb.addWorksheet(model.monthName, {
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9, orientation: 'landscape',
      fitToPage: true, fitToWidth: 1, fitToHeight: 1,
      margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 }
    }
  });
  for (let c = 1; c <= 7; c++) ws.getColumn(c).width = 24;

  let r = 1;

  // Title bar
  ws.mergeCells(r, 1, r, 7);
  for (let c = 1; c <= 7; c++) paint(ws.getCell(r, c), { bg: C.titleBg, fg: C.titleFg, size: 18 });
  ws.getCell(r, 1).value = model.title;
  ws.getRow(r).height = rh.title;
  r++;

  // Weekday header
  ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].forEach((d, i) => {
    const cell = ws.getCell(r, i + 1);
    cell.value = d;
    paint(cell, { bg: C.headBg, fg: C.headFg, size: 14 });
  });
  ws.getRow(r).height = rh.header;
  r++;

  for (const week of model.weeks) {
    // Event rows (yellow, above the dates)
    for (let i = 0; i < week.eventRows; i++) {
      week.days.forEach((d, c) => {
        const cell = ws.getCell(r, c + 1);
        cell.value = d.eventCells[i] || null;
        paint(cell, { bg: C.eventBg, size: 10 });
      });
      ws.getRow(r).height = rh.event;
      r++;
    }
    // Date row
    week.days.forEach((d, c) => {
      const cell = ws.getCell(r, c + 1);
      cell.value = d.day;
      paint(cell, { bg: C.dateBg, size: 11 });
    });
    ws.getRow(r).height = rh.date;
    r++;
    // People rows
    for (let i = 0; i < week.peopleRows; i++) {
      week.days.forEach((d, c) => {
        const cell = ws.getCell(r, c + 1);
        cell.value = d.peopleCells[i] || null;
        paint(cell, { bg: d.day === null ? C.emptyBg : C.cellBg, size: 10 });
      });
      ws.getRow(r).height = rh.person;
      r++;
    }
  }

  if (model.legend) {
    ws.mergeCells(r, 1, r, 7);
    for (let c = 1; c <= 7; c++) paint(ws.getCell(r, c), { bg: C.cellBg, size: 9, bold: false, italic: true });
    ws.getCell(r, 1).value = model.legend;
    ws.getRow(r).height = rh.legend;
  }

  await wb.xlsx.writeFile(filePath);
}

module.exports = { writeExcel };
