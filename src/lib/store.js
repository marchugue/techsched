const fs = require('fs');
const path = require('path');

const HISTORY_FILE = 'techsched-history.json';

const defaults = () => ({
  storageDir: null,
  positions: [
    { code: 'W', label: 'Writer' },
    { code: 'G', label: 'Graphics' },
    { code: 'I', label: 'Illustrator' },
    { code: 'Pj', label: 'Photojournalist' },
    { code: 'Vj', label: 'Videojournalist' },
    { code: 'B', label: 'Broadcaster' }
  ],
  members: [],
  eventPresets: ['feature', 'review', 'column', 'literary', 'documentary', 'news',
    'komiky', 'scitech', 'photo essay', 'intramurals'],
  linesPerRow: 2,
  showLegend: false
});

function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function uniqueStrings(list) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const s = String(raw == null ? '' : raw).trim();
    const k = s.toLowerCase();
    if (s && !seen.has(k)) { seen.add(k); out.push(s); }
  }
  return out;
}

function sanitizeMember(m) {
  if (typeof m === 'string') {
    const s = m.trim();
    return s ? { name: s, positions: [] } : null;
  }
  if (m && typeof m === 'object') {
    const name = String(m.name || '').trim();
    if (!name) return null;
    const positions = Array.isArray(m.positions)
      ? m.positions.map((p) => String(p || '').trim().slice(0, 6)).filter(Boolean)
      : [];
    return { name, positions: [...new Set(positions)] };
  }
  return null;
}

function sanitize(cfg) {
  const d = defaults();
  const out = Object.assign(d, cfg || {});

  const seen = new Set();
  out.positions = (Array.isArray(out.positions) ? out.positions : [])
    .map((p) => ({
      code: String((p && p.code) || '').trim().slice(0, 6),
      label: String((p && p.label) || '').trim()
    }))
    .filter((p) => {
      if (!p.code || seen.has(p.code)) return false;
      seen.add(p.code);
      return true;
    })
    .map((p) => ({ code: p.code, label: p.label || p.code }));

  const seenMembers = new Set();
  out.members = (Array.isArray(out.members) ? out.members : [])
    .map(sanitizeMember)
    .filter((m) => {
      if (!m || !m.name) return false;
      const k = m.name.toLowerCase();
      if (seenMembers.has(k)) return false;
      seenMembers.add(k);
      return true;
    });

  out.eventPresets = uniqueStrings(out.eventPresets);
  out.linesPerRow = Math.min(4, Math.max(1, parseInt(out.linesPerRow, 10) || 2));
  out.showLegend = !!out.showLegend;
  out.storageDir = out.storageDir ? String(out.storageDir) : null;
  return out;
}

function createStore(userDataDir) {
  const cfgFile = path.join(userDataDir, 'config.json');

  function getConfig() {
    try {
      return sanitize(JSON.parse(fs.readFileSync(cfgFile, 'utf8')));
    } catch (e) {
      return sanitize({});
    }
  }

  function saveConfig(patch) {
    const next = sanitize(Object.assign(getConfig(), patch || {}));
    atomicWrite(cfgFile, JSON.stringify(next, null, 2));
    return next;
  }

  function loadHistory(dir) {
    try {
      const list = JSON.parse(fs.readFileSync(path.join(dir, HISTORY_FILE), 'utf8'));
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function saveHistory(dir, list) {
    atomicWrite(path.join(dir, HISTORY_FILE), JSON.stringify(list, null, 2));
  }

  return { getConfig, saveConfig, loadHistory, saveHistory };
}

module.exports = { createStore };
