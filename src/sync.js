const path = require('path')
const fs = require('fs')
const axios = require('axios')
const CryptoJS = require('crypto-js')
const initSqlJs = require('sql.js')

class SyncEngine {
  constructor(config) {
    this.config = config
    this.status = {
      lastSync: null,
      status: 'idle',
      message: 'Waiting for first sync...'
    }
  }

  getStatus() {
    return this.status
  }

  setStatus(status, message) {
    this.status.status = status
    this.status.message = message
    if (status === 'success') {
      this.status.lastSync = new Date().toISOString()
    }
  }

  async readDatabase() {
    const SQL = await initSqlJs()
    const fileBuffer = fs.readFileSync(this.config.dbPath)
    const db = new SQL.Database(fileBuffer)

    const query = (sql) => {
      const stmt = db.prepare(sql)
      const rows = []
      while (stmt.step()) {
        rows.push(stmt.getAsObject())
      }
      stmt.free()
      return rows
    }

    // Filter by selected projects if any
    const selectedIds = this.config.selectedProjects && this.config.selectedProjects.length > 0
      ? this.config.selectedProjects
      : null

    const projectFilter = selectedIds
      ? `WHERE PROJECT_FLAG = 'Y' AND PROJ_ID IN (${selectedIds.join(',')})`
      : `WHERE PROJECT_FLAG = 'Y'`

    const taskFilter = selectedIds
      ? `WHERE PROJ_ID IN (${selectedIds.join(',')})`
      : ''

    const projects = query(`SELECT PROJ_ID, PROJ_SHORT_NAME, PLAN_START_DATE, PLAN_END_DATE, SCD_END_DATE, LAST_RECALC_DATE, ADD_DATE, CREATE_DATE, UPDATE_DATE FROM PROJECT ${projectFilter}`)

    const tasks = query(`SELECT TASK_ID, PROJ_ID, WBS_ID, TASK_CODE, TASK_NAME, STATUS_CODE, TASK_TYPE, DURATION_TYPE, PHYS_COMPLETE_PCT, COMPLETE_PCT_TYPE, TARGET_START_DATE, TARGET_END_DATE, ACT_START_DATE, ACT_END_DATE, EARLY_START_DATE, EARLY_END_DATE, LATE_START_DATE, LATE_END_DATE, REMAIN_DRTN_HR_CNT, TARGET_DRTN_HR_CNT, TOTAL_FLOAT_HR_CNT, FREE_FLOAT_HR_CNT, ACT_WORK_QTY, REMAIN_WORK_QTY, TARGET_WORK_QTY, DRIVING_PATH_FLAG, UPDATE_DATE FROM TASK ${taskFilter}`)

    const evmSummary = query(`SELECT WBS_ID, PROJ_ID, BCWP, BCWS, ETC, ACT_WORK_COST, REMAIN_WORK_COST, ACT_EXPENSE_COST, REMAIN_EXPENSE_COST, COMPLETE_CNT, ACTIVE_CNT, NOTSTARTED_CNT, TOTAL_DRTN_HR_CNT, REMAIN_DRTN_HR_CNT, ACT_START_DATE, ACT_END_DATE, BASE_START_DATE, BASE_END_DATE, UPDATE_DATE FROM SUMTASK ${taskFilter}`)

    const wbs = query(`SELECT WBS_ID, PROJ_ID, PARENT_WBS_ID, WBS_SHORT_NAME, WBS_NAME, STATUS_CODE, ORIG_COST, SEQ_NUM, UPDATE_DATE FROM PROJWBS ${taskFilter}`)

    const resources = query(`SELECT RSRC_ID, RSRC_NAME, RSRC_SHORT_NAME, RSRC_TYPE, ACTIVE_FLAG, UPDATE_DATE FROM RSRC`)

    const taskResources = query(`SELECT TASKRSRC_ID, TASK_ID, PROJ_ID, RSRC_ID, TARGET_COST, ACT_REG_COST, ACT_OT_COST, REMAIN_COST, TARGET_QTY, ACT_REG_QTY, REMAIN_QTY, ACT_START_DATE, ACT_END_DATE, TARGET_START_DATE, TARGET_END_DATE, UPDATE_DATE FROM TASKRSRC ${taskFilter}`)

    const predecessors = query(`SELECT TASK_PRED_ID, TASK_ID, PRED_TASK_ID, PROJ_ID, PRED_TYPE, LAG_HR_CNT, UPDATE_DATE FROM TASKPRED ${taskFilter}`)

    db.close()
    return { projects, tasks, wbs, resources, taskResources, predecessors, evmSummary }
  }

  async loadProjects() {
    const SQL = await initSqlJs()
    const fileBuffer = fs.readFileSync(this.config.dbPath)
    const db = new SQL.Database(fileBuffer)
    const stmt = db.prepare(`SELECT PROJ_ID, PROJ_SHORT_NAME FROM PROJECT WHERE PROJECT_FLAG = 'Y' ORDER BY PROJ_SHORT_NAME`)
    const rows = []
    while (stmt.step()) {
      rows.push(stmt.getAsObject())
    }
    stmt.free()
    db.close()
    return rows
  }

  encrypt(data) {
    const key = this.config.licenseKey
    const json = JSON.stringify(data)
    return CryptoJS.AES.encrypt(json, key).toString()
  }

  async sync() {
    try {
      this.setStatus('syncing', 'Reading P6 database...')
      const data = await this.readDatabase()
      this.setStatus('syncing', 'Encrypting data...')
      const encrypted = this.encrypt(data)
      this.setStatus('syncing', 'Sending to server...')

      const payload = {
        licenseKey: this.config.licenseKey,
        encryptedData: encrypted,
        syncedAt: new Date().toISOString(),
        meta: {
          projectCount: data.projects.length,
          taskCount: data.tasks.length,
          resourceCount: data.resources.length
        }
      }

      await axios.post(
        `${this.config.backendUrl}/api/agent/sync`,
        payload,
        { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
      )

      this.setStatus('success', `Synced ${data.tasks.length} activities from ${data.projects.length} projects`)
      return { success: true, meta: payload.meta }

    } catch (err) {
      const message = err.response?.data?.message || err.message || 'Unknown error'
      this.setStatus('error', `Sync failed: ${message}`)
      return { success: false, error: message }
    }
  }
}

module.exports = SyncEngine