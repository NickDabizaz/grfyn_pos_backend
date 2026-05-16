const { tenantQuery, getConnection, getTenantContext } = require('../../config/db');
const { generateKodeBPK } = require('../../lib/kodetrans');
const logger = require('../../lib/logger');
const { getStok } = require('../../lib/stokhelper');

function shouldApprove(req) {
  return req.body.approve === true || req.body.status === 'APPROVED';
}

async function assertSoApproved(conn, idso, idtenant) {
  const [[so]] = await conn.query(
    'SELECT * FROM salesorder WHERE idso = ? AND idtenant = ?',
    [idso, idtenant]
  );
  if (!so) {
    const err = new Error('Sales order tidak ditemukan');
    err.statusCode = 404;
    throw err;
  }
  if (so.status !== 'APPROVED' && so.status !== 'CONFIRMED') {
    const err = new Error('BPK hanya bisa dibuat dari SO APPROVED');
    err.statusCode = 400;
    throw err;
  }
  return so;
}

async function rebuildDetails(conn, { idbpk, idtenant, idso, items }) {
  let grandtotal = 0;
  for (const item of items) {
    const jml = parseFloat(item.jml) || 0;
    const harga = parseFloat(item.harga || 0);
    const subtotal = harga * jml;
    grandtotal += subtotal;

    await conn.query(
      `INSERT INTO bpkdtl (idbpk, idtenant, idbarang, idsodtl, jml, satuan, harga, subtotal)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [idbpk, idtenant, item.idbarang, item.idsodtl || null, jml, item.satuan || null, harga, subtotal]
    );

    if (item.idsodtl) {
      await conn.query(
        'UPDATE salesorderdtl SET jml_dikirim = jml_dikirim + ? WHERE idsodtl = ? AND idso = ? AND idtenant = ?',
        [jml, item.idsodtl, idso, idtenant]
      );
    }
  }
  return grandtotal;
}

async function revertOldDetails(conn, { idbpk, idtenant, idso }) {
  const [oldItems] = await conn.query(
    'SELECT * FROM bpkdtl WHERE idbpk = ? AND idtenant = ?',
    [idbpk, idtenant]
  );
  for (const item of oldItems) {
    if (idso && item.idsodtl) {
      await conn.query(
        'UPDATE salesorderdtl SET jml_dikirim = GREATEST(0, jml_dikirim - ?) WHERE idsodtl = ? AND idso = ? AND idtenant = ?',
        [item.jml, item.idsodtl, idso, idtenant]
      );
    }
  }
}

exports.getAll = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tglwal, tglakhir, idcustomer, idlokasi, available, search, status } = req.query;
    let sql = `SELECT bpk.*, DATE_FORMAT(bpk.tgltrans, '%Y-%m-%d') AS tgltrans,
        c.namacustomer, so.kodeso AS kodesalesorder
      FROM bpk
      LEFT JOIN customer c ON bpk.idcustomer = c.idcustomer AND c.idtenant = bpk.idtenant
      LEFT JOIN salesorder so ON bpk.idso = so.idso AND so.idtenant = bpk.idtenant
      WHERE bpk.idtenant = ?`;
    const params = [ctx.idtenant];
    if (available === '1' || available == 1) {
      sql += ` AND bpk.status = 'APPROVED' AND NOT EXISTS (
        SELECT 1 FROM jual j WHERE j.idbpk = bpk.idbpk AND j.status != 'CANCELLED' AND j.idtenant = bpk.idtenant
      )`;
    }
    if (idlokasi) { sql += ' AND bpk.idlokasi = ?'; params.push(idlokasi); }
    if (tglwal) { sql += ' AND bpk.tgltrans >= ?'; params.push(tglwal); }
    if (tglakhir) { sql += ' AND bpk.tgltrans <= ?'; params.push(tglakhir); }
    if (idcustomer) { sql += ' AND bpk.idcustomer = ?'; params.push(idcustomer); }
    if (status) { sql += ' AND bpk.status = ?'; params.push(status); }
    if (search) { sql += ' AND (bpk.kodebpk LIKE ? OR c.namacustomer LIKE ? OR so.kodeso LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    sql += ' ORDER BY bpk.tgltrans DESC, bpk.idbpk DESC LIMIT 200';
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
    const rows = await tenantQuery(
      `SELECT bpk.*, DATE_FORMAT(bpk.tgltrans, '%Y-%m-%d') AS tgltrans,
              c.namacustomer, c.kodecustomer, c.alamat AS calamat, c.hp AS chp,
              l.namalokasi, l.kodelokasi, so.kodeso AS kodesalesorder
       FROM bpk
       LEFT JOIN customer c ON bpk.idcustomer = c.idcustomer AND c.idtenant = bpk.idtenant
       LEFT JOIN lokasi l ON bpk.idlokasi = l.idlokasi AND l.idtenant = bpk.idtenant
       LEFT JOIN salesorder so ON bpk.idso = so.idso AND so.idtenant = bpk.idtenant
       WHERE bpk.idbpk = ? AND bpk.idtenant = ?`,
      [req.params.id, ctx.idtenant]
    );
    if (!rows.length) return res.status(404).json({ message: 'BPK tidak ditemukan' });

    const items = await tenantQuery(
      `SELECT bd.*, b.namabarang, b.kodebarang, b.satuanbesar, b.satuansedang, b.satuankecil, b.konversi1, b.konversi2
       FROM bpkdtl bd
       LEFT JOIN barang b ON bd.idbarang = b.idbarang AND b.idtenant = bd.idtenant
       WHERE bd.idbpk = ? AND bd.idtenant = ?`,
      [req.params.id, ctx.idtenant]
    );

    // dapet in stok masing masing barang di lokasi bpk
    for (const item of items) {
      const [[stok]] = await getStok(item.idbarang, rows[0].idlokasi, rows[0].tgltrans);
      item.stok = stok;
    }
    res.json({ ...rows[0], items });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

exports.create = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    const { idcustomer, idlokasi, idso, tgltrans, items, catatan } = req.body;

    if (!items || !items.length) return res.status(400).json({ message: 'Items tidak boleh kosong' });
    if (!idlokasi) return res.status(400).json({ message: 'Lokasi wajib dipilih' });
    if (!idso) return res.status(400).json({ message: 'Kode SO (Referensi) wajib dipilih' });

    const kodebpk = await generateKodeBPK(conn, ctx.idtenant, idlokasi);
    const tgl = tgltrans || new Date().toISOString().slice(0, 10);
    const status = shouldApprove(req) ? 'APPROVED' : 'DRAFT';

    await conn.beginTransaction();
    const so = await assertSoApproved(conn, idso, ctx.idtenant);

    const [result] = await conn.query(
      `INSERT INTO bpk (idtenant, idlokasi, kodebpk, tgltrans, idso, idcustomer, iduser, grandtotal, catatan, status, userentry, tglentry)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, NOW())`,
      [ctx.idtenant, idlokasi, kodebpk, tgl, idso, idcustomer || so.idcustomer || null, ctx.iduser, catatan || null, status, ctx.iduser]
    );
    const idbpk = result.insertId;
    const grandtotal = await rebuildDetails(conn, { idbpk, idtenant: ctx.idtenant, idso, items });

    await conn.query('UPDATE bpk SET grandtotal = ? WHERE idbpk = ? AND idtenant = ?', [grandtotal, idbpk, ctx.idtenant]);
    await conn.query("UPDATE salesorder SET status = 'CONFIRMED' WHERE idso = ? AND idtenant = ?", [idso, ctx.idtenant]);

    await conn.commit();
    await logger.history('BPK_CREATE', { idtenant: ctx.idtenant, idlokasi, iduser: ctx.iduser, ref: kodebpk, detail: { grandtotal, status }, req });
    res.status(201).json({ message: 'BPK berhasil dibuat', kodebpk, idbpk, grandtotal, status });
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
    const ctx = getTenantContext();
    const { id } = req.params;
    const { idcustomer, idlokasi, idso, tgltrans, items, catatan } = req.body;

    if (!items || !items.length) return res.status(400).json({ message: 'Items tidak boleh kosong' });
    if (!idlokasi) return res.status(400).json({ message: 'Lokasi wajib dipilih' });
    if (!idso) return res.status(400).json({ message: 'Kode SO (Referensi) wajib dipilih' });

    await conn.beginTransaction();

    const [[bpk]] = await conn.query('SELECT * FROM bpk WHERE idbpk = ? AND idtenant = ?', [id, ctx.idtenant]);
    if (!bpk) {
      const err = new Error('BPK tidak ditemukan');
      err.statusCode = 404;
      throw err;
    }
    if (bpk.status !== 'DRAFT') {
      const err = new Error('Hanya BPK DRAFT yang bisa diedit');
      err.statusCode = 400;
      throw err;
    }

    const so = await assertSoApproved(conn, idso, ctx.idtenant);
    await revertOldDetails(conn, { idbpk: id, idtenant: ctx.idtenant, idso: bpk.idso });
    await conn.query('DELETE FROM bpkdtl WHERE idbpk = ? AND idtenant = ?', [id, ctx.idtenant]);

    const tgl = tgltrans || String(bpk.tgltrans).slice(0, 10);
    const status = shouldApprove(req) ? 'APPROVED' : 'DRAFT';
    await conn.query(
      'UPDATE bpk SET idlokasi = ?, idcustomer = ?, idso = ?, tgltrans = ?, catatan = ?, status = ? WHERE idbpk = ? AND idtenant = ?',
      [idlokasi, idcustomer || so.idcustomer || null, idso, tgl, catatan || null, status, id, ctx.idtenant]
    );

    const grandtotal = await rebuildDetails(conn, { idbpk: id, idtenant: ctx.idtenant, idso, items });
    await conn.query('UPDATE bpk SET grandtotal = ? WHERE idbpk = ? AND idtenant = ?', [grandtotal, id, ctx.idtenant]);
    await conn.query("UPDATE salesorder SET status = 'CONFIRMED' WHERE idso = ? AND idtenant = ?", [idso, ctx.idtenant]);

    await conn.commit();
    await logger.history('BPK_UPDATE', { idtenant: ctx.idtenant, idlokasi, iduser: ctx.iduser, ref: bpk.kodebpk, detail: { grandtotal, status }, req });
    res.json({ message: 'BPK berhasil diupdate', grandtotal, status });
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
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const [[bpk]] = await conn.query('SELECT * FROM bpk WHERE idbpk = ? AND idtenant = ?', [req.params.id, ctx.idtenant]);
    if (!bpk) {
      const err = new Error('BPK tidak ditemukan');
      err.statusCode = 404;
      throw err;
    }
    if (bpk.status !== 'DRAFT') {
      const err = new Error('Hanya BPK DRAFT yang bisa di-approve');
      err.statusCode = 400;
      throw err;
    }
    await conn.query("UPDATE bpk SET status = 'APPROVED' WHERE idbpk = ? AND idtenant = ?", [req.params.id, ctx.idtenant]);
    await conn.commit();
    await logger.history('BPK_APPROVE', { idtenant: ctx.idtenant, idlokasi: bpk.idlokasi, iduser: ctx.iduser, ref: bpk.kodebpk, req });
    res.json({ message: 'BPK berhasil di-approve' });
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
    const ctx = getTenantContext();
    await conn.beginTransaction();

    const [[bpk]] = await conn.query('SELECT * FROM bpk WHERE idbpk = ? AND idtenant = ?', [req.params.id, ctx.idtenant]);
    if (!bpk) {
      const err = new Error('BPK tidak ditemukan');
      err.statusCode = 404;
      throw err;
    }
    if (bpk.status !== 'APPROVED') {
      const err = new Error('Hanya BPK APPROVED yang bisa batal approve');
      err.statusCode = 400;
      throw err;
    }

    const [[jual]] = await conn.query(
      "SELECT idjual FROM jual WHERE idbpk = ? AND idtenant = ? AND status != 'CANCELLED' LIMIT 1",
      [req.params.id, ctx.idtenant]
    );
    if (jual) {
      const err = new Error('BPK sudah dibuatkan Penjualan, tidak bisa batal approve');
      err.statusCode = 400;
      throw err;
    }

    await conn.query("UPDATE bpk SET status = 'DRAFT' WHERE idbpk = ? AND idtenant = ?", [req.params.id, ctx.idtenant]);
    await conn.commit();
    await logger.history('BPK_UNAPPROVE', { idtenant: ctx.idtenant, idlokasi: bpk.idlokasi, iduser: ctx.iduser, ref: bpk.kodebpk, req });
    res.json({ message: 'Approve BPK berhasil dibatalkan' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message });
  } finally {
    conn.release();
  }
};
