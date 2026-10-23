(() => {
  'use strict';

  const L = window.TSLayout;
  const api = window.api;
  const $ = (sel, root = document) => root.querySelector(sel);

  /* ---------- helpers ---------- */

  const PROPS = new Set(['value', 'checked', 'disabled', 'selected']);

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false && !PROPS.has(k)) continue;
      if (k === 'class') el.className = v;
      else if (PROPS.has(k)) el[k] = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  const cleanErr = (e) =>
    String((e && e.message) || e).replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, '');

  const baseName = (p) => String(p || '').split(/[\\/]/).pop();

  function fileUrl(p, version) {
    let u = String(p).replace(/\\/g, '/');
    if (!u.startsWith('/')) u = '/' + u;
    u = encodeURI(u).replace(/#/g, '%23').replace(/\?/g, '%3F');
    return 'file://' + u + (version ? '?v=' + encodeURIComponent(version) : '');
  }

  function toast(msg, kind) {
    const el = h('div', { class: 'toast' + (kind === 'error' ? ' error' : ''), role: 'status' }, msg);
    $('#toasts').append(el);
    setTimeout(() => el.remove(), kind === 'error' ? 7000 : 3500);
  }

  const modalStack = [];

  function openModal(content, opts = {}) {
    const backdrop = h('div', { class: 'backdrop' });
    const modal = h('div', { class: 'modal' + (opts.wide ? ' wide' : '') + (opts.alert ? ' ios-alert-dialog' : ''), role: 'dialog', 'aria-modal': 'true' }, content);
    backdrop.append(modal);
    const handle = {
      close() {
        backdrop.remove();
        const i = modalStack.indexOf(handle);
        if (i >= 0) modalStack.splice(i, 1);
        if (opts.onClose) opts.onClose();
      }
    };
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) handle.close(); });
    modalStack.push(handle);
    $('#modalRoot').append(backdrop);
    return handle;
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalStack.length) modalStack[modalStack.length - 1].close();
  });

  function confirmDialog({ title, message, okLabel = 'OK', danger = false, extra }) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      const m = openModal([
        h('div', { class: 'ios-alert-head' },
          h('h3', {}, title),
          h('p', {}, message),
          extra
        ),
        h('div', { class: 'ios-alert-foot' },
          h('button', { class: 'ios-alert-cancel', onclick: () => m.close() }, 'Cancel'),
          h('button', {
            class: 'ios-alert-cancel',
            style: danger ? 'color: var(--ios-red); font-weight: 700;' : 'color: var(--gold-dark); font-weight: 700;',
            onclick: () => { finish(true); m.close(); }
          }, okLabel)
        )
      ], { alert: true, onClose: () => finish(false) });
    });
  }

  /* ---------- state ---------- */

  const state = {
    config: null,
    appVersion: '1.0.0',
    updater: {
      status: 'idle',
      message: 'Click "Check for updates" to search for new releases on GitHub.',
      percent: 0,
      downloadedVersion: null
    },
    view: 'new',
    draft: newDraft(),
    history: [],
    filters: { q: '', year: '', month: '', member: '', sort: 'updated' }
  };

  function newDraft(month) {
    const now = new Date();
    return { id: null, month: month || `${now.getFullYear()}-${L.pad(now.getMonth() + 1)}`, days: {} };
  }

  function setView(v) {
    state.view = v;
    document.querySelectorAll('.nav').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
    document.querySelectorAll('.view').forEach((s) => s.classList.toggle('hidden', s.id !== 'view-' + v));
    if (v === 'new') renderNew();
    if (v === 'history') loadHistory();
    if (v === 'team') renderTeam();
    if (v === 'settings') renderSettings();
  }

  function updateFolderLabel() {
    $('#folderLabel').textContent = state.config.storageDir || 'Not set';
  }

  async function pickFolder() {
    try {
      const cfg = await api.selectFolder();
      if (!cfg) return;
      state.config = cfg;
      updateFolderLabel();
      toast('Schedules will be saved to this folder. Its history is loaded from there.');
      if (state.view === 'history') loadHistory();
      if (state.view === 'settings') renderSettings();
    } catch (e) { toast(cleanErr(e), 'error'); }
  }

  /* ---------- new schedule ---------- */

  function renderNew() {
    const root = $('#view-new');
    root.replaceChildren();
    const d = state.draft;

    const info = h('div', { class: 'month-info-centered' });
    const grid = h('div', { class: 'cal ios-cal' });

    let pm = L.parseMonth(d.month) || { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
    let pickerYear = pm.year;
    let popoverEl = null;

    function makeCalIcon() {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'cal-icon');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '2');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
      svg.innerHTML = '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line>';
      return svg;
    }

    const btnPrevMonth = h('button', {
      type: 'button',
      class: 'btn-month-nav',
      title: 'Previous month',
      onclick: () => {
        closePopover();
        let y = pm.year;
        let m = pm.month - 1;
        if (m < 1) { m = 12; y--; }
        setMonth(y, m);
      }
    }, '‹');

    const btnNextMonth = h('button', {
      type: 'button',
      class: 'btn-month-nav',
      title: 'Next month',
      onclick: () => {
        closePopover();
        let y = pm.year;
        let m = pm.month + 1;
        if (m > 12) { m = 1; y++; }
        setMonth(y, m);
      }
    }, '›');

    const btnMonthDisplay = h('button', {
      type: 'button',
      class: 'btn-month-display',
      title: 'Choose month and year',
      onclick: (e) => {
        e.stopPropagation();
        togglePopover();
      }
    });

    function updateDisplayButton() {
      btnMonthDisplay.replaceChildren(
        makeCalIcon(),
        h('span', {}, `${L.MONTHS[pm.month - 1]} ${pm.year}`),
        h('span', { class: 'chevron-icon' }, '▾')
      );
    }

    function setMonth(y, m) {
      const newStr = `${y}-${L.pad(m)}`;
      if (newStr === d.month) return;
      d.month = newStr;
      d.id = null; // a different month is a new schedule
      pm = L.parseMonth(d.month) || { year: y, month: m };
      pickerYear = pm.year;
      updateDisplayButton();
      refresh();
    }

    function closePopover() {
      if (popoverEl) {
        popoverEl.remove();
        popoverEl = null;
        document.removeEventListener('mousedown', onDocClick);
      }
    }

    const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    function renderPopoverContent() {
      if (!popoverEl) return;
      popoverEl.replaceChildren();

      const yearHeader = h('div', { class: 'picker-year-header' },
        h('button', {
          type: 'button',
          class: 'picker-year-btn',
          title: 'Previous year',
          onclick: (e) => {
            e.stopPropagation();
            pickerYear--;
            renderPopoverContent();
          }
        }, '‹'),
        h('span', { class: 'picker-year-val' }, String(pickerYear)),
        h('button', {
          type: 'button',
          class: 'picker-year-btn',
          title: 'Next year',
          onclick: (e) => {
            e.stopPropagation();
            pickerYear++;
            renderPopoverContent();
          }
        }, '›')
      );

      const monthsGrid = h('div', { class: 'picker-months-grid' });
      SHORT_MONTHS.forEach((mName, idx) => {
        const mNum = idx + 1;
        const isCurrent = (pickerYear === pm.year && mNum === pm.month);
        const cell = h('button', {
          type: 'button',
          class: 'picker-month-cell' + (isCurrent ? ' active' : ''),
          title: `${L.MONTHS[idx]} ${pickerYear}`,
          onclick: (e) => {
            e.stopPropagation();
            setMonth(pickerYear, mNum);
            closePopover();
          }
        }, mName);
        monthsGrid.append(cell);
      });

      popoverEl.append(yearHeader, monthsGrid);
    }

    function onDocClick(e) {
      if (popoverEl && !monthGroup.contains(e.target) && !popoverEl.contains(e.target)) {
        closePopover();
      }
    }

    function positionPopover() {
      if (!popoverEl) return;
      const rect = btnMonthDisplay.getBoundingClientRect();
      const scrollY = window.scrollY || 0;
      const scrollX = window.scrollX || 0;
      const popW = 290;
      let left = rect.left + scrollX + rect.width / 2 - popW / 2;
      if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
      if (left < 8) left = 8;
      const top = rect.bottom + scrollY + 8;
      popoverEl.style.position = 'fixed';
      popoverEl.style.top = (rect.bottom + 8) + 'px';
      popoverEl.style.left = left + 'px';
      popoverEl.style.width = popW + 'px';
    }

    function togglePopover() {
      if (popoverEl) {
        closePopover();
        return;
      }
      pickerYear = pm.year;
      popoverEl = h('div', { class: 'month-picker-popover body-anchored' });
      renderPopoverContent();
      document.body.append(popoverEl);
      positionPopover();
      document.addEventListener('mousedown', onDocClick);
    }

    const monthGroup = h('div', { class: 'month-selector-group' },
      btnPrevMonth,
      btnMonthDisplay,
      btnNextMonth
    );

    const btnGen = h('button', { class: 'btn primary ios-btn-primary', onclick: generate }, 'Generate schedule');
    const btnClear = h('button', {
      class: 'btn ios-btn-ghost',
      onclick: async () => {
        const ok = await confirmDialog({
          title: 'Clear Schedule?', message: 'All events and assignments for this month will be removed.',
          okLabel: 'Clear', danger: true
        });
        if (!ok) return;
        d.days = {};
        refresh();
      }
    }, 'Clear');

    async function generate() {
      btnGen.disabled = true;
      btnGen.textContent = 'Generating…';
      try {
        const res = await api.generate({ id: d.id, month: d.month, days: d.days });
        state.config = res.config;
        d.id = res.record.id;
        refresh();
        showResult(res);
      } catch (e) {
        toast(cleanErr(e), 'error');
      } finally {
        btnGen.disabled = false;
        btnGen.textContent = 'Generate schedule';
      }
    }

    function refresh() {
      pm = L.parseMonth(d.month) || { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
      updateDisplayButton();
      const total = L.daysInMonth(pm.year, pm.month);
      const offset = L.firstWeekday(pm.year, pm.month);
      const used = Object.keys(d.days).filter((k) => +k >= 1 && +k <= total).length;
      info.replaceChildren(
        h('span', { class: 'info-pill' }, `${L.MONTHS[pm.month - 1]} ${pm.year}`),
        h('span', { class: 'info-pill' }, `${total} days`),
        h('span', { class: 'info-pill' }, `Starts on ${L.WEEKDAYS_LONG[offset]}`),
        h('span', { class: 'info-pill' }, `${Math.ceil((offset + total) / 7)} weeks`),
        h('span', { class: 'info-pill ' + (used ? 'filled' : '') }, used ? `${used} ${used === 1 ? 'day' : 'days'} filled` : '0 days filled')
      );
      drawGrid(grid, refresh);
    }

    const toolbar = h('div', { class: 'ios-schedule-toolbar' },
      h('div', { class: 'toolbar-inner' },
        monthGroup,
        btnClear,
        btnGen
      )
    );

    root.append(
      toolbar,
      info,
      grid
    );
    refresh();
  }

  function drawGrid(grid, onChange) {
    const d = state.draft;
    const pm = L.parseMonth(d.month);
    const total = L.daysInMonth(pm.year, pm.month);
    const offset = L.firstWeekday(pm.year, pm.month);

    // --- Drag-span state ---
    let dragStart = null;
    let dragEnd = null;
    let isDragging = false;
    let fillPopover = null;

    function closeFillPopover() {
      if (fillPopover) { fillPopover.remove(); fillPopover = null; }
      document.removeEventListener('mousedown', onFillDocClick);
    }

    function onFillDocClick(e) {
      if (fillPopover && !fillPopover.contains(e.target)) closeFillPopover();
    }

    function getRangeMinMax() {
      if (dragStart === null || dragEnd === null) return null;
      return { from: Math.min(dragStart, dragEnd), to: Math.max(dragStart, dragEnd) };
    }

    function updateRangeHighlight() {
      const range = getRangeMinMax();
      grid.querySelectorAll('.cal-cell').forEach((el) => {
        const day = +el.dataset.day;
        const inRange = range && day >= range.from && day <= range.to;
        el.classList.toggle('drag-selected', inRange);
        el.classList.toggle('drag-start', range && day === range.from);
        el.classList.toggle('drag-end', range && day === range.to);
      });
    }

    function openFillPopover(anchorCell) {
      closeFillPopover();
      const range = getRangeMinMax();
      if (!range || range.from === range.to) return; // single day — open normal editor

      const rect = anchorCell.getBoundingClientRect();
      const popW = 280;
      let left = rect.left + rect.width / 2 - popW / 2;
      if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
      if (left < 8) left = 8;
      const top = rect.bottom + 8;

      const eventInput = h('input', {
        class: 'input',
        placeholder: `Event name for ${L.MONTHS[pm.month - 1]} ${range.from}–${range.to}…`,
        style: 'width:100%; margin-bottom: 10px;',
        onkeydown: (e) => {
          if (e.key === 'Enter') { e.preventDefault(); applyFill(eventInput.value.trim()); }
          if (e.key === 'Escape') { closeFillPopover(); clearDrag(); }
        }
      });

      const countLabel = h('div', {
        style: 'font-size:11.5px; color: var(--gold-dark); font-weight:700; margin-bottom:8px; display:flex; align-items:center; gap:6px;'
      },
        h('span', {
          style: 'background: linear-gradient(135deg,var(--gold-vibrant),var(--gold-amber)); color:#1A1200; border-radius:6px; padding:2px 8px; font-size:11px; font-weight:800;'
        }, `${range.to - range.from + 1} days`),
        `${L.MONTHS[pm.month - 1]} ${range.from} – ${range.to}`
      );

      fillPopover = h('div', { class: 'span-fill-popover' },
        countLabel,
        eventInput,
        h('div', { style: 'display:flex; gap:8px;' },
          h('button', {
            class: 'btn primary',
            style: 'flex:1; font-size:13px;',
            onclick: () => applyFill(eventInput.value.trim())
          }, 'Apply to all days'),
          h('button', {
            class: 'btn ios-btn-ghost',
            style: 'font-size:13px;',
            onclick: () => { closeFillPopover(); clearDrag(); }
          }, 'Cancel')
        )
      );

      fillPopover.style.cssText = `position:fixed; top:${top}px; left:${left}px; width:${popW}px; z-index:9998;`;
      document.body.append(fillPopover);
      setTimeout(() => { eventInput.focus(); }, 30);
      document.addEventListener('mousedown', onFillDocClick);
    }

    function applyFill(eventText) {
      const range = getRangeMinMax();
      if (!range) return;
      for (let day = range.from; day <= range.to; day++) {
        if (!d.days[day]) d.days[day] = { events: [], assignments: [] };
        const evs = d.days[day].events;
        if (eventText && !evs.includes(eventText)) evs.push(eventText);
      }
      closeFillPopover();
      clearDrag();
      drawGrid(grid, onChange);
      onChange();
    }

    function clearDrag() {
      dragStart = null;
      dragEnd = null;
      isDragging = false;
      grid.querySelectorAll('.cal-cell').forEach((el) => {
        el.classList.remove('drag-selected', 'drag-start', 'drag-end');
      });
    }

    // --- Build span event map ---
    // For each event label, find consecutive runs of days that share it
    // spanMap[day] = array of { label, isStart, isEnd, isContinuation }
    const spanMap = {};
    // collect all unique event labels across all days
    const allEventLabels = new Set();
    for (let day = 1; day <= total; day++) {
      const evs = (d.days[day] || {}).events || [];
      evs.forEach((e) => e && allEventLabels.add(e));
    }

    // for each label, find runs of consecutive days
    allEventLabels.forEach((label) => {
      let runStart = null;
      for (let day = 1; day <= total + 1; day++) {
        const hasIt = day <= total && ((d.days[day] || {}).events || []).includes(label);
        if (hasIt && runStart === null) {
          runStart = day;
        } else if (!hasIt && runStart !== null) {
          // commit run from runStart to day-1
          for (let rd = runStart; rd <= day - 1; rd++) {
            if (!spanMap[rd]) spanMap[rd] = [];
            spanMap[rd].push({
              label,
              isStart: rd === runStart,
              isEnd: rd === day - 1,
              spanLength: day - runStart,
              posInSpan: rd - runStart
            });
          }
          runStart = null;
        }
      }
    });

    // --- Build cells ---
    const cells = L.WEEKDAYS.map((w) => h('div', { class: 'cal-head' }, w));
    for (let i = 0; i < offset; i++) cells.push(h('div', { class: 'cal-blank' }));

    for (let day = 1; day <= total; day++) {
      const data = d.days[day] || { events: [], assignments: [] };
      const lines = L.groupLines(data.assignments, state.config.positions);
      const daySpans = spanMap[day] || [];

      // Build event bars for this cell
      const evEls = daySpans.map(({ label, isStart, isEnd, spanLength, posInSpan }) => {
        if (isStart && spanLength === 1) {
          // single-day event — normal chip, centered text
          return h('div', { class: 'cal-ev', title: label, style: 'text-align:center;' }, label);
        }

        // Multi-day span: show label only on the center cell
        const centerPos = Math.floor((spanLength - 1) / 2);
        const isCenter = posInSpan === centerPos;

        // Border radius: left cap on start, right cap on end, square in between
        let radius = '0';
        if (isStart && isEnd) radius = '6px';
        else if (isStart) radius = '6px 0 0 6px';
        else if (isEnd) radius = '0 6px 6px 0';

        // Margin: overlap the cell border for seamless connection
        let margin = '0 -1px';
        if (isStart) margin = '0 -1px 0 0';
        if (isEnd) margin = '0 0 0 -1px';

        return h('div', {
          class: 'cal-ev span-ev' +
            (isStart ? ' span-ev-start' : '') +
            (isEnd ? ' span-ev-end' : '') +
            (!isStart && !isEnd ? ' span-ev-mid' : ''),
          title: `${label} (${spanLength} days)`,
          style: `border-radius:${radius}; margin:${margin}; text-align:center; overflow:visible; white-space:nowrap;`
        }, isCenter ? label : '\u00a0');
      });

      // Also add any events NOT in spanMap (non-spanning) as regular chips
      const nonSpanEvs = data.events.filter((ev) => !daySpans.some((s) => s.label === ev));
      nonSpanEvs.slice(0, Math.max(0, 3 - evEls.length)).forEach((ev) => {
        evEls.push(h('div', { class: 'cal-ev', title: ev, style: 'text-align:center;' }, ev));
      });
      const extraNonSpan = nonSpanEvs.length - Math.max(0, 3 - daySpans.length);
      if (extraNonSpan > 0) evEls.push(h('div', { class: 'cal-ev', style: 'text-align:center;' }, `+${extraNonSpan} more`));

      if (!evEls.length) evEls.push(h('div', { class: 'cal-ev blank' }));

      const dayNum = day; // capture for closure
      const cell = h('button', {
        type: 'button',
        class: 'cal-cell',
        'data-day': String(dayNum),
        'aria-label': `Edit ${L.MONTHS[pm.month - 1]} ${dayNum}`,
        onmousedown: (e) => {
          if (e.button !== 0) return;
          closeFillPopover();
          dragStart = dayNum;
          dragEnd = dayNum;
          isDragging = true;
          updateRangeHighlight();
          e.preventDefault(); // prevent text select
        },
        onmouseenter: () => {
          if (!isDragging) return;
          dragEnd = dayNum;
          updateRangeHighlight();
        },
        onmouseup: (e) => {
          if (!isDragging) return;
          dragEnd = dayNum;
          isDragging = false;
          updateRangeHighlight();
          const range = getRangeMinMax();
          if (range && range.from === range.to) {
            // single day — open normal editor
            clearDrag();
            openDayEditor(dayNum, () => { drawGrid(grid, onChange); onChange(); });
          } else {
            // multi-day drag — open fill popover
            openFillPopover(cell);
          }
        }
      },
      h('div', { class: 'cal-evs' }, evEls),
      h('div', { class: 'cal-day' }, String(dayNum)),
      h('div', { class: 'cal-people' },
        lines.length ? lines.map((l) => h('div', { title: l }, l)) : h('span', { class: 'cal-hint' }, 'Add')));
      cells.push(cell);
    }

    const tail = (7 - ((offset + total) % 7)) % 7;
    for (let i = 0; i < tail; i++) cells.push(h('div', { class: 'cal-blank' }));

    // Cancel drag if mouse releases outside grid
    const onDocMouseUp = () => {
      if (isDragging) {
        isDragging = false;
        const range = getRangeMinMax();
        if (range && range.from !== range.to) {
          const anchor = grid.querySelector(`.cal-cell[data-day="${range.to}"]`) ||
                         grid.querySelector(`.cal-cell[data-day="${range.from}"]`);
          if (anchor) openFillPopover(anchor);
          else clearDrag();
        } else {
          clearDrag();
        }
      }
    };
    document.addEventListener('mouseup', onDocMouseUp, { once: true });

    grid.replaceChildren(...cells);
  }

  function openDayEditor(day, onSave) {
    const d = state.draft;
    const pm = L.parseMonth(d.month);
    const date = new Date(pm.year, pm.month - 1, day);
    const cur = d.days[day] || { events: [], assignments: [] };
    const work = {
      events: cur.events.slice(),
      assignments: cur.assignments.map((a) => ({ name: a.name, positions: a.positions.slice() }))
    };
    if (!work.events.length) work.events.push('');
    if (!work.assignments.length) work.assignments.push({ name: '', positions: [] });

    const evBox = h('div');
    const pplBox = h('div');

    function drawEvents(focusLast) {
      evBox.replaceChildren(...work.events.map((ev, i) => h('div', { class: 'row event-row' },
        h('input', {
          class: 'input event-input', value: ev, list: 'dlEvents', placeholder: 'Event, for example feature',
          'aria-label': 'Event',
          oninput: (e) => { work.events[i] = e.target.value; },
          onkeydown: (e) => {
            if (e.key === 'Enter') { e.preventDefault(); work.events.push(''); drawEvents(true); }
          }
        }),
        h('button', {
          type: 'button', class: 'x remove-btn', title: 'Remove event', 'aria-label': 'Remove event',
          onclick: () => { work.events.splice(i, 1); if (!work.events.length) work.events.push(''); drawEvents(); }
        }, '×'))));
      if (focusLast) evBox.querySelector('.row:last-child input').focus();
    }

    function applyMemberPositions(a) {
      const match = state.config.members.find(
        (m) => (typeof m === 'string' ? m : m.name).toLowerCase() === a.name.trim().toLowerCase()
      );
      if (match && typeof match === 'object' && Array.isArray(match.positions)) {
        a.positions = match.positions.slice();
      }
    }

    function drawPeople(focusLast) {
      pplBox.replaceChildren(...work.assignments.map((a, i) => {
        const posCodes = Array.isArray(a.positions) ? a.positions.filter(Boolean) : [];
        const posText = posCodes.join('/');

        const posTag = posText
          ? h('span', { class: 'person-pos-tag', title: posCodes.map((c) => {
              const found = state.config.positions.find((p) => p.code === c);
              return found ? `${found.code} - ${found.label}` : c;
            }).join(', ') }, posText)
          : h('span', { class: 'person-pos-tag empty' }, 'No position');

        return h('div', { class: 'person-row' },
          h('input', {
            class: 'input person-name-input', value: a.name, list: 'dlMembers', placeholder: 'Name', 'aria-label': 'Name',
            oninput: (e) => {
              a.name = e.target.value;
              applyMemberPositions(a);
              // update pos tag inline without full redraw
              const newCodes = Array.isArray(a.positions) ? a.positions.filter(Boolean) : [];
              const newText = newCodes.join('/');
              posTag.textContent = newText || 'No position';
              posTag.classList.toggle('empty', !newText);
              posTag.title = newCodes.map((c) => {
                const found = state.config.positions.find((p) => p.code === c);
                return found ? `${found.code} - ${found.label}` : c;
              }).join(', ');
            },
            onkeydown: (e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                work.assignments.push({ name: '', positions: [] });
                drawPeople(true);
              }
            }
          }),
          posTag,
          h('button', {
            type: 'button', class: 'x remove-btn', title: 'Remove person', 'aria-label': 'Remove person',
            onclick: () => {
              work.assignments.splice(i, 1);
              if (!work.assignments.length) work.assignments.push({ name: '', positions: [] });
              drawPeople();
            }
          }, '×')
        );
      }));
      if (focusLast) {
        const last = pplBox.querySelector('.person-row:last-child input');
        if (last) last.focus();
      }
    }

    function save() {
      const events = work.events.map((s) => s.trim()).filter(Boolean);
      const assignments = work.assignments
        .map((a) => ({ name: a.name.trim(), positions: a.positions.slice() }))
        .filter((a) => a.name);
      if (events.length || assignments.length) d.days[day] = { events, assignments };
      else delete d.days[day];
      m.close();
      onSave();
    }

    drawEvents();
    drawPeople();

    const m = openModal([
      h('div', { class: 'modal-head ios-modal-head' },
        h('div', { class: 'modal-head-info' },
          h('h2', {}, `${L.MONTHS[pm.month - 1]} ${day}`),
          h('small', { class: 'modal-head-sub' }, L.WEEKDAYS_LONG[date.getDay()])),
        h('button', { class: 'modal-close-icon', title: 'Close', 'aria-label': 'Close', onclick: () => m.close() }, '✕')),
      h('div', { class: 'modal-body ios-modal-body' },
        h('datalist', { id: 'dlMembers' }, state.config.members.map((m) => h('option', { value: typeof m === 'string' ? m : m.name }))),
        h('datalist', { id: 'dlEvents' }, state.config.eventPresets.map((n) => h('option', { value: n }))),
        h('div', { class: 'modal-section' },
          h('div', { class: 'sec-title' },
            h('svg', { class: 'sec-icon', viewBox: '0 0 24 24', width: '16', height: '16', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' },
              h('rect', { x: '3', y: '4', width: '18', height: '18', rx: '2', ry: '2' }),
              h('line', { x1: '16', y1: '2', x2: '16', y2: '6' }),
              h('line', { x1: '8', y1: '2', x2: '8', y2: '6' }),
              h('line', { x1: '3', y1: '10', x2: '21', y2: '10' })),
            h('span', {}, 'Events')),
          evBox,
          h('button', {
            type: 'button', class: 'btn btn-add',
            onclick: () => { work.events.push(''); drawEvents(true); }
          },
            h('span', { class: 'btn-plus-icon' }, '+'),
            'Add event')),
        h('div', { class: 'modal-section' },
          h('div', { class: 'sec-title' },
            h('svg', { class: 'sec-icon', viewBox: '0 0 24 24', width: '16', height: '16', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' },
              h('path', { d: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2' }),
              h('circle', { cx: '9', cy: '7', r: '4' }),
              h('path', { d: 'M23 21v-2a4 4 0 0 0-3-3.87' }),
              h('path', { d: 'M16 3.13a4 4 0 0 1 0 7.75' })),
            h('span', {}, 'People')),
          h('p', { class: 'sec-sub' }, 'Type a name — positions are auto-applied from the Members list.'),
          pplBox,
          h('button', {
            type: 'button', class: 'btn btn-add',
            onclick: () => { work.assignments.push({ name: '', positions: [] }); drawPeople(true); }
          },
            h('span', { class: 'btn-plus-icon' }, '+'),
            'Add person'))),
      h('div', { class: 'modal-foot ios-modal-foot' },
        h('button', {
          class: 'btn danger',
          onclick: () => { delete d.days[day]; m.close(); onSave(); }
        }, 'Clear day'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: save }, 'Save day'))
    ], { wide: true });

    setTimeout(() => {
      const first = evBox.querySelector('input');
      if (first) first.focus();
    }, 30);
  }

  function showResult(res) {
    const rec = res.record;
    const f = rec.files;
    let currentFormat = 'png';

    const btnSave = h('button', {
      class: 'btn primary ios-btn-primary',
      onclick: async () => {
        btnSave.disabled = true;
        btnSave.textContent = 'Saving…';
        try {
          const target = currentFormat === 'xlsx' ? f.xlsx : (currentFormat === 'pdf' ? f.pdf : f.png);
          if (!target) throw new Error('File not available.');
          const r = await api.saveAs(target);
          if (r) toast('Saved copy to ' + r);
          m.close();
          setView('history');
        } catch (e) {
          toast(cleanErr(e), 'error');
          btnSave.disabled = false;
          btnSave.textContent = 'Save';
        }
      }
    }, 'Save');

    const formatSelect = h('select', {
      class: 'input ios-select-format',
      onchange: (e) => { currentFormat = e.target.value; }
    },
      h('option', { value: 'png', selected: true }, 'Save as Image (.png)'),
      h('option', { value: 'pdf' }, 'Save as PDF (.pdf)'),
      h('option', { value: 'xlsx' }, 'Save as Excel (.xlsx)')
    );

    const m = openModal([
      h('div', { class: 'modal-head ios-modal-head' },
        h('div', { class: 'modal-head-info' },
          h('h2', {}, rec.title),
          h('small', { class: 'modal-head-sub' }, 'Schedule generated successfully')),
        h('button', { class: 'modal-close-icon', title: 'Close', 'aria-label': 'Close', onclick: () => m.close() }, '✕')
      ),
      h('div', { class: 'modal-body ios-modal-body' },
        res.warnings.length ? h('div', { class: 'warn' }, res.warnings.join(' ')) : null,
        f.png ? h('div', { class: 'ios-preview-wrapper' },
          h('img', {
            class: 'preview-fit',
            src: fileUrl(f.png, rec.updatedAt),
            alt: `${rec.title} preview`,
            title: 'Click to open image file',
            onclick: () => api.openFile(f.png)
          })
        ) : null
      ),
      h('div', { class: 'modal-foot ios-modal-foot' },
        formatSelect,
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn ios-btn-ghost', onclick: () => { m.close(); setView('history'); } }, 'Go to History'),
        btnSave
      )
    ], { wide: true });
  }

  /* ---------- history ---------- */

  async function loadHistory() {
    try { state.history = await api.listHistory(); } catch (e) { toast(cleanErr(e), 'error'); }
    renderHistory();
  }

  function recNames(rec) {
    const set = new Set();
    for (const d of Object.values(rec.days || {})) for (const a of d.assignments || []) set.add(a.name);
    return set;
  }

  function matches(rec) {
    const f = state.filters;
    const [y, mo] = rec.month.split('-');
    if (f.year && y !== f.year) return false;
    if (f.month && mo !== f.month) return false;
    if (f.member && !recNames(rec).has(f.member)) return false;
    if (f.q) {
      const hay = [rec.title];
      for (const d of Object.values(rec.days || {})) {
        hay.push(...(d.events || []));
        for (const a of d.assignments || []) hay.push(a.name, ...(a.positions || []));
      }
      if (!hay.join(' ').toLowerCase().includes(f.q.trim().toLowerCase())) return false;
    }
    return true;
  }

  function sorter(a, b) {
    const s = state.filters.sort;
    if (s === 'month-desc') return b.month.localeCompare(a.month) || b.updatedAt.localeCompare(a.updatedAt);
    if (s === 'month-asc') return a.month.localeCompare(b.month) || b.updatedAt.localeCompare(a.updatedAt);
    return b.updatedAt.localeCompare(a.updatedAt);
  }

  const fmtDate = (iso) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

  function renderHistory() {
    const root = $('#view-history');
    root.replaceChildren();
    const f = state.filters;

    const years = [...new Set(state.history.map((r) => r.month.slice(0, 4)))].sort().reverse();
    const members = [...new Set(state.history.flatMap((r) => [...recNames(r)]))].sort((a, b) => a.localeCompare(b));
    const list = h('div');
    const count = h('p', { class: 'sub' });

    const select = (key, label, opts) => h('label', { class: 'field' }, h('span', {}, label),
      h('select', { class: 'input', onchange: (e) => { f[key] = e.target.value; draw(); } },
        opts.map(([v, t]) => h('option', { value: v, selected: f[key] === v }, t))));

    const search = h('input', {
      class: 'input', type: 'search', value: f.q, placeholder: 'Names, positions or events',
      oninput: (e) => { f.q = e.target.value; draw(); }
    });

    function draw() {
      const items = state.history.filter(matches).sort(sorter);
      const n = state.history.length;
      count.textContent = items.length === n
        ? `${n} ${n === 1 ? 'schedule' : 'schedules'}`
        : `${items.length} of ${n} schedules`;
      list.replaceChildren(...(items.length
        ? items.map(card)
        : [h('div', { class: 'card empty' }, n ? 'No schedules match these filters.' : 'No schedules yet. Create one under New schedule.')]));
    }

    root.append(
      h('h1', {}, 'History'),
      count,
      h('div', { class: 'bar', style: 'margin-bottom:16px' },
        h('label', { class: 'field grow' }, h('span', {}, 'Search'), search),
        select('year', 'Year', [['', 'All years'], ...years.map((y) => [y, y])]),
        select('month', 'Month', [['', 'All months'], ...L.MONTHS.map((m, i) => [L.pad(i + 1), m])]),
        select('member', 'Member', [['', 'Anyone'], ...members.map((m) => [m, m])]),
        select('sort', 'Sort by', [['updated', 'Recently updated'], ['month-desc', 'Month, newest'], ['month-asc', 'Month, oldest']]),
        h('button', {
          class: 'btn',
          onclick: () => { state.filters = { q: '', year: '', month: '', member: '', sort: f.sort }; renderHistory(); }
        }, 'Reset filters')),
      list
    );
    draw();
  }

  function openPreviewModal(rec) {
    if (!rec.exists.png) return;
    const m = openModal([
      h('div', { class: 'modal-head ios-modal-head' },
        h('h2', {}, rec.title),
        h('button', { class: 'btn ios-btn-ghost btn-sm', onclick: () => m.close() }, 'Close')
      ),
      h('div', { class: 'modal-body ios-modal-body', style: 'text-align: center;' },
        h('div', { class: 'ios-preview-wrapper' },
          h('img', {
            class: 'preview-fit',
            src: fileUrl(rec.files.png, rec.updatedAt),
            alt: `${rec.title} preview`,
            onclick: () => api.openFile(rec.files.png)
          })
        )
      ),
      h('div', { class: 'modal-foot ios-modal-foot' },
        h('button', { class: 'btn ios-btn-ghost', onclick: () => api.openFile(rec.files.png) }, 'Open in default viewer'),
        h('button', { class: 'btn primary ios-btn-primary', onclick: () => { m.close(); openSaveDialog(rec); } }, 'Save copy…')
      )
    ], { wide: true });
  }

  function openSaveDialog(rec) {
    const f = rec.files;
    let m;
    const saveItem = (label, ext, key, iconSvg) => h('button', {
      class: 'ios-sheet-item',
      disabled: !rec.exists[key],
      onclick: async () => {
        m.close();
        try {
          const r = await api.saveAs(f[key]);
          if (r) toast(`Saved ${label} copy to ` + r);
        } catch (e) {
          toast(cleanErr(e), 'error');
        }
      }
    },
      h('span', { class: 'ios-sheet-icon' }, iconSvg),
      h('div', { class: 'ios-sheet-text' },
        h('b', {}, label),
        h('small', {}, `Export as .${ext}`)
      )
    );

    const imageSvg = h('svg', { viewBox: '0 0 24 24', width: '22', height: '22', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' },
      h('rect', { x: '3', y: '3', width: '18', height: '18', rx: '2', ry: '2' }),
      h('circle', { cx: '8.5', cy: '8.5', r: '1.5' }),
      h('polyline', { points: '21 15 16 10 5 21' }));

    const pdfSvg = h('svg', { viewBox: '0 0 24 24', width: '22', height: '22', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' },
      h('path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }),
      h('polyline', { points: '14 2 14 8 20 8' }),
      h('line', { x1: '16', y1: '13', x2: '8', y2: '13' }),
      h('line', { x1: '16', y1: '17', x2: '8', y2: '17' }));

    const excelSvg = h('svg', { viewBox: '0 0 24 24', width: '22', height: '22', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' },
      h('rect', { x: '3', y: '3', width: '18', height: '18', rx: '2', ry: '2' }),
      h('line', { x1: '3', y1: '9', x2: '21', y2: '9' }),
      h('line', { x1: '3', y1: '15', x2: '21', y2: '15' }),
      h('line', { x1: '9', y1: '3', x2: '9', y2: '21' }),
      h('line', { x1: '15', y1: '3', x2: '15', y2: '21' }));

    m = openModal([
      h('div', { class: 'ios-alert-head' },
        h('h3', {}, 'Save Schedule'),
        h('p', {}, 'Choose an export format')
      ),
      h('div', { class: 'ios-sheet-list' },
        saveItem('Image', 'png', 'png', imageSvg),
        saveItem('PDF Document', 'pdf', 'pdf', pdfSvg),
        saveItem('Excel Sheet', 'xlsx', 'xlsx', excelSvg)
      ),
      h('div', { class: 'ios-alert-foot' },
        h('button', { class: 'ios-alert-cancel', onclick: () => m.close() }, 'Cancel')
      )
    ], { alert: true });
  }

  function card(rec) {
    const s = rec.stats || {};
    const thumb = rec.exists.png
      ? h('div', { class: 'thumb ios-thumb', title: 'Click to view full preview', onclick: () => openPreviewModal(rec) },
        h('img', { src: fileUrl(rec.files.png, rec.updatedAt), alt: `${rec.title} preview` }))
      : h('div', { class: 'thumb ios-thumb' }, 'No preview');

    return h('div', { class: 'card hist' },
      thumb,
      h('div', {},
        h('h3', {}, rec.title),
        h('div', { class: 'meta' },
          `Created ${fmtDate(rec.createdAt)}. ` +
          (rec.updatedAt !== rec.createdAt ? `Updated ${fmtDate(rec.updatedAt)}. ` : '') +
          `${s.days || 0} days scheduled, ${s.events || 0} events, ${s.people || 0} assignments, ${s.members || 0} members.`),
        h('div', { class: 'actions ios-card-actions' },
          h('button', {
            class: 'btn primary ios-btn-sm',
            title: 'Save schedule as Image, PDF, or Excel',
            onclick: () => openSaveDialog(rec)
          },
          h('svg', { viewBox: '0 0 24 24', width: '14', height: '14', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' },
            h('path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }),
            h('polyline', { points: '7 10 12 15 17 10' }),
            h('line', { x1: '12', y1: '15', x2: '12', y2: '3' })),
          ' Save'),
          h('button', {
            class: 'btn ios-btn-sm',
            onclick: () => {
              state.draft = { id: rec.id, month: rec.month, days: JSON.parse(JSON.stringify(rec.days || {})) };
              setView('new');
            }
          }, 'Edit'),
          h('button', {
            class: 'btn ios-btn-sm', disabled: !rec.exists.xlsx && !rec.exists.png,
            onclick: () => api.reveal(rec.files.xlsx || rec.files.png).catch((e) => toast(cleanErr(e), 'error'))
          }, 'Show in folder'),
          h('button', { class: 'btn ios-btn-sm danger', onclick: () => deleteRecord(rec) }, 'Delete'))));
  }

  async function deleteRecord(rec) {
    let withFiles = true;
    const ok = await confirmDialog({
      title: 'Delete schedule', message: `Remove ${rec.title} from history?`, okLabel: 'Delete', danger: true,
      extra: h('label', { class: 'inline-check' },
        h('input', { type: 'checkbox', checked: true, onchange: (e) => { withFiles = e.target.checked; } }),
        'Also delete its Excel, PDF and image files')
    });
    if (!ok) return;
    try {
      await api.remove(rec.id, withFiles);
      if (state.draft.id === rec.id) state.draft.id = null;
      toast('Schedule deleted');
      loadHistory();
    } catch (e) { toast(cleanErr(e), 'error'); }
  }

  /* ---------- settings ---------- */

  function chipEditor(items, placeholder, onChange) {
    const chips = h('div', { class: 'chips' });
    const input = h('input', {
      class: 'input', placeholder, 'aria-label': placeholder,
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }
    });

    function draw() {
      chips.replaceChildren(...items.map((t, i) => h('span', { class: 'chip' }, t,
        h('button', {
          title: 'Remove', 'aria-label': 'Remove ' + t,
          onclick: () => { items.splice(i, 1); draw(); onChange(items.slice()); }
        }, '×'))));
      if (!items.length) chips.append(h('span', { class: 'sub', style: 'margin:0' }, 'Nothing added yet.'));
    }

    function add() {
      const parts = input.value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
      let changed = false;
      for (const p of parts) {
        if (!items.some((x) => x.toLowerCase() === p.toLowerCase())) { items.push(p); changed = true; }
      }
      input.value = '';
      if (changed) { draw(); onChange(items.slice()); }
    }

    draw();
    return h('div', {}, chips, h('div', { class: 'add-row' }, input, h('button', { class: 'btn', onclick: add }, 'Add')));
  }

  async function triggerCheckForUpdates() {
    state.updater.status = 'checking';
    state.updater.message = 'Connecting to GitHub to check for updates…';
    if (state.view === 'settings') renderSettings();
    try {
      const res = await api.checkForUpdates();
      if (res && res.status === 'dev') {
        state.updater.status = 'idle';
        state.updater.message = res.message;
        toast(res.message);
      } else if (res && res.status === 'error') {
        state.updater.status = 'error';
        state.updater.message = res.message;
        toast(res.message, 'error');
      }
    } catch (e) {
      state.updater.status = 'error';
      const msg = cleanErr(e);
      state.updater.message = msg.length > 100 ? msg.slice(0, 100) + '…' : msg;
      toast(state.updater.message, 'error');
    }
    if (state.view === 'settings') renderSettings();
  }

  function renderTeam() {
    const root = $('#view-team');
    root.replaceChildren();
    const c = state.config;

    async function patch(p) {
      try {
        state.config = await api.setConfig(p);
      } catch (e) {
        toast(cleanErr(e), 'error');
      }
    }

    let memberFilter = '';
    const newMemberState = { name: '', positions: [] };

    // --- POSITIONS MANAGEMENT ---
    let posRows = (c.positions || []).map((p) => ({ code: p.code, label: p.label }));
    const posBox = h('div', { class: 'pos-manage-list' });

    const savePositions = async () => {
      const cleaned = posRows
        .filter((p) => p.code.trim())
        .map((p) => ({ code: p.code.trim(), label: p.label.trim() }));
      await patch({ positions: cleaned });
      drawAddMemberPills();
      drawMembersList();
    };

    function drawPos(focusLast) {
      posBox.replaceChildren(...posRows.map((p, i) => h('div', { class: 'pos-row ios-pos-row' },
        h('input', {
          class: 'input pos-code-input', value: p.code, maxlength: '6', placeholder: 'Code', 'aria-label': 'Position code',
          onchange: (e) => { p.code = e.target.value.trim(); savePositions(); }
        }),
        h('input', {
          class: 'input pos-label-input', value: p.label, placeholder: 'Name, e.g. Writer', 'aria-label': 'Position name',
          onchange: (e) => { p.label = e.target.value.trim(); savePositions(); }
        }),
        h('button', {
          type: 'button',
          class: 'x remove-btn', title: 'Remove position', 'aria-label': 'Remove position',
          onclick: () => { posRows.splice(i, 1); drawPos(); savePositions(); }
        }, '×'))));
      if (focusLast) {
        const last = posBox.querySelector('.pos-row:last-child input');
        if (last) last.focus();
      }
    }
    drawPos();

    // --- MEMBERS MANAGEMENT ---
    let membersList = (c.members || []).map((m) =>
      typeof m === 'string'
        ? { name: m, positions: [] }
        : { name: m.name, positions: Array.isArray(m.positions) ? m.positions.slice() : [] }
    );

    const saveMembers = async () => {
      await patch({ members: membersList });
    };

    const addMemberPillsBox = h('div', { class: 'pos-chips add-member-chips' });

    function drawAddMemberPills() {
      addMemberPillsBox.replaceChildren(
        ...state.config.positions.map((p) => {
          const isSelected = newMemberState.positions.includes(p.code);
          const pill = h('button', {
            type: 'button',
            class: 'pos' + (isSelected ? ' on' : ''),
            title: `Select ${p.label}`,
            onclick: () => {
              const idx = newMemberState.positions.indexOf(p.code);
              if (idx >= 0) newMemberState.positions.splice(idx, 1);
              else newMemberState.positions.push(p.code);
              pill.classList.toggle('on', idx < 0);
            }
          }, h('b', {}, p.code), ' ', p.label);
          return pill;
        })
      );
    }
    drawAddMemberPills();

    function makeEditIcon() {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'action-icon edit-icon-svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('width', '15');
      svg.setAttribute('height', '15');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '2');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
      svg.innerHTML = '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>';
      return svg;
    }

    let editingMember = null;
    const formHeading = h('div', { class: 'form-mode-title', style: 'display:none; margin-bottom: 8px;' });
    const formTrayLabel = h('div', { class: 'tray-label', style: 'margin-bottom: 6px;' }, 'Select default positions:');
    const btnSubmit = h('button', { class: 'btn primary', onclick: commitMember }, 'Add Member');
    const btnCancel = h('button', {
      type: 'button',
      class: 'btn ios-btn-ghost',
      style: 'display:none; margin-left: 8px;',
      onclick: cancelEdit
    }, 'Cancel');

    const newMemberInput = h('input', {
      class: 'input grow',
      placeholder: 'Full name, for example Alex Rivera',
      onkeydown: (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitMember();
        } else if (e.key === 'Escape' && editingMember) {
          e.preventDefault();
          cancelEdit();
        }
      }
    });

    const addMemberSection = h('div', { class: 'add-member-section' },
      formHeading,
      h('div', { class: 'row', style: 'margin-bottom: 12px;' },
        newMemberInput,
        btnSubmit,
        btnCancel),
      h('div', { class: 'add-member-pos-select' },
        formTrayLabel,
        addMemberPillsBox));

    function commitMember() {
      const name = newMemberInput.value.trim();
      if (!name) return;
      const lower = name.toLowerCase();

      if (editingMember) {
        if (membersList.some((m) => m !== editingMember && m.name.toLowerCase() === lower)) {
          toast(`"${name}" is already used by another member.`, 'error');
          return;
        }
        editingMember.name = name;
        editingMember.positions = newMemberState.positions.slice();
        toast(`Updated "${name}".`);
        cancelEdit();
        drawMembersList();
        saveMembers();
        return;
      }

      if (membersList.some((m) => m.name.toLowerCase() === lower)) {
        toast(`"${name}" is already in the member list.`, 'error');
        return;
      }
      membersList.push({ name, positions: newMemberState.positions.slice() });
      newMemberInput.value = '';
      newMemberState.positions = [];
      drawAddMemberPills();
      drawMembersList();
      saveMembers();
      toast(`Added "${name}" with ${membersList[membersList.length - 1].positions.length} position(s).`);
    }

    function startEditMember(m) {
      editingMember = m;
      newMemberInput.value = m.name;
      newMemberState.positions = Array.isArray(m.positions) ? m.positions.slice() : [];
      drawAddMemberPills();
      formHeading.style.display = 'flex';
      formHeading.replaceChildren(
        h('span', { class: 'editing-badge' }, 'Editing'),
        h('span', { class: 'editing-name' }, m.name)
      );
      formTrayLabel.textContent = `Select assigned positions for ${m.name}:`;
      btnSubmit.textContent = 'Save Changes';
      btnCancel.style.display = 'inline-flex';
      drawMembersList();
      newMemberInput.focus();
      addMemberSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function cancelEdit() {
      editingMember = null;
      newMemberInput.value = '';
      newMemberState.positions = [];
      drawAddMemberPills();
      formHeading.style.display = 'none';
      formTrayLabel.textContent = 'Select default positions:';
      btnSubmit.textContent = 'Add Member';
      btnCancel.style.display = 'none';
      drawMembersList();
    }

    const membersCountLabel = h('span', { class: 'member-count-pill' });
    const membersListBox = h('div', { class: 'team-members-list' });

    function drawMembersList() {
      const filter = memberFilter.trim().toLowerCase();
      const filtered = membersList.filter((m) => {
        if (!filter) return true;
        if (m.name.toLowerCase().includes(filter)) return true;
        return m.positions.some((code) => {
          if (code.toLowerCase().includes(filter)) return true;
          const pos = state.config.positions.find((p) => p.code === code);
          return pos && pos.label.toLowerCase().includes(filter);
        });
      });

      membersCountLabel.textContent = `${membersList.length} ${membersList.length === 1 ? 'member' : 'members'}`;

      if (!filtered.length) {
        membersListBox.replaceChildren(
          h('div', { class: 'card empty-team-card' },
            membersList.length ? 'No members match your search.' : 'No team members added yet. Add your first member above.')
        );
        return;
      }

      membersListBox.replaceChildren(...filtered.map((m) => {
        const isEditingThis = (editingMember === m);

        const posCodes = Array.isArray(m.positions) ? m.positions.map((c) => String(c).toUpperCase()).filter(Boolean) : [];
        const posText = posCodes.join('/');

        const btnEdit = h('button', {
          type: 'button',
          class: 'edit-btn',
          title: `Edit ${m.name}`,
          'aria-label': `Edit ${m.name}`,
          onclick: (e) => {
            e.stopPropagation();
            startEditMember(m);
          }
        }, makeEditIcon());

        const btnRemove = h('button', {
          type: 'button',
          class: 'x remove-btn',
          title: `Remove ${m.name}`,
          'aria-label': `Remove ${m.name}`,
          onclick: (e) => {
            e.stopPropagation();
            if (editingMember === m) cancelEdit();
            membersList = membersList.filter((item) => item !== m);
            drawMembersList();
            saveMembers();
            toast(`Removed "${m.name}".`);
          }
        }, '×');

        return h('div', {
          class: 'member-simple-row' + (isEditingThis ? ' is-editing' : ''),
          onclick: () => startEditMember(m)
        },
          h('div', { class: 'member-row-info' },
            h('span', { class: 'member-row-name', title: m.name }, m.name),
            posText
              ? [
                  h('span', { class: 'member-row-sep' }, '-'),
                  h('span', {
                    class: 'member-pos-badge',
                    title: m.positions.map((c) => {
                      const found = state.config.positions.find((p) => p.code.toLowerCase() === c.toLowerCase());
                      return found ? `${found.code} (${found.label})` : c;
                    }).join(', ')
                  }, posText)
                ]
              : [
                  h('span', { class: 'member-row-sep' }, '-'),
                  h('span', { class: 'member-pos-empty' }, 'No positions')
                ]
          ),
          h('div', { class: 'member-row-actions' },
            btnEdit,
            btnRemove
          )
        );
      }));
    }

    const searchInput = h('input', {
      class: 'input grow',
      type: 'search',
      placeholder: 'Search members by name or position…',
      oninput: (e) => {
        memberFilter = e.target.value;
        drawMembersList();
      }
    });

    drawMembersList();

    root.append(
      h('h1', {}, 'Members & Positions'),
      h('p', { class: 'sub' }, 'Manage team members, configure multiple positions, and customize shorthand schedule codes.'),
      h('div', { class: 'team-layout-grid' },

        // Left Column: Members
        h('div', { class: 'card team-members-card' },
          h('div', { class: 'card-header-row' },
            h('div', {},
              h('h2', {}, 'Team Members'),
              h('p', { class: 'sub', style: 'margin:0' }, 'Manage team members and assigned positions. Click edit or select positions on top.')),
            membersCountLabel),

          // Add/Edit Member Form
          addMemberSection,

          // Search Row
          h('div', { class: 'row', style: 'margin-top: 18px; margin-bottom: 14px;' },
            searchInput),

          // Members List
          membersListBox),

        // Right Column: Position Codes
        h('div', { class: 'card team-positions-card' },
          h('h2', {}, 'Position Codes'),
          h('p', { class: 'sub', style: 'margin-top:0' },
            'Shorthand codes (e.g. "W" for Writer) appear in calendar cells. Update labels or add new roles anytime.'),
          posBox,
          h('button', {
            type: 'button',
            class: 'btn btn-add',
            style: 'margin-top: 10px;',
            onclick: () => {
              posRows.push({ code: '', label: '' });
              drawPos(true);
            }
          },
            h('span', { class: 'btn-plus-icon' }, '+'),
            'Add position'))
      )
    );
  }

  function renderSettings() {
    const root = $('#view-settings');
    root.replaceChildren();
    const c = state.config;

    async function patch(p) {
      try { state.config = await api.setConfig(p); } catch (e) { toast(cleanErr(e), 'error'); }
    }

    root.append(
      h('h1', {}, 'Settings'),
      h('p', { class: 'sub' }, 'Configure schedule storage, sheet layout options, and event suggestions.'),
      h('div', { class: 'set-grid' },

        h('div', { class: 'card wide' },
          h('h2', {}, 'Application & Updates'),
          h('p', { class: 'sub', style: 'margin-top:0' },
            'TechSched checks GitHub Releases (marchugue/techsched) and downloads updates automatically.'),
          h('div', { class: 'updater-row' },
            h('div', { class: 'updater-info' },
              h('div', {}, 'Installed Version: ', h('b', {}, 'v' + (state.appVersion || '1.0.0')),
                ' · Release channel: ', h('code', {}, 'github:marchugue/techsched')),
              h('div', {
                class: 'update-status-msg' +
                  (state.updater.status === 'ok' ? ' ok' : state.updater.status === 'error' ? ' error' : state.updater.status === 'downloaded' ? ' highlight' : '')
              }, state.updater.message)
            ),
            h('div', { class: 'updater-actions' },
              state.updater.status === 'downloaded'
                ? h('button', {
                    class: 'btn primary',
                    onclick: () => api.installUpdate()
                  }, 'Restart & Install')
                : h('button', {
                    class: 'btn',
                    disabled: state.updater.status === 'checking' || state.updater.status === 'downloading',
                    onclick: triggerCheckForUpdates
                  }, state.updater.status === 'checking' ? 'Checking…' : 'Check for updates')
            )
          ),
          state.updater.status === 'downloading'
            ? h('div', { class: 'update-progress-wrap' },
                h('div', { class: 'update-progress-bar-bg' },
                  h('div', { class: 'update-progress-bar-fill', style: `width: ${state.updater.percent}%` })),
                h('div', { class: 'update-progress-text' }, `${state.updater.percent}% downloaded`))
            : false
        ),

        h('div', { class: 'card wide' },
          h('h2', {}, 'Schedule folder'),
          h('p', { class: 'sub', style: 'margin-top:0' },
            'Excel, PDF and image files are saved here, along with the history list. Pick another folder to switch to its history.'),
          h('div', { class: 'row' },
            h('code', { class: 'grow', style: 'word-break:break-all' }, c.storageDir || 'Not set'),
            h('button', { class: 'btn', onclick: pickFolder }, 'Select folder'),
            h('button', { class: 'btn', onclick: () => api.openFolder() }, 'Open'))),

        h('div', { class: 'card' },
          h('h2', {}, 'Sheet layout'),
          h('label', { class: 'field' },
            h('span', {}, 'People lines per row'),
            h('select', {
              class: 'input',
              onchange: (e) => patch({ linesPerRow: parseInt(e.target.value, 10) })
            }, [1, 2, 3, 4].map((n) => h('option', { value: String(n), selected: c.linesPerRow === n }, String(n))))),
          h('p', { class: 'sub', style: 'margin:6px 0 0' }, 'When a day has more lines than this, the sheet adds another row for that week.'),
          h('label', { class: 'inline-check' },
            h('input', { type: 'checkbox', checked: c.showLegend, onchange: (e) => patch({ showLegend: e.target.checked }) }),
            'Show the position key under the calendar')),

        h('div', { class: 'card' },
          h('h2', {}, 'Event suggestions'),
          h('p', { class: 'sub', style: 'margin-top:0' }, 'Suggested when adding events to a day.'),
          chipEditor(c.eventPresets.slice(), 'Add events, separated by commas', (items) => patch({ eventPresets: items })))
      )
    );
  }

  /* ---------- start ---------- */

  async function init() {
    state.config = await api.getConfig();

    try {
      state.appVersion = await api.getAppVersion();
      const b = $('#appVerBadge');
      if (b && state.appVersion) b.textContent = 'v' + state.appVersion;
    } catch (e) { /* ignore */ }

    if (api.onUpdaterStatus) {
      api.onUpdaterStatus((data) => {
        if (!data) return;
        if (data.status === 'checking') {
          state.updater.status = 'checking';
          state.updater.message = 'Checking GitHub for new releases…';
        } else if (data.status === 'available') {
          state.updater.status = 'downloading';
          state.updater.percent = 0;
          state.updater.message = `Update v${data.version} found! Downloading in background…`;
          toast(`Update v${data.version} found! Downloading…`);
          const dot = $('#settingsUpdateDot');
          if (dot) dot.classList.remove('hidden');
        } else if (data.status === 'not-available') {
          state.updater.status = 'ok';
          state.updater.message = `TechSched is up to date (v${state.appVersion || '1.0.0'}).`;
        } else if (data.status === 'downloading') {
          state.updater.status = 'downloading';
          state.updater.percent = data.percent || 0;
          state.updater.message = `Downloading update: ${data.percent}%`;
        } else if (data.status === 'downloaded') {
          state.updater.status = 'downloaded';
          state.updater.downloadedVersion = data.version;
          state.updater.message = `Version v${data.version} is ready to install!`;
          toast(`TechSched v${data.version} downloaded! Restart to apply.`);
          const dot = $('#settingsUpdateDot');
          if (dot) dot.classList.remove('hidden');
        } else if (data.status === 'error') {
          state.updater.status = 'error';
          state.updater.message = `Note: ${data.message || 'Check failed'}`;
        }
        if (state.view === 'settings') renderSettings();
      });
    }

    updateFolderLabel();
    document.querySelectorAll('.nav').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
    $('#btnPickFolder').addEventListener('click', pickFolder);
    initWindowControls();
    setView('new');
  }

  function initWindowControls() {
    const btnMin = $('#btnWinMin');
    const btnMax = $('#btnWinMax');
    const btnClose = $('#btnWinClose');
    const titlebar = $('#windowTitlebar');

    function updateMax(isMax) {
      document.body.classList.toggle('is-maximized', isMax);
      const iconMax = $('#iconMax');
      const iconRestore = $('#iconRestore');
      if (iconMax) iconMax.classList.toggle('hidden', isMax);
      if (iconRestore) iconRestore.classList.toggle('hidden', !isMax);
    }

    if (btnMin) btnMin.addEventListener('click', () => api.minimizeWindow && api.minimizeWindow());
    if (btnMax) btnMax.addEventListener('click', async () => {
      if (api.maximizeWindow) {
        const isMax = await api.maximizeWindow();
        updateMax(isMax);
      }
    });
    if (btnClose) btnClose.addEventListener('click', () => api.closeWindow && api.closeWindow());

    if (titlebar) {
      const dragArea = titlebar.querySelector('.titlebar-drag-area');
      if (dragArea) {
        dragArea.addEventListener('dblclick', async () => {
          if (api.maximizeWindow) {
            const isMax = await api.maximizeWindow();
            updateMax(isMax);
          }
        });
      }
    }

    if (api.onMaximizedChange) {
      api.onMaximizedChange((isMax) => updateMax(isMax));
    }

    if (api.isMaximized) {
      api.isMaximized().then((isMax) => updateMax(isMax)).catch(() => {});
    }

    initWindowResizing();
  }

  function initWindowResizing() {
    const handles = document.querySelectorAll('.resize-handle');
    if (!handles.length || !api.getBounds || !api.setBounds) return;

    handles.forEach((handle) => {
      handle.addEventListener('mousedown', async (e) => {
        if (document.body.classList.contains('is-maximized')) return;
        e.preventDefault();
        const edge = handle.dataset.edge;
        const startX = e.screenX;
        const startY = e.screenY;
        const initialBounds = await api.getBounds();
        if (!initialBounds) return;

        let rafId = null;
        let latestBounds = Object.assign({}, initialBounds);

        const onMouseMove = (ev) => {
          const dx = ev.screenX - startX;
          const dy = ev.screenY - startY;
          let { x, y, width, height } = initialBounds;

          if (edge.includes('e')) width = Math.max(980, initialBounds.width + dx);
          if (edge.includes('s')) height = Math.max(650, initialBounds.height + dy);
          if (edge.includes('w')) {
            const newW = Math.max(980, initialBounds.width - dx);
            x = initialBounds.x + (initialBounds.width - newW);
            width = newW;
          }
          if (edge.includes('n')) {
            const newH = Math.max(650, initialBounds.height - dy);
            y = initialBounds.y + (initialBounds.height - newH);
            height = newH;
          }

          latestBounds = { x, y, width, height };
          if (!rafId) {
            rafId = requestAnimationFrame(() => {
              api.setBounds(latestBounds);
              rafId = null;
            });
          }
        };

        const onMouseUp = () => {
          window.removeEventListener('mousemove', onMouseMove);
          window.removeEventListener('mouseup', onMouseUp);
          if (rafId) {
            cancelAnimationFrame(rafId);
            api.setBounds(latestBounds);
          }
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
      });
    });
  }

  init().catch((e) => toast(cleanErr(e), 'error'));
})();
