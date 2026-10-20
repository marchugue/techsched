const { contextBridge, ipcRenderer } = require('electron');

const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  getConfig: () => call('config:get'),
  setConfig: (patch) => call('config:set', patch),
  selectFolder: () => call('folder:select'),
  openFolder: () => call('folder:open'),
  listHistory: () => call('history:list'),
  generate: (schedule) => call('schedule:generate', schedule),
  remove: (id, deleteFiles) => call('schedule:delete', { id, deleteFiles }),
  openFile: (p) => call('file:open', p),
  reveal: (p) => call('file:reveal', p),
  saveAs: (p) => call('file:saveAs', p),
  getAppVersion: () => call('app:version'),
  checkForUpdates: () => call('updater:check'),
  installUpdate: () => call('updater:install'),
  onUpdaterStatus: (cb) => {
    const handler = (e, data) => cb(data);
    ipcRenderer.on('updater:status', handler);
    return () => ipcRenderer.removeListener('updater:status', handler);
  }
});
