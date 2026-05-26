const { tenantQuery, getConnection, getTenantContext } = require('../../config/db');
const logger = require('../../lib/logger');

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

exports.getAll = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { idbarang, show_expired } = req.query;
    const today = todayStr();
    let sql = `SELECT bl.*, b.namabarang, b.kodebarang, b.satuankecil,
        DATEDIFF(bl.tglkadaluarsa, ?) as days_to_expire
      FROM batch_lot bl
      LEFT JOIN barang b ON bl.idbarang = b.idbarang AND b.idtenant = bl.idtenant
      WHERE bl.idlokasi = ? AND bl.status = 'AKTIF'`;
    const params = [today, ctx.idlokasi];
    if (idbarang) { sql += ' AND bl.idbarang = ?'; params.push(idbarang); }
    if (!show_expired || show_expired === 'false') {
      sql += ' AND (bl.tglkadaluarsa IS NULL OR bl.tglkadaluarsa >= ?)';
      params.push(today);
    }
    sql += ' ORDER BY bl.tglkadaluarsa ASC, bl.idbarang';
    const rows = await tenantQuery(sql, params);
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

exports.getOne = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const today = todayStr();
    const rows = await tenantQuery(
      `SELECT bl.*, b.namabarang, b.kodebarang, DATEDIFF(bl.tglkadaluarsa, ?) as days_to_expire
       FROM batch_lot bl LEFT JOIN barang b ON bl.idbarang = b.idbarang AND b.idtenant = bl.idtenant
       WHERE bl.idbatch = ? AND bl.idlokasi = ?`,
      [today, req.params.id, ctx.idlokasi]
    );
    if (!rows.length) return res.status(404).json({ message: 'Batch/lot tidak ditemukan' });
    res.json(rows[0]);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

exports.create = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    const { idbarang, nomorbatch, tglproduksi, tglkadaluarsa, qty_masuk, satuan, koderef, jenisref, idref } = req.body;
    if (!idbarang || !nomorbatch || !qty_masuk) {
      return res.status(400).json({ message: 'idbarang, nomorbatch, qty_masuk wajib diisi' });
    }
    if (parseFloat(qty_masuk) <= 0) return res.status(400).json({ message: 'qty_masuk harus lebih dari 0' });

    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO batch_lot (idtenant, idbarang, idlokasi, nomorbatch, tglproduksi, tglkadaluarsa, qty_masuk, qty_keluar, qty_sisa, satuan, idref, koderef, jenisref, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 'AKTIF')`,
      [ctx.idtenant, idbarang, ctx.idlokasi, nomorbatch, tglproduksi || null, tglkadaluarsa || null,
       qty_masuk, qty_masuk, satuan || null, idref || null, koderef || null, jenisref || null]
    );
    await conn.commit();
    res.status(201).json({ message: 'Batch/lot berhasil disimpan', idbatch: result.insertId });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ message: 'Nomor batch untuk barang dan lokasi ini sudah ada' });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.update = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    const { qty_masuk, tglkadaluarsa } = req.body;
    const [[row]] = await conn.query(
      'SELECT * FROM batch_lot WHERE idbatch = ? AND idtenant = ?',
      [req.params.id, ctx.idtenant]
    );
    if (!row) return res.status(404).json({ message: 'Batch/lot tidak ditemukan' });

    const newQtyMasuk = qty_masuk !== undefined ? parseFloat(qty_masuk) : parseFloat(row.qty_masuk);
    const newQtySisa = newQtyMasuk - parseFloat(row.qty_keluar);
    if (newQtySisa < 0) return res.status(400).json({ message: 'qty_masuk tidak bisa lebih kecil dari qty yang sudah keluar' });

    await conn.query(
      'UPDATE batch_lot SET qty_masuk = ?, qty_sisa = ?, tglkadaluarsa = ? WHERE idbatch = ?',
      [newQtyMasuk, newQtySisa, tglkadaluarsa !== undefined ? tglkadaluarsa : row.tglkadaluarsa, req.params.id]
    );
    res.json({ message: 'Batch/lot diperbarui' });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.getExpiringSoon = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const days = parseInt(req.query.days) || 30;
    const today = todayStr();
    const rows = await tenantQuery(
      `SELECT bl.*, b.namabarang, b.kodebarang, b.satuankecil,
        DATEDIFF(bl.tglkadaluarsa, ?) as days_to_expire
       FROM batch_lot bl
       LEFT JOIN barang b ON bl.idbarang = b.idbarang AND b.idtenant = bl.idtenant
       WHERE bl.idlokasi = ? AND bl.status = 'AKTIF' AND bl.tglkadaluarsa IS NOT NULL
         AND bl.tglkadaluarsa >= ? AND bl.tglkadaluarsa <= DATE_ADD(?, INTERVAL ? DAY)
         AND bl.qty_sisa > 0
       ORDER BY bl.tglkadaluarsa ASC`,
      [today, ctx.idlokasi, today, today, days]
    );
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

exports.getByBarang = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const today = todayStr();
    const rows = await tenantQuery(
      `SELECT bl.*, DATEDIFF(bl.tglkadaluarsa, ?) as days_to_expire
       FROM batch_lot bl
       WHERE bl.idbarang = ? AND bl.idlokasi = ? AND bl.status = 'AKTIF' AND bl.qty_sisa > 0
       ORDER BY bl.tglkadaluarsa ASC, bl.idbatch ASC`,
      [today, req.params.idbarang, ctx.idlokasi]
    );
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};
