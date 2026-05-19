const { tenantQuery, getConnection, getTenantContext, pool } = require('../../config/db');
const { generateKodePelunasanPiutang } = require('../../lib/kodetrans');
const jurnalhelper = require('../../lib/jurnalhelper');
const logger = require('../../lib/logger');

let statusColumnReady = false;

async function ensureStatusColumn() {
  if (statusColumnReady) return;
  const [rows] = await pool.query("SHOW COLUMNS FROM pelunasanpiutang LIKE 'status'");
  if (!rows.length) {
    await pool.query("ALTER TABLE pelunasanpiutang ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'APPROVED' AFTER catatan");
  }
  statusColumnReady = true;
}

function normalizeStatus(status) {
  if (status === 'AKTIF') return 'APPROVED';
  if (status === 'VOID' || status === 'BATAL') return 'CANCELLED';
  return status || 'APPROVED';
}

async function getPelunasanForUpdate(conn, ctx, id) {
  const [[row]] = await conn.query(
    'SELECT * FROM pelunasanpiutang WHERE idpelunasan = ? AND idtenant = ? AND idlokasi = ? FOR UPDATE',
    [id, ctx.idtenant, ctx.idlokasi]
  );
  return row;
}

async function getDetails(conn, id) {
  const [rows] = await conn.query('SELECT * FROM pelunasanpiutangdtl WHERE idpelunasan = ?', [id]);
  return rows;
}

async function applyDetails(conn, ctx, details, direction = 1) {
  for (const d of details) {
    const amount = Math.abs(parseFloat(d.amount || 0)) * direction;
    const [[kp]] = await conn.query(
      "SELECT idkartupiutang, amount, terbayar, sisa FROM kartupiutang WHERE kodetrans = ? AND idtenant = ? AND idlokasi = ? AND jenis = 'JUAL'",
      [d.kodetrans, ctx.idtenant, ctx.idlokasi]
    );
    if (!kp) continue;
    const newTerbayar = Math.max(0, (parseFloat(kp.terbayar) || 0) + amount);
    const newSisa = Math.max(0, (parseFloat(kp.sisa) || 0) - amount);
    const status = newSisa <= 0 ? 'LUNAS' : 'OPEN';
    await conn.query(
      'UPDATE kartupiutang SET terbayar = ?, sisa = ?, status = ? WHERE idkartupiutang = ?',
      [newTerbayar, newSisa, status, kp.idkartupiutang]
    );
  }
}

// Normalisasi array pembayaran (Detail Jurnal) dari request body
function normalizePembayaran(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map(p => ({ idakun: parseInt(p.idakun, 10), amount: parseFloat(p.amount) || 0 }))
    .filter(p => p.idakun > 0 && p.amount > 0);
}

function validatePayload(body) {
  const { idcustomer, total_amount, details, pembayaran } = body;
  if (!idcustomer) return 'Customer harus dipilih';
  if (!details || !details.length) return 'Detail pelunasan tidak boleh kosong';
  const totalDetail = details.reduce((sum, d) => sum + parseFloat(d.amount || 0), 0);
  if (Math.abs(totalDetail - parseFloat(total_amount || 0)) > 0.01) return 'Total amount tidak sesuai dengan jumlah detail';
  if (details.some(d => !d.kodetrans || !(parseFloat(d.amount || 0) > 0))) return 'Detail pelunasan tidak valid';
  // Detail Jurnal (pembayaran) bersifat opsional; bila diisi harus valid & balance dengan total
  if (Array.isArray(pembayaran) && pembayaran.length) {
    if (pembayaran.some(p => !(parseInt(p.idakun, 10) > 0) || !(parseFloat(p.amount || 0) > 0))) {
      return 'Detail jurnal pembayaran tidak valid';
    }
    const totalBayar = pembayaran.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
    if (Math.abs(totalBayar - parseFloat(total_amount || 0)) > 0.01) {
      return 'Total pembayaran (Detail Jurnal) tidak sesuai dengan total pelunasan';
    }
  }
  return null;
}

// Memastikan akun pembayaran milik tenant ini & berstatus AKTIF
async function assertPembayaranAkun(conn, idtenant, bayarRows) {
  if (!bayarRows.length) return;
  const ids = [...new Set(bayarRows.map(p => p.idakun))];
  const [rows] = await conn.query(
    "SELECT idakun FROM akun WHERE idtenant = ? AND status = 'AKTIF' AND idakun IN (?)",
    [idtenant, ids]
  );
  if (rows.length !== ids.length) {
    const err = new Error('Akun pembayaran (Detail Jurnal) tidak valid atau tidak aktif');
    err.statusCode = 400;
    throw err;
  }
}

// Posting jurnal pelunasan piutang; fallback ke akun Kas/Bank default bila pembayaran kosong
async function postJurnalPelunasan(conn, ctx, akun, pelunasan, bayarRows) {
  let payments = bayarRows;
  if (!payments.length) {
    const idakunBayar = jurnalhelper.resolveAkunBayar(akun, pelunasan.metodbayar);
    payments = [{ idakun: idakunBayar, amount: parseFloat(pelunasan.total_amount) || 0 }];
    await conn.query(
      'INSERT INTO pelunasanpiutangbayar (idpelunasan, idtenant, idakun, amount) VALUES (?, ?, ?, ?)',
      [pelunasan.idpelunasan, ctx.idtenant, idakunBayar, payments[0].amount]
    );
  }
  await jurnalhelper.postJurnalPelunasanPiutang(conn, {
    akun, idtenant: ctx.idtenant, idlokasi: pelunasan.idlokasi || ctx.idlokasi,
    idpelunasan: pelunasan.idpelunasan, kodepelunasan: pelunasan.kodepelunasan,
    tgltrans: pelunasan.tgltrans, payments,
  });
}

exports.getAll = async (req, res) => {
  try {
    await ensureStatusColumn();
    const ctx = getTenantContext();
    const { idcustomer, tglwal, tglakhir, status } = req.query;
    let sql = `SELECT pp.*, c.kodecustomer, c.namacustomer
      FROM pelunasanpiutang pp
      LEFT JOIN customer c ON pp.idcustomer = c.idcustomer AND c.idtenant = pp.idtenant
      WHERE pp.idtenant = ? AND pp.idlokasi = ?`;
    const params = [ctx.idtenant, ctx.idlokasi];
    if (idcustomer) { sql += ' AND pp.idcustomer = ?'; params.push(idcustomer); }
    if (tglwal) { sql += ' AND pp.tgltrans >= ?'; params.push(tglwal); }
    if (tglakhir) { sql += ' AND pp.tgltrans <= ?'; params.push(tglakhir); }
    if (status) { sql += ' AND pp.status = ?'; params.push(status); }
    sql += ' ORDER BY pp.tgltrans DESC, pp.idpelunasan DESC';
    const rows = await tenantQuery(sql, params);
    res.json(rows.map(row => ({ ...row, status: normalizeStatus(row.status) })));
  } catch (err) {
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

exports.getOne = async (req, res) => {
  try {
    await ensureStatusColumn();
    const ctx = getTenantContext();
    const rows = await tenantQuery(
      `SELECT pp.*, c.kodecustomer, c.namacustomer
       FROM pelunasanpiutang pp
       LEFT JOIN customer c ON pp.idcustomer = c.idcustomer AND c.idtenant = pp.idtenant
       WHERE pp.idpelunasan = ? AND pp.idtenant = ? AND pp.idlokasi = ?`,
      [req.params.id, ctx.idtenant, ctx.idlokasi]
    );
    if (!rows.length) return res.status(404).json({ message: 'Pelunasan piutang tidak ditemukan' });
    const details = await tenantQuery('SELECT * FROM pelunasanpiutangdtl WHERE idpelunasan = ?', [req.params.id]);
    const pembayaran = await tenantQuery(
      `SELECT pb.idbayar, pb.idakun, pb.amount, a.kodeakun, a.namaakun
       FROM pelunasanpiutangbayar pb
       LEFT JOIN akun a ON a.idakun = pb.idakun AND a.idtenant = pb.idtenant
       WHERE pb.idpelunasan = ? AND pb.idtenant = ?`,
      [req.params.id, ctx.idtenant]
    );
    res.json({ ...rows[0], status: normalizeStatus(rows[0].status), details, pembayaran });
  } catch (err) {
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

exports.create = async (req, res) => {
  const conn = await getConnection();
  try {
    await ensureStatusColumn();
    await jurnalhelper.ensureJurnalSchema(conn);
    const ctx = getTenantContext();
    const error = validatePayload(req.body);
    if (error) return res.status(400).json({ message: error });
    const { idcustomer, tgltrans, total_amount, metodbayar, catatan, details } = req.body;
    const approve = req.body.approve === true || req.body.status === 'APPROVED';
    const status = approve ? 'APPROVED' : 'DRAFT';
    const bayarRows = normalizePembayaran(req.body.pembayaran);
    await assertPembayaranAkun(conn, ctx.idtenant, bayarRows);
    const akun = await jurnalhelper.getDefaultAkunJurnal(conn, ctx.idtenant);

    await conn.beginTransaction();
    const kodepelunasan = await generateKodePelunasanPiutang(conn, ctx.idtenant, ctx.idlokasi);
    const [result] = await conn.query(
      `INSERT INTO pelunasanpiutang (idtenant, idlokasi, idcustomer, kodepelunasan, tgltrans, total_amount, metodbayar, catatan, status, userentry)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ctx.idtenant, ctx.idlokasi, idcustomer, kodepelunasan, tgltrans, total_amount, metodbayar || 'TUNAI', catatan || '', status, ctx.iduser]
    );
    const idpelunasan = result.insertId;
    for (const d of details) {
      await conn.query('INSERT INTO pelunasanpiutangdtl (idpelunasan, kodetrans, amount) VALUES (?, ?, ?)', [idpelunasan, d.kodetrans, d.amount]);
    }
    for (const p of bayarRows) {
      await conn.query('INSERT INTO pelunasanpiutangbayar (idpelunasan, idtenant, idakun, amount) VALUES (?, ?, ?, ?)', [idpelunasan, ctx.idtenant, p.idakun, p.amount]);
    }
    if (approve) {
      await applyDetails(conn, ctx, details, 1);
      await postJurnalPelunasan(conn, ctx, akun, { idpelunasan, kodepelunasan, tgltrans, total_amount, metodbayar, idlokasi: ctx.idlokasi }, bayarRows);
    }
    await conn.commit();
    await logger.history('PELUNASAN_PIUTANG_CREATE', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: kodepelunasan, req });
    res.status(201).json({ message: 'Pelunasan piutang berhasil ditambah', idpelunasan, kodepelunasan });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.update = async (req, res) => {
  const conn = await getConnection();
  try {
    await ensureStatusColumn();
    await jurnalhelper.ensureJurnalSchema(conn);
    const ctx = getTenantContext();
    const error = validatePayload(req.body);
    if (error) return res.status(400).json({ message: error });
    const { idcustomer, tgltrans, total_amount, metodbayar, catatan, details } = req.body;
    const approve = req.body.approve === true || req.body.status === 'APPROVED';
    const bayarRows = normalizePembayaran(req.body.pembayaran);
    await assertPembayaranAkun(conn, ctx.idtenant, bayarRows);
    const akun = await jurnalhelper.getDefaultAkunJurnal(conn, ctx.idtenant);

    await conn.beginTransaction();
    const pelunasan = await getPelunasanForUpdate(conn, ctx, req.params.id);
    if (!pelunasan) {
      await conn.rollback();
      return res.status(404).json({ message: 'Pelunasan piutang tidak ditemukan' });
    }
    if (normalizeStatus(pelunasan.status) !== 'DRAFT') {
      await conn.rollback();
      return res.status(400).json({ message: 'Hanya pelunasan DRAFT yang bisa diedit' });
    }
    await conn.query(
      'UPDATE pelunasanpiutang SET idcustomer = ?, tgltrans = ?, total_amount = ?, metodbayar = ?, catatan = ?, status = ? WHERE idpelunasan = ? AND idtenant = ? AND idlokasi = ?',
      [idcustomer, tgltrans, total_amount, metodbayar || 'TUNAI', catatan || '', approve ? 'APPROVED' : 'DRAFT', pelunasan.idpelunasan, ctx.idtenant, ctx.idlokasi]
    );
    await conn.query('DELETE FROM pelunasanpiutangdtl WHERE idpelunasan = ?', [pelunasan.idpelunasan]);
    await conn.query('DELETE FROM pelunasanpiutangbayar WHERE idpelunasan = ?', [pelunasan.idpelunasan]);
    for (const d of details) {
      await conn.query('INSERT INTO pelunasanpiutangdtl (idpelunasan, kodetrans, amount) VALUES (?, ?, ?)', [pelunasan.idpelunasan, d.kodetrans, d.amount]);
    }
    for (const p of bayarRows) {
      await conn.query('INSERT INTO pelunasanpiutangbayar (idpelunasan, idtenant, idakun, amount) VALUES (?, ?, ?, ?)', [pelunasan.idpelunasan, ctx.idtenant, p.idakun, p.amount]);
    }
    if (approve) {
      await applyDetails(conn, ctx, details, 1);
      await postJurnalPelunasan(conn, ctx, akun, {
        idpelunasan: pelunasan.idpelunasan, kodepelunasan: pelunasan.kodepelunasan,
        tgltrans, total_amount, metodbayar, idlokasi: pelunasan.idlokasi,
      }, bayarRows);
    }
    await conn.commit();
    await logger.history('PELUNASAN_PIUTANG_UPDATE', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: pelunasan.kodepelunasan, req });
    res.json({ message: 'Pelunasan piutang berhasil diupdate' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.approve = async (req, res) => {
  const conn = await getConnection();
  try {
    await ensureStatusColumn();
    await jurnalhelper.ensureJurnalSchema(conn);
    const ctx = getTenantContext();
    const akun = await jurnalhelper.getDefaultAkunJurnal(conn, ctx.idtenant);
    await conn.beginTransaction();
    const pelunasan = await getPelunasanForUpdate(conn, ctx, req.params.id);
    if (!pelunasan) {
      await conn.rollback();
      return res.status(404).json({ message: 'Pelunasan piutang tidak ditemukan' });
    }
    if (normalizeStatus(pelunasan.status) !== 'DRAFT') {
      await conn.rollback();
      return res.status(400).json({ message: 'Hanya pelunasan DRAFT yang bisa diapprove' });
    }
    const details = await getDetails(conn, pelunasan.idpelunasan);
    await applyDetails(conn, ctx, details, 1);
    const [bayarRows] = await conn.query('SELECT idakun, amount FROM pelunasanpiutangbayar WHERE idpelunasan = ?', [pelunasan.idpelunasan]);
    await postJurnalPelunasan(conn, ctx, akun, pelunasan, bayarRows.map(b => ({ idakun: b.idakun, amount: parseFloat(b.amount) })));
    await conn.query("UPDATE pelunasanpiutang SET status = 'APPROVED' WHERE idpelunasan = ? AND idtenant = ? AND idlokasi = ?", [pelunasan.idpelunasan, ctx.idtenant, ctx.idlokasi]);
    await conn.commit();
    await logger.history('PELUNASAN_PIUTANG_APPROVE', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: pelunasan.kodepelunasan, req });
    res.json({ message: 'Pelunasan piutang berhasil diapprove' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.unapprove = async (req, res) => {
  const conn = await getConnection();
  try {
    await ensureStatusColumn();
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const pelunasan = await getPelunasanForUpdate(conn, ctx, req.params.id);
    if (!pelunasan) {
      await conn.rollback();
      return res.status(404).json({ message: 'Pelunasan piutang tidak ditemukan' });
    }
    if (normalizeStatus(pelunasan.status) !== 'APPROVED') {
      await conn.rollback();
      return res.status(400).json({ message: 'Hanya pelunasan APPROVED yang bisa batal approve' });
    }
    const details = await getDetails(conn, pelunasan.idpelunasan);
    await applyDetails(conn, ctx, details, -1);
    await jurnalhelper.hapusJurnal(conn, ctx.idtenant, [pelunasan.kodepelunasan]);
    await conn.query("UPDATE pelunasanpiutang SET status = 'DRAFT' WHERE idpelunasan = ? AND idtenant = ? AND idlokasi = ?", [pelunasan.idpelunasan, ctx.idtenant, ctx.idlokasi]);
    await conn.commit();
    await logger.history('PELUNASAN_PIUTANG_UNAPPROVE', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: pelunasan.kodepelunasan, req });
    res.json({ message: 'Approve pelunasan piutang dibatalkan' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.cancel = async (req, res) => {
  const conn = await getConnection();
  try {
    await ensureStatusColumn();
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const pelunasan = await getPelunasanForUpdate(conn, ctx, req.params.id);
    if (!pelunasan) {
      await conn.rollback();
      return res.status(404).json({ message: 'Pelunasan piutang tidak ditemukan' });
    }
    if (normalizeStatus(pelunasan.status) === 'APPROVED') {
      await conn.rollback();
      return res.status(400).json({ message: 'Pelunasan APPROVED harus batal approve dulu sebelum dibatalkan' });
    }
    await conn.query("UPDATE pelunasanpiutang SET status = 'CANCELLED' WHERE idpelunasan = ? AND idtenant = ? AND idlokasi = ?", [pelunasan.idpelunasan, ctx.idtenant, ctx.idlokasi]);
    await conn.commit();
    await logger.history('PELUNASAN_PIUTANG_CANCEL', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: pelunasan.kodepelunasan, req });
    res.json({ message: 'Pelunasan piutang dibatalkan' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.remove = exports.cancel;
