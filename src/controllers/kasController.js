// Controller untuk transaksi kas — mencatat pemasukan dan pengeluaran beserta jurnal akuntansi
// Endpoint: GET /getAll, GET /getOne/:id, POST /create, PUT /update/:id, DELETE /remove/:id
const { tenantQuery, tenantExecute, getConnection, getTenantContext } = require('../config/db');
const { generateKodeKas } = require('../lib/kodetrans');
const logger = require('../lib/logger');

// GET — Mendapatkan daftar transaksi kas dengan filter pencarian kode
exports.getAll = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { search } = req.query;
    let sql = 'SELECT k.* FROM kas k WHERE 1=1';
    const params = [];
    sql += ' AND k.idlokasi = ?'; params.push(ctx.idlokasi);
    if (search) { sql += ' AND k.kodekas LIKE ?'; params.push(`%${search}%`); }
    sql += ' ORDER BY k.idkas DESC';
    const rows = await tenantQuery(sql, params);
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET — Mendapatkan detail satu transaksi kas beserta rincian akun dan jurnalnya
exports.getOne = async (req, res) => {
  try {
    const ctx = getTenantContext();
    let sql = 'SELECT k.* FROM kas k WHERE k.idkas = ? AND k.idlokasi = ?';
    const rows = await tenantQuery(sql, [req.params.id, ctx.idlokasi]);
    if (rows.length === 0) return res.status(404).json({ message: 'Kas tidak ditemukan' });

    let sql2 = 'SELECT kd.*, a.kodeakun, a.namaakun FROM kasdtl kd JOIN akun a ON kd.idakun = a.idakun AND a.idtenant = kd.idtenant WHERE kd.idkas = ?';
    const details = await tenantQuery(sql2,
      [req.params.id]
    );

    res.json({ ...rows[0], details });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// POST — Membuat transaksi kas baru. Menyimpan header, detail akun, dan entri jurnal akuntansi.
exports.create = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const { details } = req.body;

    // Generate kode kas unik
    const kodekas = await generateKodeKas(conn, ctx.idtenant, ctx.idlokasi);
    const tgltrans = new Date().toISOString().slice(0, 10);

    // Insert header kas
    let sql = 'INSERT INTO kas (idtenant, idlokasi, kodekas, tgltrans, iduser, status, userentry) VALUES (?, ?, ?, ?, ?, ?, ?)';
    const [result] = await conn.query(sql,
      [ctx.idtenant, ctx.idlokasi, kodekas, tgltrans, ctx.iduser, 'AKTIF', ctx.iduser]
    );
    // ID kas dari auto-increment
    const idkas = result.insertId;

    for (const d of details) {
      // Insert detail per akun
      let sql2 = 'INSERT INTO kasdtl (idkas, idtenant, idakun, catatan, amount) VALUES (?, ?, ?, ?, ?)';
      await conn.query(sql2,
        [idkas, ctx.idtenant, d.idakun, d.catatan || '', d.amount]
      );

      // Tentukan posisi jurnal: akun KAS selalu DEBET, akun lain lihat tanda amount (>= 0 → DEBET, < 0 → KREDIT)
      let sql3 = 'SELECT namaakun FROM akun WHERE idakun = ? AND idtenant = ?';
      const [[akun]] = await conn.query(sql3, [d.idakun, ctx.idtenant]);
      const posisi = akun && akun.namaakun === 'KAS' ? 'DEBET' : (d.amount >= 0 ? 'DEBET' : 'KREDIT');

      // Insert entri jurnal dengan amount absolut
      let sql4 = 'INSERT INTO jurnal (idtenant, idlokasi, idtrans, kodetrans, jenis, tgltrans, idakun, posisi, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';
      await conn.query(sql4,
        [ctx.idtenant, ctx.idlokasi, idkas, kodekas, 'kas', tgltrans, d.idakun, posisi, Math.abs(d.amount)]
      );
    }

    await conn.commit();
    await logger.history('KAS_CREATE', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: kodekas, req });
    res.status(201).json({ message: 'Kas berhasil ditambah', idkas, kodekas });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// PUT — Memperbarui transaksi kas: menghapus jurnal & detail lama, lalu menyimpan ulang
exports.update = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const { details } = req.body;
    const { id } = req.params;

    let sql = 'SELECT * FROM kas WHERE idkas = ? AND idtenant = ? AND idlokasi = ?';
    const [rows] = await conn.query(sql, [id, ctx.idtenant, ctx.idlokasi]);
    if (rows.length === 0) return res.status(404).json({ message: 'Kas tidak ditemukan' });

    // Hapus jurnal dan detail lama sebelum insert ulang
    let sql2 = "DELETE FROM jurnal WHERE jenis = ? AND idtrans = ? AND idtenant = ? AND idlokasi = ?";
    await conn.query(sql2, ['kas', id, ctx.idtenant, ctx.idlokasi]);
    let sql3 = 'DELETE FROM kasdtl WHERE idkas = ? AND idtenant = ?';
    await conn.query(sql3, [id, ctx.idtenant]);

    for (const d of details) {
      let sql4 = 'INSERT INTO kasdtl (idkas, idtenant, idakun, catatan, amount) VALUES (?, ?, ?, ?, ?)';
      await conn.query(sql4,
        [id, ctx.idtenant, d.idakun, d.catatan || '', d.amount]
      );

      let sql5 = 'SELECT namaakun FROM akun WHERE idakun = ? AND idtenant = ?';
      const [[akun]] = await conn.query(sql5, [d.idakun, ctx.idtenant]);
      const posisi = akun && akun.namaakun === 'KAS' ? 'DEBET' : (d.amount >= 0 ? 'DEBET' : 'KREDIT');

      let sql6 = 'INSERT INTO jurnal (idtenant, idlokasi, idtrans, kodetrans, jenis, tgltrans, idakun, posisi, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';
      await conn.query(sql6,
        [ctx.idtenant, ctx.idlokasi, id, rows[0].kodekas, 'kas', rows[0].tgltrans, d.idakun, posisi, Math.abs(d.amount)]
      );
    }

    await conn.commit();
    await logger.history('KAS_UPDATE', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: rows[0].kodekas, req });
    res.json({ message: 'Kas berhasil diupdate' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// DELETE — Menghapus transaksi kas beserta jurnal dan detailnya secara langsung (hard delete)
exports.remove = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    let sql = "DELETE FROM jurnal WHERE jenis = ? AND idtrans = ? AND idtenant = ? AND idlokasi = ?";
    await conn.query(sql, ['kas', req.params.id, ctx.idtenant, ctx.idlokasi]);
    let sql2 = 'DELETE FROM kas WHERE idkas = ? AND idtenant = ? AND idlokasi = ?';
    await conn.query(sql2, [req.params.id, ctx.idtenant, ctx.idlokasi]);
    await logger.history('KAS_DELETE', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: String(req.params.id), req });
    res.json({ message: 'Kas berhasil dihapus' });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};
