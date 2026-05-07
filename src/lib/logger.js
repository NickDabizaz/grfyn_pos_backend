const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

const LOG_DIR = path.join(__dirname, '..', '..', 'logs');

function getLogFilePath(date) {
  const d = date || new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return path.join(LOG_DIR, `error-${y}-${m}-${day}.json`);
}

function cleanOldLogs(retentionDays = 30) {
  if (!fs.existsSync(LOG_DIR)) return;
  const files = fs.readdirSync(LOG_DIR);
  const now = new Date();
  let deleted = 0;
  for (const f of files) {
    const match = f.match(/^error-(\d{4})-(\d{2})-(\d{2})\.json$/);
    if (!match) continue;
    const fileDate = new Date(`${match[1]}-${match[2]}-${match[3]}`);
    const diffDays = Math.floor((now - fileDate) / (1000 * 60 * 60 * 24));
    if (diffDays > retentionDays) {
      try {
        fs.unlinkSync(path.join(LOG_DIR, f));
        deleted++;
      } catch (_) {}
    }
  }
  if (deleted > 0) console.log(`[logger] Cleaned ${deleted} old log files`);
}

async function error(err, context = {}) {
  const { req, idtenant, iduser, path: reqPath, method } = context;

  const entry = {
    ts: new Date().toISOString(),
    level: 'error',
    message: err?.message || String(err),
    stack: err?.stack || null,
    idtenant: idtenant || null,
    iduser: iduser || null,
    path: reqPath || req?.originalUrl || req?.url || null,
    method: method || req?.method || null
  };

  try {
    const filePath = getLogFilePath();
    fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8');
  } catch (writeErr) {
    console.error('[logger] Failed to write error log:', writeErr.message);
  }
}

async function history(action, context = {}) {
  const { idtenant, idlokasi, iduser, ref, detail, req } = context;

  const ip = req?.ip || req?.socket?.remoteAddress || null;
  const useragent = req?.headers?.['user-agent'] || null;

  try {
    await pool.query(
      `INSERT INTO historyprogram (idtenant, idlokasi, iduser, action, ref, detail, ip, useragent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        idtenant || null,
        idlokasi || null,
        iduser || null,
        action,
        ref || null,
        detail ? JSON.stringify(detail) : null,
        ip,
        useragent ? useragent.substring(0, 255) : null
      ]
    );
  } catch (dbErr) {
    console.error('[logger] Failed to write history:', dbErr.message);
  }
}

module.exports = { error, history, cleanOldLogs };
