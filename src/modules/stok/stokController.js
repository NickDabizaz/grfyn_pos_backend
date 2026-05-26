// Controller untuk manajemen stok — kartu stok, penyesuaian, saldo awal, dan kalkulasi saldo
// Endpoint: GET /kartustok, GET /penyesuaian, GET /penyesuaian/:id, POST /penyesuaian, GET /saldo, GET /saldo/list, GET /saldo/:id, POST /saldo-awal, GET /stok/:idbarang
const { tenantQuery, tenantExecute, getConnection, getTenantContext } = require('../../config/db');
const { generateKodePenyesuaian, generateKodeSaldoStok } = require('../../lib/kodetrans');
const logger = require('../../lib/logger');

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function normalizeDate(value) {
  return value && /^\d{4}-\d{2}-\d{2}/.test(String(value)) ? String(value).slice(0, 10) : todayLocal();
}

function normalizeStatus(status) {
  if (status === 'AKTIF') return 'APPROVED';
  if (status === 'VOID') return 'CANCELLED';
  return status || 'DRAFT';
}

// GET — Mendapatkan riwayat kartu stok dengan filter barang, tanggal, jenis, dan kode transaksi
exports.getKartuStok = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { idbarang, tglwal, tglakhir, jenis, search } = req.query;
    let sql = `SELECT ks.*, b.namabarang, b.satuankecil FROM kartustok ks LEFT JOIN barang b ON ks.idbarang = b.idbarang AND b.idtenant = ks.idtenant WHERE 1=1`;
    const params = [];
    sql += ' AND ks.idlokasi = ?'; params.push(ctx.idlokasi);
    if (idbarang) { sql += ' AND ks.idbarang = ?'; params.push(idbarang); }
    if (tglwal) { sql += ' AND ks.tgltrans >= ?'; params.push(tglwal); }
    if (tglakhir) { sql += ' AND ks.tgltrans <= ?'; params.push(tglakhir); }
    if (jenis) { sql += ' AND ks.jenis = ?'; params.push(jenis); }
    if (search) { sql += ' AND ks.kodetrans LIKE ?'; params.push(`%${search}%`); }
    sql += ' ORDER BY ks.tgltrans DESC, ks.idkartustok DESC LIMIT 500';
    const rows = await tenantQuery(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET — Mendapatkan daftar penyesuaian stok dengan filter pencarian kode
exports.getPenyesuaian = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { search } = req.query;
    let sql = 'SELECT ps.* FROM penyesuaianstok ps WHERE 1=1';
    const params = [];
    sql += ' AND ps.idlokasi = ?'; params.push(ctx.idlokasi);
    if (search) { sql += ' AND ps.kodepenyesuaianstok LIKE ?'; params.push(`%${search}%`); }
    sql += ' ORDER BY ps.tgltrans DESC, ps.idpenyesuaianstok DESC';
    const rows = await tenantQuery(sql, params);
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET — Mendapatkan detail item dari satu penyesuaian stok
exports.getPenyesuaianDetail = async (req, res) => {
  try {
    let sql = `SELECT psd.*, b.namabarang, b.satuankecil
      FROM penyesuaianstokdtl psd LEFT JOIN barang b ON psd.idbarang = b.idbarang AND b.idtenant = psd.idtenant
      WHERE psd.idpenyesuaianstok = ?`;
    const rows = await tenantQuery(sql, [req.params.id]);
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// POST — Membuat penyesuaian stok: membandingkan stok program vs stok fisik, mencatat selisih ke kartu stok
exports.createPenyesuaian = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const { keterangan, items, tgltrans: tglInput } = req.body;

    // Validasi: minimal satu item
    if (!items || !items.length) return res.status(400).json({ message: 'Items tidak boleh kosong' });

    const tgltrans = normalizeDate(tglInput);
    // Generate kode penyesuaian unik
    const kode = await generateKodePenyesuaian(conn, ctx.idtenant, ctx.idlokasi);

    // Insert header penyesuaian
    let sql = 'INSERT INTO penyesuaianstok (idtenant, idlokasi, kodepenyesuaianstok, tgltrans, iduser, keterangan, status, userentry) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
    await conn.query(sql, [ctx.idtenant, ctx.idlokasi, kode, tgltrans, ctx.iduser, keterangan || '', 'AKTIF', ctx.iduser]);
    // Ambil id header yang baru dibuat
    let sql2 = 'SELECT idpenyesuaianstok FROM penyesuaianstok WHERE kodepenyesuaianstok = ? AND idtenant = ? AND idlokasi = ?';
    const [[header]] = await conn.query(sql2, [kode, ctx.idtenant, ctx.idlokasi]);

    for (const item of items) {
      // Hitung stok program: total masuk - total keluar dari kartustok
      let sql3 = 'SELECT COALESCE(SUM(jml), 0) as total FROM kartustok WHERE idbarang = ? AND jenis = ? AND idtenant = ? AND idlokasi = ?';
      const [[masuk]] = await conn.query(sql3, [item.idbarang, 'M', ctx.idtenant, ctx.idlokasi]);
      let sql4 = 'SELECT COALESCE(SUM(jml), 0) as total FROM kartustok WHERE idbarang = ? AND jenis = ? AND idtenant = ? AND idlokasi = ?';
      const [[keluar]] = await conn.query(sql4, [item.idbarang, 'K', ctx.idtenant, ctx.idlokasi]);
      // stokProgram: stok yang tercatat di sistem
      const stokProgram = masuk.total - keluar.total;
      // selisih: jika positif → stok fisik lebih kecil (harus keluar), jika negatif → stok fisik lebih besar (harus masuk)
      const selisih = stokProgram - item.jml;

      // Insert detail penyesuaian dengan selisih yang dihitung
      let sql5 = 'INSERT INTO penyesuaianstokdtl (idpenyesuaianstok, idtenant, idbarang, jml, selisih, keterangan) VALUES (?, ?, ?, ?, ?, ?)';
      await conn.query(sql5, [header.idpenyesuaianstok, ctx.idtenant, item.idbarang, item.jml, selisih, item.keterangan || '']);

      // Jika ada selisih, catat pergerakan di kartustok untuk menyesuaikan stok
      if (selisih !== 0) {
        // selisih > 0 artinya stok program lebih besar → perlu dikurangi (KELUAR)
        // selisih < 0 artinya stok program lebih kecil → perlu ditambah (MASUK)
        const jenis = selisih > 0 ? 'K' : 'M';
        // jmlAbs: jumlah absolut selisih yang akan dicatat
        const jmlAbs = Math.abs(selisih);
        let sql6 = 'INSERT INTO kartustok (idtenant, idlokasi, kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idtrans, jenistransaksi) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
        await conn.query(sql6, [ctx.idtenant, ctx.idlokasi, kode, item.idbarang, jmlAbs, jenis, tgltrans, `Penyesuaian ${kode}`, header.idpenyesuaianstok, 'PENYESUAIANSTOK']);
      }
    }

    await conn.commit();
    await logger.history('STOK_PENYESUAIAN', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: kode, req });
    res.status(201).json({ message: 'Penyesuaian stok berhasil', kode });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// GET — Kalkulasi saldo stok semua barang per tanggal tertentu. Jika belum ada saldo awal, hitung langsung dari kartustok.
exports.getSaldoStok = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tgl } = req.query;
    // targetDate: tanggal acuan kalkulasi saldo
    const targetDate = normalizeDate(tgl);

    // Cek apakah sudah ada data saldo stok sebelumnya
    let sql = "SELECT COUNT(*) as cnt FROM saldostok WHERE idtenant = ? AND idlokasi = ? AND status IN ('APPROVED', 'AKTIF')";
    const [[saldoExists]] = await require('../../config/db').pool.query(sql, [ctx.idtenant, ctx.idlokasi]);

    // Belum ada saldo → hitung stok langsung dari kartustok (akumulasi total masuk - total keluar)
    if (saldoExists.cnt === 0) {
      let sql2 = `SELECT b.idbarang, b.kodebarang, b.namabarang, b.satuankecil, b.stokmin,
          COALESCE(m.total, 0) - COALESCE(k.total, 0) as stok
        FROM barang b
        LEFT JOIN (SELECT idbarang, SUM(jml) as total FROM kartustok WHERE jenis='M' AND idtenant = ? AND idlokasi = ? GROUP BY idbarang) m ON b.idbarang = m.idbarang
        LEFT JOIN (SELECT idbarang, SUM(jml) as total FROM kartustok WHERE jenis='K' AND idtenant = ? AND idlokasi = ? GROUP BY idbarang) k ON b.idbarang = k.idbarang
        WHERE b.status = 'AKTIF' ORDER BY b.namabarang`;
      const rows = await tenantQuery(sql2, [ctx.idtenant, ctx.idlokasi, ctx.idtenant, ctx.idlokasi]);
      return res.json(rows);
    }

    // Sudah ada saldo → ambil saldo terakhir ≤ targetDate + mutasi setelah tanggal saldo terakhir
    let sql3 = `SELECT b.idbarang, b.kodebarang, b.namabarang, b.satuankecil, b.stokmin,
        COALESCE(sd.qty, 0) + COALESCE(km.masuk, 0) - COALESCE(km.keluar, 0) as stok
      FROM barang b
      LEFT JOIN (
        SELECT ssd.idbarang, ssd.qty FROM saldostokdtl ssd
        JOIN saldostok ss ON ss.idsaldostok = ssd.idsaldostok
        WHERE ss.idtenant = ? AND ss.idlokasi = ? AND ss.status IN ('APPROVED', 'AKTIF') AND ss.tgltrans = (SELECT MAX(tgltrans) FROM saldostok WHERE idtenant = ? AND idlokasi = ? AND status IN ('APPROVED', 'AKTIF') AND tgltrans <= ?)
      ) sd ON sd.idbarang = b.idbarang
      LEFT JOIN (
        SELECT idbarang,
          COALESCE(SUM(CASE WHEN jenis='M' THEN jml ELSE 0 END), 0) as masuk,
          COALESCE(SUM(CASE WHEN jenis='K' THEN jml ELSE 0 END), 0) as keluar
        FROM kartustok WHERE idtenant = ? AND idlokasi = ? AND tgltrans > (SELECT COALESCE(MAX(tgltrans), '1970-01-01') FROM saldostok WHERE idtenant = ? AND idlokasi = ? AND status IN ('APPROVED', 'AKTIF') AND tgltrans <= ?)
        GROUP BY idbarang
      ) km ON km.idbarang = b.idbarang
      WHERE b.status = 'AKTIF' ORDER BY b.namabarang`;
    const rows = await tenantQuery(sql3,
      [ctx.idtenant, ctx.idlokasi, ctx.idtenant, ctx.idlokasi, targetDate,
       ctx.idtenant, ctx.idlokasi, ctx.idtenant, ctx.idlokasi, targetDate]
    );
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET — Mendapatkan daftar saldo stok yang pernah dicatat
exports.getSaldoStokList = async (req, res) => {
  try {
    const ctx = getTenantContext();
    let sql = `SELECT ss.*, l.kodelokasi, l.namalokasi, u.namauser
      FROM saldostok ss
      LEFT JOIN lokasi l ON l.idlokasi = ss.idlokasi AND l.idtenant = ss.idtenant
      LEFT JOIN user u ON u.iduser = ss.iduser AND u.idtenant = ss.idtenant
      WHERE ss.idtenant = ?
      ORDER BY ss.tgltrans DESC, ss.idsaldostok DESC LIMIT 50`;
    const rows = await tenantQuery(sql, [ctx.idtenant]);
    res.json(rows.map(row => ({ ...row, status: normalizeStatus(row.status) })));
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET — Mendapatkan detail item dari satu saldo stok
exports.getSaldoStokDetail = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const headerRows = await tenantQuery(
      `SELECT ss.*, l.kodelokasi, l.namalokasi, u.namauser
       FROM saldostok ss
       LEFT JOIN lokasi l ON l.idlokasi = ss.idlokasi AND l.idtenant = ss.idtenant
       LEFT JOIN user u ON u.iduser = ss.iduser AND u.idtenant = ss.idtenant
       WHERE ss.idsaldostok = ? AND ss.idtenant = ?`,
      [req.params.id, ctx.idtenant]
    );
    if (!headerRows.length) return res.status(404).json({ message: 'Saldo awal stok tidak ditemukan' });

    let sql = `SELECT ssd.*, ssd.qty AS jml, b.namabarang, b.satuankecil, b.satuansedang, b.satuanbesar, b.kodebarang
       FROM saldostokdtl ssd
       LEFT JOIN barang b ON ssd.idbarang = b.idbarang AND b.idtenant = ssd.idtenant
       WHERE ssd.idsaldostok = ?`;
    const rows = await tenantQuery(sql, [req.params.id]);
    res.json({ ...headerRows[0], status: normalizeStatus(headerRows[0].status), items: rows });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

async function insertSaldoAwalKartuStok(conn, saldo, items) {
  await conn.query(
    "DELETE FROM kartustok WHERE idtenant = ? AND idtrans = ? AND jenistransaksi = 'SALDOSTOK'",
    [saldo.idtenant, saldo.idsaldostok]
  );
  for (const item of items) {
    const qty = parseFloat(item.qty ?? item.jml ?? 0);
    if (qty > 0) {
      await conn.query(
        `INSERT INTO kartustok (idtenant, idlokasi, kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idtrans, jenistransaksi)
         VALUES (?, ?, ?, ?, ?, 'M', ?, ?, ?, 'SALDOSTOK')`,
        [saldo.idtenant, saldo.idlokasi, saldo.kodesaldostok, item.idbarang, qty, normalizeDate(saldo.tgltrans), `Saldo Awal ${saldo.kodesaldostok}`, saldo.idsaldostok]
      );
    }
  }
}

async function getSaldoAwalForUpdate(conn, ctx, id) {
  const [[saldo]] = await conn.query(
    'SELECT * FROM saldostok WHERE idsaldostok = ? AND idtenant = ? FOR UPDATE',
    [id, ctx.idtenant]
  );
  return saldo;
}

exports.createClosing = async (req, res) => {
  res.status(501).json({ message: 'Closing akan diimplementasikan di fase berikutnya' });
};

exports.cancelClosing = async (req, res) => {
  res.status(501).json({ message: 'Closing akan diimplementasikan di fase berikutnya' });
};

exports.getClosingDetail = async (req, res) => {
  res.status(501).json({ message: 'Closing akan diimplementasikan di fase berikutnya' });
};

exports.getClosing = async (req, res) => {
  res.status(501).json({ message: 'Closing akan diimplementasikan di fase berikutnya' });
};

// POST — Membuat saldo awal stok. Menyimpan header saldo, detail qty, dan mencatat pergerakan stok masuk.
exports.createSaldoAwal = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    const { keterangan, items, tgltrans: tglInput, idlokasi, approve } = req.body;
    const idlokasiTrans = parseInt(idlokasi || ctx.idlokasi, 10);

    // Validasi: minimal satu item
    if (!items || !items.length) return res.status(400).json({ message: 'Items tidak boleh kosong' });
    if (!idlokasiTrans) return res.status(400).json({ message: 'Lokasi wajib diisi' });

    await conn.beginTransaction();
    const tgltrans = normalizeDate(tglInput);
    const status = approve === true || req.body.status === 'APPROVED' ? 'APPROVED' : 'DRAFT';
    // Generate kode saldo stok unik
    const kodeSaldo = await generateKodeSaldoStok(conn, ctx.idtenant, idlokasiTrans);

    // Insert header saldo stok
    let sql = 'INSERT INTO saldostok (idtenant, idlokasi, kodesaldostok, tgltrans, iduser, catatan, status, userentry) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
    await conn.query(sql, [ctx.idtenant, idlokasiTrans, kodeSaldo, tgltrans, ctx.iduser, keterangan || '', status, ctx.iduser]);
    // Ambil id header yang baru dibuat
    let sql2 = 'SELECT idsaldostok FROM saldostok WHERE kodesaldostok = ? AND idtenant = ? AND idlokasi = ?';
    const [[header]] = await conn.query(sql2, [kodeSaldo, ctx.idtenant, idlokasiTrans]);

    for (const item of items) {
      const qty = parseFloat(item.jml || item.qty || 0);
      if (!item.idbarang || !(qty >= 0)) {
        await conn.rollback();
        return res.status(400).json({ message: 'Detail barang tidak valid' });
      }
      // Insert detail qty per barang ke saldo stok
      let sql3 = 'INSERT INTO saldostokdtl (idsaldostok, idtenant, idbarang, qty) VALUES (?, ?, ?, ?)';
      await conn.query(sql3, [header.idsaldostok, ctx.idtenant, item.idbarang, qty]);

      // Jika qty > 0, catat sebagai stok masuk di kartustok
      if (status === 'APPROVED' && qty > 0) {
        let sql4 = 'INSERT INTO kartustok (idtenant, idlokasi, kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idtrans, jenistransaksi) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
        await conn.query(sql4, [ctx.idtenant, idlokasiTrans, kodeSaldo, item.idbarang, qty, 'M', tgltrans, `Saldo Awal ${kodeSaldo}`, header.idsaldostok, 'SALDOSTOK']);
      }
    }

    await conn.commit();
    await logger.history('STOK_SALDOAWAL', { idtenant: ctx.idtenant, idlokasi: idlokasiTrans, iduser: ctx.iduser, ref: kodeSaldo, req });
    res.status(201).json({ message: 'Saldo awal stok berhasil', kode: kodeSaldo });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.updateSaldoAwal = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    const { keterangan, items, tgltrans: tglInput, idlokasi, approve } = req.body;
    if (!items || !items.length) return res.status(400).json({ message: 'Items tidak boleh kosong' });

    await conn.beginTransaction();
    const saldo = await getSaldoAwalForUpdate(conn, ctx, req.params.id);
    if (!saldo) {
      await conn.rollback();
      return res.status(404).json({ message: 'Saldo awal stok tidak ditemukan' });
    }
    if (normalizeStatus(saldo.status) !== 'DRAFT') {
      await conn.rollback();
      return res.status(400).json({ message: 'Hanya saldo awal DRAFT yang bisa diedit' });
    }

    const idlokasiTrans = parseInt(idlokasi || saldo.idlokasi, 10);
    if (!idlokasiTrans) {
      await conn.rollback();
      return res.status(400).json({ message: 'Lokasi wajib diisi' });
    }
    const tgltrans = normalizeDate(tglInput || saldo.tgltrans);
    const status = approve === true || req.body.status === 'APPROVED' ? 'APPROVED' : 'DRAFT';

    await conn.query(
      'UPDATE saldostok SET idlokasi = ?, tgltrans = ?, catatan = ?, status = ? WHERE idsaldostok = ? AND idtenant = ?',
      [idlokasiTrans, tgltrans, keterangan || null, status, saldo.idsaldostok, ctx.idtenant]
    );
    await conn.query('DELETE FROM saldostokdtl WHERE idsaldostok = ? AND idtenant = ?', [saldo.idsaldostok, ctx.idtenant]);
    const detailItems = [];
    for (const item of items) {
      const qty = parseFloat(item.jml ?? item.qty ?? 0);
      if (!item.idbarang || !(qty >= 0)) {
        await conn.rollback();
        return res.status(400).json({ message: 'Detail barang tidak valid' });
      }
      await conn.query(
        'INSERT INTO saldostokdtl (idsaldostok, idtenant, idbarang, qty) VALUES (?, ?, ?, ?)',
        [saldo.idsaldostok, ctx.idtenant, item.idbarang, qty]
      );
      detailItems.push({ idbarang: item.idbarang, qty });
    }

    const nextSaldo = { ...saldo, idlokasi: idlokasiTrans, tgltrans, status };
    if (status === 'APPROVED') {
      await insertSaldoAwalKartuStok(conn, nextSaldo, detailItems);
    } else {
      await conn.query(
        "DELETE FROM kartustok WHERE idtenant = ? AND idtrans = ? AND jenistransaksi = 'SALDOSTOK'",
        [ctx.idtenant, saldo.idsaldostok]
      );
    }

    await conn.commit();
    await logger.history('STOK_SALDOAWAL_UPDATE', { idtenant: ctx.idtenant, idlokasi: idlokasiTrans, iduser: ctx.iduser, ref: saldo.kodesaldostok, req });
    res.json({ message: 'Saldo awal stok berhasil diupdate' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.approveSaldoAwal = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const saldo = await getSaldoAwalForUpdate(conn, ctx, req.params.id);
    if (!saldo) {
      await conn.rollback();
      return res.status(404).json({ message: 'Saldo awal stok tidak ditemukan' });
    }
    if (normalizeStatus(saldo.status) !== 'DRAFT') {
      await conn.rollback();
      return res.status(400).json({ message: 'Hanya saldo awal DRAFT yang bisa diapprove' });
    }
    const [items] = await conn.query(
      'SELECT idbarang, qty FROM saldostokdtl WHERE idsaldostok = ? AND idtenant = ?',
      [saldo.idsaldostok, ctx.idtenant]
    );
    await insertSaldoAwalKartuStok(conn, saldo, items);
    await conn.query("UPDATE saldostok SET status = 'APPROVED' WHERE idsaldostok = ? AND idtenant = ?", [saldo.idsaldostok, ctx.idtenant]);
    await conn.commit();
    await logger.history('STOK_SALDOAWAL_APPROVE', { idtenant: ctx.idtenant, idlokasi: saldo.idlokasi, iduser: ctx.iduser, ref: saldo.kodesaldostok, req });
    res.json({ message: 'Saldo awal stok berhasil diapprove' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.unapproveSaldoAwal = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const saldo = await getSaldoAwalForUpdate(conn, ctx, req.params.id);
    if (!saldo) {
      await conn.rollback();
      return res.status(404).json({ message: 'Saldo awal stok tidak ditemukan' });
    }
    if (normalizeStatus(saldo.status) !== 'APPROVED') {
      await conn.rollback();
      return res.status(400).json({ message: 'Hanya saldo awal APPROVED yang bisa batal approve' });
    }
    await conn.query(
      "DELETE FROM kartustok WHERE idtenant = ? AND idtrans = ? AND jenistransaksi = 'SALDOSTOK'",
      [ctx.idtenant, saldo.idsaldostok]
    );
    await conn.query("UPDATE saldostok SET status = 'DRAFT' WHERE idsaldostok = ? AND idtenant = ?", [saldo.idsaldostok, ctx.idtenant]);
    await conn.commit();
    await logger.history('STOK_SALDOAWAL_UNAPPROVE', { idtenant: ctx.idtenant, idlokasi: saldo.idlokasi, iduser: ctx.iduser, ref: saldo.kodesaldostok, req });
    res.json({ message: 'Approve saldo awal stok dibatalkan' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.cancelSaldoAwal = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const saldo = await getSaldoAwalForUpdate(conn, ctx, req.params.id);
    if (!saldo) {
      await conn.rollback();
      return res.status(404).json({ message: 'Saldo awal stok tidak ditemukan' });
    }
    if (normalizeStatus(saldo.status) === 'CANCELLED') {
      await conn.rollback();
      return res.status(400).json({ message: 'Saldo awal stok sudah dibatalkan' });
    }
    if (normalizeStatus(saldo.status) === 'APPROVED') {
      await conn.rollback();
      return res.status(400).json({ message: 'Saldo awal APPROVED harus batal approve dulu sebelum dibatalkan' });
    }
    await conn.query(
      "DELETE FROM kartustok WHERE idtenant = ? AND idtrans = ? AND jenistransaksi = 'SALDOSTOK'",
      [ctx.idtenant, saldo.idsaldostok]
    );
    await conn.query("UPDATE saldostok SET status = 'CANCELLED' WHERE idsaldostok = ? AND idtenant = ?", [saldo.idsaldostok, ctx.idtenant]);
    await conn.commit();
    await logger.history('STOK_SALDOAWAL_CANCEL', { idtenant: ctx.idtenant, idlokasi: saldo.idlokasi, iduser: ctx.iduser, ref: saldo.kodesaldostok, req });
    res.json({ message: 'Saldo awal stok dibatalkan' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// GET — Menghitung stok satu barang per tanggal tertentu, dengan memperhitungkan saldo terdekat + mutasi setelahnya
exports.getStok = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { idbarang } = req.params;
    // targetDate: tanggal acuan kalkulasi stok
    const targetDate = normalizeDate(req.query.tgl);

    // Cari saldo stok terakhir yang ≤ targetDate
    let sql = `SELECT ss.idsaldostok, ss.tgltrans FROM saldostok ss
       WHERE ss.idtenant = ? AND ss.idlokasi = ? AND ss.status IN ('APPROVED', 'AKTIF') AND ss.tgltrans <= ? ORDER BY ss.tgltrans DESC LIMIT 1`;
    const [[latestSaldo]] = await require('../../config/db').pool.query(sql, [ctx.idtenant, ctx.idlokasi, targetDate]);

    // stok: akumulasi akhir yang akan dikembalikan
    let stok = 0;
    // fromDate: batas awal mutasi (setelah tanggal saldo terakhir)
    let fromDate = null;

    // Jika ada saldo terdekat, ambil qty dari detail saldo tersebut sebagai stok awal
    if (latestSaldo) {
      // Ambil qty barang dari saldo terdekat sebagai basis
      let sql2 = `SELECT COALESCE(qty, 0) as qty FROM saldostokdtl
         WHERE idsaldostok = ? AND idtenant = ? AND idbarang = ?`;
      const [[snap]] = await require('../../config/db').pool.query(sql2, [latestSaldo.idsaldostok, ctx.idtenant, idbarang]);
      stok = snap ? snap.qty : 0;
      // Mutasi hanya dihitung setelah tanggal saldo terakhir
      fromDate = latestSaldo.tgltrans;
    }

    const params = [ctx.idtenant, ctx.idlokasi, idbarang];
    // dateCond: kondisi tanggal untuk query mutasi (≤ targetDate, dan > fromDate jika ada saldo)
    let dateCond = 'AND tgltrans <= ?';
    params.push(targetDate);
    if (fromDate) {
      dateCond += ' AND tgltrans > ?';
      params.push(fromDate);
    }

    // Hitung mutasi masuk dan keluar setelah saldo terakhir (atau dari awal jika belum ada saldo)
    let sql3 = `SELECT COALESCE(SUM(jml), 0) as total FROM kartustok
       WHERE idtenant = ? AND idlokasi = ? AND idbarang = ? AND jenis = 'M' ${dateCond}`;
    const [[masuk]] = await require('../../config/db').pool.query(sql3, params);
    let sql4 = `SELECT COALESCE(SUM(jml), 0) as total FROM kartustok
       WHERE idtenant = ? AND idlokasi = ? AND idbarang = ? AND jenis = 'K' ${dateCond}`;
    const [[keluar]] = await require('../../config/db').pool.query(sql4, params);

    // Akumulasi akhir: saldo awal + total masuk - total keluar
    stok += masuk.total - keluar.total;

    res.json({ idbarang: parseInt(idbarang), stok, tgl: targetDate });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};


// GET /stok/alert-stok-min — Daftar barang yang stoknya <= stokmin
exports.getAlertStokMin = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const rows = await tenantQuery(
      `SELECT b.idbarang, b.kodebarang, b.namabarang, b.satuankecil, b.stokmin,
        COALESCE(SUM(CASE WHEN ks.jenis='M' THEN ks.jml ELSE -ks.jml END), 0) as stok_sekarang
       FROM barang b
       LEFT JOIN kartustok ks ON ks.idbarang = b.idbarang AND ks.idlokasi = ? AND ks.idtenant = b.idtenant
       WHERE b.status = 'AKTIF' AND b.stokmin > 0
       GROUP BY b.idbarang
       HAVING stok_sekarang <= b.stokmin
       ORDER BY stok_sekarang ASC`,
      [ctx.idlokasi]
    );
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};
