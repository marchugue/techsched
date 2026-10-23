const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

// Setup updater logger
log.transports.file.level = 'info';
autoUpdater.logger = log;
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

// Remove native application menu bar
Menu.setApplicationMenu(null);

const L = require('./src/lib/layout');
const { writeExcel } = require('./src/lib/excel');
const { toPdf, toPng } = require('./src/lib/capture');
const { createStore } = require('./src/lib/store');

let win;
let store;
let cfg;

function createWindow() {
  const iconPath = path.join(__dirname, 'src', 'renderer', 'assets', 'logo.png');
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 650,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    roundedCorners: true,
    title: 'TechSched',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.removeMenu();

  win.on('maximize', () => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('window:maximized-change', true);
    }
  });

  win.on('unmaximize', () => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('window:maximized-change', false);
    }
  });

  win.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));
}

/** Only allow file actions inside the storage folder. */
function inStorage(p) {
  const root = path.resolve(cfg.storageDir) + path.sep;
  const abs = path.resolve(String(p || ''));
  if (!abs.startsWith(root)) throw new Error('That file is outside the storage folder.');
  return abs;
}

async function generate(input) {
  const pm = L.parseMonth(input && input.month);
  if (!pm) throw new Error('Choose a valid month first.');

  fs.mkdirSync(cfg.storageDir, { recursive: true });

  const total = L.daysInMonth(pm.year, pm.month);
  const days = L.cleanDays(input.days, total);

  // New names typed into the editor join the member list.
  const known = new Set(cfg.members.map((m) => (typeof m === 'string' ? m : m.name).toLowerCase()));
  const fresh = [];
  for (const d of Object.values(days)) {
    for (const a of d.assignments) {
      const k = a.name.toLowerCase();
      if (!known.has(k)) {
        known.add(k);
        fresh.push({ name: a.name, positions: a.positions ? a.positions.slice() : [] });
      }
    }
  }
  if (fresh.length) cfg = store.saveConfig({ members: cfg.members.concat(fresh) });

  const model = L.buildModel({ month: input.month, days }, cfg);

  const history = store.loadHistory(cfg.storageDir);
  const idx = history.findIndex((h) => h.id === input.id && h.month === input.month);
  const prev = idx >= 0 ? history[idx] : null;

  const now = new Date();
  const stamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const id = prev ? prev.id : crypto.randomUUID();
  const base = prev ? prev.base : `techsched-${pm.year}-${L.pad(pm.month)}-${stamp}`;

  const dir = path.join(cfg.storageDir, `${pm.year}-${L.pad(pm.month)}`);
  fs.mkdirSync(dir, { recursive: true });
  const files = {
    xlsx: path.join(dir, base + '.xlsx'),
    pdf: path.join(dir, base + '.pdf'),
    png: path.join(dir, base + '.png')
  };
  const warnings = [];

  await writeExcel(model, files.xlsx);

  try {
    fs.writeFileSync(files.pdf, await toPdf(model));
  } catch (e) {
    files.pdf = null;
    warnings.push('PDF could not be created: ' + e.message);
  }
  try {
    fs.writeFileSync(files.png, await toPng(model));
  } catch (e) {
    files.png = null;
    warnings.push('Image could not be created: ' + e.message);
  }

  const record = {
    id,
    base,
    month: input.month,
    title: model.title,
    createdAt: prev ? prev.createdAt : now.toISOString(),
    updatedAt: now.toISOString(),
    days,
    stats: L.summarize(days),
    files
  };
  if (prev) history[idx] = record; else history.push(record);
  store.saveHistory(cfg.storageDir, history);

  return { record, config: cfg, warnings };
}

function registerIpc() {
  ipcMain.handle('config:get', () => cfg);

  ipcMain.handle('config:set', (e, patch) => {
    cfg = store.saveConfig(patch);
    return cfg;
  });

  ipcMain.handle('folder:select', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Select schedule folder',
      defaultPath: cfg.storageDir || undefined,
      properties: ['openDirectory', 'createDirectory']
    });
    if (r.canceled || !r.filePaths[0]) return null;
    cfg = store.saveConfig({ storageDir: r.filePaths[0] });
    return cfg;
  });

  ipcMain.handle('folder:open', () => shell.openPath(cfg.storageDir));

  ipcMain.handle('history:list', () => {
    return store.loadHistory(cfg.storageDir).map((rec) => {
      const exists = {};
      for (const k of ['xlsx', 'pdf', 'png']) {
        exists[k] = !!(rec.files && rec.files[k] && fs.existsSync(rec.files[k]));
      }
      return Object.assign({}, rec, { exists });
    });
  });

  ipcMain.handle('schedule:generate', (e, input) => generate(input));

  ipcMain.handle('schedule:delete', (e, { id, deleteFiles }) => {
    const history = store.loadHistory(cfg.storageDir);
    const rec = history.find((h) => h.id === id);
    if (!rec) return false;
    if (deleteFiles) {
      for (const p of Object.values(rec.files || {})) {
        try { if (p) fs.unlinkSync(inStorage(p)); } catch (err) { /* already gone */ }
      }
    }
    store.saveHistory(cfg.storageDir, history.filter((h) => h.id !== id));
    return true;
  });

  ipcMain.handle('file:open', (e, p) => shell.openPath(inStorage(p)));
  ipcMain.handle('file:reveal', (e, p) => shell.showItemInFolder(inStorage(p)));

  ipcMain.handle('file:saveAs', async (e, p) => {
    const src = inStorage(p);
    const ext = path.extname(src).slice(1);
    const r = await dialog.showSaveDialog(win, {
      title: 'Save a copy',
      defaultPath: path.join(app.getPath('downloads'), path.basename(src)),
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
    });
    if (r.canceled || !r.filePath) return null;
    await fs.promises.copyFile(src, r.filePath);
    return r.filePath;
  });

  // Auto-updater IPC handlers
  ipcMain.handle('app:version', () => app.getVersion());

  ipcMain.handle('updater:check', async () => {
    if (!app.isPackaged) {
      log.info('Manual update check skipped: running in dev mode');
      return {
        status: 'dev',
        message: 'Auto-updates are enabled in the packaged app (.exe). Development mode is active.'
      };
    }
    try {
      const res = await autoUpdater.checkForUpdates();
      return {
        status: 'ok',
        updateInfo: res ? res.updateInfo : null
      };
    } catch (err) {
      log.error('Manual update check error:', err);
      return {
        status: 'error',
        message: err.message || String(err)
      };
    }
  });

  ipcMain.handle('updater:install', () => {
    autoUpdater.quitAndInstall();
  });

  // Window control IPC handlers
  ipcMain.handle('window:minimize', () => {
    if (win) win.minimize();
  });

  ipcMain.handle('window:maximize', () => {
    if (!win) return false;
    if (win.isMaximized()) {
      win.unmaximize();
      return false;
    } else {
      win.maximize();
      return true;
    }
  });

  ipcMain.handle('window:close', () => {
    if (win) win.close();
  });

  ipcMain.handle('window:isMaximized', () => {
    return win ? win.isMaximized() : false;
  });

  ipcMain.handle('window:getBounds', () => {
    return win ? win.getBounds() : null;
  });

  ipcMain.handle('window:setBounds', (e, bounds) => {
    if (win && bounds) {
      win.setBounds(bounds);
    }
  });
}

function sendUpdaterStatus(payload) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('updater:status', payload);
  }
}

function setupAutoUpdater() {
  autoUpdater.on('checking-for-update', () => {
    log.info('Checking for update...');
    sendUpdaterStatus({ status: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    log.info('Update available:', info.version);
    sendUpdaterStatus({
      status: 'available',
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    log.info('Update not available. Current version is up to date.');
    sendUpdaterStatus({
      status: 'not-available',
      version: app.getVersion()
    });
  });

  autoUpdater.on('error', (err) => {
    log.error('AutoUpdater error:', err);
    sendUpdaterStatus({
      status: 'error',
      message: err == null ? 'Unknown update error' : (err.message || String(err))
    });
  });

  autoUpdater.on('download-progress', (progressObj) => {
    sendUpdaterStatus({
      status: 'downloading',
      percent: Math.round(progressObj.percent || 0),
      bytesPerSecond: progressObj.bytesPerSecond,
      transferred: progressObj.transferred,
      total: progressObj.total
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    log.info('Update downloaded:', info.version);
    sendUpdaterStatus({
      status: 'downloaded',
      version: info.version,
      releaseNotes: info.releaseNotes
    });

    if (win && !win.isDestroyed()) {
      dialog.showMessageBox(win, {
        type: 'info',
        buttons: ['Restart and Install', 'Later'],
        defaultId: 0,
        cancelId: 1,
        title: 'Update Ready',
        message: `A new version of TechSched (v${info.version}) has been downloaded.`,
        detail: 'Restart the application now to install the latest version.'
      }).then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
    }
  });
}

app.whenReady().then(() => {
  store = createStore(app.getPath('userData'));
  cfg = store.getConfig();
  if (!cfg.storageDir) {
    cfg = store.saveConfig({ storageDir: path.join(app.getPath('documents'), 'TechSched') });
  }
  fs.mkdirSync(cfg.storageDir, { recursive: true });

  registerIpc();
  createWindow();
  setupAutoUpdater();

  // If running packaged app, automatically check for updates after launch
  if (app.isPackaged) {
    setTimeout(() => {
      autoUpdater.checkForUpdatesAndNotify().catch((err) => {
        log.error('Initial auto-update check error:', err);
      });
    }, 3000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
