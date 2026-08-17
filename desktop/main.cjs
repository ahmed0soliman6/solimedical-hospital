const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  let mainWindow;

  function isExternalUrl(url) {
    return /^https?:\/\//i.test(String(url || ''));
  }

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 980,
      minHeight: 680,
      show: false,
      backgroundColor: '#102A35',
      autoHideMenuBar: true,
      title: 'مستشفى ميت على التخصصي',
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    });

    mainWindow.once('ready-to-show', () => mainWindow.show());
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (isExternalUrl(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    mainWindow.webContents.on('will-navigate', (event, url) => {
      if (isExternalUrl(url) && !url.startsWith('https://mitali1.vercel.app/')) {
        event.preventDefault();
        shell.openExternal(url);
      }
    });
    mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));
    mainWindow.on('closed', () => { mainWindow = null; });
  }

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
