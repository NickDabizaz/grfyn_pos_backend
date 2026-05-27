const { pool } = require('../../config/db');
const os = require('os');

exports.index = async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);

    const [[errorCount]] = await pool.query(
      "SELECT COUNT(*) as cnt FROM historyprogram WHERE aksi = 'ERROR' AND DATE(tglentry) = ?",
      [today]
    );

    const [recentHistory] = await pool.query(
      `SELECT * FROM historyprogram
       WHERE aksi IN ('SIMPAN', 'EDIT', 'HAPUS', 'BATAL', 'APPROVE', 'BATAL APPROVE')
          OR jenistransaksi = 'REGISTER'
          OR jenistransaksi = 'IMPORT'
          OR jenistransaksi LIKE 'IMPORT\\_%'
          OR jenistransaksi = 'SUBSCRIPTION'
          OR jenistransaksi LIKE 'SUBSCRIPTION\\_%'
          OR jenistransaksi LIKE '%SUBSCRIPTION%'
          OR jenistransaksi = 'BT'
          OR jenistransaksi LIKE 'BT\\_%'
       ORDER BY tglentry DESC LIMIT 10`
    );

    const [[dbStatus]] = await pool.query('SELECT 1 as ok');
    const dbOk = !!dbStatus;

    const [[poolStats]] = await pool.query(
      "SHOW STATUS LIKE 'Threads_connected'"
    );

    const uptime = os.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const processUptime = process.uptime();
    const pHours = Math.floor(processUptime / 3600);
    const pMinutes = Math.floor((processUptime % 3600) / 60);

    res.render('layout', {
      title: 'Dashboard',
      active: 'dashboard',
      view: 'dashboard',
      stats: {
        errorsToday: errorCount?.cnt || 0,
        historyToday: recentHistory.length,
        dbStatus: dbOk ? 'Connected' : 'Disconnected',
        dbConnections: poolStats?.Value || 0,
        osUptime: `${hours}h ${minutes}m`,
        processUptime: `${pHours}h ${pMinutes}m`,
        nodeVersion: process.version,
        platform: os.platform(),
        totalMem: Math.round(os.totalmem() / 1024 / 1024 / 1024 * 10) / 10,
        freeMem: Math.round(os.freemem() / 1024 / 1024 / 1024 * 10) / 10
      },
      recentHistory
    });
  } catch (err) {
    res.render('layout', {
      title: 'Dashboard',
      active: 'dashboard',
      view: 'dashboard',
      stats: { errorsToday: 0, historyToday: 0, dbStatus: 'Error', dbConnections: 0, osUptime: 'N/A', processUptime: 'N/A', nodeVersion: process.version, platform: os.platform(), totalMem: 0, freeMem: 0 },
      recentHistory: [],
      error: err.message
    });
  }
};
