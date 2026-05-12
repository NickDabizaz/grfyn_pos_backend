const { tenantQuery, getConnection, getTenantContext } = require('../config/db');
const { generateKodeMaster } = require('../lib/kodetrans');
const logger = require('../lib/logger');

// GET /karyawan
exports.getAll = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { status, search } = req.query;
    let sql = 'SELECT * FROM karyawan WHERE idtenant = ?';
    const params = [ctx.idtenant];
    if (status) { sql += ' AND status = ?'; params.push(status); }
    if (search) { sql += ' AND (namakaryawan LIKE ? OR kodekaryawan LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    sql += ' ORDER BY namakaryawan';
    const rows = await tenantQuery(sql, params);
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /karyawan/:id
exports.getOne = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const rows = await tenantQuery(
      'SELECT * FROM karyawan WHERE idkaryawan = ? AND idtenant = ?',
      [req.params.id, ctx.idtenant]
    );
    if (!rows.length) return res.status(404).json({ message: 'Karyawan tidak ditemukan' });
    res.json(rows[0]);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// POST /karyawan
exports.create = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();

    const { namakaryawan, jabatan, departemen, tgllahir, tglmasuk, gajipoko, norekening, namabank, hp, email, alamat } = req.body;
    if (!namakaryawan) return res.status(400).json({ message: 'namakaryawan wajib diisi' });

    const kodekaryawan = await generateKodeMaster(conn, 'KRY', ctx.idtenant, 'karyawan', 'kodekaryawan');

    const [result] = await conn.query(
      `INSERT INTO karyawan (idtenant, kodekaryawan, namakaryawan, jabatan, departemen, tgllahir, tglmasuk, gajipoko, norekening, namabank, hp, email, alamat, status, userentry, tglentry)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'AKTIF', ?, NOW())`,
      [ctx.idtenant, kodekaryawan, namakaryawan, jabatan || null, departemen || null, tgllahir || null, tglmasuk || null, gajipoko || 0, norekening || null, namabank || null, hp || null, email || null, alamat || null, ctx.iduser]
    );

    await conn.commit();
    await logger.history('KARYAWAN_CREATE', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: kodekaryawan, req });
    res.status(201).json({ message: 'Karyawan berhasil ditambah', idkaryawan: result.insertId, kodekaryawan });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// PUT /karyawan/:id
exports.update = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();

    const [[karyawan]] = await conn.query(
      'SELECT * FROM karyawan WHERE idkaryawan = ? AND idtenant = ?',
      [req.params.id, ctx.idtenant]
    );
    if (!karyawan) return res.status(404).json({ message: 'Karyawan tidak ditemukan' });

    const { namakaryawan, jabatan, departemen, tgllahir, tglmasuk, gajipoko, norekening, namabank, hp, email, alamat, status } = req.body;

    await conn.query(
      `UPDATE karyawan SET namakaryawan = ?, jabatan = ?, departemen = ?, tgllahir = ?, tglmasuk = ?,
       gajipoko = ?, norekening = ?, namabank = ?, hp = ?, email = ?, alamat = ?, status = ?
       WHERE idkaryawan = ? AND idtenant = ?`,
      [namakaryawan || karyawan.namakaryawan, jabatan || null, departemen || null, tgllahir || null, tglmasuk || null,
       gajipoko !== undefined ? gajipoko : karyawan.gajipoko, norekening || null, namabank || null, hp || null, email || null, alamat || null,
       status || karyawan.status, req.params.id, ctx.idtenant]
    );

    await conn.commit();
    await logger.history('KARYAWAN_UPDATE', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: karyawan.kodekaryawan, req });
    res.json({ message: 'Karyawan berhasil diupdate' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// DELETE /karyawan/:id (soft delete)
exports.remove = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();

    const [[karyawan]] = await conn.query(
      'SELECT * FROM karyawan WHERE idkaryawan = ? AND idtenant = ?',
      [req.params.id, ctx.idtenant]
    );
    if (!karyawan) return res.status(404).json({ message: 'Karyawan tidak ditemukan' });

    await conn.query(
      "UPDATE karyawan SET status = 'NONAKTIF' WHERE idkaryawan = ? AND idtenant = ?",
      [req.params.id, ctx.idtenant]
    );

    await conn.commit();
    await logger.history('KARYAWAN_DELETE', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: karyawan.kodekaryawan, req });
    res.json({ message: 'Karyawan berhasil dinonaktifkan' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// GET /karyawan/:id/komponen — List komponen gaji karyawan
exports.getKomponenGaji = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const rows = await tenantQuery(
      "SELECT * FROM komponengaji WHERE idkaryawan = ? AND idtenant = ? AND status = 'AKTIF' ORDER BY jenis, namakomponan",
      [req.params.id, ctx.idtenant]
    );
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// POST /karyawan/:id/komponen — Set/replace komponen gaji
exports.setKomponenGaji = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    const { items } = req.body;
    if (!items) return res.status(400).json({ message: 'items wajib diisi' });

    await conn.beginTransaction();

    // Hapus semua komponen lama lalu insert baru
    await conn.query(
      'DELETE FROM komponengaji WHERE idkaryawan = ? AND idtenant = ?',
      [req.params.id, ctx.idtenant]
    );

    for (const item of items) {
      await conn.query(
        `INSERT INTO komponengaji (idtenant, idkaryawan, namakomponan, jenis, amount, status)
         VALUES (?, ?, ?, ?, ?, 'AKTIF')`,
        [ctx.idtenant, req.params.id, item.namakomponan, item.jenis, item.amount || 0]
      );
    }

    await conn.commit();
    res.json({ message: 'Komponen gaji berhasil disimpan' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};
