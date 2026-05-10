/* Controller transaksi pembelian (beli).
   Menangani CRUD pembelian, pembatalan (void), pengecekan kelayakan edit,
   integrasi stok (satuan kecil), harga beli history, dan hutang supplier. */
const { tenantQuery, tenantExecute, getConnection, getTenantContext } = require('../config/db');
const { generateKodeBeli } = require('../lib/kodetrans');
const { generateKodePelunasanHutang } = require('../lib/kodetrans');
const logger = require('../lib/logger');

// Migrasi idempoten: pastikan kolom satuan ada di belidtl (hanya dijalankan sekali)
let _satuanMigrated = false;
async function ensureSatuanColumn(conn) {
  if (_satuanMigrated) return;
  try {
    let sql = 'ALTER TABLE belidtl ADD COLUMN satuan VARCHAR(20) DEFAULT NULL';
    await conn.query(sql);
  } catch (_) { /* kolom sudah ada, abaikan error */ }
  _satuanMigrated = true;
}

// Konversi jumlah item ke satuan terkecil (satuankecil) untuk konsistensi kartu stok
// b = info barang (satuanbesar, satuansedang, satuankecil, konversi1, konversi2)
function toKecilJml(jml, satuan, b) {
  const k1 = Math.max(parseInt(b.konversi1) || 1, 1); // Faktor konversi besar -> sedang
  const k2 = Math.max(parseInt(b.konversi2) || 1, 1); // Faktor konversi sedang -> kecil
  if (satuan && b.satuanbesar && satuan === b.satuanbesar) return jml * k1 * k2;
  if (satuan && b.satuansedang && satuan === b.satuansedang) return jml * k2;
  return jml; // Sudah dalam satuan kecil
}

// POST /beli — Buat transaksi pembelian baru (header, detail item, stok, hutang)
exports.create = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();

    const { idsupplier, bayar, items, kodebeli: customKodebeli, idlokasi: customIdlokasi } = req.body;

    if (!items || !items.length) return res.status(400).json({ message: 'Items tidak boleh kosong' }); // Validasi: minimal 1 item

    await ensureSatuanColumn(conn);

    // Ambil persentase PPN dari tenant (default 11%)
    let sql2 = 'SELECT ppn FROM tenant WHERE idtenant = ?';
    const [[tenant]] = await conn.query(sql2, [ctx.idtenant]);
    const ppnPercent = tenant ? parseFloat(tenant.ppn) : 11;

    // Gunakan kode manual jika diisi, jika tidak auto-generate
    const kodebeli = (customKodebeli && customKodebeli.trim())
      ? customKodebeli.trim()
      : await generateKodeBeli(conn, ctx.idtenant, ctx.idlokasi);

    const tgltrans = req.body.tgltrans || new Date().toISOString().slice(0, 10); // Default: hari ini

    // Lokasi bisa di-override dari form (user ganti lokasi)
    const idlokasi = (customIdlokasi && parseInt(customIdlokasi)) ? parseInt(customIdlokasi) : ctx.idlokasi;

    // Insert header pembelian dengan status AKTIF
    let sql3 = 'INSERT INTO beli (idtenant, idlokasi, kodebeli, tgltrans, idsupplier, iduser, grandtotal, bayar, status, userentry) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)';
    await conn.query(
      sql3,
      [ctx.idtenant, idlokasi, kodebeli, tgltrans, idsupplier || null, ctx.iduser, bayar || 0, 'AKTIF', ctx.iduser]
    );

    // Ambil ID header yang baru dibuat
    let sql4 = 'SELECT idbeli FROM beli WHERE kodebeli = ? AND idtenant = ? AND idlokasi = ?';
    const [[header]] = await conn.query(
      sql4,
      [kodebeli, ctx.idtenant, idlokasi]
    );

    let calculatedGrandTotal = 0; // Total dihitung ulang dari detail item

    // Pre-compile query untuk efisiensi dalam loop
    let sql5 = 'SELECT hargabeli FROM hargabeli WHERE idbarang = ? AND idtenant = ? ORDER BY tgltrans DESC, idhargabeli DESC LIMIT 1';
    let sql6 = 'INSERT INTO belidtl (idbeli, idtenant, idbarang, jml, harga, ppn, diskon, subtotal, satuan) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';
    let sql7 = 'SELECT satuanbesar, satuansedang, satuankecil, konversi1, konversi2 FROM barang WHERE idbarang = ? AND idtenant = ?';
    let sql8 = 'INSERT INTO kartustok (idtenant, idlokasi, kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idref, jenisref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
    let sql9 = 'INSERT INTO hargabeli (idtenant, idbarang, hargabeli, tgltrans) VALUES (?, ?, ?, ?)';

    // Iterasi tiap item: hitung PPN, diskon, subtotal; konversi satuan; catat stok
    for (const item of items) {
      const [[latestBeli]] = await conn.query(
        sql5,
        [item.idbarang, ctx.idtenant]
      );

      const harga = parseFloat(item.harga);

      // PPN per item: mode INCLUDE menggunakan tarif tenant, TIDAK_PAKAI = 0
      const ppn_mode = item.ppn_mode || 'INCLUDE';
      const ppnAmount = ppn_mode === 'INCLUDE' ? (harga * item.jml * ppnPercent) / 100 : 0;
      const diskonAmount = item.diskon ? (harga * item.jml * item.diskon) / 100 : 0;
      const subtotal = (harga * item.jml) + ppnAmount - diskonAmount;
      calculatedGrandTotal += subtotal;

      await conn.query(
        sql6,
        [header.idbeli, ctx.idtenant, item.idbarang, item.jml, harga, ppnAmount, item.diskon || 0, subtotal, item.satuan || null]
      );

      // Ambil info satuan barang untuk konversi ke satuan kecil di kartu stok
      const [[barangInfo]] = await conn.query(
        sql7,
        [item.idbarang, ctx.idtenant]
      );

      // Konversi ke satuan kecil agar stok konsisten di semua transaksi
      const jmlKartustok = barangInfo ? toKecilJml(item.jml, item.satuan, barangInfo) : item.jml;

      // Catat pergerakan stok jenis M (masuk)
      await conn.query(
        sql8,
        [ctx.idtenant, idlokasi, kodebeli, item.idbarang, jmlKartustok, 'M', tgltrans, `Pembelian ${kodebeli}`, header.idbeli, 'beli']
      );

      // Catat history harga beli jika berbeda dari harga terakhir
      if (!latestBeli || parseFloat(latestBeli.hargabeli) !== harga) {
        await conn.query(sql9, [ctx.idtenant, item.idbarang, harga, tgltrans]);
      }
    }

    // Update grandtotal header pembelian
    let sql10 = 'UPDATE beli SET grandtotal = ? WHERE idbeli = ? AND idtenant = ? AND idlokasi = ?';
    await conn.query(sql10, [calculatedGrandTotal, header.idbeli, ctx.idtenant, idlokasi]);

    // Catat ke kartu hutang dengan status OPEN (kewajiban ke supplier)
    let sql11 = 'INSERT INTO kartuhutang (idtenant, idlokasi, idsupplier, kodetrans, jenis, amount, terbayar, sisa, tgltrans, status) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)';
    await conn.query(
      sql11,
      [ctx.idtenant, idlokasi, idsupplier || null, kodebeli, 'BELI', calculatedGrandTotal, calculatedGrandTotal, tgltrans, 'OPEN']
    );

    // Opsi pelunasan langsung: buat transaksi pelunasan hutang otomatis
    if (req.body.langsung_lunas && calculatedGrandTotal > 0 && idsupplier) {
      const kodepelunasan = await generateKodePelunasanHutang(conn, ctx.idtenant, idlokasi);
      let sql12 = 'INSERT INTO pelunasanhutang (idtenant, idlokasi, idsupplier, kodepelunasan, tgltrans, total_amount, metodbayar, catatan, userentry) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';
      const [pelResult] = await conn.query(
        sql12,
        [ctx.idtenant, idlokasi, idsupplier, kodepelunasan, tgltrans, calculatedGrandTotal, req.body.metodbayar || 'TUNAI', `Pelunasan Langsung Transaksi Pembelian  ${kodebeli}`, ctx.iduser]
      );
      const idpelunasan = pelResult.insertId;

      // Detail pelunasan: hubungkan ke kode transaksi beli
      let sql13 = 'INSERT INTO pelunasanhutangdtl (idpelunasan, kodetrans, amount) VALUES (?, ?, ?)';
      await conn.query(
        sql13,
        [idpelunasan, kodebeli, calculatedGrandTotal]
      );

      // Update kartuhutang: set terbayar = amount, sisa = 0, status = LUNAS
      let sql14 = "UPDATE kartuhutang SET terbayar = amount, sisa = 0, status = 'LUNAS' WHERE kodetrans = ? AND idtenant = ? AND idlokasi = ?";
      await conn.query(
        sql14,
        [kodebeli, ctx.idtenant, idlokasi]
      );
    }

    await conn.commit();
    await logger.history('BELI_CREATE', { idtenant: ctx.idtenant, idlokasi, iduser: ctx.iduser, ref: kodebeli, detail: { grandtotal: calculatedGrandTotal }, req });
    res.status(201).json({ message: 'Pembelian berhasil', kodebeli, idbeli: header.idbeli, grandtotal: calculatedGrandTotal });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// GET /beli — Daftar transaksi pembelian dengan filter tenant, lokasi, supplier & pencarian (limit 200)
exports.getAll = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tglwal, tglakhir, idsupplier, idlokasi, search } = req.query;
    let sql = `SELECT b.*, DATE_FORMAT(b.tgltrans, '%Y-%m-%d') AS tgltrans, s.namasupplier, l.namalokasi
      FROM beli b
      LEFT JOIN supplier s ON b.idsupplier = s.idsupplier AND s.idtenant = b.idtenant
      LEFT JOIN lokasi l ON b.idlokasi = l.idlokasi AND l.idtenant = b.idtenant
      WHERE b.idtenant = ?`;
    const params = [ctx.idtenant];
    // Query dinamis: tambahkan filter hanya jika parameter tersedia
    if (idlokasi)   { sql += ' AND b.idlokasi = ?';  params.push(idlokasi); }
    if (tglwal)     { sql += ' AND b.tgltrans >= ?'; params.push(tglwal); }
    if (tglakhir)   { sql += ' AND b.tgltrans <= ?'; params.push(tglakhir); }
    if (idsupplier) { sql += ' AND b.idsupplier = ?'; params.push(idsupplier); }
    if (search)     { sql += ' AND b.kodebeli LIKE ?'; params.push(`%${search}%`); }
    sql += ' ORDER BY b.tgltrans DESC, b.idbeli DESC LIMIT 200';
    const rows = await tenantQuery(sql, params);
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /beli/:id — Detail satu transaksi pembelian beserta item, info satuan barang, dan status pelunasan
exports.getOne = async (req, res) => {
  try {
    const ctx = getTenantContext();
    let sql16 = `SELECT b.*, DATE_FORMAT(b.tgltrans, '%Y-%m-%d') AS tgltrans,
      s.namasupplier, s.kodesupplier, s.alamat AS salamat, s.hp AS shp,
      l.namalokasi, l.kodelokasi, COALESCE(kh.status, 'BELUMLUNAS') as statuslunas
      FROM beli b
      LEFT JOIN supplier s ON b.idsupplier = s.idsupplier AND s.idtenant = b.idtenant
      LEFT JOIN lokasi l ON b.idlokasi = l.idlokasi AND l.idtenant = b.idtenant
      LEFT JOIN kartuhutang kh on kh.kodetrans = b.kodebeli and kh.status = 'LUNAS'
      WHERE b.idbeli = ? AND b.idtenant = ?`;
    const rows = await tenantQuery(sql16, [req.params.id, ctx.idtenant]);
    if (rows.length === 0) return res.status(404).json({ message: 'Pembelian tidak ditemukan' });

    // Ambil detail item pembelian beserta info satuan barang
    let sql17 = `SELECT bd.*, br.namabarang, br.kodebarang,
      br.satuanbesar, br.satuansedang, br.satuankecil, br.konversi1, br.konversi2
      FROM belidtl bd
      LEFT JOIN barang br ON bd.idbarang = br.idbarang AND br.idtenant = bd.idtenant
      WHERE bd.idbeli = ? AND bd.idtenant = ?`;
    const items = await tenantQuery(sql17, [req.params.id, ctx.idtenant]);

    // Tentukan ppn_mode dari nilai PPN: > 0 berarti INCLUDE
    const mappedItems = items.map(item => ({
      ...item,
      ppn_mode: parseFloat(item.ppn || 0) > 0 ? 'INCLUDE' : 'TIDAK_PAKAI',
    }));

    res.json({ ...rows[0], items: mappedItems });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// PUT /beli/:id — Edit transaksi pembelian (hapus detail lama, buat ulang item, stok, hutang)
exports.update = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();

    const { id } = req.params;
    const { tgltrans, idsupplier, idlokasi: newIdlokasi, items, kodebeli } = req.body;

    if (!items || !items.length) return res.status(400).json({ message: 'Items tidak boleh kosong' }); // Validasi: minimal 1 item

    let sql18 = 'SELECT * FROM beli WHERE idbeli = ? AND idtenant = ?';
    const [[beli]] = await conn.query(sql18, [id, ctx.idtenant]);
if (!beli) return res.status(404).json({ message: 'Pembelian tidak ditemukan' });
    if (beli.status === 'VOID') return res.status(400).json({ message: 'Pembelian sudah dibatalkan' });

    // Cek apakah hutang sudah lunas — jika iya, hapus pelunasan dulu
    let sql19 = "SELECT idkartuhutang FROM kartuhutang WHERE kodetrans = ? AND jenis = 'BELI' AND status = 'LUNAS' AND idtenant = ?";
    const [[hutangLunas]] = await conn.query(
      sql19,
      [beli.kodebeli, ctx.idtenant]
    );

    if (hutangLunas){
      // Hapus pelunasan hutang beserta detailnya
      let sql20 = `
        DELETE ph, phdtl
        FROM pelunasanhutang ph 
        JOIN pelunasanhutangdtl phdtl on ph.idpelunasan = phdtl.idpelunasan
        WHERE phdtl.kodetrans = ?
      `;
      await conn.query(sql20, [beli.kodebeli]);
    }

    await ensureSatuanColumn(conn);

    // Ambil ulang PPN tenant
    let sql21 = 'SELECT ppn FROM tenant WHERE idtenant = ?';
    const [[tenant]] = await conn.query(sql21, [ctx.idtenant]);
    const ppnPercent = tenant ? parseFloat(tenant.ppn) : 11;

    // Tentukan lokasi: dari input edit atau dari data lama
    const idlokasi = (newIdlokasi && parseInt(newIdlokasi)) ? parseInt(newIdlokasi) : beli.idlokasi;
    const newTgltrans = tgltrans || String(beli.tgltrans).slice(0, 10);

    // Bersihkan data lama: hutang, stok, detail
    let sql22 = 'DELETE FROM kartuhutang WHERE kodetrans = ? AND idtenant = ?';
    await conn.query(
      sql22,
      [beli.kodebeli, ctx.idtenant]
    );

    let sql23 = "DELETE FROM kartustok WHERE idref = ? AND jenisref = 'beli' AND idtenant = ?";
    await conn.query(sql23, [id, ctx.idtenant]);
    let sql24 = 'DELETE FROM belidtl WHERE idbeli = ? AND idtenant = ?';
    await conn.query(sql24, [id, ctx.idtenant]);

    let calculatedGrandTotal = 0;

    // Pre-compile query untuk insert ulang detail & stok
    let sql25 = 'INSERT INTO belidtl (idbeli, idtenant, idbarang, jml, harga, ppn, diskon, subtotal, satuan) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';
    let sql26 = 'SELECT satuanbesar, satuansedang, satuankecil, konversi1, konversi2 FROM barang WHERE idbarang = ? AND idtenant = ?';
    let sql27 = 'INSERT INTO kartustok (idtenant, idlokasi, kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idref, jenisref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
    let sql28 = 'SELECT hargabeli FROM hargabeli WHERE idbarang = ? AND idtenant = ? ORDER BY tgltrans DESC, idhargabeli DESC LIMIT 1';
    let sql29 = 'INSERT INTO hargabeli (idtenant, idbarang, hargabeli, tgltrans) VALUES (?, ?, ?, ?)';

    // Iterasi item baru: hitung ulang PPN, diskon, subtotal; konversi satuan
    for (const item of items) {
      const harga = parseFloat(item.harga);
      const jml = parseInt(item.jml) || 1;
      const ppn_mode = item.ppn_mode || 'INCLUDE';
      const ppnAmount = ppn_mode === 'INCLUDE' ? (harga * jml * ppnPercent) / 100 : 0;
      const subtotal = (harga * jml) + ppnAmount;
      calculatedGrandTotal += subtotal;

      await conn.query(
        sql25,
        [id, ctx.idtenant, item.idbarang, jml, harga, ppnAmount, 0, subtotal, item.satuan || null]
      );

      // Konversi ke satuan kecil untuk kartu stok
      const [[barangInfo]] = await conn.query(
        sql26,
        [item.idbarang, ctx.idtenant]
      );
      const jmlKartustok = barangInfo ? toKecilJml(jml, item.satuan, barangInfo) : jml;

      await conn.query(
        sql27,
        [ctx.idtenant, idlokasi, beli.kodebeli, item.idbarang, jmlKartustok, 'M', newTgltrans, `Pembelian ${beli.kodebeli}`, id, 'beli']
      );

      // Update history harga beli jika berubah
      const [[latestBeli]] = await conn.query(
        sql28,
        [item.idbarang, ctx.idtenant]
      );
      if (!latestBeli || parseFloat(latestBeli.hargabeli) !== harga) {
        await conn.query(sql29, [ctx.idtenant, item.idbarang, harga, newTgltrans]);
      }
    }

    // Update grandtotal header pembelian
    let sql30 = 'UPDATE beli SET grandtotal = ? WHERE idbeli = ? AND idtenant = ?';
    await conn.query(sql30, [calculatedGrandTotal, id, ctx.idtenant]);

    // Buat ulang catatan hutang
    let sql31 = 'INSERT INTO kartuhutang (idtenant, idlokasi, idsupplier, kodetrans, jenis, amount, tgltrans, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
    await conn.query(
      sql31,
      [ctx.idtenant, idlokasi, idsupplier || null, beli.kodebeli, 'BELI', calculatedGrandTotal, newTgltrans, 'OPEN']
    );

    // Opsi pelunasan langsung setelah edit
    if (req.body.langsung_lunas && calculatedGrandTotal > 0 && idsupplier) {
      const kodepelunasan = await generateKodePelunasanHutang(conn, ctx.idtenant, idlokasi);
      let sql32 = 'INSERT INTO pelunasanhutang (idtenant, idlokasi, idsupplier, kodepelunasan, tgltrans, total_amount, metodbayar, catatan, userentry) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';
      const [pelResult] = await conn.query(
        sql32,
        [ctx.idtenant, idlokasi, idsupplier, kodepelunasan, tgltrans, calculatedGrandTotal, req.body.metodbayar || 'TUNAI', `Pelunasan Langsung Transaksi Pembelian  ${kodebeli}`, ctx.iduser]
      );
      const idpelunasan = pelResult.insertId;

      let sql33 = 'INSERT INTO pelunasanhutangdtl (idpelunasan, kodetrans, amount) VALUES (?, ?, ?)';
      await conn.query(
        sql33,
        [idpelunasan, kodebeli, calculatedGrandTotal]
      );

      // Update kartuhutang: set terbayar = amount, sisa = 0, status = LUNAS
      let sql34 = "UPDATE kartuhutang SET terbayar = amount, sisa = 0, status = 'LUNAS' WHERE kodetrans = ? AND idtenant = ? AND idlokasi = ?";
      await conn.query(
        sql34,
        [kodebeli, ctx.idtenant, idlokasi]
      );
    }

    await conn.commit();
    await logger.history('BELI_UPDATE', { idtenant: ctx.idtenant, idlokasi, iduser: ctx.iduser, ref: beli.kodebeli, req });
    res.json({ message: 'Pembelian berhasil diupdate', grandtotal: calculatedGrandTotal });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// GET /beli/:id/check-edit — Cek apakah transaksi beli bisa diedit (hutang belum lunas)
exports.checkEdit = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { id } = req.params;

    // Cek status hutang: jika sudah LUNAS, pelunasan harus dihapus dulu
    let sql35 = "SELECT kodetrans, status FROM kartuhutang WHERE kodetrans = (SELECT kodebeli FROM beli WHERE idbeli = ? AND idtenant = ?) AND jenis = 'BELI' AND idtenant = ?";
    const [hutangRows] = await tenantQuery(
      sql35,
      [id, ctx.idtenant, ctx.idtenant]
    );

    if (hutangRows && hutangRows.length > 0 && hutangRows[0].status === 'LUNAS') {
      return res.status(400).json({ canEdit: false, reason: 'HUTANG_LUNAS', message: 'Hapus pelunasan hutang terlebih dahulu sebelum edit' });
    }

    res.json({ canEdit: true });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// POST /beli/:id/cancel — Batalkan (void) transaksi beli, balikkan stok, hapus hutang
exports.cancel = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const { id } = req.params;

    let sql36 = 'SELECT * FROM beli WHERE idbeli = ? AND idtenant = ?';
    const [[beli]] = await conn.query(sql36, [id, ctx.idtenant]);
    if (!beli) return res.status(404).json({ message: 'Pembelian tidak ditemukan' });
    if (beli.status === 'VOID') return res.status(400).json({ message: 'Pembelian sudah dibatalkan' });

    // Cek apakah hutang sudah lunas — jika iya, batalkan pelunasan dulu
    let sql37 = "SELECT idkartuhutang FROM kartuhutang WHERE kodetrans = ? AND jenis = 'BELI' AND status = 'LUNAS' AND idtenant = ?";
    const [[hutangLunas]] = await conn.query(
      sql37,
      [beli.kodebeli, ctx.idtenant]
    );
    if (hutangLunas) return res.status(400).json({ message: 'Hapus pelunasan hutang terlebih dahulu sebelum membatalkan' });

    // Ubah status header beli menjadi VOID
    let sql38 = 'UPDATE beli SET status = ? WHERE idbeli = ? AND idtenant = ?';
    await conn.query(sql38, ['VOID', id, ctx.idtenant]);

    // Hapus catatan hutang untuk transaksi ini
    let sql39 = 'DELETE FROM kartuhutang WHERE kodetrans = ? AND idtenant = ?';
    await conn.query(sql39, [beli.kodebeli, ctx.idtenant]);

    // Balik stok: catat pergerakan keluar (K) untuk setiap item yang dibeli
    let sql40 = 'SELECT * FROM belidtl WHERE idbeli = ? AND idtenant = ?';
    const [details] = await conn.query(sql40, [id, ctx.idtenant]);
    const today = new Date().toISOString().slice(0, 10);
    let sql41 = 'INSERT INTO kartustok (idtenant, idlokasi, kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idref, jenisref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
    for (const dtl of details) {
      await conn.query(
        sql41,
        [ctx.idtenant, beli.idlokasi, `VOID-${beli.kodebeli}`, dtl.idbarang, dtl.jml, 'K', today, `Pembatalan ${beli.kodebeli}`, beli.idbeli, 'beli_void']
      );
    }

    await conn.commit();
    await logger.history('BELI_CANCEL', { idtenant: ctx.idtenant, idlokasi: beli.idlokasi, iduser: ctx.iduser, ref: beli.kodebeli, req });
    res.json({ message: 'Pembelian berhasil dibatalkan' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};
