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

    const monthInput = h('input', {
      class: 'input ios-month-input', type: 'month', value: d.month, 'aria-label': 'Month',
      onchange: (e) => {
        if (!L.parseMonth(e.target.value)) { e.target.value = d.month; return; }
        d.month = e.target.value;
        d.id = null; // a different month is a new schedule
        refresh();
      }
    });

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
      const pm = L.parseMonth(d.month);
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
        monthInput,
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

    const cells = L.WEEKDAYS.map((w) => h('div', { class: 'cal-head' }, w));
    for (let i = 0; i < offset; i++) cells.push(h('div', { class: 'cal-blank' }));

    for (let day = 1; day <= total; day++) {
      const data = d.days[day] || { events: [], assignments: [] };
      const lines = L.groupLines(data.assignments, state.config.positions);
      const evs = data.events.slice(0, 3).map((ev) => h('div', { class: 'cal-ev', title: ev }, ev));
      if (data.events.length > 3) evs.push(h('div', { class: 'cal-ev' }, `+${data.events.length - 3} more`));
      if (!evs.length) evs.push(h('div', { class: 'cal-ev blank' }));

      cells.push(h('button', {
        type: 'button', class: 'cal-cell',
        'aria-label': `Edit ${L.MONTHS[pm.month - 1]} ${day}`,
        onclick: () => openDayEditor(day, () => { drawGrid(grid, onChange); onChange(); })
      },
      h('div', { class: 'cal-evs' }, evs),
      h('div', { class: 'cal-day' }, String(day)),
      h('div', { class: 'cal-people' },
        lines.length ? lines.map((l) => h('div', { title: l }, l)) : h('span', { class: 'cal-hint' }, 'Add'))));
    }

    const tail = (7 - ((offset + total) % 7)) % 7;
    for (let i = 0; i < tail; i++) cells.push(h('div', { class: 'cal-blank' }));
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
      evBox.replaceChildren(...work.events.map((ev, i) => h('div', { class: 'row' },
        h('input', {
          class: 'input', value: ev, list: 'dlEvents', placeholder: 'Event, for example feature',
          'aria-label': 'Event',
          oninput: (e) => { work.events[i] = e.target.value; },
          onkeydown: (e) => {
            if (e.key === 'Enter') { e.preventDefault(); work.events.push(''); drawEvents(true); }
          }
        }),
        h('button', {
          type: 'button', class: 'x', title: 'Remove event', 'aria-label': 'Remove event',
          onclick: () => { work.events.splice(i, 1); if (!work.events.length) work.events.push(''); drawEvents(); }
        }, '×'))));
      if (focusLast) evBox.querySelector('.row:last-child input').focus();
    }

    function drawPeople(focusLast) {
      const positions = state.config.positions;
      pplBox.replaceChildren(...work.assignments.map((a, i) => {
        const chips = positions.length
          ? positions.map((p) => {
            const btn = h('button', {
              type: 'button', class: 'pos' + (a.positions.includes(p.code) ? ' on' : ''),
              title: p.label, 'aria-pressed': String(a.positions.includes(p.code)),
              onclick: () => {
                const k = a.positions.indexOf(p.code);
                if (k >= 0) a.positions.splice(k, 1); else a.positions.push(p.code);
                btn.classList.toggle('on', k < 0);
                btn.setAttribute('aria-pressed', String(k < 0));
              }
            }, h('b', {}, p.code), ' ', p.label);
            return btn;
          })
          : h('span', { class: 'sub' }, 'No positions yet. Add some in Settings.');

        return h('div', { class: 'person' },
          h('div', { class: 'row' },
            h('input', {
              class: 'input', value: a.name, list: 'dlMembers', placeholder: 'Name', 'aria-label': 'Name',
              oninput: (e) => { a.name = e.target.value; },
              onkeydown: (e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  work.assignments.push({ name: '', positions: [] });
                  drawPeople(true);
                }
              }
            }),
            h('button', {
              type: 'button', class: 'x', title: 'Remove person', 'aria-label': 'Remove person',
              onclick: () => {
                work.assignments.splice(i, 1);
                if (!work.assignments.length) work.assignments.push({ name: '', positions: [] });
                drawPeople();
              }
            }, '×')),
          h('div', { class: 'pos-chips' }, chips));
      }));
      if (focusLast) pplBox.querySelector('.person:last-child input').focus();
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
      h('div', { class: 'modal-head' },
        h('h2', {}, `${L.MONTHS[pm.month - 1]} ${day}`),
        h('small', {}, L.WEEKDAYS_LONG[date.getDay()])),
      h('div', { class: 'modal-body' },
        h('datalist', { id: 'dlMembers' }, state.config.members.map((n) => h('option', { value: n }))),
        h('datalist', { id: 'dlEvents' }, state.config.eventPresets.map((n) => h('option', { value: n }))),
        h('div', { class: 'sec-title' }, 'Events'),
        evBox,
        h('button', { type: 'button', class: 'btn small', onclick: () => { work.events.push(''); drawEvents(true); } }, 'Add event'),
        h('div', { class: 'sec-title', style: 'margin-top:18px' }, 'People and positions'),
        h('p', { class: 'sub', style: 'margin:0 0 8px' }, 'Pick one or more positions for each person.'),
        pplBox,
        h('button', {
          type: 'button', class: 'btn small',
          onclick: () => { work.assignments.push({ name: '', positions: [] }); drawPeople(true); }
        }, 'Add person')),
      h('div', { class: 'modal-foot' },
        h('button', {
          class: 'btn danger',
          onclick: () => { delete d.days[day]; m.close(); onSave(); }
        }, 'Clear day'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'),
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
        try {
          const target = currentFormat === 'xlsx' ? f.xlsx : (currentFormat === 'pdf' ? f.pdf : f.png);
          if (!target) throw new Error('File not available.');
          const r = await api.saveAs(target);
          if (r) toast('Saved copy to ' + r);
        } catch (e) {
          toast(cleanErr(e), 'error');
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
        h('h2', {}, rec.title),
        h('small', {}, 'Schedule generated successfully')
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
        h('button', { class: 'btn ios-btn-ghost', onclick: () => m.close() }, 'Done'),
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
        state.updater.message = 'Update check: ' + res.message;
        toast(res.message, 'error');
      }
    } catch (e) {
      state.updater.status = 'error';
      state.updater.message = 'Update check failed: ' + cleanErr(e);
      toast(cleanErr(e), 'error');
    }
    if (state.view === 'settings') renderSettings();
  }

  function renderSettings() {
    const root = $('#view-settings');
    root.replaceChildren();
    const c = state.config;

    async function patch(p) {
      try { state.config = await api.setConfig(p); } catch (e) { toast(cleanErr(e), 'error'); }
    }

    // Positions
    let posRows = c.positions.map((p) => ({ code: p.code, label: p.label }));
    const posBox = h('div');
    const savePositions = () => patch({
      positions: posRows.filter((p) => p.code.trim()).map((p) => ({ code: p.code.trim(), label: p.label.trim() }))
    });

    function drawPos(focusLast) {
      posBox.replaceChildren(...posRows.map((p, i) => h('div', { class: 'pos-row' },
        h('input', {
          class: 'input', value: p.code, maxlength: '6', placeholder: 'Code', 'aria-label': 'Position code',
          onchange: (e) => { p.code = e.target.value; savePositions(); }
        }),
        h('input', {
          class: 'input', value: p.label, placeholder: 'Name, for example Writer', 'aria-label': 'Position name',
          onchange: (e) => { p.label = e.target.value; savePositions(); }
        }),
        h('button', {
          class: 'x', title: 'Remove position', 'aria-label': 'Remove position',
          onclick: () => { posRows.splice(i, 1); drawPos(); savePositions(); }
        }, '×'))));
      if (focusLast) posBox.querySelector('.pos-row:last-child input').focus();
    }
    drawPos();

    root.append(
      h('h1', {}, 'Settings'),
      h('p', { class: 'sub' }, 'Changes are saved as you make them.'),
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
          h('h2', {}, 'Positions'),
          h('p', { class: 'sub', style: 'margin-top:0' }, 'The code appears on the sheet, as in W-Wendy. A person can hold several.'),
          posBox,
          h('button', { class: 'btn small', onclick: () => { posRows.push({ code: '', label: '' }); drawPos(true); } }, 'Add position')),

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
          h('h2', {}, 'Members'),
          h('p', { class: 'sub', style: 'margin-top:0' }, 'Suggested while typing names. New names you enter are added automatically.'),
          chipEditor(c.members.slice(), 'Add names, separated by commas', (items) => patch({ members: items }))),

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
    setView('new');
  }

  init().catch((e) => toast(cleanErr(e), 'error'));
})();
