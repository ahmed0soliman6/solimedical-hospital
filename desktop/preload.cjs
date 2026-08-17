const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('MitaliDesktop', Object.freeze({
  isDesktop: true,
  platform: process.platform,
  appVersion: 'v1.3.22',
}));
