const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dshChat', {
  getConfig: () => ipcRenderer.invoke('chat:get-config'),
  saveKey: (providerId, key) => ipcRenderer.invoke('chat:save-key', providerId, key),
  getCustomProviders: () => ipcRenderer.invoke('chat:custom-providers:get'),
  saveCustomProviders: (list) => ipcRenderer.invoke('chat:custom-providers:save', list),
  send: (payload) => ipcRenderer.send('chat:send', payload),
  onChunk: (cb) => {
    const listener = (_event, data) => cb(data);
    ipcRenderer.on('chat:chunk', listener);
    return () => ipcRenderer.removeListener('chat:chunk', listener);
  },
  onDone: (cb) => {
    const listener = (_event, data) => cb(data);
    ipcRenderer.on('chat:done', listener);
    return () => ipcRenderer.removeListener('chat:done', listener);
  },
});

contextBridge.exposeInMainWorld('dshAizex', {
  getAccount: () => ipcRenderer.invoke('aizex-account:get'),
  saveAccount: (email, password) => ipcRenderer.invoke('aizex-account:save', email, password),
});

contextBridge.exposeInMainWorld('dshMusic', {
  minimize: () => ipcRenderer.send('music:minimize'),
  hide: () => ipcRenderer.send('music:hide'),
  expand: () => ipcRenderer.send('music:expand'),
  compact: () => ipcRenderer.send('music:compact'),
});

contextBridge.exposeInMainWorld('dshResearchRadar', {
  get: () => ipcRenderer.invoke('research-radar:get'),
  refresh: () => ipcRenderer.invoke('research-radar:refresh'),
});

contextBridge.exposeInMainWorld('dshControl', {
  status: () => ipcRenderer.invoke('control:status'),
  login: (payload) => ipcRenderer.invoke('control:login', payload),
  changePassword: (payload) => ipcRenderer.invoke('control:change-password', payload),
  logout: () => ipcRenderer.invoke('control:logout'),
  openAdmin: () => ipcRenderer.invoke('control:open-admin'),
  submitKnowledge: (payload) => ipcRenderer.invoke('control:knowledge-submit', payload),
  submitFeedback: (payload) => ipcRenderer.invoke('control:feedback-submit', payload),
});
