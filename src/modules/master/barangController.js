// Controller untuk manajemen data barang (produk).
// Menangani CRUD barang, riwayat harga beli/jual, pengecekan harga, dan kalkulasi stok berbasis kartustok.

const { tenantQuery, tenantExecute, getConnection, getTenantContext } = require('../../config/db');
const { generateKodeMaster } = require('../../lib/kodetrans');
const { isPakaiBahanBakuEnabled } = require('../../lib/confighelper');
const logger = require('../../lib/logger');

const JENIS_OPTIONS = ['BAHAN BAKU', 'BAHAN SETENGAH JADI', 'BARANG JADI'];

function normalizeText(value) {
  return String(value || '').trim().toUpperCase();
}

function parsePositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function validateAndNormalizeBarangPayload(body, { pakaiBahanBaku }) {
  const satuanbesar = normalizeText(body.satuanbesar);
  const satuansedang = normalizeText(body.satuansedang);
  const satuankecil = normalizeText(body.satuankecil);
  const units = [satuanbesar, satuansedang, satuankecil].filter(Boolean);

  if (!units.length) {
    return { valid: false, message: 'Minimal isi 1 satuan. Mulai dari Satuan Kecil.' };
  }

  if (!satuankecil && (satuansedang || satuanbesar)) {
    return { valid: false, message: 'Satuan Kecil harus diisi terlebih dahulu sebelum Satuan Sedang atau Satuan Besar.' };
  }

  if (satuanbesar && !satuansedang) {
    return { valid: false, message: 'Satuan Sedang harus diisi sebelum Satuan Besar.' };
  }

  if (units.length !== new Set(units).size) {
    return { valid: false, message: 'Satuan Besar, Satuan Sedang, dan Satuan Kecil tidak boleh sama.' };
  }

  let konversi1 = 1;
  let konversi2 = 1;

  if (satuansedang) {
    konversi2 = parsePositiveNumber(body.konversi2);
    if (!konversi2) return { valid: false, message: 'Konversi Kecil harus lebih dari 0.' };
  }

  if (satuanbesar) {
    konversi1 = parsePositiveNumber(body.konversi1);
    if (!konversi1) return { valid: false, message: 'Konversi Besar harus lebih dari 0.' };
  }

  const jenis = pakaiBahanBaku ? normalizeText(body.jenis || 'BARANG JADI') : 'BARANG JADI';
  if (!JENIS_OPTIONS.includes(jenis)) {
    return { valid: false, message: 'Jenis barang tidak valid.' };
  }

  return {
    valid: true,
    data: {
      satuanbesar,
      satuansedang,
      satuankecil,
      konversi1,
      konversi2,
      jenis,
    },
  };
}

// GET /barang — Menampilkan semua barang dengan harga beli/jual terbaru dan stok dari kartustok
exports.getAll = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { search, jenis } = req.query;
    let sql = `SELECT b.*,
      (SELECT hargabeli FROM hargabeli WHERE idbarang = b.idbarang AND idtenant = ? ORDER BY tgltrans DESC, idhargabeli DESC LIMIT 1) as hargabeli_terbaru,
      (SELECT hargajual FROM hargajual WHERE idbarang = b.idbarang AND idtenant = ? ORDER BY tgltrans DESC, idhargajual DESC LIMIT 1) as hargajual_terbaru,
      COALESCE(SUM(CASE WHEN ks.jenis='M' THEN ks.jml ELSE -ks.jml END), 0) as stok
    FROM barang b
    LEFT JOIN kartustok ks ON ks.idbarang = b.idbarang AND ks.idtenant = ?
    WHERE 1=1`;
    const params = [ctx.idtenant, ctx.idtenant, ctx.idtenant];
    // Filter opsional: pencarian berdasarkan nama/kode barang
    if (search) { sql += ' AND (b.namabarang LIKE ? OR b.kodebarang LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    // Filter opsional: jenis barang (BARANG JADI, BAHAN BAKU, dll)
    if (jenis) { sql += ' AND b.jenis = ?'; params.push(jenis); }
    sql += ' GROUP BY b.idbarang ORDER BY kodebarang ASC';
    const rows = await tenantQuery(sql, params);
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /barang/browse — Menampilkan daftar barang aktif untuk dropdown/browse
exports.browseBarang = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { search, jenis, excludeJenis } = req.query;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    let sql = `SELECT b.*,
      (SELECT hargabeli FROM hargabeli WHERE idbarang = b.idbarang AND idtenant = ? ORDER BY tgltrans DESC, idhargabeli DESC LIMIT 1) as hargabeli_terbaru,
      (SELECT hargajual FROM hargajual WHERE idbarang = b.idbarang AND idtenant = ? ORDER BY tgltrans DESC, idhargajual DESC LIMIT 1) as hargajual_terbaru,
      COALESCE(SUM(CASE WHEN ks.jenis='M' THEN ks.jml ELSE -ks.jml END), 0) as stok
    FROM barang b
    LEFT JOIN kartustok ks ON ks.idbarang = b.idbarang AND ks.idtenant = ? AND ks.idlokasi = ?
    WHERE b.status = 'AKTIF' AND b.idtenant = ?`;
    const params = [ctx.idtenant, ctx.idtenant, ctx.idtenant, ctx.idlokasi, ctx.idtenant];
    
    // Filter opsional: pencarian berdasarkan nama/kode barang
    if (search) {
      sql += ' AND (b.namabarang LIKE ? OR b.kodebarang LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (jenis) {
      sql += ' AND b.jenis = ?';
      params.push(String(jenis).toUpperCase());
    }
    if (excludeJenis) {
      const normalizedExcludeJenis = String(excludeJenis).toUpperCase();
      if (normalizedExcludeJenis === 'BARANG JADI' || normalizedExcludeJenis === 'BAHAN JADI') {
        sql += " AND b.jenis NOT IN ('BARANG JADI', 'BAHAN JADI')";
      } else {
        sql += ' AND b.jenis <> ?';
        params.push(normalizedExcludeJenis);
      }
    }
    sql += ' GROUP BY b.idbarang ORDER BY b.kodebarang, b.namabarang LIMIT ?';
    params.push(limit);
    const rows = await tenantQuery(sql, params);
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /barang/:id — Menampilkan detail satu barang berdasarkan ID
exports.getOne = async (req, res) => {
  try {
    const ctx = getTenantContext();
    let sql = `SELECT b.*,
      (SELECT hargabeli FROM hargabeli WHERE idbarang = b.idbarang AND idtenant = ? ORDER BY tgltrans DESC, idhargabeli DESC LIMIT 1) as hargabeli_terbaru,
      (SELECT hargajual FROM hargajual WHERE idbarang = b.idbarang AND idtenant = ? ORDER BY tgltrans DESC, idhargajual DESC LIMIT 1) as hargajual_terbaru,
      COALESCE(SUM(CASE WHEN ks.jenis='M' THEN ks.jml ELSE -ks.jml END), 0) as stok
    FROM barang b
    LEFT JOIN kartustok ks ON ks.idbarang = b.idbarang AND ks.idtenant = ?
    WHERE b.idbarang = ?
    GROUP BY b.idbarang`;
    const rows = await tenantQuery(sql, [ctx.idtenant, ctx.idtenant, ctx.idtenant, req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Barang tidak ditemukan' });
    res.json(rows[0]);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// POST /barang — Membuat barang baru beserta harga beli dan jual awal
exports.create = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    const { namabarang, satuanbesar, satuansedang, satuankecil, konversi1, konversi2, jenis, stokmin, hargabeli, hargajual, kodebarang: customKode } = req.body;
    const pakaiBahanBaku = await isPakaiBahanBakuEnabled(conn, ctx.idtenant);
    const normalized = validateAndNormalizeBarangPayload({ satuanbesar, satuansedang, satuankecil, konversi1, konversi2, jenis }, { pakaiBahanBaku });
    if (!normalized.valid) return res.status(400).json({ message: normalized.message });

    await conn.beginTransaction();

    // Generate kode barang: gunakan kustom jika ada, jika tidak auto-generate
    const kodebarang = (customKode && customKode.trim())
      ? customKode.trim().toUpperCase()
      : await generateKodeMaster(conn, 'BRG', ctx.idtenant, 'barang', 'kodebarang', 4);
    const today = new Date().toISOString().slice(0, 10); // Tanggal hari ini (YYYY-MM-DD)

    const [[sameName]] = await conn.query(
      'SELECT idbarang FROM barang WHERE idtenant = ? AND namabarang = ? LIMIT 1',
      [ctx.idtenant, normalizeText(namabarang)]
    );
    if (sameName) {
      await conn.rollback();
      return res.status(400).json({ message: 'Nama barang sudah ada dalam tenant ini' });
    }

    // Insert barang utama
    let sql = 'INSERT INTO barang (idtenant, kodebarang, namabarang, satuanbesar, satuansedang, satuankecil, konversi1, konversi2, jenis, stokmin, status, userentry) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
    const [result] = await conn.query(sql, [
      ctx.idtenant, kodebarang, normalizeText(namabarang),
      normalized.data.satuanbesar, normalized.data.satuansedang, normalized.data.satuankecil,
      normalized.data.konversi1, normalized.data.konversi2, normalized.data.jenis,
      stokmin || 0, 'AKTIF', ctx.iduser
    ]);
    const idbarang = result.insertId;

    // Insert harga beli awal jika disediakan
    if (hargabeli) {
      let sql2 = 'INSERT INTO hargabeli (idtenant, idbarang, hargabeli, tgltrans) VALUES (?, ?, ?, ?)';
      await conn.query(sql2, [ctx.idtenant, idbarang, hargabeli, today]);
    }
    // Insert harga jual awal jika disediakan
    if (hargajual) {
      let sql3 = 'INSERT INTO hargajual (idtenant, idbarang, hargajual, tgltrans) VALUES (?, ?, ?, ?)';
      await conn.query(sql3, [ctx.idtenant, idbarang, hargajual, today]);
    }

    await conn.commit();
    res.status(201).json({ message: 'Barang berhasil ditambah', idbarang, kodebarang });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ message: 'Kode barang atau nama barang sudah ada dalam tenant ini' });
    }
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// PUT /barang/:id — Memperbarui data barang dan mencatat perubahan harga jika berbeda
exports.update = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    const { namabarang, satuanbesar, satuansedang, satuankecil, konversi1, konversi2, jenis, stokmin, hargabeli, hargajual, status } = req.body;
    const { id } = req.params;
    const pakaiBahanBaku = await isPakaiBahanBakuEnabled(conn, ctx.idtenant);
    const normalized = validateAndNormalizeBarangPayload({ satuanbesar, satuansedang, satuankecil, konversi1, konversi2, jenis }, { pakaiBahanBaku });
    if (!normalized.valid) return res.status(400).json({ message: normalized.message });

    await conn.beginTransaction();

    // Validasi: cek barang ada
    let sql = 'SELECT * FROM barang WHERE idbarang = ? AND idtenant = ?';
    const [barang] = await conn.query(sql, [id, ctx.idtenant]);
    if (barang.length === 0) {
      await conn.rollback();
      return res.status(404).json({ message: 'Barang tidak ditemukan' });
    }

    // Update data barang — gunakan nilai lama jika field tidak dikirim (?? untuk null-check, || untuk falsy)
    const [[sameName]] = await conn.query(
      'SELECT idbarang FROM barang WHERE idtenant = ? AND namabarang = ? AND idbarang <> ? LIMIT 1',
      [ctx.idtenant, normalizeText(namabarang || barang[0].namabarang), id]
    );
    if (sameName) {
      await conn.rollback();
      return res.status(400).json({ message: 'Nama barang sudah ada dalam tenant ini' });
    }

    let sql2 = 'UPDATE barang SET namabarang = ?, satuanbesar = ?, satuansedang = ?, satuankecil = ?, konversi1 = ?, konversi2 = ?, jenis = ?, stokmin = ?, status = ? WHERE idbarang = ? AND idtenant = ?';
    await conn.query(sql2,
      [
        normalizeText(namabarang || barang[0].namabarang),
        normalized.data.satuanbesar,
        normalized.data.satuansedang,
        normalized.data.satuankecil,
        normalized.data.konversi1,
        normalized.data.konversi2,
        normalized.data.jenis,
        stokmin ?? barang[0].stokmin,
        status ?? barang[0].status, id, ctx.idtenant
      ]
    );

    const today = new Date().toISOString().slice(0, 10);

    // Cek dan catat perubahan harga beli — hanya insert jika harga berubah
    if (hargabeli) {
      let sql3 = 'SELECT hargabeli FROM hargabeli WHERE idbarang = ? AND idtenant = ? ORDER BY tgltrans DESC, idhargabeli DESC LIMIT 1';
      const [[latest]] = await conn.query(sql3, [id, ctx.idtenant]);
      if (!latest || parseFloat(latest.hargabeli) !== parseFloat(hargabeli)) {
        let sql4 = 'INSERT INTO hargabeli (idtenant, idbarang, hargabeli, tgltrans) VALUES (?, ?, ?, ?)';
        await conn.query(sql4, [ctx.idtenant, id, hargabeli, today]);
      }
    }
    // Cek dan catat perubahan harga jual — hanya insert jika harga berubah
    if (hargajual) {
      let sql5 = 'SELECT hargajual FROM hargajual WHERE idbarang = ? AND idtenant = ? ORDER BY tgltrans DESC, idhargajual DESC LIMIT 1';
      const [[latest]] = await conn.query(sql5, [id, ctx.idtenant]);
      if (!latest || parseFloat(latest.hargajual) !== parseFloat(hargajual)) {
        let sql6 = 'INSERT INTO hargajual (idtenant, idbarang, hargajual, tgltrans) VALUES (?, ?, ?, ?)';
        await conn.query(sql6, [ctx.idtenant, id, hargajual, today]);
      }
    }

    await conn.commit();
    res.json({ message: 'Barang berhasil diupdate' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ message: 'Kode barang atau nama barang sudah ada dalam tenant ini' });
    }
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// DELETE /barang/:id — Menghapus barang berdasarkan ID
exports.remove = async (req, res) => {
  try {
    const ctx = getTenantContext();
    let sql = 'DELETE FROM barang WHERE idbarang = ? AND idtenant = ?';
    await tenantExecute(sql, [req.params.id, ctx.idtenant]);
    res.json({ message: 'Barang berhasil dihapus' });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /barang/:id/hargabeli — Menampilkan riwayat harga beli suatu barang
exports.getHargaBeli = async (req, res) => {
  try {
    const ctx = getTenantContext();
    let sql = 'SELECT * FROM hargabeli WHERE idbarang = ? ORDER BY tgltrans DESC, idhargabeli DESC';
    const rows = await tenantQuery(sql, [req.params.id]);
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /barang/:id/hargajual — Menampilkan riwayat harga jual suatu barang
exports.getHargaJual = async (req, res) => {
  try {
    const ctx = getTenantContext();
    let sql = 'SELECT * FROM hargajual WHERE idbarang = ? ORDER BY tgltrans DESC, idhargajual DESC';
    const rows = await tenantQuery(sql, [req.params.id]);
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /barang/check-price — Memeriksa barang yang harga jualnya lebih rendah dari harga beli (indikasi kerugian)
exports.checkPrice = async (req, res) => {
  try {
    let sql = `SELECT b.*,
      (SELECT hargabeli FROM hargabeli WHERE idbarang = b.idbarang AND idtenant = b.idtenant ORDER BY tgltrans DESC, hargabeli desc LIMIT 1) as hargabeli,
      (SELECT hargajual FROM hargajual WHERE idbarang = b.idbarang AND idtenant = b.idtenant ORDER BY tgltrans DESC, hargajual desc LIMIT 1) as hargajual
    FROM barang b WHERE b.status = 'AKTIF'`;
    const rows = await tenantQuery(sql);
    // Filter barang yang hargajual < hargabeli (harga rugi)
    const warnings = rows.filter(r => r.hargajual && r.hargabeli && parseFloat(r.hargajual) < parseFloat(r.hargabeli));
    res.json({ total: rows.length, warnings: warnings.length, items: warnings });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};
