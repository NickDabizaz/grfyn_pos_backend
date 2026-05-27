const { tenantQuery, getConnection, getTenantContext } = require('../../config/db');
const { generateKodeBPB } = require('../../lib/kodetrans');
const logger = require('../../lib/logger');

const ACTIVE_STATUSES = ['DRAFT', 'APPROVED', 'CONFIRMED'];

function shouldApprove(req) {
  return req.body.approve === true || req.body.status === 'APPROVED';
}

async function assertPoApproved(conn, idpo, idtenant) {
  const [[po]] = await conn.query(
    'SELECT * FROM purchaseorder WHERE idpo = ? AND idtenant = ?',
    [idpo, idtenant]
  );
  if (!po) {
    const err = new Error('Purchase order tidak ditemukan');
    err.statusCode = 404;
    throw err;
  }
  if (po.status !== 'APPROVED' && po.status !== 'CONFIRMED') {
    const err = new Error('BPB hanya bisa dibuat dari PO APPROVED');
    err.statusCode = 400;
    throw err;
  }
  return po;
}

function raiseValidation(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  throw err;
}

async function validateBpbMatchesPo(conn, { po, idtenant, idsupplier, idlokasi, items }) {
  if (Number(idsupplier) !== Number(po.idsupplier)) {
    raiseValidation('Supplier BPB harus sama dengan supplier PO dan tidak boleh diganti');
  }
  if (Number(idlokasi) !== Number(po.idlokasi)) {
    raiseValidation('Lokasi BPB harus sama dengan lokasi PO dan tidak boleh diganti');
  }

  const [poItems] = await conn.query(
    'SELECT idpodtl, idbarang, jml FROM purchaseorderdtl WHERE idpo = ? AND idtenant = ?',
    [po.idpo, idtenant]
  );
  if (items.length !== poItems.length) {
    raiseValidation('Barang BPB harus sama dengan barang di PO; tidak boleh ditambah atau dikurangi');
  }

  const poItemByDetailId = new Map(poItems.map(item => [Number(item.idpodtl), item]));
  const usedDetailIds = new Set();

  for (const item of items) {
    const detailId = Number(item.idpodtl);
    const poItem = poItemByDetailId.get(detailId);
    if (!detailId || !poItem) {
      raiseValidation('Setiap barang BPB wajib berasal dari detail PO yang dipilih');
    }
    if (usedDetailIds.has(detailId)) {
      raiseValidation('Detail PO tidak boleh dipakai lebih dari satu baris BPB');
    }
    usedDetailIds.add(detailId);

    if (Number(item.idbarang) !== Number(poItem.idbarang)) {
      raiseValidation('Barang BPB harus sama dengan barang di PO');
    }

    const jml = parseFloat(item.jml);
    if (!Number.isFinite(jml) || jml <= 0) {
      raiseValidation('Jumlah BPB harus lebih dari 0');
    }
    if (jml > parseFloat(poItem.jml)) {
      raiseValidation('Jumlah BPB tidak boleh melebihi jumlah PO');
    }
  }
}

async function rebuildDetails(conn, { idbpb, idtenant, idpo, items }) {
  let grandtotal = 0;
  for (const item of items) {
    const jml = parseFloat(item.jml) || 0;
    const harga = parseFloat(item.harga || 0);
    const subtotal = harga * jml;
    grandtotal += subtotal;

    await conn.query(
      `INSERT INTO bpbdtl (idbpb, idtenant, idbarang, idpodtl, jml, satuan, harga, subtotal)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [idbpb, idtenant, item.idbarang, item.idpodtl || null, jml, item.satuan || null, harga, subtotal]
    );

    if (item.idpodtl) {
      await conn.query(
        'UPDATE purchaseorderdtl SET jml_diterima = jml_diterima + ? WHERE idpodtl = ? AND idpo = ? AND idtenant = ?',
        [jml, item.idpodtl, idpo, idtenant]
      );
    }
  }
  return grandtotal;
}

async function revertOldDetails(conn, { idbpb, idtenant, idpo }) {
  const [oldItems] = await conn.query(
    'SELECT * FROM bpbdtl WHERE idbpb = ? AND idtenant = ?',
    [idbpb, idtenant]
  );
  for (const item of oldItems) {
    if (idpo && item.idpodtl) {
      await conn.query(
        'UPDATE purchaseorderdtl SET jml_diterima = GREATEST(0, jml_diterima - ?) WHERE idpodtl = ? AND idpo = ? AND idtenant = ?',
        [item.jml, item.idpodtl, idpo, idtenant]
      );
    }
  }
}

exports.getAll = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tglwal, tglakhir, idsupplier, idlokasi, available, search, status } = req.query;
    let sql = `SELECT bpb.*, DATE_FORMAT(bpb.tgltrans, '%Y-%m-%d') AS tgltrans,
        s.namasupplier, po.kodepo AS kodepurchaseorder
      FROM bpb
      LEFT JOIN supplier s ON bpb.idsupplier = s.idsupplier AND s.idtenant = bpb.idtenant
      LEFT JOIN purchaseorder po ON bpb.idpo = po.idpo AND po.idtenant = bpb.idtenant
      WHERE bpb.idtenant = ?`;
    const params = [ctx.idtenant];
    if (available === '1' || available == 1) {
      sql += ` AND bpb.status = 'APPROVED' AND NOT EXISTS (
        SELECT 1 FROM beli bl WHERE bl.idbpb = bpb.idbpb AND bl.status != 'CANCELLED' AND bl.idtenant = bpb.idtenant
      )`;
    }
    if (idlokasi) { sql += ' AND bpb.idlokasi = ?'; params.push(idlokasi); }
    if (tglwal) { sql += ' AND bpb.tgltrans >= ?'; params.push(tglwal); }
    if (tglakhir) { sql += ' AND bpb.tgltrans <= ?'; params.push(tglakhir); }
    if (idsupplier) { sql += ' AND bpb.idsupplier = ?'; params.push(idsupplier); }
    if (status) { sql += ' AND bpb.status = ?'; params.push(status); }
    if (search) { sql += ' AND (bpb.kodebpb LIKE ? OR s.namasupplier LIKE ? OR po.kodepo LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    sql += ' ORDER BY bpb.tgltrans DESC, bpb.idbpb DESC LIMIT 200';
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
      `SELECT bpb.*, DATE_FORMAT(bpb.tgltrans, '%Y-%m-%d') AS tgltrans,
              s.namasupplier, s.kodesupplier, s.alamat AS salamat, s.hp AS shp,
              l.namalokasi, l.kodelokasi, po.kodepo AS kodepurchaseorder
       FROM bpb
       LEFT JOIN supplier s ON bpb.idsupplier = s.idsupplier AND s.idtenant = bpb.idtenant
       LEFT JOIN lokasi l ON bpb.idlokasi = l.idlokasi AND l.idtenant = bpb.idtenant
       LEFT JOIN purchaseorder po ON bpb.idpo = po.idpo AND po.idtenant = bpb.idtenant
       WHERE bpb.idbpb = ? AND bpb.idtenant = ?`,
      [req.params.id, ctx.idtenant]
    );
    if (!rows.length) return res.status(404).json({ message: 'BPB tidak ditemukan' });

    const items = await tenantQuery(
      `SELECT bd.*, b.namabarang, b.kodebarang, b.satuanbesar, b.satuansedang, b.satuankecil, b.konversi1, b.konversi2
       FROM bpbdtl bd
       LEFT JOIN barang b ON bd.idbarang = b.idbarang AND b.idtenant = bd.idtenant
       WHERE bd.idbpb = ? AND bd.idtenant = ?`,
      [req.params.id, ctx.idtenant]
    );
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
    const { idsupplier, idlokasi, idpo, tgltrans, items, catatan } = req.body;

    if (!items || !items.length) return res.status(400).json({ message: 'Items tidak boleh kosong' });
    if (!idsupplier) return res.status(400).json({ message: 'Supplier wajib dipilih' });
    if (!idlokasi) return res.status(400).json({ message: 'Lokasi wajib dipilih' });
    if (!idpo) return res.status(400).json({ message: 'Kode PO (Referensi) wajib dipilih' });

    const kodebpb = await generateKodeBPB(conn, ctx.idtenant, idlokasi);
    const tgl = tgltrans || new Date().toISOString().slice(0, 10);
    const status = shouldApprove(req) ? 'APPROVED' : 'DRAFT';

    await conn.beginTransaction();
    const po = await assertPoApproved(conn, idpo, ctx.idtenant);
    await validateBpbMatchesPo(conn, { po, idtenant: ctx.idtenant, idsupplier, idlokasi, items });

    const [result] = await conn.query(
      `INSERT INTO bpb (idtenant, idlokasi, kodebpb, tgltrans, idpo, idsupplier, iduser, grandtotal, catatan, status, userentry, tglentry)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, NOW())`,
      [ctx.idtenant, idlokasi, kodebpb, tgl, idpo, idsupplier, ctx.iduser, catatan || null, status, ctx.iduser]
    );
    const idbpb = result.insertId;
    const grandtotal = await rebuildDetails(conn, { idbpb, idtenant: ctx.idtenant, idpo, items });

    await conn.query('UPDATE bpb SET grandtotal = ? WHERE idbpb = ? AND idtenant = ?', [grandtotal, idbpb, ctx.idtenant]);
    await conn.query("UPDATE purchaseorder SET status = 'CONFIRMED' WHERE idpo = ? AND idtenant = ?", [idpo, ctx.idtenant]);

    await conn.commit();
    await logger.history('BPB_CREATE', { idtenant: ctx.idtenant, idlokasi, iduser: ctx.iduser, ref: kodebpb, detail: { grandtotal, status }, req });
    res.status(201).json({ message: 'BPB berhasil dibuat', kodebpb, idbpb, grandtotal, status });
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
    const { idsupplier, idlokasi, idpo, tgltrans, items, catatan } = req.body;

    if (!items || !items.length) return res.status(400).json({ message: 'Items tidak boleh kosong' });
    if (!idsupplier) return res.status(400).json({ message: 'Supplier wajib dipilih' });
    if (!idlokasi) return res.status(400).json({ message: 'Lokasi wajib dipilih' });
    if (!idpo) return res.status(400).json({ message: 'Kode PO (Referensi) wajib dipilih' });

    await conn.beginTransaction();

    const [[bpb]] = await conn.query('SELECT * FROM bpb WHERE idbpb = ? AND idtenant = ?', [id, ctx.idtenant]);
    if (!bpb) {
      const err = new Error('BPB tidak ditemukan');
      err.statusCode = 404;
      throw err;
    }
    if (bpb.status !== 'DRAFT') {
      const err = new Error('Hanya BPB DRAFT yang bisa diedit');
      err.statusCode = 400;
      throw err;
    }

    if (Number(idpo) !== Number(bpb.idpo)) {
      raiseValidation('PO referensi BPB tidak boleh diganti');
    }

    const po = await assertPoApproved(conn, idpo, ctx.idtenant);
    await validateBpbMatchesPo(conn, { po, idtenant: ctx.idtenant, idsupplier, idlokasi, items });
    await revertOldDetails(conn, { idbpb: id, idtenant: ctx.idtenant, idpo: bpb.idpo });
    await conn.query('DELETE FROM bpbdtl WHERE idbpb = ? AND idtenant = ?', [id, ctx.idtenant]);

    const tgl = tgltrans || String(bpb.tgltrans).slice(0, 10);
    const status = shouldApprove(req) ? 'APPROVED' : 'DRAFT';
    await conn.query(
      'UPDATE bpb SET idlokasi = ?, idsupplier = ?, idpo = ?, tgltrans = ?, catatan = ?, status = ? WHERE idbpb = ? AND idtenant = ?',
      [idlokasi, idsupplier, idpo, tgl, catatan || null, status, id, ctx.idtenant]
    );

    const grandtotal = await rebuildDetails(conn, { idbpb: id, idtenant: ctx.idtenant, idpo, items });
    await conn.query('UPDATE bpb SET grandtotal = ? WHERE idbpb = ? AND idtenant = ?', [grandtotal, id, ctx.idtenant]);
    await conn.query("UPDATE purchaseorder SET status = 'CONFIRMED' WHERE idpo = ? AND idtenant = ?", [idpo, ctx.idtenant]);

    await conn.commit();
    await logger.history('BPB_UPDATE', { idtenant: ctx.idtenant, idlokasi, iduser: ctx.iduser, ref: bpb.kodebpb, detail: { grandtotal, status }, req });
    res.json({ message: 'BPB berhasil diupdate', grandtotal, status });
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
    const [[bpb]] = await conn.query('SELECT * FROM bpb WHERE idbpb = ? AND idtenant = ?', [req.params.id, ctx.idtenant]);
    if (!bpb) {
      const err = new Error('BPB tidak ditemukan');
      err.statusCode = 404;
      throw err;
    }
    if (bpb.status !== 'DRAFT') {
      const err = new Error('Hanya BPB DRAFT yang bisa di-approve');
      err.statusCode = 400;
      throw err;
    }
    await conn.query("UPDATE bpb SET status = 'APPROVED' WHERE idbpb = ? AND idtenant = ?", [req.params.id, ctx.idtenant]);
    await conn.commit();
    await logger.history('BPB_APPROVE', { idtenant: ctx.idtenant, idlokasi: bpb.idlokasi, iduser: ctx.iduser, ref: bpb.kodebpb, req });
    res.json({ message: 'BPB berhasil di-approve' });
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

    const [[bpb]] = await conn.query('SELECT * FROM bpb WHERE idbpb = ? AND idtenant = ?', [req.params.id, ctx.idtenant]);
    if (!bpb) {
      const err = new Error('BPB tidak ditemukan');
      err.statusCode = 404;
      throw err;
    }
    if (bpb.status !== 'APPROVED') {
      const err = new Error('Hanya BPB APPROVED yang bisa batal approve');
      err.statusCode = 400;
      throw err;
    }

    const [[beli]] = await conn.query(
      "SELECT idbeli FROM beli WHERE idbpb = ? AND idtenant = ? AND status != 'CANCELLED' LIMIT 1",
      [req.params.id, ctx.idtenant]
    );
    if (beli) {
      const err = new Error('BPB sudah dibuatkan Pembelian, tidak bisa batal approve');
      err.statusCode = 400;
      throw err;
    }

    await conn.query("UPDATE bpb SET status = 'DRAFT' WHERE idbpb = ? AND idtenant = ?", [req.params.id, ctx.idtenant]);
    await conn.commit();
    await logger.history('BPB_UNAPPROVE', { idtenant: ctx.idtenant, idlokasi: bpb.idlokasi, iduser: ctx.iduser, ref: bpb.kodebpb, req });
    res.json({ message: 'Approve BPB berhasil dibatalkan' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.batal = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();

    const [[bpb]] = await conn.query('SELECT * FROM bpb WHERE idbpb = ? AND idtenant = ?', [req.params.id, ctx.idtenant]);
    if (!bpb) {
      const err = new Error('BPB tidak ditemukan');
      err.statusCode = 404;
      throw err;
    }
    if (bpb.status !== 'DRAFT') {
      const err = new Error('Hanya BPB DRAFT yang bisa dibatalkan');
      err.statusCode = 400;
      throw err;
    }

    await revertOldDetails(conn, { idbpb: req.params.id, idtenant: ctx.idtenant, idpo: bpb.idpo });
    await conn.query("UPDATE bpb SET status = 'CANCELLED' WHERE idbpb = ? AND idtenant = ?", [req.params.id, ctx.idtenant]);

    const [[activeBpb]] = await conn.query(
      "SELECT idbpb FROM bpb WHERE idpo = ? AND idtenant = ? AND status != 'CANCELLED' LIMIT 1",
      [bpb.idpo, ctx.idtenant]
    );
    if (!activeBpb) {
      await conn.query("UPDATE purchaseorder SET status = 'APPROVED' WHERE idpo = ? AND idtenant = ?", [bpb.idpo, ctx.idtenant]);
    }

    await conn.commit();
    await logger.history('BPB_BATAL', { idtenant: ctx.idtenant, idlokasi: bpb.idlokasi, iduser: ctx.iduser, ref: bpb.kodebpb, req });
    res.json({ message: 'BPB berhasil dibatalkan' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message });
  } finally {
    conn.release();
  }
};
