const { pool, tenantQuery, getConnection, getTenantContext } = require('../config/db');
const { generateKodeShift } = require('../lib/kodetrans');
const logger = require('../lib/logger');

// GET /shift — Daftar shift dengan filter
exports.getAll = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tglwal, tglakhir, status, iduser } = req.query;
    let sql = `SELECT s.*, u.namauser FROM shift s
      LEFT JOIN user u ON s.iduser = u.iduser AND u.idtenant = s.idtenant
      WHERE s.idlokasi = ?`;
    const params = [ctx.idlokasi];
    if (tglwal) { sql += ' AND s.tglshift >= ?'; params.push(tglwal); }
    if (tglakhir) { sql += ' AND s.tglshift <= ?'; params.push(tglakhir); }
    if (status) { sql += ' AND s.status = ?'; params.push(status); }
    if (iduser) { sql += ' AND s.iduser = ?'; params.push(iduser); }
    sql += ' ORDER BY s.tglshift DESC, s.idshift DESC LIMIT 200';
    const rows = await tenantQuery(sql, params);
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /shift/aktif — Shift yang sedang BUKA untuk user+lokasi ini
exports.getAktif = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const rows = await tenantQuery(
      `SELECT s.*, u.namauser FROM shift s
       LEFT JOIN user u ON s.iduser = u.iduser AND u.idtenant = s.idtenant
       WHERE s.idlokasi = ? AND s.iduser = ? AND s.status = 'BUKA'
       ORDER BY s.tgl_buka DESC LIMIT 1`,
      [ctx.idlokasi, ctx.iduser]
    );
    if (!rows.length) return res.json(null);
    res.json(rows[0]);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /shift/:id — Detail shift + summary penjualan
exports.getOne = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const rows = await tenantQuery(
      `SELECT s.*, u.namauser FROM shift s
       LEFT JOIN user u ON s.iduser = u.iduser AND u.idtenant = s.idtenant
       WHERE s.idshift = ? AND s.idlokasi = ?`,
      [req.params.id, ctx.idlokasi]
    );
    if (!rows.length) return res.status(404).json({ message: 'Shift tidak ditemukan' });

    const shift = rows[0];
    const [[salesSummary]] = await pool.query(
      `SELECT COALESCE(SUM(grandtotal), 0) AS total_sales, COUNT(*) AS jumlah_transaksi
       FROM jual WHERE idtenant = ? AND idlokasi = ? AND tgltrans = ? AND status != 'VOID'`,
      [ctx.idtenant, ctx.idlokasi, shift.tglshift]
    );

    res.json({ ...shift, summary: salesSummary });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// POST /shift/buka — Buka shift baru
exports.buka = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    const { modal_awal, catatan } = req.body;

    // Cek tidak ada shift BUKA lain untuk lokasi ini
    const [[existing]] = await conn.query(
      "SELECT idshift FROM shift WHERE idtenant = ? AND idlokasi = ? AND status = 'BUKA'",
      [ctx.idtenant, ctx.idlokasi]
    );
    if (existing) return res.status(400).json({ message: 'Sudah ada shift yang sedang BUKA di lokasi ini' });

    const kodeshift = await generateKodeShift(conn, ctx.idtenant, ctx.idlokasi);
    const tglshift = new Date().toISOString().slice(0, 10);

    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO shift (idtenant, idlokasi, kodeshift, tglshift, iduser, modal_awal, catatan, status, tgl_buka, userentry, tglentry)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'BUKA', NOW(), ?, NOW())`,
      [ctx.idtenant, ctx.idlokasi, kodeshift, tglshift, ctx.iduser, modal_awal || 0, catatan || null, ctx.iduser]
    );
    const idshift = result.insertId;

    await conn.commit();
    await logger.history('SHIFT_BUKA', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: kodeshift, req });
    res.status(201).json({ message: 'Shift berhasil dibuka', kodeshift, idshift });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// PUT /shift/:id/tutup — Tutup shift
exports.tutup = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();

    const [[shift]] = await conn.query(
      'SELECT * FROM shift WHERE idshift = ? AND idtenant = ? AND idlokasi = ?',
      [req.params.id, ctx.idtenant, ctx.idlokasi]
    );
    if (!shift) return res.status(404).json({ message: 'Shift tidak ditemukan' });
    if (shift.status !== 'BUKA') return res.status(400).json({ message: 'Shift sudah ditutup' });

    const { kas_akhir, catatan } = req.body;

    // Hitung total_sales dari transaksi jual pada tglshift + lokasi
    const [[salesRow]] = await conn.query(
      `SELECT COALESCE(SUM(grandtotal), 0) AS total_sales
       FROM jual WHERE idtenant = ? AND idlokasi = ? AND tgltrans = ? AND status != 'VOID'`,
      [ctx.idtenant, ctx.idlokasi, shift.tglshift]
    );
    const totalSales = parseFloat(salesRow.total_sales);
    const kasAkhir = parseFloat(kas_akhir || 0);
    const selisih = kasAkhir - (parseFloat(shift.modal_awal) + totalSales);

    await conn.query(
      `UPDATE shift SET status = 'TUTUP', kas_akhir = ?, total_sales = ?, selisih = ?, catatan = ?, tgl_tutup = NOW()
       WHERE idshift = ? AND idtenant = ?`,
      [kasAkhir, totalSales, selisih, catatan || shift.catatan, req.params.id, ctx.idtenant]
    );

    await conn.commit();
    await logger.history('SHIFT_TUTUP', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: shift.kodeshift, detail: { total_sales: totalSales, selisih }, req });
    res.json({ message: 'Shift berhasil ditutup', total_sales: totalSales, kas_akhir: kasAkhir, selisih });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};
