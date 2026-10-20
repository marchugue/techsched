// Builds a self-contained HTML page of the schedule for PDF / PNG export.
const pt2px = (pt) => (pt * 4) / 3;

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// A4 landscape with 8mm margins, in CSS px (96dpi)
const PDF_W = 1062;
const PDF_H = 733;
const PNG_W = 1400;
const PNG_SCALE = 2;

function layoutFor(model, mode) {
  const naturalH = pt2px(model.heightPt) + model.rowCount + 6;
  if (mode === 'pdf') {
    const zoom = Math.min(1, PDF_H / naturalH);
    return { zoom, width: PDF_W / zoom };
  }
  return { zoom: PNG_SCALE, width: PNG_W };
}

/** Pixel size of the window needed to capture the PNG. */
function pngSize(model) {
  const naturalH = pt2px(model.heightPt) + model.rowCount * 4 + 80;
  return { width: Math.ceil((PNG_W + 50) * PNG_SCALE), height: Math.ceil((naturalH + 60) * PNG_SCALE) };
}

function buildHtml(model, mode) {
  const rh = model.rowHeights;
  const { zoom, width } = layoutFor(model, mode);
  const px = (pt) => pt2px(pt).toFixed(2) + 'px';
  const lineH = px(rh.line);

  const head = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => `<th class="head">${d}</th>`).join('');
  let rows = '';
  for (const week of model.weeks) {
    for (let i = 0; i < week.eventRows; i++) {
      rows += `<tr style="height:${px(rh.event)}">` +
        week.days.map((d) => `<td class="event">${esc(d.eventCells[i])}</td>`).join('') + '</tr>';
    }
    rows += `<tr style="height:${px(rh.date)}">` +
      week.days.map((d) => `<td class="date">${d.day == null ? '' : d.day}</td>`).join('') + '</tr>';
    for (let i = 0; i < week.peopleRows; i++) {
      rows += `<tr style="height:${px(rh.person)}">` +
        week.days.map((d) => `<td class="people${d.day == null ? ' off' : ''}">${esc(d.peopleCells[i])}</td>`).join('') +
        '</tr>';
    }
  }
  const legend = model.legend
    ? `<tr style="height:${px(rh.legend)}"><td class="legend" colspan="7">${esc(model.legend)}</td></tr>`
    : '';

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(model.title)}</title>
<style>
  @page { size: A4 landscape; margin: 8mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: Arial, Helvetica, sans-serif; }
  #sheet { display: inline-block; width: ${width.toFixed(2)}px; zoom: ${zoom}; padding: 18px; background: #fff; box-sizing: border-box; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  td, th { border: 1px solid #d9d9d9; padding: 0 4px; text-align: center; vertical-align: middle;
           overflow: hidden; font-weight: bold; color: #000; }
  .title { background: #0a2230; color: #a6a6a6; font-size: 24px; height: ${px(rh.title)}; }
  .head { background: #1f4e5a; color: #bfbfbf; font-size: 18px; height: ${px(rh.header)}; }
  .event { background: #ffff00; font-size: 13px; }
  .date { background: #6fcad4; font-size: 14px; }
  .people { background: #fff; font-size: 13px; line-height: ${lineH}; white-space: pre-line; }
  .people.off { background: #f2f2f2; }
  .legend { background: #fff; font-size: 12px; font-weight: normal; font-style: italic; }
</style></head>
<body><div id="sheet"><table>
<tr><th class="title" colspan="7">${esc(model.title)}</th></tr>
<tr>${head}</tr>
${rows}
${legend}
</table></div></body></html>`;
}

module.exports = { buildHtml, pngSize };
