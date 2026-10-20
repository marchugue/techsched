/*
 * Shared schedule layout model.
 * Works in Node (require) and in the renderer (window.TSLayout), so the editor,
 * the Excel file, the PDF and the image all agree on what a month looks like.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TSLayout = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  // Row heights in points (Excel units). HTML output converts to px.
  const ROW = { title: 34, header: 22, event: 19, date: 19, line: 14, pad: 10, legend: 22 };

  const pad = (n) => String(n).padStart(2, '0');

  /** "2026-10" -> { year: 2026, month: 10 } (month is 1-12) or null */
  function parseMonth(str) {
    const m = /^(\d{4})-(\d{2})$/.exec(str || '');
    if (!m) return null;
    const year = +m[1];
    const month = +m[2];
    if (month < 1 || month > 12 || year < 1900 || year > 2200) return null;
    return { year, month };
  }

  const daysInMonth = (year, month) => new Date(year, month, 0).getDate();
  const firstWeekday = (year, month) => new Date(year, month - 1, 1).getDay(); // 0 = Sunday

  /**
   * Turns a day's assignments into display lines.
   * People with the same position set share a line: "B-Nickole, Krystelle".
   * A person with several positions is shown as "W/G-Name".
   */
  function groupLines(assignments, positions) {
    const order = new Map((positions || []).map((p, i) => [p.code, i]));
    const rank = (c) => (order.has(c) ? order.get(c) : 999);
    const groups = new Map();
    for (const a of assignments || []) {
      const name = String((a && a.name) || '').trim();
      if (!name) continue;
      const codes = (a.positions || []).slice().sort((x, y) => rank(x) - rank(y));
      const key = codes.join('/');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(name);
    }
    const lines = [];
    for (const [key, names] of groups) lines.push(key ? key + '-' + names.join(', ') : names.join(', '));
    return lines;
  }

  /** Drops empty entries and days that don't exist in the month. */
  function cleanDays(days, total) {
    const out = {};
    for (const [k, v] of Object.entries(days || {})) {
      const n = parseInt(k, 10);
      if (!(n >= 1 && n <= total) || !v) continue;
      const events = (v.events || []).map((s) => String(s).trim()).filter(Boolean);
      const assignments = (v.assignments || [])
        .map((a) => ({
          name: String((a && a.name) || '').trim(),
          positions: Array.from(new Set(((a && a.positions) || []).map(String)))
        }))
        .filter((a) => a.name);
      if (events.length || assignments.length) out[n] = { events, assignments };
    }
    return out;
  }

  function summarize(days) {
    const names = new Set();
    let events = 0;
    let people = 0;
    let withContent = 0;
    for (const d of Object.values(days || {})) {
      withContent++;
      events += (d.events || []).length;
      for (const a of d.assignments || []) { people++; names.add(a.name); }
    }
    return { days: withContent, events, people, members: names.size };
  }

  /**
   * Builds the week-by-week grid. Per week: N event rows (yellow), one date row,
   * M people rows. Cells outside the month have day === null.
   */
  function buildModel(schedule, settings) {
    const pm = parseMonth(schedule.month);
    if (!pm) throw new Error('Invalid month');
    const { year, month } = pm;
    const total = daysInMonth(year, month);
    const lpr = Math.min(4, Math.max(1, parseInt(settings.linesPerRow, 10) || 2));
    const offset = firstWeekday(year, month);
    const nWeeks = Math.ceil((offset + total) / 7);
    const personRowPt = lpr * ROW.line + ROW.pad;

    const weeks = [];
    let heightPt = ROW.title + ROW.header;
    let rowCount = 2;

    for (let w = 0; w < nWeeks; w++) {
      const days = [];
      for (let d = 0; d < 7; d++) {
        const num = w * 7 + d - offset + 1;
        if (num < 1 || num > total) { days.push({ day: null, events: [], lines: [] }); continue; }
        const data = (schedule.days && schedule.days[num]) || {};
        const events = (data.events || []).map((s) => String(s).trim()).filter(Boolean);
        days.push({ day: num, events, lines: groupLines(data.assignments, settings.positions) });
      }
      const eventRows = Math.max(1, ...days.map((x) => x.events.length));
      const peopleRows = Math.max(1, ...days.map((x) => Math.ceil(x.lines.length / lpr)));
      for (const x of days) {
        x.eventCells = Array.from({ length: eventRows }, (_, i) => x.events[i] || '');
        x.peopleCells = Array.from({ length: peopleRows },
          (_, i) => x.lines.slice(i * lpr, (i + 1) * lpr).join('\n'));
      }
      weeks.push({ eventRows, peopleRows, days });
      heightPt += eventRows * ROW.event + ROW.date + peopleRows * personRowPt;
      rowCount += eventRows + 1 + peopleRows;
    }

    const legend = settings.showLegend
      ? (settings.positions || []).map((p) => p.code + ' = ' + p.label).join('     ')
      : '';
    if (legend) { heightPt += ROW.legend; rowCount += 1; }

    return {
      title: MONTHS[month - 1] + ' ' + year,
      monthName: MONTHS[month - 1],
      year, month, total, weeks, legend, rowCount, heightPt,
      rowHeights: Object.assign({ person: personRowPt }, ROW)
    };
  }

  return {
    MONTHS, WEEKDAYS, WEEKDAYS_LONG, ROW, pad,
    parseMonth, daysInMonth, firstWeekday,
    groupLines, cleanDays, summarize, buildModel
  };
});
