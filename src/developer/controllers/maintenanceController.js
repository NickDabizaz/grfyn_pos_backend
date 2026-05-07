const fs = require('fs');
const path = require('path');
const { pool } = require('../../config/db');

const LOG_DIR = path.join(__dirname, '..', '..', '..', 'logs');

exports.index = async (req, res) => {
  try {
    const logFiles = [];
    if (fs.existsSync(LOG_DIR)) {
      const files = fs.readdirSync(LOG_DIR)
        .filter(f => f.endsWith('.json'))
        .sort()
        .reverse();
      for (const f of files) {
        const stat = fs.statSync(path.join(LOG_DIR, f));
        logFiles.push({
          name: f,
          size: Math.round(stat.size / 1024 * 10) / 10,
          modified: stat.mtime.toISOString()
        });
      }
    }

    const [poolVars] = await pool.query("SHOW VARIABLES LIKE 'max_connections'");
    const [poolStatus] = await pool.query(
      "SHOW STATUS WHERE Variable_name IN ('Threads_connected', 'Threads_running', 'Threads_created', 'Connections')"
    );
    const statusMap = {};
    for (const s of poolStatus) {
      statusMap[s.Variable_name] = s.Value;
    }

    const safeKeys = [
      'DB_HOST', 'DB_NAME', 'DB_PORT', 'PORT', 'NODE_ENV',
      'DEVELOPER_PORTAL_ENABLED'
    ];

    const envVars = {};
    for (const key of safeKeys) {
      if (process.env[key] !== undefined) {
        envVars[key] = process.env[key];
      }
    }

    res.render('layout', { view: 'maintenance', 
      title: 'Maintenance',
      active: 'maintenance',
      logFiles,
      poolInfo: {
        maxConnections: poolVars[0]?.Value || 0,
        threadsConnected: statusMap['Threads_connected'] || 0,
        threadsRunning: statusMap['Threads_running'] || 0,
        threadsCreated: statusMap['Threads_created'] || 0,
        totalConnections: statusMap['Connections'] || 0
      },
      envVars,
      success: req.query.success || null,
      error: null
    });
  } catch (err) {
    res.render('layout', { view: 'maintenance', 
      title: 'Maintenance',
      active: 'maintenance',
      logFiles: [],
      poolInfo: { maxConnections: 0, threadsConnected: 0, threadsRunning: 0, threadsCreated: 0, totalConnections: 0 },
      envVars: {},
      success: null,
      error: err.message
    });
  }
};

exports.clearOldLogs = (req, res) => {
  try {
    let deleted = 0;
    if (fs.existsSync(LOG_DIR)) {
      const files = fs.readdirSync(LOG_DIR);
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        fs.unlinkSync(path.join(LOG_DIR, f));
        deleted++;
      }
    }
    res.redirect('/developer/maintenance?success=' + deleted + '+file+log+berhasil+dihapus');
  } catch (err) {
    res.redirect('/developer/maintenance?error=' + encodeURIComponent(err.message));
  }
};
