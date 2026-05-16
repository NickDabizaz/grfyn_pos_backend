const { tenantQuery, getConnection, getTenantContext } = require('../../config/db');
const { generateKodeSO } = require('../../lib/kodetrans');
const logger = require('../../lib/logger');

function shouldApprove(req) {
  return req.body.approve === true || req.body.status === 'APPROVED';
}

// GET /sales-order — Daftar SO dengan filter
exports.getAll = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tglwal, tglakhir, status, idcustomer, idlokasi, available, search } = req.query;
    let sql = `SELECT so.*, DATE_FORMAT(so.tgltrans, '%Y-%m-%d') AS tgltrans, c.namacustomer FROM salesorder so
      LEFT JOIN customer c ON so.idcustomer = c.idcustomer AND c.idtenant = so.idtenant
      WHERE so.idtenant = ?`;
    const params = [ctx.idtenant];
    if (available === '1' || available == 1) {
      sql += ` AND so.status = 'APPROVED' AND NOT EXISTS (
        SELECT 1 FROM bpk WHERE bpk.idso = so.idso AND bpk.status != 'CANCELLED' AND bpk.idtenant = so.idtenant
      )`;
    }
    if (idlokasi) { sql += ' AND so.idlokasi = ?'; params.push(idlokasi); }
    if (tglwal) { sql += ' AND so.tgltrans >= ?'; params.push(tglwal); }
    if (tglakhir) { sql += ' AND so.tgltrans <= ?'; params.push(tglakhir); }
    if (status) { sql += ' AND so.status = ?'; params.push(status); }
    if (idcustomer) { sql += ' AND so.idcustomer = ?'; params.push(idcustomer); }
    if (search) { sql += ' AND (so.kodeso LIKE ? OR c.namacustomer LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    sql += ' ORDER BY so.tgltrans DESC, so.idso DESC LIMIT 200';
    const rows = await tenantQuery(sql, params);
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /sales-order/:id — Detail SO + items
exports.getOne = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const rows = await tenantQuery(
      `SELECT so.*, DATE_FORMAT(so.tgltrans, '%Y-%m-%d') AS tgltrans,
              c.namacustomer, c.kodecustomer, c.alamat AS calamat, c.hp AS chp,
              l.namalokasi, l.kodelokasi
       FROM salesorder so
       LEFT JOIN customer c ON so.idcustomer = c.idcustomer AND c.idtenant = so.idtenant
       LEFT JOIN lokasi l ON so.idlokasi = l.idlokasi AND l.idtenant = so.idtenant
       WHERE so.idso = ? AND so.idtenant = ?`,
      [req.params.id, ctx.idtenant]
    );
    if (!rows.length) return res.status(404).json({ message: 'Sales order tidak ditemukan' });

    const items = await tenantQuery(
      `SELECT sod.*, b.namabarang, b.kodebarang, b.satuanbesar, b.satuansedang, b.satuankecil, b.konversi1, b.konversi2
       FROM salesorderdtl sod
       LEFT JOIN barang b ON sod.idbarang = b.idbarang AND b.idtenant = sod.idtenant
       WHERE sod.idso = ?`,
      [req.params.id]
    );
    res.json({ ...rows[0], items });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// POST /sales-order — Buat SO DRAFT
exports.create = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    const { idcustomer, idlokasi, tgltrans, items, catatan } = req.body;

    if (!items || !items.length) return res.status(400).json({ message: 'Items tidak boleh kosong' });
    if (!idlokasi) return res.status(400).json({ message: 'Lokasi wajib dipilih' });

    const kodeso = await generateKodeSO(conn, ctx.idtenant, idlokasi);
    const tgl = tgltrans || new Date().toISOString().slice(0, 10);
    const status = shouldApprove(req) ? 'APPROVED' : 'DRAFT';

    await conn.beginTransaction();

    let grandtotal = 0;
    const [headerResult] = await conn.query(
      `INSERT INTO salesorder (idtenant, idlokasi, kodeso, tgltrans, idcustomer, iduser, grandtotal, catatan, status, userentry, tglentry)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, NOW())`,
      [ctx.idtenant, idlokasi, kodeso, tgl, idcustomer || null, ctx.iduser, catatan || null, status, ctx.iduser]
    );
    const idso = headerResult.insertId;

    for (const item of items) {
      const subtotal = parseFloat(item.harga || 0) * parseFloat(item.jml);
      grandtotal += subtotal;
      await conn.query(
        `INSERT INTO salesorderdtl (idso, idtenant, idbarang, jml, jml_dikirim, satuan, harga, subtotal)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
        [idso, ctx.idtenant, item.idbarang, item.jml, item.satuan || null, item.harga || 0, subtotal]
      );
    }

    await conn.query('UPDATE salesorder SET grandtotal = ? WHERE idso = ?', [grandtotal, idso]);

    await conn.commit();
    await logger.history('SO_CREATE', { idtenant: ctx.idtenant, idlokasi, iduser: ctx.iduser, ref: kodeso, req });
    res.status(201).json({ message: 'Sales order berhasil dibuat', kodeso, idso, grandtotal, status });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// PUT /sales-order/:id — Update SO (hanya DRAFT)
exports.update = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    const { id } = req.params;
    const { idcustomer, idlokasi, tgltrans, items, catatan } = req.body;

    if (!items || !items.length) return res.status(400).json({ message: 'Items tidak boleh kosong' });
    if (!idlokasi) return res.status(400).json({ message: 'Lokasi wajib dipilih' });

    await conn.beginTransaction();

    const [[so]] = await conn.query(
      'SELECT * FROM salesorder WHERE idso = ? AND idtenant = ?',
      [id, ctx.idtenant]
    );
    if (!so) {
      const err = new Error('Sales order tidak ditemukan');
      err.statusCode = 404;
      throw err;
    }
    if (so.status !== 'DRAFT') {
      const err = new Error('Hanya SO DRAFT yang bisa diedit');
      err.statusCode = 400;
      throw err;
    }

    const tgl = tgltrans || String(so.tgltrans).slice(0, 10);
    const status = shouldApprove(req) ? 'APPROVED' : 'DRAFT';

    await conn.query('DELETE FROM salesorderdtl WHERE idso = ? AND idtenant = ?', [id, ctx.idtenant]);
    await conn.query(
      'UPDATE salesorder SET idlokasi = ?, idcustomer = ?, tgltrans = ?, catatan = ?, status = ? WHERE idso = ? AND idtenant = ?',
      [idlokasi, idcustomer || null, tgl, catatan || null, status, id, ctx.idtenant]
    );

    let grandtotal = 0;
    for (const item of items) {
      const subtotal = parseFloat(item.harga || 0) * parseFloat(item.jml);
      grandtotal += subtotal;
      await conn.query(
        `INSERT INTO salesorderdtl (idso, idtenant, idbarang, jml, jml_dikirim, satuan, harga, subtotal)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
        [id, ctx.idtenant, item.idbarang, item.jml, item.satuan || null, item.harga || 0, subtotal]
      );
    }

    await conn.query('UPDATE salesorder SET grandtotal = ? WHERE idso = ?', [grandtotal, id]);

    await conn.commit();
    await logger.history('SO_UPDATE', { idtenant: ctx.idtenant, idlokasi, iduser: ctx.iduser, ref: so.kodeso, req });
    res.json({ message: 'Sales order berhasil diupdate', grandtotal, status });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// PUT /sales-order/:id/approve — Approve SO
exports.approve = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();

    const [[so]] = await conn.query(
      'SELECT * FROM salesorder WHERE idso = ? AND idtenant = ?',
      [req.params.id, ctx.idtenant]
    );
    if (!so) {
      const err = new Error('Sales order tidak ditemukan');
      err.statusCode = 404;
      throw err;
    }
    if (so.status !== 'DRAFT') {
      const err = new Error('Hanya DRAFT yang bisa di-approve');
      err.statusCode = 400;
      throw err;
    }

    await conn.query(
      "UPDATE salesorder SET status = 'APPROVED' WHERE idso = ? AND idtenant = ?",
      [req.params.id, ctx.idtenant]
    );

    await conn.commit();
    await logger.history('SO_APPROVE', { idtenant: ctx.idtenant, idlokasi: so.idlokasi, iduser: ctx.iduser, ref: so.kodeso, req });
    res.json({ message: 'Sales order berhasil di-approve' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// PUT /sales-order/:id/unapprove — Batalkan approve SO jika belum ada BPK
exports.unapprove = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();

    const [[so]] = await conn.query(
      'SELECT * FROM salesorder WHERE idso = ? AND idtenant = ?',
      [req.params.id, ctx.idtenant]
    );
    if (!so) {
      const err = new Error('Sales order tidak ditemukan');
      err.statusCode = 404;
      throw err;
    }
    if (so.status !== 'APPROVED') {
      const err = new Error('Hanya SO APPROVED yang bisa batal approve');
      err.statusCode = 400;
      throw err;
    }

    const [[bpk]] = await conn.query(
      "SELECT idbpk FROM bpk WHERE idso = ? AND idtenant = ? AND status != 'CANCELLED' LIMIT 1",
      [req.params.id, ctx.idtenant]
    );
    if (bpk) {
      const err = new Error('SO sudah dibuatkan BPK, tidak bisa batal approve');
      err.statusCode = 400;
      throw err;
    }

    await conn.query(
      "UPDATE salesorder SET status = 'DRAFT' WHERE idso = ? AND idtenant = ?",
      [req.params.id, ctx.idtenant]
    );

    await conn.commit();
    await logger.history('SO_UNAPPROVE', { idtenant: ctx.idtenant, idlokasi: so.idlokasi, iduser: ctx.iduser, ref: so.kodeso, req });
    res.json({ message: 'Approve Sales Order berhasil dibatalkan' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// PUT /sales-order/:id/batal — Batalkan SO (hanya dari DRAFT)
exports.batal = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();

    const [[so]] = await conn.query(
      'SELECT * FROM salesorder WHERE idso = ? AND idtenant = ?',
      [req.params.id, ctx.idtenant]
    );
    if (!so) {
      const err = new Error('Sales order tidak ditemukan');
      err.statusCode = 404;
      throw err;
    }
    if (so.status !== 'DRAFT') {
      const err = new Error('Hanya DRAFT yang bisa dibatalkan');
      err.statusCode = 400;
      throw err;
    }

    await conn.query(
      "UPDATE salesorder SET status = 'CANCELLED' WHERE idso = ? AND idtenant = ?",
      [req.params.id, ctx.idtenant]
    );

    await conn.commit();
    await logger.history('SO_BATAL', { idtenant: ctx.idtenant, idlokasi: so.idlokasi, iduser: ctx.iduser, ref: so.kodeso, req });
    res.json({ message: 'Sales order berhasil dibatalkan' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message });
  } finally {
    conn.release();
  }
};
