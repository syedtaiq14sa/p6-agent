const path = require('path')
const fs = require('fs')
const { app } = require('electron')

class Store {
  constructor() {
    const userDataPath = app.getPath('userData')
    this.configPath = path.join(userDataPath, 'config.json')
  }

  getConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf8')
        return JSON.parse(data)
      }
    } catch (err) {
      console.error('Error reading config:', err)
    }
    return {
      licenseKey: '',
      dbPath: '',
      syncEnabled: false,
      backendUrl: 'https://p6intelligence-backend-production.up.railway.app',
      lastSync: null
    }
  }

  saveConfig(config) {
    try {
      const userDataPath = app.getPath('userData')
      if (!fs.existsSync(userDataPath)) {
        fs.mkdirSync(userDataPath, { recursive: true })
      }
      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2))
      return true
    } catch (err) {
      console.error('Error saving config:', err)
      return false
    }
  }
}

module.exports = Store