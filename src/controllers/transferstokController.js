const { tenantQuery, getConnection, getTenantContext } = require('../config/db');
const { generateKodeTransferStok } = require('../lib/kodetrans');
const logger = require('../lib/logger');

// GET /transfer-stok — Daftar transfer stok dengan filter
exports.getAll = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tglwal, tglakhir, status } = req.query;
    let sql = `SELECT ts.*, l2.namalokasi AS namalokasitujuan
      FROM transferstok ts
      LEFT JOIN lokasi l2 ON ts.idlokasitujuan = l2.idlokasi AND l2.idtenant = ts.idtenant
      WHERE ts.idlokasi = ?`;
    const params = [ctx.idlokasi];
    if (tglwal) { sql += ' AND ts.tgltrans >= ?'; params.push(tglwal); }
    if (tglakhir) { sql += ' AND ts.tgltrans <= ?'; params.push(tglakhir); }
    if (status) { sql += ' AND ts.status = ?'; params.push(status); }
    sql += ' ORDER BY ts.tgltrans DESC, ts.idtransferstok DESC LIMIT 200';
    const rows = await tenantQuery(sql, params);
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /transfer-stok/:id — Detail transfer stok + items
exports.getOne = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const rows = await tenantQuery(
      `SELECT ts.*, l2.namalokasi AS namalokasitujuan
       FROM transferstok ts
       LEFT JOIN lokasi l2 ON ts.idlokasitujuan = l2.idlokasi AND l2.idtenant = ts.idtenant
       WHERE ts.idtransferstok = ? AND ts.idlokasi = ?`,
      [req.params.id, ctx.idlokasi]
    );
    if (!rows.length) return res.status(404).json({ message: 'Transfer stok tidak ditemukan' });

    const items = await tenantQuery(
      `SELECT tsd.*, b.namabarang, b.kodebarang
       FROM transferstokdtl tsd
       LEFT JOIN barang b ON tsd.idbarang = b.idbarang AND b.idtenant = tsd.idtenant
       WHERE tsd.idtransferstok = ?`,
      [req.params.id]
    );
    res.json({ ...rows[0], items });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// POST /transfer-stok — Buat transfer stok DRAFT (belum gerak stok)
exports.create = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    const { idlokasitujuan, tgltrans, items, catatan } = req.body;

    if (!idlokasitujuan) return res.status(400).json({ message: 'idlokasitujuan wajib diisi' });
    if (parseInt(idlokasitujuan) === ctx.idlokasi) return res.status(400).json({ message: 'Lokasi tujuan tidak boleh sama dengan lokasi asal' });
    if (!items || !items.length) return res.status(400).json({ message: 'Items tidak boleh kosong' });

    const kodetransferstok = await generateKodeTransferStok(conn, ctx.idtenant, ctx.idlokasi);
    const tgl = tgltrans || new Date().toISOString().slice(0, 10);

    await conn.beginTransaction();

    const [headerResult] = await conn.query(
      `INSERT INTO transferstok (idtenant, idlokasi, kodetransferstok, tgltrans, idlokasitujuan, iduser, catatan, status, userentry, tglentry)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, NOW())`,
      [ctx.idtenant, ctx.idlokasi, kodetransferstok, tgl, idlokasitujuan, ctx.iduser, catatan || null, ctx.iduser]
    );
    const idtransferstok = headerResult.insertId;

    for (const item of items) {
      await conn.query(
        `INSERT INTO transferstokdtl (idtransferstok, idtenant, idbarang, jml, satuan, keterangan)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [idtransferstok, ctx.idtenant, item.idbarang, item.jml, item.satuan || null, item.keterangan || null]
      );
    }

    await conn.commit();
    await logger.history('TRANSFERSTOK_CREATE', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: kodetransferstok, req });
    res.status(201).json({ message: 'Transfer stok berhasil dibuat', kodetransferstok, idtransferstok });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// PUT /transfer-stok/:id/kirim — Ubah status DIKIRIM, kurangi stok di lokasi asal
exports.kirim = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();

    const [[ts]] = await conn.query(
      'SELECT * FROM transferstok WHERE idtransferstok = ? AND idtenant = ? AND idlokasi = ?',
      [req.params.id, ctx.idtenant, ctx.idlokasi]
    );
    if (!ts) return res.status(404).json({ message: 'Transfer stok tidak ditemukan' });
    if (ts.status !== 'DRAFT') return res.status(400).json({ message: 'Hanya status DRAFT yang bisa dikirim' });

    const [items] = await conn.query(
      'SELECT * FROM transferstokdtl WHERE idtransferstok = ? AND idtenant = ?',
      [req.params.id, ctx.idtenant]
    );

    const tgl = new Date().toISOString().slice(0, 10);
    for (const item of items) {
      await conn.query(
        `INSERT INTO kartustok (idtenant, idlokasi, kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idref, jenisref)
         VALUES (?, ?, ?, ?, ?, 'K', ?, ?, ?, 'transferstok_keluar')`,
        [ctx.idtenant, ctx.idlokasi, ts.kodetransferstok, item.idbarang, item.jml, tgl, `Transfer Keluar ${ts.kodetransferstok}`, ts.idtransferstok]
      );
    }

    await conn.query(
      "UPDATE transferstok SET status = 'DIKIRIM' WHERE idtransferstok = ? AND idtenant = ?",
      [req.params.id, ctx.idtenant]
    );

    await conn.commit();
    await logger.history('TRANSFERSTOK_KIRIM', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: ts.kodetransferstok, req });
    res.json({ message: 'Transfer stok berhasil dikirim' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// PUT /transfer-stok/:id/terima — Ubah status DITERIMA, tambah stok di lokasi tujuan
exports.terima = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();

    // Boleh diterima oleh lokasi tujuan
    const [[ts]] = await conn.query(
      'SELECT * FROM transferstok WHERE idtransferstok = ? AND idtenant = ?',
      [req.params.id, ctx.idtenant]
    );
    if (!ts) return res.status(404).json({ message: 'Transfer stok tidak ditemukan' });
    if (ts.status !== 'DIKIRIM') return res.status(400).json({ message: 'Hanya status DIKIRIM yang bisa diterima' });

    const [items] = await conn.query(
      'SELECT * FROM transferstokdtl WHERE idtransferstok = ? AND idtenant = ?',
      [req.params.id, ctx.idtenant]
    );

    const tgl = new Date().toISOString().slice(0, 10);
    for (const item of items) {
      await conn.query(
        `INSERT INTO kartustok (idtenant, idlokasi, kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idref, jenisref)
         VALUES (?, ?, ?, ?, ?, 'M', ?, ?, ?, 'transferstok_masuk')`,
        [ctx.idtenant, ts.idlokasitujuan, ts.kodetransferstok, item.idbarang, item.jml, tgl, `Transfer Masuk ${ts.kodetransferstok}`, ts.idtransferstok]
      );
    }

    await conn.query(
      "UPDATE transferstok SET status = 'DITERIMA' WHERE idtransferstok = ? AND idtenant = ?",
      [req.params.id, ctx.idtenant]
    );

    await conn.commit();
    await logger.history('TRANSFERSTOK_TERIMA', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: ts.kodetransferstok, req });
    res.json({ message: 'Transfer stok berhasil diterima' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// PUT /transfer-stok/:id/batal — Batalkan transfer stok
exports.batal = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();

    const [[ts]] = await conn.query(
      'SELECT * FROM transferstok WHERE idtransferstok = ? AND idtenant = ? AND idlokasi = ?',
      [req.params.id, ctx.idtenant, ctx.idlokasi]
    );
    if (!ts) return res.status(404).json({ message: 'Transfer stok tidak ditemukan' });
    if (ts.status === 'DIBATALKAN') return res.status(400).json({ message: 'Transfer sudah dibatalkan' });
    if (ts.status === 'DITERIMA') return res.status(400).json({ message: 'Transfer yang sudah diterima tidak bisa dibatalkan' });

    // Jika sudah DIKIRIM, reverse stok yang sudah dikurangi
    if (ts.status === 'DIKIRIM') {
      const [items] = await conn.query(
        'SELECT * FROM transferstokdtl WHERE idtransferstok = ? AND idtenant = ?',
        [req.params.id, ctx.idtenant]
      );
      const tgl = new Date().toISOString().slice(0, 10);
      for (const item of items) {
        await conn.query(
          `INSERT INTO kartustok (idtenant, idlokasi, kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idref, jenisref)
           VALUES (?, ?, ?, ?, ?, 'M', ?, ?, ?, 'transferstok_batal')`,
          [ctx.idtenant, ctx.idlokasi, `BATAL-${ts.kodetransferstok}`, item.idbarang, item.jml, tgl, `Batal Transfer ${ts.kodetransferstok}`, ts.idtransferstok]
        );
      }
    }

    await conn.query(
      "UPDATE transferstok SET status = 'DIBATALKAN' WHERE idtransferstok = ? AND idtenant = ?",
      [req.params.id, ctx.idtenant]
    );

    await conn.commit();
    await logger.history('TRANSFERSTOK_BATAL', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: ts.kodetransferstok, req });
    res.json({ message: 'Transfer stok berhasil dibatalkan' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};
