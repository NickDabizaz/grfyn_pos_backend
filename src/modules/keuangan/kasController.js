// Controller untuk transaksi kas — mencatat pemasukan/pengeluaran beserta jurnal akuntansi.
// Alur status: DRAFT -> APPROVED (jurnal diposting saat approve) / CANCELLED.
const { tenantQuery, getConnection, getTenantContext } = require('../../config/db');
const { generateKodeKas } = require('../../lib/kodetrans');
const jurnalhelper = require('../../lib/jurnalhelper');
const logger = require('../../lib/logger');

// Membangun baris jurnal dari detail kas (positif -> DEBET, negatif -> KREDIT)
function buildJurnalLines(details) {
  return (details || []).map(d => {
    const amt = parseFloat(d.amount) || 0;
    return { idakun: d.idakun, posisi: amt >= 0 ? 'DEBET' : 'KREDIT', amount: Math.abs(amt) };
  });
}

// GET — Daftar transaksi kas dengan filter pencarian kode & status
exports.getAll = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { search, status } = req.query;
    let sql = 'SELECT k.* FROM kas k WHERE k.idlokasi = ?';
    const params = [ctx.idlokasi];
    if (search) { sql += ' AND k.kodekas LIKE ?'; params.push(`%${search}%`); }
    if (status) { sql += ' AND k.status = ?'; params.push(status); }
    sql += ' ORDER BY k.idkas DESC';
    const rows = await tenantQuery(sql, params);
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET — Detail satu transaksi kas beserta rincian akun
exports.getOne = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const rows = await tenantQuery(
      'SELECT k.* FROM kas k WHERE k.idkas = ? AND k.idlokasi = ?',
      [req.params.id, ctx.idlokasi]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Kas tidak ditemukan' });

    const details = await tenantQuery(
      'SELECT kd.*, a.kodeakun, a.namaakun FROM kasdtl kd JOIN akun a ON kd.idakun = a.idakun AND a.idtenant = kd.idtenant WHERE kd.idkas = ?',
      [req.params.id]
    );
    res.json({ ...rows[0], details });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// POST — Membuat transaksi kas. Status DRAFT, atau APPROVED bila approve=true.
exports.create = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const { details } = req.body;
    if (!details || !details.length) {
      await conn.rollback();
      return res.status(400).json({ message: 'Detail kas tidak boleh kosong' });
    }
    const approve = req.body.approve === true || req.body.status === 'APPROVED';
    const statusKas = approve ? 'APPROVED' : 'DRAFT';
    const kodekas = await generateKodeKas(conn, ctx.idtenant, ctx.idlokasi);
    const tgltrans = req.body.tgltrans || new Date().toISOString().slice(0, 10);

    const [result] = await conn.query(
      'INSERT INTO kas (idtenant, idlokasi, kodekas, tgltrans, iduser, status, userentry) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [ctx.idtenant, ctx.idlokasi, kodekas, tgltrans, ctx.iduser, statusKas, ctx.iduser]
    );
    const idkas = result.insertId;

    for (const d of details) {
      await conn.query(
        'INSERT INTO kasdtl (idkas, idtenant, idakun, catatan, amount) VALUES (?, ?, ?, ?, ?)',
        [idkas, ctx.idtenant, d.idakun, d.catatan || '', d.amount]
      );
    }

    // Jurnal hanya diposting saat APPROVED (divalidasi balance DEBET == KREDIT)
    if (approve) {
      await jurnalhelper.postJurnal(conn, {
        idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, idtrans: idkas, kodetrans: kodekas,
        jenis: 'kas', tgltrans, lines: buildJurnalLines(details),
      });
    }

    await conn.commit();
    await logger.history('KAS_CREATE', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: kodekas, detail: { status: statusKas }, req });
    res.status(201).json({ message: 'Kas berhasil ditambah', idkas, kodekas, status: statusKas });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// PUT — Edit transaksi kas (hanya status DRAFT)
exports.update = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const { details } = req.body;
    const { id } = req.params;

    if (!details || !details.length) {
      await conn.rollback();
      return res.status(400).json({ message: 'Detail kas tidak boleh kosong' });
    }

    const [[kas]] = await conn.query('SELECT * FROM kas WHERE idkas = ? AND idtenant = ? AND idlokasi = ?', [id, ctx.idtenant, ctx.idlokasi]);
    if (!kas) {
      await conn.rollback();
      return res.status(404).json({ message: 'Kas tidak ditemukan' });
    }
    if (kas.status === 'CANCELLED') {
      await conn.rollback();
      return res.status(400).json({ message: 'Kas sudah dibatalkan' });
    }
    if (kas.status !== 'DRAFT') {
      await conn.rollback();
      return res.status(400).json({ message: 'Hanya Kas DRAFT yang bisa diedit' });
    }

    const approve = req.body.approve === true || req.body.status === 'APPROVED';
    const tgltrans = req.body.tgltrans || String(kas.tgltrans).slice(0, 10);

    await conn.query('DELETE FROM kasdtl WHERE idkas = ? AND idtenant = ?', [id, ctx.idtenant]);
    for (const d of details) {
      await conn.query(
        'INSERT INTO kasdtl (idkas, idtenant, idakun, catatan, amount) VALUES (?, ?, ?, ?, ?)',
        [id, ctx.idtenant, d.idakun, d.catatan || '', d.amount]
      );
    }
    await conn.query('UPDATE kas SET tgltrans = ?, status = ? WHERE idkas = ? AND idtenant = ?', [tgltrans, approve ? 'APPROVED' : 'DRAFT', id, ctx.idtenant]);

    if (approve) {
      await jurnalhelper.postJurnal(conn, {
        idtenant: ctx.idtenant, idlokasi: kas.idlokasi, idtrans: id, kodetrans: kas.kodekas,
        jenis: 'kas', tgltrans, lines: buildJurnalLines(details),
      });
    }

    await conn.commit();
    await logger.history('KAS_UPDATE', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: kas.kodekas, req });
    res.json({ message: 'Kas berhasil diupdate' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// PUT /:id/approve — DRAFT -> APPROVED, posting jurnal
exports.approve = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const { id } = req.params;

    const [[kas]] = await conn.query('SELECT * FROM kas WHERE idkas = ? AND idtenant = ?', [id, ctx.idtenant]);
    if (!kas) {
      await conn.rollback();
      return res.status(404).json({ message: 'Kas tidak ditemukan' });
    }
    if (kas.status !== 'DRAFT') {
      await conn.rollback();
      return res.status(400).json({ message: 'Hanya Kas DRAFT yang bisa di-approve' });
    }

    const [dtl] = await conn.query('SELECT idakun, amount FROM kasdtl WHERE idkas = ? AND idtenant = ?', [id, ctx.idtenant]);
    if (!dtl.length) {
      await conn.rollback();
      return res.status(400).json({ message: 'Detail kas kosong' });
    }

    await jurnalhelper.postJurnal(conn, {
      idtenant: ctx.idtenant, idlokasi: kas.idlokasi, idtrans: id, kodetrans: kas.kodekas,
      jenis: 'kas', tgltrans: kas.tgltrans, lines: buildJurnalLines(dtl),
    });
    await conn.query("UPDATE kas SET status = 'APPROVED' WHERE idkas = ? AND idtenant = ?", [id, ctx.idtenant]);

    await conn.commit();
    await logger.history('KAS_APPROVE', { idtenant: ctx.idtenant, idlokasi: kas.idlokasi, iduser: ctx.iduser, ref: kas.kodekas, req });
    res.json({ message: 'Kas berhasil di-approve' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// PUT /:id/unapprove — APPROVED -> DRAFT, hapus jurnal
exports.unapprove = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const { id } = req.params;

    const [[kas]] = await conn.query('SELECT * FROM kas WHERE idkas = ? AND idtenant = ?', [id, ctx.idtenant]);
    if (!kas) {
      await conn.rollback();
      return res.status(404).json({ message: 'Kas tidak ditemukan' });
    }
    if (kas.status !== 'APPROVED') {
      await conn.rollback();
      return res.status(400).json({ message: 'Hanya Kas APPROVED yang bisa batal approve' });
    }

    await jurnalhelper.hapusJurnal(conn, ctx.idtenant, [kas.kodekas]);
    await conn.query("UPDATE kas SET status = 'DRAFT' WHERE idkas = ? AND idtenant = ?", [id, ctx.idtenant]);

    await conn.commit();
    await logger.history('KAS_UNAPPROVE', { idtenant: ctx.idtenant, idlokasi: kas.idlokasi, iduser: ctx.iduser, ref: kas.kodekas, req });
    res.json({ message: 'Approve Kas dibatalkan' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// PUT /:id/cancel — DRAFT -> CANCELLED
exports.cancel = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const { id } = req.params;

    const [[kas]] = await conn.query('SELECT * FROM kas WHERE idkas = ? AND idtenant = ?', [id, ctx.idtenant]);
    if (!kas) {
      await conn.rollback();
      return res.status(404).json({ message: 'Kas tidak ditemukan' });
    }
    if (kas.status === 'CANCELLED') {
      await conn.rollback();
      return res.status(400).json({ message: 'Kas sudah dibatalkan' });
    }
    if (kas.status === 'APPROVED') {
      await conn.rollback();
      return res.status(400).json({ message: 'Kas APPROVED harus batal approve dulu sebelum dibatalkan' });
    }

    await conn.query("UPDATE kas SET status = 'CANCELLED' WHERE idkas = ? AND idtenant = ?", [id, ctx.idtenant]);

    await conn.commit();
    await logger.history('KAS_CANCEL', { idtenant: ctx.idtenant, idlokasi: kas.idlokasi, iduser: ctx.iduser, ref: kas.kodekas, req });
    res.json({ message: 'Kas berhasil dibatalkan' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// DELETE — Hapus permanen transaksi kas (tidak boleh saat status APPROVED)
exports.remove = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    const [[kas]] = await conn.query('SELECT kodekas, status FROM kas WHERE idkas = ? AND idtenant = ? AND idlokasi = ?', [req.params.id, ctx.idtenant, ctx.idlokasi]);
    if (!kas) return res.status(404).json({ message: 'Kas tidak ditemukan' });
    if (kas.status === 'APPROVED') {
      return res.status(400).json({ message: 'Kas APPROVED harus batal approve dulu sebelum dihapus' });
    }
    await jurnalhelper.hapusJurnal(conn, ctx.idtenant, [kas.kodekas]);
    await conn.query('DELETE FROM kas WHERE idkas = ? AND idtenant = ? AND idlokasi = ?', [req.params.id, ctx.idtenant, ctx.idlokasi]);
    await logger.history('KAS_DELETE', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: kas.kodekas, req });
    res.json({ message: 'Kas berhasil dihapus' });
  } catch (err) {
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message });
  } finally {
    conn.release();
  }
};
