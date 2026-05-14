const { tenantQuery, getConnection, getTenantContext } = require('../../config/db');
const { generateKodeGRN } = require('../../lib/kodetrans');
const logger = require('../../lib/logger');

// GET /grn — Daftar GRN
exports.getAll = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tglwal, tglakhir, idsupplier, idlokasi, available, search } = req.query;
    let sql = `SELECT g.*, s.namasupplier FROM grn g
      LEFT JOIN supplier s ON g.idsupplier = s.idsupplier AND s.idtenant = g.idtenant
      WHERE g.idtenant = ?`;
    const params = [ctx.idtenant];
    if (available === '1' || available == 1) {
      sql += ` AND NOT EXISTS (
        SELECT 1 FROM beli b WHERE b.idgrn = g.idgrn AND b.status != 'VOID' AND b.idtenant = g.idtenant
      )`;
    }
    if (idlokasi) { sql += ' AND g.idlokasi = ?'; params.push(idlokasi); }
    if (tglwal) { sql += ' AND g.tgltrans >= ?'; params.push(tglwal); }
    if (tglakhir) { sql += ' AND g.tgltrans <= ?'; params.push(tglakhir); }
    if (idsupplier) { sql += ' AND g.idsupplier = ?'; params.push(idsupplier); }
    if (search) { sql += ' AND (g.kodegrn LIKE ? OR s.namasupplier LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    sql += ' ORDER BY g.tgltrans DESC, g.idgrn DESC LIMIT 200';
    const rows = await tenantQuery(sql, params);
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /grn/:id — Detail GRN + items + supplier/lokasi full
exports.getOne = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const rows = await tenantQuery(
      `SELECT g.*, s.namasupplier, s.kodesupplier, s.alamat AS salamat, s.hp AS shp,
              l.namalokasi, l.kodelokasi, po.kodepo AS kodepurchaseorder
       FROM grn g
       LEFT JOIN supplier s ON g.idsupplier = s.idsupplier AND s.idtenant = g.idtenant
       LEFT JOIN lokasi l ON g.idlokasi = l.idlokasi AND l.idtenant = g.idtenant
       LEFT JOIN purchaseorder po ON g.idpo = po.idpo
       WHERE g.idgrn = ? AND g.idtenant = ?`,
      [req.params.id, ctx.idtenant]
    );
    if (!rows.length) return res.status(404).json({ message: 'GRN tidak ditemukan' });

    const items = await tenantQuery(
      `SELECT gd.*, b.namabarang, b.kodebarang, b.satuanbesar, b.satuansedang, b.satuankecil, b.konversi1, b.konversi2
       FROM grndtl gd
       LEFT JOIN barang b ON gd.idbarang = b.idbarang AND b.idtenant = gd.idtenant
       WHERE gd.idgrn = ?`,
      [req.params.id]
    );
    res.json({ ...rows[0], items });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// POST /grn — Buat GRN (penerimaan barang)
exports.create = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    const { idsupplier, idlokasi, idpo, tgltrans, items, catatan } = req.body;

    if (!items || !items.length) return res.status(400).json({ message: 'Items tidak boleh kosong' });
    if (!idsupplier) return res.status(400).json({ message: 'Supplier wajib dipilih' });
    if (!idlokasi) return res.status(400).json({ message: 'Lokasi wajib dipilih' });
    if (!idpo) return res.status(400).json({ message: 'Kode PO (Referensi) wajib dipilih' });

    const kodegrn = await generateKodeGRN(conn, ctx.idtenant, idlokasi);
    const tgl = tgltrans || new Date().toISOString().slice(0, 10);

    await conn.beginTransaction();

    let grandtotal = 0;
    const [grnResult] = await conn.query(
      `INSERT INTO grn (idtenant, idlokasi, kodegrn, tgltrans, idpo, idsupplier, iduser, grandtotal, catatan, status, userentry, tglentry)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'AKTIF', ?, NOW())`,
      [ctx.idtenant, idlokasi, kodegrn, tgl, idpo, idsupplier, ctx.iduser, catatan || null, ctx.iduser]
    );
    const idgrn = grnResult.insertId;

    for (const item of items) {
      const subtotal = parseFloat(item.harga || 0) * parseFloat(item.jml);
      grandtotal += subtotal;

      await conn.query(
        `INSERT INTO grndtl (idgrn, idtenant, idbarang, idpodtl, jml, satuan, harga, subtotal)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [idgrn, ctx.idtenant, item.idbarang, item.idpodtl || null, item.jml, item.satuan || null, item.harga || 0, subtotal]
      );

      // Update jml_diterima di PO detail jika terkait PO
      if (item.idpodtl) {
        await conn.query(
          'UPDATE purchaseorderdtl SET jml_diterima = jml_diterima + ? WHERE idpodtl = ? AND idpo = ?',
          [item.jml, item.idpodtl, idpo]
        );
      }
    }

    await conn.query('UPDATE grn SET grandtotal = ? WHERE idgrn = ?', [grandtotal, idgrn]);

    // Update status PO
    const [[poInfo]] = await conn.query(
      `SELECT SUM(pod.jml) AS total_po, SUM(pod.jml_diterima) AS total_diterima
       FROM purchaseorderdtl pod WHERE pod.idpo = ? AND pod.idtenant = ?`,
      [idpo, ctx.idtenant]
    );
    const poStatus = parseFloat(poInfo.total_diterima) >= parseFloat(poInfo.total_po) ? 'COMPLETE' : 'PARTIAL';
    await conn.query(
      'UPDATE purchaseorder SET status = ? WHERE idpo = ? AND idtenant = ?',
      [poStatus, idpo, ctx.idtenant]
    );

    await conn.commit();
    await logger.history('GRN_CREATE', { idtenant: ctx.idtenant, idlokasi, iduser: ctx.iduser, ref: kodegrn, detail: { grandtotal }, req });
    res.status(201).json({ message: 'GRN berhasil dibuat', kodegrn, idgrn, grandtotal });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// PUT /grn/:id — Update GRN (clean slate rebuild)
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

    const [[grn]] = await conn.query(
      'SELECT * FROM grn WHERE idgrn = ? AND idtenant = ?',
      [id, ctx.idtenant]
    );
    if (!grn) return res.status(404).json({ message: 'GRN tidak ditemukan' });
    if (grn.status === 'VOID') return res.status(400).json({ message: 'GRN sudah dibatalkan' });

    // Revert jml_diterima on old PO detail rows
    const oldItems = await conn.query(
      'SELECT * FROM grndtl WHERE idgrn = ? AND idtenant = ?',
      [id, ctx.idtenant]
    );
    for (const oi of (oldItems[0] || [])) {
      if (grn.idpo && oi.idpodtl) {
        await conn.query(
          'UPDATE purchaseorderdtl SET jml_diterima = GREATEST(0, jml_diterima - ?) WHERE idpodtl = ? AND idpo = ?',
          [oi.jml, oi.idpodtl, grn.idpo]
        );
      }
    }

    await conn.query('DELETE FROM grndtl WHERE idgrn = ? AND idtenant = ?', [id, ctx.idtenant]);

    const tgl = tgltrans || String(grn.tgltrans).slice(0, 10);
    await conn.query(
      'UPDATE grn SET idlokasi = ?, idsupplier = ?, idpo = ?, tgltrans = ?, catatan = ? WHERE idgrn = ? AND idtenant = ?',
      [idlokasi, idsupplier, idpo, tgl, catatan || null, id, ctx.idtenant]
    );

    let grandtotal = 0;
    for (const item of items) {
      const subtotal = parseFloat(item.harga || 0) * parseFloat(item.jml);
      grandtotal += subtotal;
      await conn.query(
        `INSERT INTO grndtl (idgrn, idtenant, idbarang, idpodtl, jml, satuan, harga, subtotal)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, ctx.idtenant, item.idbarang, item.idpodtl || null, item.jml, item.satuan || null, item.harga || 0, subtotal]
      );
      if (item.idpodtl) {
        await conn.query(
          'UPDATE purchaseorderdtl SET jml_diterima = jml_diterima + ? WHERE idpodtl = ? AND idpo = ?',
          [item.jml, item.idpodtl, idpo]
        );
      }
    }

    await conn.query('UPDATE grn SET grandtotal = ? WHERE idgrn = ?', [grandtotal, id]);

    // Update status new PO
    const [[poInfo]] = await conn.query(
      `SELECT SUM(pod.jml) AS total_po, SUM(pod.jml_diterima) AS total_diterima
       FROM purchaseorderdtl pod WHERE pod.idpo = ? AND pod.idtenant = ?`,
      [idpo, ctx.idtenant]
    );
    const poStatus = parseFloat(poInfo.total_diterima) >= parseFloat(poInfo.total_po) ? 'COMPLETE' : 'PARTIAL';
    await conn.query(
      'UPDATE purchaseorder SET status = ? WHERE idpo = ? AND idtenant = ?',
      [poStatus, idpo, ctx.idtenant]
    );

    await conn.commit();
    await logger.history('GRN_UPDATE', { idtenant: ctx.idtenant, idlokasi, iduser: ctx.iduser, ref: grn.kodegrn, req });
    res.json({ message: 'GRN berhasil diupdate', grandtotal });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};
