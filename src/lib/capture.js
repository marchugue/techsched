const { BrowserWindow } = require('electron');
const { buildHtml, pngSize } = require('./render-html');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function withWindow(html, width, height, fn) {
  const win = new BrowserWindow({
    show: false,
    width: Math.max(width, 1600),
    height: Math.max(height, 1200),
    useContentSize: true,
    enableLargerThanScreen: true,
    frame: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      javascript: true,
      backgroundThrottling: false
    }
  });
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await wait(250);
    return await fn(win);
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

async function toPdf(model) {
  const html = buildHtml(model, 'pdf');
  return withWindow(html, 1200, 800, (win) =>
    win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true }));
}

async function toPng(model) {
  const html = buildHtml(model, 'png');
  const initial = pngSize(model);
  return withWindow(html, initial.width, initial.height, async (win) => {
    // Measure exact bounding box of the rendered sheet
    const bounds = await win.webContents.executeJavaScript(`
      (() => {
        const sheet = document.getElementById('sheet') || document.querySelector('table') || document.body;
        const rect = sheet.getBoundingClientRect();
        return {
          width: Math.ceil(Math.max(sheet.scrollWidth, rect.width, rect.right)),
          height: Math.ceil(Math.max(sheet.scrollHeight, rect.height, rect.bottom))
        };
      })()
    `).catch(() => initial);

    const targetWidth = Math.max(bounds.width + 12, initial.width);
    const targetHeight = Math.max(bounds.height + 12, initial.height);

    win.setContentSize(targetWidth, targetHeight);
    await wait(120);

    const rect = { x: 0, y: 0, width: targetWidth, height: targetHeight };
    let img = await win.webContents.capturePage(rect);
    if (img.isEmpty()) {
      // Some platforms only paint visible windows; show it briefly without stealing focus.
      win.showInactive();
      await wait(400);
      img = await win.webContents.capturePage(rect);
    }
    if (img.isEmpty()) throw new Error('Could not capture the schedule image.');
    return img.toPNG();
  });
}

module.exports = { toPdf, toPng };
