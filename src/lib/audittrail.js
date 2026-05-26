const { pool } = require('../config/db');
const logger = require('./logger');

async function logAudit(conn, { idtenant, idlokasi, iduser, tabel, idref, aksi, dataLama, dataBaru }) {
  try {
    const db = conn || pool;
    await db.query(
      `INSERT INTO audit_trail (idtenant, idlokasi, iduser, tabel, idref, aksi, data_lama, data_baru)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        idtenant,
        idlokasi || null,
        iduser || null,
        tabel,
        idref,
        aksi,
        dataLama ? JSON.stringify(dataLama) : null,
        dataBaru ? JSON.stringify(dataBaru) : null,
      ]
    );
  } catch (err) {
    logger.error(err, { context: 'audittrail' });
  }
}

module.exports = { logAudit };
