const { tenantQuery, tenantExecute, getConnection, getTenantContext } = require('../../config/db');
const logger = require('../../lib/logger');

const DEFAULTS = {
  nominal_per_poin: 10000,
  nilai_tukar_poin: 1000,
  min_poin_tukar: 10,
  max_poin_per_transaksi: null,
  status: 'AKTIF',
};

exports.getSetting = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const rows = await tenantQuery('SELECT * FROM poin_setting WHERE idtenant = ?', [ctx.idtenant]);
    res.json(rows[0] || { idtenant: ctx.idtenant, ...DEFAULTS });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

exports.saveSetting = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { nominal_per_poin, nilai_tukar_poin, min_poin_tukar, max_poin_per_transaksi } = req.body;

    if (nominal_per_poin <= 0 || nilai_tukar_poin <= 0 || min_poin_tukar <= 0) {
      return res.status(400).json({ message: 'nominal_per_poin, nilai_tukar_poin, dan min_poin_tukar harus lebih dari 0' });
    }
    if (max_poin_per_transaksi !== undefined && max_poin_per_transaksi !== null && max_poin_per_transaksi <= 0) {
      return res.status(400).json({ message: 'max_poin_per_transaksi harus lebih dari 0 jika diisi' });
    }

    const sql = `INSERT INTO poin_setting (idtenant, nominal_per_poin, nilai_tukar_poin, min_poin_tukar, max_poin_per_transaksi)
                 VALUES (?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                   nominal_per_poin = VALUES(nominal_per_poin),
                   nilai_tukar_poin = VALUES(nilai_tukar_poin),
                   min_poin_tukar = VALUES(min_poin_tukar),
                   max_poin_per_transaksi = VALUES(max_poin_per_transaksi)`;
    await tenantExecute(sql, [ctx.idtenant, nominal_per_poin, nilai_tukar_poin, min_poin_tukar, max_poin_per_transaksi ?? null]);
    res.json({ message: 'Setting poin berhasil disimpan' });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

exports.getCustomerPoin = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { idcustomer } = req.params;

    const custRows = await tenantQuery('SELECT idcustomer, namacustomer, kodecustomer FROM customer WHERE idcustomer = ?', [idcustomer]);
    if (!custRows.length) return res.status(404).json({ message: 'Customer tidak ditemukan' });

    const poinRows = await tenantQuery('SELECT total_poin FROM poin_customer WHERE idcustomer = ? AND idtenant = ?', [idcustomer, ctx.idtenant]);
    const total_poin = poinRows.length ? poinRows[0].total_poin : 0;

    const history = await tenantQuery(
      `SELECT idpointegon, idref, koderef, jenisref, poin, jenis, tgltrans, keterangan, tglentry
       FROM poin_transaksi
       WHERE idcustomer = ? AND idtenant = ?
       ORDER BY idpointegon DESC`,
      [idcustomer, ctx.idtenant]
    );

    res.json({ ...custRows[0], total_poin, history });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

exports.getAllCustomerPoin = async (req, res) => {
  try {
    const { search } = req.query;
    let sql = `SELECT c.idcustomer, c.kodecustomer, c.namacustomer, c.hp,
                      COALESCE(pc.total_poin, 0) AS total_poin
               FROM customer c
               LEFT JOIN poin_customer pc ON pc.idcustomer = c.idcustomer AND pc.idtenant = c.idtenant
               WHERE 1=1`;
    const params = [];
    if (search) {
      sql += ' AND (c.namacustomer LIKE ? OR c.kodecustomer LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    sql += ' ORDER BY c.namacustomer ASC';
    const rows = await tenantQuery(sql, params);
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

exports.addPoin = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    const { idcustomer, poin, jenis, keterangan, idref, koderef, jenisref } = req.body;

    if (!idcustomer || !poin || poin <= 0) {
      return res.status(400).json({ message: 'idcustomer dan poin (> 0) wajib diisi' });
    }
    if (!['MASUK', 'KELUAR'].includes(jenis)) {
      return res.status(400).json({ message: 'jenis harus MASUK atau KELUAR' });
    }

    const [[cust]] = await conn.query('SELECT idcustomer FROM customer WHERE idcustomer = ? AND idtenant = ?', [idcustomer, ctx.idtenant]);
    if (!cust) return res.status(404).json({ message: 'Customer tidak ditemukan' });

    await conn.beginTransaction();

    if (jenis === 'KELUAR') {
      const [[pc]] = await conn.query('SELECT total_poin FROM poin_customer WHERE idcustomer = ? AND idtenant = ?', [idcustomer, ctx.idtenant]);
      const current = pc ? pc.total_poin : 0;
      if (current < poin) {
        await conn.rollback();
        return res.status(400).json({ message: `Poin tidak cukup. Poin tersedia: ${current}` });
      }
    }

    const upsertSql = `INSERT INTO poin_customer (idtenant, idcustomer, total_poin)
                       VALUES (?, ?, ?)
                       ON DUPLICATE KEY UPDATE total_poin = total_poin + VALUES(total_poin)`;
    const delta = jenis === 'MASUK' ? poin : -poin;
    await conn.query(upsertSql, [ctx.idtenant, idcustomer, delta]);

    const tgltrans = new Date().toISOString().slice(0, 10);
    await conn.query(
      `INSERT INTO poin_transaksi (idtenant, idcustomer, idref, koderef, jenisref, poin, jenis, tgltrans, keterangan)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ctx.idtenant, idcustomer, idref || null, koderef || null, jenisref || null, poin, jenis, tgltrans, keterangan || null]
    );

    await conn.commit();
    res.json({ message: `Poin berhasil di${jenis === 'MASUK' ? 'tambah' : 'kurang'}`, poin, jenis });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.tukarPoin = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { idcustomer, poin } = req.body;

    if (!idcustomer || !poin || poin <= 0) {
      return res.status(400).json({ message: 'idcustomer dan poin (> 0) wajib diisi' });
    }

    const settingRows = await tenantQuery('SELECT * FROM poin_setting WHERE idtenant = ?', [ctx.idtenant]);
    const setting = settingRows[0] || DEFAULTS;

    if (poin < setting.min_poin_tukar) {
      return res.status(400).json({ message: `Minimal penukaran ${setting.min_poin_tukar} poin` });
    }

    const poinRows = await tenantQuery('SELECT total_poin FROM poin_customer WHERE idcustomer = ? AND idtenant = ?', [idcustomer, ctx.idtenant]);
    const total_poin = poinRows.length ? poinRows[0].total_poin : 0;

    if (total_poin < poin) {
      return res.status(400).json({ message: `Poin tidak cukup. Poin tersedia: ${total_poin}` });
    }

    const nilai_tukar = poin * parseFloat(setting.nilai_tukar_poin);
    res.json({ poin, nilai_tukar, nilai_tukar_poin: setting.nilai_tukar_poin });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

exports.prosesSetelahJual = async (idtenant, idcustomer, idjual, koderef, grandtotal, conn) => {
  try {
    if (!idcustomer || !grandtotal || grandtotal <= 0) return 0;

    const [[setting]] = await conn.query('SELECT * FROM poin_setting WHERE idtenant = ?', [idtenant]);
    if (!setting || setting.status !== 'AKTIF') return 0;

    const nominalPerPoin = parseFloat(setting.nominal_per_poin);
    if (!nominalPerPoin || nominalPerPoin <= 0) return 0;

    let poinDidapat = Math.floor(grandtotal / nominalPerPoin);
    if (poinDidapat <= 0) return 0;

    if (setting.max_poin_per_transaksi !== null && poinDidapat > setting.max_poin_per_transaksi) {
      poinDidapat = setting.max_poin_per_transaksi;
    }

    await conn.query(
      `INSERT INTO poin_customer (idtenant, idcustomer, total_poin)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE total_poin = total_poin + VALUES(total_poin)`,
      [idtenant, idcustomer, poinDidapat]
    );

    const tgltrans = new Date().toISOString().slice(0, 10);
    await conn.query(
      `INSERT INTO poin_transaksi (idtenant, idcustomer, idref, koderef, jenisref, poin, jenis, tgltrans, keterangan)
       VALUES (?, ?, ?, ?, ?, ?, 'MASUK', ?, ?)`,
      [idtenant, idcustomer, idjual, koderef, 'JUAL', poinDidapat, tgltrans, `Poin dari transaksi ${koderef}`]
    );

    return poinDidapat;
  } catch (err) {
    logger.error(err);
    return 0;
  }
};
