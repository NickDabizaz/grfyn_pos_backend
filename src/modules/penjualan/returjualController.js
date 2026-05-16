const { tenantQuery, getConnection, getTenantContext } = require('../../config/db');
const { generateKodeReturJual } = require('../../lib/kodetrans');
const logger = require('../../lib/logger');

async function calculateAndInsertDetails(conn, { idreturjual, idtenant, items }) {
  const [[tenant]] = await conn.query('SELECT ppn FROM tenant WHERE idtenant = ?', [idtenant]);
  const ppnPercent = tenant ? parseFloat(tenant.ppn) : 11;
  let total = 0;

  for (const item of items) {
    const harga = parseFloat(item.harga || 0);
    const jml = parseFloat(item.jml || 0);
    const diskon = parseFloat(item.diskon || 0);
    const base = harga * jml;
    const ppn = item.ppn_mode === 'INCLUDE' ? (base * ppnPercent) / 100 : 0;
    const subtotal = base + ppn - ((base * diskon) / 100);
    total += subtotal;

    await conn.query(
      'INSERT INTO returjualdtl (idreturjual, idtenant, idbarang, satuan, jml, harga, ppn, diskon, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [idreturjual, idtenant, item.idbarang, item.satuan || null, jml, harga, ppn, diskon, subtotal]
    );
  }

  return total;
}

async function postApprovedRetur(conn, { idtenant, idlokasi, idcustomer, kodereturjual, kodejual, idreturjual, tgltrans, total }) {
  const [details] = await conn.query(
    'SELECT * FROM returjualdtl WHERE idreturjual = ? AND idtenant = ?',
    [idreturjual, idtenant]
  );

  for (const item of details) {
    await conn.query(
      'INSERT INTO kartustok (idtenant, idlokasi, kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idtrans, jenistransaksi) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [idtenant, idlokasi, kodereturjual, item.idbarang, item.jml, 'M', tgltrans, `Retur Penjualan ${kodereturjual}`, idreturjual, 'RETURJUAL']
    );
  }

  if (kodejual && idcustomer) {
    await conn.query(
      'INSERT INTO kartupiutang (idtenant, idlokasi, idcustomer, kodetrans, jenis, kodetransreferensi, amount, terbayar, sisa, tgltrans, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [idtenant, idlokasi, idcustomer, kodejual, 'RETUR', kodereturjual, -total, 0, -total, tgltrans, 'OPEN']
    );
  }
}

async function deletePostedRetur(conn, { idtenant, idlokasi, kodereturjual }) {
  await conn.query(
    "DELETE FROM kartupiutang WHERE kodetransreferensi = ? AND idtenant = ? AND idlokasi = ? AND jenis = 'RETUR'",
    [kodereturjual, idtenant, idlokasi]
  );
  await conn.query(
    "DELETE FROM kartustok WHERE kodetrans = ? AND jenistransaksi = 'RETURJUAL' AND idtenant = ? AND idlokasi = ?",
    [kodereturjual, idtenant, idlokasi]
  );
}

async function refreshJualReturStatus(conn, { idtenant, idjual }) {
  if (!idjual) return;
  const [[activeRetur]] = await conn.query(
    "SELECT idreturjual FROM returjual WHERE idjual = ? AND idtenant = ? AND status != 'CANCELLED' LIMIT 1",
    [idjual, idtenant]
  );
  await conn.query(
    "UPDATE jual SET status = ? WHERE idjual = ? AND idtenant = ? AND status IN ('APPROVED', 'CONFIRMED')",
    [activeRetur ? 'CONFIRMED' : 'APPROVED', idjual, idtenant]
  );
}

exports.create = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const { idcustomer, idlokasi, idjual, kodejual, items, catatan, tgltrans } = req.body;
    const approve = req.body.approve === true || req.body.status === 'APPROVED';
    const status = approve ? 'APPROVED' : 'DRAFT';

    if (!items || !items.length) {
      await conn.rollback();
      return res.status(400).json({ message: 'Items tidak boleh kosong' });
    }
    if (!idcustomer) {
      await conn.rollback();
      return res.status(400).json({ message: 'Customer wajib dipilih' });
    }
    if (!idlokasi) {
      await conn.rollback();
      return res.status(400).json({ message: 'Lokasi wajib dipilih' });
    }

    const kodereturjual = await generateKodeReturJual(conn, ctx.idtenant, idlokasi);
    const tgl = tgltrans || new Date().toISOString().slice(0, 10);

    await conn.query(
      'INSERT INTO returjual (idtenant, idlokasi, kodereturjual, tgltrans, idcustomer, idjual, kodejual, iduser, total, catatan, status, userentry) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)',
      [ctx.idtenant, idlokasi, kodereturjual, tgl, idcustomer, idjual || null, kodejual || null, ctx.iduser, catatan || null, status, ctx.iduser]
    );

    const [[header]] = await conn.query(
      'SELECT idreturjual FROM returjual WHERE kodereturjual = ? AND idtenant = ? AND idlokasi = ?',
      [kodereturjual, ctx.idtenant, idlokasi]
    );

    const total = await calculateAndInsertDetails(conn, { idreturjual: header.idreturjual, idtenant: ctx.idtenant, items });
    await conn.query('UPDATE returjual SET total = ? WHERE idreturjual = ? AND idtenant = ?', [total, header.idreturjual, ctx.idtenant]);
    await refreshJualReturStatus(conn, { idtenant: ctx.idtenant, idjual });

    if (approve) {
      await postApprovedRetur(conn, {
        idtenant: ctx.idtenant,
        idlokasi,
        idcustomer,
        kodereturjual,
        kodejual,
        idreturjual: header.idreturjual,
        tgltrans: tgl,
        total,
      });
    }

    await conn.commit();
    await logger.history('RETURJUAL_CREATE', { idtenant: ctx.idtenant, idlokasi, iduser: ctx.iduser, ref: kodereturjual, detail: { total, status }, req });
    res.status(201).json({ message: 'Retur penjualan berhasil dibuat', kodereturjual, idreturjual: header.idreturjual, total, status });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.update = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const { id } = req.params;
    const { idcustomer, idlokasi, idjual, kodejual, items, catatan, tgltrans } = req.body;
    const approve = req.body.approve === true || req.body.status === 'APPROVED';
    const status = approve ? 'APPROVED' : 'DRAFT';

    if (!items || !items.length) {
      await conn.rollback();
      return res.status(400).json({ message: 'Items tidak boleh kosong' });
    }
    if (!idcustomer) {
      await conn.rollback();
      return res.status(400).json({ message: 'Customer wajib dipilih' });
    }
    if (!idlokasi) {
      await conn.rollback();
      return res.status(400).json({ message: 'Lokasi wajib dipilih' });
    }

    const [[retur]] = await conn.query('SELECT * FROM returjual WHERE idreturjual = ? AND idtenant = ?', [id, ctx.idtenant]);
    if (!retur) {
      await conn.rollback();
      return res.status(404).json({ message: 'Retur penjualan tidak ditemukan' });
    }
    if (retur.status === 'CANCELLED') {
      await conn.rollback();
      return res.status(400).json({ message: 'Retur penjualan sudah dibatalkan' });
    }
    if (retur.status !== 'DRAFT') {
      await conn.rollback();
      return res.status(400).json({ message: 'Hanya Retur Penjualan DRAFT yang bisa diedit' });
    }

    const tgl = tgltrans || String(retur.tgltrans).slice(0, 10);
    await conn.query('DELETE FROM returjualdtl WHERE idreturjual = ? AND idtenant = ?', [id, ctx.idtenant]);
    const total = await calculateAndInsertDetails(conn, { idreturjual: id, idtenant: ctx.idtenant, items });
    await conn.query(
      'UPDATE returjual SET tgltrans = ?, idlokasi = ?, idcustomer = ?, idjual = ?, kodejual = ?, total = ?, catatan = ?, status = ? WHERE idreturjual = ? AND idtenant = ?',
      [tgl, idlokasi, idcustomer, idjual || null, kodejual || null, total, catatan || null, status, id, ctx.idtenant]
    );
    await refreshJualReturStatus(conn, { idtenant: ctx.idtenant, idjual: retur.idjual });
    await refreshJualReturStatus(conn, { idtenant: ctx.idtenant, idjual });

    if (approve) {
      await postApprovedRetur(conn, {
        idtenant: ctx.idtenant,
        idlokasi,
        idcustomer,
        kodereturjual: retur.kodereturjual,
        kodejual,
        idreturjual: id,
        tgltrans: tgl,
        total,
      });
    }

    await conn.commit();
    await logger.history('RETURJUAL_UPDATE', { idtenant: ctx.idtenant, idlokasi, iduser: ctx.iduser, ref: retur.kodereturjual, detail: { total, status }, req });
    res.json({ message: 'Retur penjualan berhasil diupdate', total, status });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.getAll = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tglwal, tglakhir, idcustomer, idlokasi, search } = req.query;
    let sql = `SELECT r.*, c.namacustomer
      FROM returjual r
      LEFT JOIN customer c ON r.idcustomer = c.idcustomer AND c.idtenant = r.idtenant
      WHERE r.idtenant = ?`;
    const params = [ctx.idtenant];
    if (idlokasi)   { sql += ' AND r.idlokasi = ?'; params.push(idlokasi); }
    if (tglwal)     { sql += ' AND r.tgltrans >= ?'; params.push(tglwal); }
    if (tglakhir)   { sql += ' AND r.tgltrans <= ?'; params.push(tglakhir); }
    if (idcustomer) { sql += ' AND r.idcustomer = ?'; params.push(idcustomer); }
    if (search)     { sql += ' AND r.kodereturjual LIKE ?'; params.push(`%${search}%`); }
    sql += ' ORDER BY r.tgltrans DESC, r.idreturjual DESC LIMIT 200';
    const rows = await tenantQuery(sql, params);
    res.json(rows.map(row => ({
      ...row,
      status: row.status === 'AKTIF' ? 'APPROVED' : row.status,
    })));
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

exports.getOne = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const rows = await tenantQuery(
      `SELECT r.*, c.namacustomer, c.kodecustomer, c.alamat AS calamat, c.hp AS chp,
              l.namalokasi, l.kodelokasi
       FROM returjual r
       LEFT JOIN customer c ON r.idcustomer = c.idcustomer AND c.idtenant = r.idtenant
       LEFT JOIN lokasi l ON r.idlokasi = l.idlokasi AND l.idtenant = r.idtenant
       WHERE r.idreturjual = ? AND r.idtenant = ?`,
      [req.params.id, ctx.idtenant]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Retur penjualan tidak ditemukan' });

    const items = await tenantQuery(
      `SELECT rd.*, b.namabarang, b.kodebarang, b.satuanbesar, b.satuansedang, b.satuankecil, b.konversi1, b.konversi2
       FROM returjualdtl rd
       LEFT JOIN barang b ON rd.idbarang = b.idbarang AND b.idtenant = rd.idtenant
       WHERE rd.idreturjual = ?`,
      [req.params.id]
    );
    const mappedItems = items.map(item => ({
      ...item,
      ppn_mode: parseFloat(item.ppn || 0) > 0 ? 'INCLUDE' : 'TIDAK_PAKAI',
    }));
    res.json({
      ...rows[0],
      status: rows[0].status === 'AKTIF' ? 'APPROVED' : rows[0].status,
      items: mappedItems,
    });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

exports.cancel = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const { id } = req.params;

    const [[retur]] = await conn.query(
      'SELECT * FROM returjual WHERE idreturjual = ? AND idtenant = ?',
      [id, ctx.idtenant]
    );
    if (!retur) {
      await conn.rollback();
      return res.status(404).json({ message: 'Retur penjualan tidak ditemukan' });
    }
    if (retur.status === 'CANCELLED') {
      await conn.rollback();
      return res.status(400).json({ message: 'Retur penjualan sudah dibatalkan' });
    }
    if (retur.status !== 'DRAFT') {
      await conn.rollback();
      return res.status(400).json({ message: 'Retur Penjualan APPROVED harus batal approve dulu sebelum dihapus' });
    }

    await conn.query(
      'UPDATE returjual SET status = ? WHERE idreturjual = ? AND idtenant = ? AND idlokasi = ?',
      ['CANCELLED', id, ctx.idtenant, retur.idlokasi]
    );
    await refreshJualReturStatus(conn, { idtenant: ctx.idtenant, idjual: retur.idjual });

    await conn.commit();
    await logger.history('RETURJUAL_CANCEL', { idtenant: ctx.idtenant, idlokasi: retur.idlokasi, iduser: ctx.iduser, ref: retur.kodereturjual, req });
    res.json({ message: 'Retur penjualan berhasil dibatalkan' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.approve = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const { id } = req.params;

    const [[retur]] = await conn.query('SELECT * FROM returjual WHERE idreturjual = ? AND idtenant = ?', [id, ctx.idtenant]);
    if (!retur) {
      await conn.rollback();
      return res.status(404).json({ message: 'Retur penjualan tidak ditemukan' });
    }
    if (retur.status !== 'DRAFT') {
      await conn.rollback();
      return res.status(400).json({ message: 'Hanya Retur Penjualan DRAFT yang bisa di-approve' });
    }

    await postApprovedRetur(conn, {
      idtenant: ctx.idtenant,
      idlokasi: retur.idlokasi,
      idcustomer: retur.idcustomer,
      kodereturjual: retur.kodereturjual,
      kodejual: retur.kodejual,
      idreturjual: id,
      tgltrans: retur.tgltrans,
      total: retur.total,
    });
    await conn.query("UPDATE returjual SET status = 'APPROVED' WHERE idreturjual = ? AND idtenant = ?", [id, ctx.idtenant]);
    await refreshJualReturStatus(conn, { idtenant: ctx.idtenant, idjual: retur.idjual });

    await conn.commit();
    await logger.history('RETURJUAL_APPROVE', { idtenant: ctx.idtenant, idlokasi: retur.idlokasi, iduser: ctx.iduser, ref: retur.kodereturjual, req });
    res.json({ message: 'Retur Penjualan berhasil di-approve' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.unapprove = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const { id } = req.params;

    const [[retur]] = await conn.query(
      'SELECT * FROM returjual WHERE idreturjual = ? AND idtenant = ?',
      [id, ctx.idtenant]
    );
    if (!retur) {
      await conn.rollback();
      return res.status(404).json({ message: 'Retur penjualan tidak ditemukan' });
    }
    if (retur.status !== 'APPROVED' && retur.status !== 'AKTIF') {
      await conn.rollback();
      return res.status(400).json({ message: 'Hanya Retur Penjualan APPROVED yang bisa batal approve' });
    }

    await deletePostedRetur(conn, {
      idtenant: ctx.idtenant,
      idlokasi: retur.idlokasi,
      kodereturjual: retur.kodereturjual,
    });

    await conn.query(
      "UPDATE returjual SET status = 'DRAFT' WHERE idreturjual = ? AND idtenant = ?",
      [id, ctx.idtenant]
    );
    await refreshJualReturStatus(conn, { idtenant: ctx.idtenant, idjual: retur.idjual });

    await conn.commit();
    await logger.history('RETURJUAL_UNAPPROVE', { idtenant: ctx.idtenant, idlokasi: retur.idlokasi, iduser: ctx.iduser, ref: retur.kodereturjual, req });
    res.json({ message: 'Approve Retur Penjualan dibatalkan' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};
