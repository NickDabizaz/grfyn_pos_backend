const { tenantQuery, getConnection, getTenantContext } = require('../config/db');
const { generateKodeStockOpname, generateKodePenyesuaian } = require('../lib/kodetrans');
const logger = require('../lib/logger');

// GET /stock-opname — Daftar stock opname
exports.getAll = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tglwal, tglakhir, status } = req.query;
    let sql = `SELECT so.*, u.namauser FROM stockopname so
      LEFT JOIN user u ON so.iduser = u.iduser AND u.idtenant = so.idtenant
      WHERE so.idlokasi = ?`;
    const params = [ctx.idlokasi];
    if (tglwal) { sql += ' AND so.tgltrans >= ?'; params.push(tglwal); }
    if (tglakhir) { sql += ' AND so.tgltrans <= ?'; params.push(tglakhir); }
    if (status) { sql += ' AND so.status = ?'; params.push(status); }
    sql += ' ORDER BY so.tgltrans DESC, so.idstockopname DESC LIMIT 200';
    const rows = await tenantQuery(sql, params);
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// POST /stock-opname — Buat opname baru DRAFT, auto-load stok sistem
exports.create = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    const { tgltrans, catatan } = req.body;
    const tgl = tgltrans || new Date().toISOString().slice(0, 10);

    const kodestockopname = await generateKodeStockOpname(conn, ctx.idtenant, ctx.idlokasi);

    await conn.beginTransaction();

    const [headerResult] = await conn.query(
      `INSERT INTO stockopname (idtenant, idlokasi, kodestockopname, tgltrans, iduser, catatan, status, userentry, tglentry)
       VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?, NOW())`,
      [ctx.idtenant, ctx.idlokasi, kodestockopname, tgl, ctx.iduser, catatan || null, ctx.iduser]
    );
    const idstockopname = headerResult.insertId;

    // Auto-load semua barang dengan stok sistem saat ini dari kartustok
    const [barangList] = await conn.query(
      `SELECT b.idbarang,
         COALESCE(SUM(CASE WHEN ks.jenis='M' THEN ks.jml ELSE -ks.jml END), 0) AS stok_sistem
       FROM barang b
       LEFT JOIN kartustok ks ON ks.idbarang = b.idbarang AND ks.idtenant = b.idtenant AND ks.idlokasi = ?
       WHERE b.idtenant = ? AND b.status = 'AKTIF'
       GROUP BY b.idbarang`,
      [ctx.idlokasi, ctx.idtenant]
    );

    for (const br of barangList) {
      await conn.query(
        `INSERT INTO stockopnamedtl (idstockopname, idtenant, idbarang, stok_sistem, stok_fisik, selisih)
         VALUES (?, ?, ?, ?, 0, ?)`,
        [idstockopname, ctx.idtenant, br.idbarang, br.stok_sistem, -parseFloat(br.stok_sistem)]
      );
    }

    await conn.commit();
    await logger.history('STOCKOPNAME_CREATE', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: kodestockopname, req });
    res.status(201).json({ message: 'Stock opname berhasil dibuat', kodestockopname, idstockopname });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// GET /stock-opname/:id — Detail dengan daftar barang, stok sistem, stok fisik
exports.getOne = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const rows = await tenantQuery(
      `SELECT so.*, u.namauser FROM stockopname so
       LEFT JOIN user u ON so.iduser = u.iduser AND u.idtenant = so.idtenant
       WHERE so.idstockopname = ? AND so.idlokasi = ?`,
      [req.params.id, ctx.idlokasi]
    );
    if (!rows.length) return res.status(404).json({ message: 'Stock opname tidak ditemukan' });

    const items = await tenantQuery(
      `SELECT sod.*, b.namabarang, b.kodebarang, b.satuankecil FROM stockopnamedtl sod
       LEFT JOIN barang b ON sod.idbarang = b.idbarang AND b.idtenant = sod.idtenant
       WHERE sod.idstockopname = ?`,
      [req.params.id]
    );
    res.json({ ...rows[0], items });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// PUT /stock-opname/:id/fisik — Update stok fisik per item
exports.updateFisik = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    const { items } = req.body;

    if (!items || !items.length) return res.status(400).json({ message: 'Items tidak boleh kosong' });

    const [[opname]] = await conn.query(
      'SELECT * FROM stockopname WHERE idstockopname = ? AND idtenant = ? AND idlokasi = ?',
      [req.params.id, ctx.idtenant, ctx.idlokasi]
    );
    if (!opname) return res.status(404).json({ message: 'Stock opname tidak ditemukan' });
    if (opname.status !== 'DRAFT') return res.status(400).json({ message: 'Hanya opname DRAFT yang bisa diupdate' });

    await conn.beginTransaction();

    for (const item of items) {
      const stokFisik = parseFloat(item.stok_fisik);
      const [[dtl]] = await conn.query(
        'SELECT stok_sistem FROM stockopnamedtl WHERE idstockopname = ? AND idbarang = ? AND idtenant = ?',
        [req.params.id, item.idbarang, ctx.idtenant]
      );
      if (dtl) {
        const selisih = stokFisik - parseFloat(dtl.stok_sistem);
        await conn.query(
          'UPDATE stockopnamedtl SET stok_fisik = ?, selisih = ? WHERE idstockopname = ? AND idbarang = ? AND idtenant = ?',
          [stokFisik, selisih, req.params.id, item.idbarang, ctx.idtenant]
        );
      }
    }

    await conn.commit();
    res.json({ message: 'Stok fisik berhasil diupdate' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// PUT /stock-opname/:id/finalize — Finalisasi opname, buat penyesuaian stok
exports.finalize = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();

    const [[opname]] = await conn.query(
      'SELECT * FROM stockopname WHERE idstockopname = ? AND idtenant = ? AND idlokasi = ?',
      [req.params.id, ctx.idtenant, ctx.idlokasi]
    );
    if (!opname) return res.status(404).json({ message: 'Stock opname tidak ditemukan' });
    if (opname.status !== 'DRAFT') return res.status(400).json({ message: 'Hanya opname DRAFT yang bisa difinalisasi' });

    const [details] = await conn.query(
      'SELECT * FROM stockopnamedtl WHERE idstockopname = ? AND idtenant = ? AND selisih != 0',
      [req.params.id, ctx.idtenant]
    );

    if (details.length > 0) {
      const kodepenyesuaian = await generateKodePenyesuaian(conn, ctx.idtenant, ctx.idlokasi);
      const tgl = opname.tgltrans instanceof Date
        ? opname.tgltrans.toISOString().slice(0, 10)
        : String(opname.tgltrans).slice(0, 10);

      const [penyResult] = await conn.query(
        `INSERT INTO penyesuaianstok (idtenant, idlokasi, kodepenyesuaianstok, tgltrans, iduser, keterangan, status, userentry)
         VALUES (?, ?, ?, ?, ?, ?, 'AKTIF', ?)`,
        [ctx.idtenant, ctx.idlokasi, kodepenyesuaian, tgl, ctx.iduser, `Stock Opname ${opname.kodestockopname}`, ctx.iduser]
      );
      const idpenyesuaian = penyResult.insertId;

      for (const dtl of details) {
        const selisih = parseFloat(dtl.selisih);
        await conn.query(
          `INSERT INTO penyesuaianstokdtl (idpenyesuaianstok, idtenant, idbarang, jml, selisih, keterangan)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [idpenyesuaian, ctx.idtenant, dtl.idbarang, parseFloat(dtl.stok_fisik), selisih, `Opname ${opname.kodestockopname}`]
        );

        const jenis = selisih > 0 ? 'M' : 'K';
        await conn.query(
          `INSERT INTO kartustok (idtenant, idlokasi, kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idref, jenisref)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'stockopname')`,
          [ctx.idtenant, ctx.idlokasi, kodepenyesuaian, dtl.idbarang, Math.abs(selisih), jenis, tgl, `Opname ${opname.kodestockopname}`, idpenyesuaian]
        );
      }
    }

    await conn.query(
      "UPDATE stockopname SET status = 'FINALIZED' WHERE idstockopname = ? AND idtenant = ?",
      [req.params.id, ctx.idtenant]
    );

    await conn.commit();
    await logger.history('STOCKOPNAME_FINALIZE', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: opname.kodestockopname, req });
    res.json({ message: 'Stock opname berhasil difinalisasi', jumlah_penyesuaian: details.length });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};
