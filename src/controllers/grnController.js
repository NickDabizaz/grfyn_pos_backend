const { tenantQuery, getConnection, getTenantContext } = require('../config/db');
const { generateKodeGRN, generateKodeBeli } = require('../lib/kodetrans');
const logger = require('../lib/logger');

// GET /grn — Daftar GRN
exports.getAll = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tglwal, tglakhir, idsupplier } = req.query;
    let sql = `SELECT g.*, s.namasupplier FROM grn g
      LEFT JOIN supplier s ON g.idsupplier = s.idsupplier AND s.idtenant = g.idtenant
      WHERE g.idlokasi = ?`;
    const params = [ctx.idlokasi];
    if (tglwal) { sql += ' AND g.tgltrans >= ?'; params.push(tglwal); }
    if (tglakhir) { sql += ' AND g.tgltrans <= ?'; params.push(tglakhir); }
    if (idsupplier) { sql += ' AND g.idsupplier = ?'; params.push(idsupplier); }
    sql += ' ORDER BY g.tgltrans DESC, g.idgrn DESC LIMIT 200';
    const rows = await tenantQuery(sql, params);
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /grn/:id — Detail GRN + items
exports.getOne = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const rows = await tenantQuery(
      `SELECT g.*, s.namasupplier FROM grn g
       LEFT JOIN supplier s ON g.idsupplier = s.idsupplier AND s.idtenant = g.idtenant
       WHERE g.idgrn = ? AND g.idlokasi = ?`,
      [req.params.id, ctx.idlokasi]
    );
    if (!rows.length) return res.status(404).json({ message: 'GRN tidak ditemukan' });

    const items = await tenantQuery(
      `SELECT gd.*, b.namabarang, b.kodebarang FROM grndtl gd
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

// POST /grn — Buat GRN (penerimaan barang), insert stok, hutang, beli, jurnal
exports.create = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    const { idsupplier, idpo, tgltrans, items, catatan } = req.body;

    if (!items || !items.length) return res.status(400).json({ message: 'Items tidak boleh kosong' });

    const kodegrn = await generateKodeGRN(conn, ctx.idtenant, ctx.idlokasi);
    const kodebeli = await generateKodeBeli(conn, ctx.idtenant, ctx.idlokasi);
    const tgl = tgltrans || new Date().toISOString().slice(0, 10);

    await conn.beginTransaction();

    let grandtotal = 0;
    const [grnResult] = await conn.query(
      `INSERT INTO grn (idtenant, idlokasi, kodegrn, tgltrans, idpo, idsupplier, iduser, grandtotal, catatan, status, userentry, tglentry)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'AKTIF', ?, NOW())`,
      [ctx.idtenant, ctx.idlokasi, kodegrn, tgl, idpo || null, idsupplier || null, ctx.iduser, catatan || null, ctx.iduser]
    );
    const idgrn = grnResult.insertId;

    // Buat faktur beli otomatis dari GRN
    const [beliResult] = await conn.query(
      `INSERT INTO beli (idtenant, idlokasi, kodebeli, tgltrans, idsupplier, iduser, grandtotal, bayar, status, userentry)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, 'AKTIF', ?)`,
      [ctx.idtenant, ctx.idlokasi, kodebeli, tgl, idsupplier || null, ctx.iduser, ctx.iduser]
    );
    const idbeli = beliResult.insertId;

    for (const item of items) {
      const subtotal = parseFloat(item.harga || 0) * parseFloat(item.jml);
      grandtotal += subtotal;

      await conn.query(
        `INSERT INTO grndtl (idgrn, idtenant, idbarang, idpodtl, jml, satuan, harga, subtotal)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [idgrn, ctx.idtenant, item.idbarang, item.idpodtl || null, item.jml, item.satuan || null, item.harga || 0, subtotal]
      );

      // Stok masuk
      await conn.query(
        `INSERT INTO kartustok (idtenant, idlokasi, kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idref, jenisref)
         VALUES (?, ?, ?, ?, ?, 'M', ?, ?, ?, 'grn')`,
        [ctx.idtenant, ctx.idlokasi, kodegrn, item.idbarang, item.jml, tgl, `GRN ${kodegrn}`, idgrn]
      );

      // Detail faktur beli
      await conn.query(
        `INSERT INTO belidtl (idbeli, idtenant, idbarang, jml, harga, ppn, diskon, subtotal, satuan)
         VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)`,
        [idbeli, ctx.idtenant, item.idbarang, item.jml, item.harga || 0, subtotal, item.satuan || null]
      );

      // Update jml_diterima di PO detail jika terkait PO
      if (idpo && item.idpodtl) {
        await conn.query(
          'UPDATE purchaseorderdtl SET jml_diterima = jml_diterima + ? WHERE idpodtl = ? AND idpo = ?',
          [item.jml, item.idpodtl, idpo]
        );
      }
    }

    await conn.query('UPDATE grn SET grandtotal = ? WHERE idgrn = ?', [grandtotal, idgrn]);
    await conn.query('UPDATE beli SET grandtotal = ? WHERE idbeli = ?', [grandtotal, idbeli]);

    // Update status PO jika terkait
    if (idpo) {
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
    }

    // Catat hutang ke supplier
    if (idsupplier) {
      await conn.query(
        `INSERT INTO kartuhutang (idtenant, idlokasi, idsupplier, kodetrans, jenis, amount, terbayar, sisa, tgltrans, status)
         VALUES (?, ?, ?, ?, 'BELI', ?, 0, ?, ?, 'OPEN')`,
        [ctx.idtenant, ctx.idlokasi, idsupplier, kodebeli, grandtotal, grandtotal, tgl]
      );
    }

    // Jurnal: DEBET Persediaan (1-1004), KREDIT Hutang Usaha (2-1001)
    const [[akunPersediaan]] = await conn.query(
      "SELECT idakun FROM akun WHERE idtenant = ? AND kodeakun = '1-1004' LIMIT 1",
      [ctx.idtenant]
    );
    const [[akunHutang]] = await conn.query(
      "SELECT idakun FROM akun WHERE idtenant = ? AND kodeakun = '2-1001' LIMIT 1",
      [ctx.idtenant]
    );
    if (akunPersediaan) {
      await conn.query(
        `INSERT INTO jurnal (idtenant, idlokasi, idtrans, kodetrans, jenis, tgltrans, idakun, posisi, amount, status)
         VALUES (?, ?, ?, ?, 'grn', ?, ?, 'DEBET', ?, 'AKTIF')`,
        [ctx.idtenant, ctx.idlokasi, idgrn, kodegrn, tgl, akunPersediaan.idakun, grandtotal]
      );
    }
    if (akunHutang) {
      await conn.query(
        `INSERT INTO jurnal (idtenant, idlokasi, idtrans, kodetrans, jenis, tgltrans, idakun, posisi, amount, status)
         VALUES (?, ?, ?, ?, 'grn', ?, ?, 'KREDIT', ?, 'AKTIF')`,
        [ctx.idtenant, ctx.idlokasi, idgrn, kodegrn, tgl, akunHutang.idakun, grandtotal]
      );
    }

    await conn.commit();
    await logger.history('GRN_CREATE', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: kodegrn, detail: { grandtotal }, req });
    res.status(201).json({ message: 'GRN berhasil dibuat', kodegrn, idgrn, kodebeli, idbeli, grandtotal });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};
