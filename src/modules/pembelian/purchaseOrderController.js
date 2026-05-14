const { tenantQuery, getConnection, getTenantContext } = require('../../config/db');
const { generateKodePO } = require('../../lib/kodetrans');
const logger = require('../../lib/logger');

// GET /purchase-order — Daftar PO dengan filter
exports.getAll = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tglwal, tglakhir, status, idsupplier, idlokasi, available, search } = req.query;
    let sql = `SELECT po.*, s.namasupplier FROM purchaseorder po
      LEFT JOIN supplier s ON po.idsupplier = s.idsupplier AND s.idtenant = po.idtenant
      WHERE po.idtenant = ?`;
    const params = [ctx.idtenant];
    if (available === '1' || available == 1) {
      sql += ` AND NOT EXISTS (
        SELECT 1 FROM grn g WHERE g.idpo = po.idpo AND g.status != 'VOID' AND g.idtenant = po.idtenant
      )`;
    }
    if (idlokasi) { sql += ' AND po.idlokasi = ?'; params.push(idlokasi); }
    if (tglwal) { sql += ' AND po.tgltrans >= ?'; params.push(tglwal); }
    if (tglakhir) { sql += ' AND po.tgltrans <= ?'; params.push(tglakhir); }
    if (status) { sql += ' AND po.status = ?'; params.push(status); }
    if (idsupplier) { sql += ' AND po.idsupplier = ?'; params.push(idsupplier); }
    if (search) { sql += ' AND (po.kodepo LIKE ? OR s.namasupplier LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    sql += ' ORDER BY po.tgltrans DESC, po.idpo DESC LIMIT 200';
    const rows = await tenantQuery(sql, params);
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /purchase-order/:id — Detail PO + items + supplier/lokasi full
exports.getOne = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const rows = await tenantQuery(
      `SELECT po.*, s.namasupplier, s.kodesupplier, s.alamat AS salamat, s.hp AS shp,
              l.namalokasi, l.kodelokasi
       FROM purchaseorder po
       LEFT JOIN supplier s ON po.idsupplier = s.idsupplier AND s.idtenant = po.idtenant
       LEFT JOIN lokasi l ON po.idlokasi = l.idlokasi AND l.idtenant = po.idtenant
       WHERE po.idpo = ? AND po.idtenant = ?`,
      [req.params.id, ctx.idtenant]
    );
    if (!rows.length) return res.status(404).json({ message: 'Purchase order tidak ditemukan' });

    const items = await tenantQuery(
      `SELECT pod.*, b.namabarang, b.kodebarang, b.satuanbesar, b.satuansedang, b.satuankecil, b.konversi1, b.konversi2
       FROM purchaseorderdtl pod
       LEFT JOIN barang b ON pod.idbarang = b.idbarang AND b.idtenant = pod.idtenant
       WHERE pod.idpo = ?`,
      [req.params.id]
    );
    res.json({ ...rows[0], items });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// POST /purchase-order — Buat PO DRAFT
exports.create = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    const { idsupplier, idlokasi, tgltrans, items, catatan } = req.body;

    if (!items || !items.length) return res.status(400).json({ message: 'Items tidak boleh kosong' });
    if (!idsupplier) return res.status(400).json({ message: 'Supplier wajib dipilih' });
    if (!idlokasi) return res.status(400).json({ message: 'Lokasi wajib dipilih' });

    const kodepo = await generateKodePO(conn, ctx.idtenant, idlokasi);
    const tgl = tgltrans || new Date().toISOString().slice(0, 10);

    await conn.beginTransaction();

    let grandtotal = 0;
    const [headerResult] = await conn.query(
      `INSERT INTO purchaseorder (idtenant, idlokasi, kodepo, tgltrans, idsupplier, iduser, grandtotal, catatan, status, userentry, tglentry)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'DRAFT', ?, NOW())`,
      [ctx.idtenant, idlokasi, kodepo, tgl, idsupplier, ctx.iduser, catatan || null, ctx.iduser]
    );
    const idpo = headerResult.insertId;

    for (const item of items) {
      const subtotal = parseFloat(item.harga || 0) * parseFloat(item.jml);
      grandtotal += subtotal;
      await conn.query(
        `INSERT INTO purchaseorderdtl (idpo, idtenant, idbarang, jml, jml_diterima, satuan, harga, subtotal)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
        [idpo, ctx.idtenant, item.idbarang, item.jml, item.satuan || null, item.harga || 0, subtotal]
      );
    }

    await conn.query('UPDATE purchaseorder SET grandtotal = ? WHERE idpo = ?', [grandtotal, idpo]);

    await conn.commit();
    await logger.history('PO_CREATE', { idtenant: ctx.idtenant, idlokasi, iduser: ctx.iduser, ref: kodepo, req });
    res.status(201).json({ message: 'Purchase order berhasil dibuat', kodepo, idpo, grandtotal });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// PUT /purchase-order/:id — Update PO (hanya DRAFT)
exports.update = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    const { id } = req.params;
    const { idsupplier, idlokasi, tgltrans, items, catatan } = req.body;

    if (!items || !items.length) return res.status(400).json({ message: 'Items tidak boleh kosong' });
    if (!idsupplier) return res.status(400).json({ message: 'Supplier wajib dipilih' });
    if (!idlokasi) return res.status(400).json({ message: 'Lokasi wajib dipilih' });

    await conn.beginTransaction();

    const [[po]] = await conn.query(
      'SELECT * FROM purchaseorder WHERE idpo = ? AND idtenant = ?',
      [id, ctx.idtenant]
    );
    if (!po) return res.status(404).json({ message: 'Purchase order tidak ditemukan' });
    if (po.status !== 'DRAFT') return res.status(400).json({ message: 'Hanya PO DRAFT yang bisa diedit' });

    const tgl = tgltrans || String(po.tgltrans).slice(0, 10);

    await conn.query('DELETE FROM purchaseorderdtl WHERE idpo = ? AND idtenant = ?', [id, ctx.idtenant]);
    await conn.query(
      'UPDATE purchaseorder SET idlokasi = ?, idsupplier = ?, tgltrans = ?, catatan = ? WHERE idpo = ? AND idtenant = ?',
      [idlokasi, idsupplier, tgl, catatan || null, id, ctx.idtenant]
    );

    let grandtotal = 0;
    for (const item of items) {
      const subtotal = parseFloat(item.harga || 0) * parseFloat(item.jml);
      grandtotal += subtotal;
      await conn.query(
        `INSERT INTO purchaseorderdtl (idpo, idtenant, idbarang, jml, jml_diterima, satuan, harga, subtotal)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
        [id, ctx.idtenant, item.idbarang, item.jml, item.satuan || null, item.harga || 0, subtotal]
      );
    }

    await conn.query('UPDATE purchaseorder SET grandtotal = ? WHERE idpo = ?', [grandtotal, id]);

    await conn.commit();
    await logger.history('PO_UPDATE', { idtenant: ctx.idtenant, idlokasi, iduser: ctx.iduser, ref: po.kodepo, req });
    res.json({ message: 'Purchase order berhasil diupdate', grandtotal });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// PUT /purchase-order/:id/approve — Approve PO
exports.approve = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();

    const [[po]] = await conn.query(
      'SELECT * FROM purchaseorder WHERE idpo = ? AND idtenant = ?',
      [req.params.id, ctx.idtenant]
    );
    if (!po) return res.status(404).json({ message: 'Purchase order tidak ditemukan' });
    if (po.status !== 'DRAFT') return res.status(400).json({ message: 'Hanya DRAFT yang bisa di-approve' });

    await conn.query(
      "UPDATE purchaseorder SET status = 'APPROVED' WHERE idpo = ? AND idtenant = ?",
      [req.params.id, ctx.idtenant]
    );

    await conn.commit();
    await logger.history('PO_APPROVE', { idtenant: ctx.idtenant, idlokasi: po.idlokasi, iduser: ctx.iduser, ref: po.kodepo, req });
    res.json({ message: 'Purchase order berhasil di-approve' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// PUT /purchase-order/:id/batal — Batalkan PO (hanya dari DRAFT)
exports.batal = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();

    const [[po]] = await conn.query(
      'SELECT * FROM purchaseorder WHERE idpo = ? AND idtenant = ?',
      [req.params.id, ctx.idtenant]
    );
    if (!po) return res.status(404).json({ message: 'Purchase order tidak ditemukan' });
    if (po.status !== 'DRAFT') return res.status(400).json({ message: 'Hanya DRAFT yang bisa dibatalkan' });

    await conn.query(
      "UPDATE purchaseorder SET status = 'CANCELLED' WHERE idpo = ? AND idtenant = ?",
      [req.params.id, ctx.idtenant]
    );

    await conn.commit();
    await logger.history('PO_BATAL', { idtenant: ctx.idtenant, idlokasi: po.idlokasi, iduser: ctx.iduser, ref: po.kodepo, req });
    res.json({ message: 'Purchase order berhasil dibatalkan' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};
