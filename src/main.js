const { app, BrowserWindow, Tray, Menu, ipcMain, dialog } = require('electron')
const path = require('path')
const { autoUpdater } = require('electron-updater')
const Store = require('./store')
const SyncEngine = require('./sync')

let tray = null
let settingsWindow = null
let syncEngine = null
let syncInterval = null

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

app.whenReady().then(() => {
  createTray()
  createSettingsWindow()
  startSync()
})

app.on('window-all-closed', (e) => {
  // Keep app running in tray when window is closed
  e.preventDefault()
})

function createTray() {
  // Use a default icon if custom one not present
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png')
  tray = new Tray(iconPath)

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'P6 Intelligence Agent',
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'Open Settings',
      click: () => {
        settingsWindow.show()
        settingsWindow.focus()
      }
    },
    {
      label: 'Sync Now',
      click: () => {
        if (syncEngine) syncEngine.sync()
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.exit(0)
      }
    }
  ])

  tray.setToolTip('P6 Intelligence Agent')
  tray.setContextMenu(contextMenu)

  tray.on('click', () => {
    settingsWindow.show()
    settingsWindow.focus()
  })
}

function createSettingsWindow() {
  settingsWindow = new BrowserWindow({
    width: 520,
    height: 620,
    resizable: false,
    title: 'P6 Intelligence Agent',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    icon: path.join(__dirname, '..', 'assets', 'icon.png')
  })

  settingsWindow.loadFile(path.join(__dirname, 'settings.html'))

  // Hide instead of close
  settingsWindow.on('close', (e) => {
    e.preventDefault()
    settingsWindow.hide()
  })
}

function startSync() {
  const store = new Store()
  const config = store.getConfig()

  if (config.licenseKey && config.dbPath && config.syncEnabled) {
    syncEngine = new SyncEngine(config)
    syncEngine.sync() // immediate first sync
    syncInterval = setInterval(() => {
      syncEngine.sync()
    }, 60 * 1000) // every 1 minute
  }
}

function restartSync() {
  if (syncInterval) clearInterval(syncInterval)
  startSync()
}

// IPC handlers — communication between main process and settings window
ipcMain.handle('get-config', () => {
  const store = new Store()
  return store.getConfig()
})

ipcMain.handle('save-config', (event, config) => {
  const store = new Store()
  store.saveConfig(config)
  restartSync()
  return { success: true }
})

ipcMain.handle('sync-now', async () => {
  const store = new Store()
  const config = store.getConfig()
  if (!config.licenseKey || !config.dbPath) {
    return { success: false, error: 'Please configure license key and database path first' }
  }
  const engine = new SyncEngine(config)
  return await engine.sync()
})

ipcMain.handle('browse-db', async () => {
  const result = await dialog.showOpenDialog(settingsWindow, {
    title: 'Select P6 SQLite Database',
    filters: [{ name: 'SQLite Database', extensions: ['db', 'sqlite'] }],
    properties: ['openFile']
  })
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0]
  }
  return null
})

ipcMain.handle('get-sync-status', () => {
  if (syncEngine) return syncEngine.getStatus()
  return { lastSync: null, status: 'idle', message: 'Not configured' }
})