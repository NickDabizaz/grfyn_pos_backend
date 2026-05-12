/* Controller transaksi penjualan (jual).
   Menangani CRUD penjualan, pencatatan pembayaran, pembatalan (void),
   pengecekan kelayakan edit, serta integrasi jurnal, stok, dan piutang. */
const { tenantQuery, tenantExecute, getConnection, getTenantContext } = require('../config/db');
const { generateKodeJual } = require('../lib/kodetrans');
const { generateKodePelunasanPiutang } = require('../lib/kodetrans');
const logger = require('../lib/logger');

// POST /jual — Buat transaksi penjualan baru (header, detail item, stok, jurnal, piutang)
exports.create = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const { idcustomer, bayar, items, jenis } = req.body;

    // Ambil persentase PPN dari tenant; 0 jika useppn=false, default 11% jika tenant tidak ditemukan
    let sql = 'SELECT ppn FROM tenant WHERE idtenant = ?';
    const [[tenant]] = await conn.query(sql, [ctx.idtenant]);
    const ppnPercent = req.body.useppn === false ? 0 : (tenant ? parseFloat(tenant.ppn) : 11);

    // --- Cek ketersediaan stok sebelum memproses (Pessimistic Lock via FOR UPDATE) ---
    const idbarangList = items.map(i => i.idbarang);
    const placeholders = idbarangList.map(() => '?').join(',');

    // Hitung stok bersih (masuk - keluar) per barang di lokasi ini
    const [stokRows] = await conn.query(
      `SELECT idbarang,
         COALESCE(SUM(CASE WHEN jenis='M' THEN jml ELSE 0 END),0) -
         COALESCE(SUM(CASE WHEN jenis='K' THEN jml ELSE 0 END),0) AS stok_tersedia
       FROM kartustok
       WHERE idtenant = ? AND idlokasi = ? AND idbarang IN (${placeholders})
       GROUP BY idbarang
       FOR UPDATE`,
      [ctx.idtenant, ctx.idlokasi, ...idbarangList]
    );

    const stokMap = {};
    stokRows.forEach(r => { stokMap[r.idbarang] = Number(r.stok_tersedia); });

    const stokKurang = items.filter(item => {
      const tersedia = stokMap[item.idbarang] ?? 0;
      return tersedia < item.jml;
    });

    if (stokKurang.length > 0) {
      await conn.rollback();
      return res.status(400).json({
        message: 'Stok tidak mencukupi',
        details: stokKurang.map(item => ({
          idbarang : item.idbarang,
          diminta  : item.jml,
          tersedia : stokMap[item.idbarang] ?? 0,
        })),
      });
    }
    // -------------------------------------------------------------------------------

    // Generate kode transaksi otomatis berdasarkan tenant & lokasi
    const kodejual = await generateKodeJual(conn, ctx.idtenant, ctx.idlokasi);
    const tgltrans = req.body.tgltrans || new Date().toISOString().slice(0, 10); // Default: hari ini

    // Insert header transaksi jual dengan status awal AKTIF
    let sql2 = 'INSERT INTO jual (idtenant, idlokasi, kodejual, tgltrans, idcustomer, iduser, grandtotal, bayar, kembali, jenis, metodbayar, status, userentry) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?, ?, ?)';
    const [headerResult] = await conn.query(sql2, [ctx.idtenant, ctx.idlokasi, kodejual, tgltrans, idcustomer || null, ctx.iduser, bayar || 0, jenis || 'POS', req.body.metodbayar || 'TUNAI', 'AKTIF', ctx.iduser]);
    const idjual = headerResult.insertId;

    // Ambil riwayat harga jual untuk semua item dalam satu query (menghindari N+1)
    const [hargaRows] = await conn.query(
      `SELECT h1.idbarang, h1.hargajual
       FROM hargajual h1
       WHERE h1.idtenant = ? AND h1.idbarang IN (${placeholders})
         AND h1.idhargajual = (
           SELECT MAX(h2.idhargajual) FROM hargajual h2
           WHERE h2.idtenant = h1.idtenant AND h2.idbarang = h1.idbarang
         )`,
      [ctx.idtenant, ...idbarangList]
    );
    const hargaMap = {};
    hargaRows.forEach(r => { hargaMap[r.idbarang] = parseFloat(r.hargajual); });

    let calculatedGrandTotal = 0;
    const jualdtlRows   = [];  // Batch insert jualdtl
    const kartustokRows = [];  // Batch insert kartustok
    const hargaBaruRows = [];  // Batch insert hargajual (hanya yang berubah)

    for (const item of items) {
      const harga        = parseFloat(item.harga);
      const ppnAmount    = (harga * item.jml * ppnPercent) / 100;
      const diskonAmount = item.diskon ? (harga * item.jml * item.diskon) / 100 : 0;
      const subtotal     = (harga * item.jml) + ppnAmount - diskonAmount;
      calculatedGrandTotal += subtotal;

      jualdtlRows.push([idjual, ctx.idtenant, item.idbarang, item.jml, item.satuan, harga, ppnAmount, item.diskon || 0, subtotal]);
      kartustokRows.push([ctx.idtenant, ctx.idlokasi, kodejual, item.idbarang, item.jml, 'K', tgltrans, `Penjualan ${kodejual}`, idjual, 'jual']);

      if (hargaMap[item.idbarang] === undefined || hargaMap[item.idbarang] !== harga) {
        hargaBaruRows.push([ctx.idtenant, item.idbarang, harga, tgltrans]);
      }
    }

    // Batch inserts — satu query per tabel
    await conn.query('INSERT INTO jualdtl (idjual, idtenant, idbarang, jml, satuan, harga, ppn, diskon, subtotal) VALUES ?', [jualdtlRows]);
    await conn.query('INSERT INTO kartustok (idtenant, idlokasi, kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idref, jenisref) VALUES ?', [kartustokRows]);
    if (hargaBaruRows.length) {
      await conn.query('INSERT INTO hargajual (idtenant, idbarang, hargajual, tgltrans) VALUES ?', [hargaBaruRows]);
    }

    // Hitung kembalian dan tentukan status lunas/aktif
    const calculatedKembali = (bayar || 0) - calculatedGrandTotal; // Bisa negatif jika kurang bayar
    const statusJual = (bayar || 0) >= calculatedGrandTotal ? 'LUNAS' : 'AKTIF';
    let sql8 = 'UPDATE jual SET grandtotal = ?, kembali = ?, status = ? WHERE idjual = ? AND idtenant = ? AND idlokasi = ?';
    await conn.query(sql8, [calculatedGrandTotal, calculatedKembali, statusJual, idjual, ctx.idtenant, ctx.idlokasi]);

    // Jurnal: DEBET KAS, KREDIT PENJUALAN (jika akun tersedia)
    let sql9 = "SELECT idakun FROM akun WHERE namaakun = 'KAS' AND idtenant = ? LIMIT 1";
    const [[akunKas]] = await conn.query(sql9, [ctx.idtenant]);
    let sql10 = "SELECT idakun FROM akun WHERE namaakun = 'PENJUALAN' AND idtenant = ? LIMIT 1";
    const [[akunJual]] = await conn.query(sql10, [ctx.idtenant]);
    if (akunKas) {
      let sql11 = 'INSERT INTO jurnal (idtenant, idlokasi, idtrans, kodetrans, jenis, idakun, posisi, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
      await conn.query(sql11, [ctx.idtenant, ctx.idlokasi, idjual, kodejual, 'jual', akunKas.idakun, 'DEBET', calculatedGrandTotal]);
    }
    if (akunJual) {
      let sql12 = 'INSERT INTO jurnal (idtenant, idlokasi, idtrans, kodetrans, jenis, idakun, posisi, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
      await conn.query(sql12, [ctx.idtenant, ctx.idlokasi, idjual, kodejual, 'jual', akunJual.idakun, 'KREDIT', calculatedGrandTotal]);
    }

    // Catat ke kartu piutang dengan status OPEN (tunggakan customer)
    let sql13 = 'INSERT INTO kartupiutang (idtenant, idlokasi, idcustomer, kodetrans, jenis, amount, terbayar, sisa, tgltrans, status) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)';
    await conn.query(sql13, [ctx.idtenant, ctx.idlokasi, idcustomer || null, kodejual, 'JUAL', calculatedGrandTotal, calculatedGrandTotal, tgltrans, 'OPEN']);

    // Opsi pelunasan langsung: buat transaksi pelunasan piutang otomatis
    if (req.body.langsung_lunas && calculatedGrandTotal > 0 && idcustomer) {
      const kodepelunasan = await generateKodePelunasanPiutang(conn, ctx.idtenant, ctx.idlokasi);
      let sql14 = 'INSERT INTO pelunasanpiutang (idtenant, idlokasi, idcustomer, kodepelunasan, tgltrans, total_amount, metodbayar, catatan, userentry) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';
      const [pelResult] = await conn.query(sql14, [ctx.idtenant, ctx.idlokasi, idcustomer, kodepelunasan, tgltrans, calculatedGrandTotal, req.body.metodbayar || 'TUNAI', `Pelunasan Langsung Transaksi Penjualan ${kodejual}`, ctx.iduser]);
      const idpelunasan = pelResult.insertId;

      // Detail pelunasan: hubungkan ke kode transaksi jual
      let sql15 = 'INSERT INTO pelunasanpiutangdtl (idpelunasan, kodetrans, amount) VALUES (?, ?, ?)';
      await conn.query(sql15, [idpelunasan, kodejual, calculatedGrandTotal]);

      // Update kartupiutang: set terbayar = amount, sisa = 0, status = LUNAS
      let sql16 = "UPDATE kartupiutang SET terbayar = amount, sisa = 0, status = 'LUNAS' WHERE kodetrans = ? AND idtenant = ? AND idlokasi = ?";
      await conn.query(sql16, [kodejual, ctx.idtenant, ctx.idlokasi]);
    }

    await conn.commit();
    await logger.history('JUAL_CREATE', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: kodejual, detail: { grandtotal: calculatedGrandTotal }, req });
    res.status(201).json({ message: 'Transaksi berhasil', kodejual, idjual, grandtotal: calculatedGrandTotal });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// GET /jual — Daftar transaksi penjualan dengan filter & pencarian (limit 200)
exports.getAll = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tglwal, tglakhir, idcustomer, jenis, search } = req.query;
    let sql = `SELECT j.*, DATE_FORMAT(j.tgltrans, '%Y-%m-%d') AS tgltrans, c.namacustomer, l.namalokasi
      FROM jual j
      LEFT JOIN customer c ON j.idcustomer = c.idcustomer AND c.idtenant = j.idtenant
      LEFT JOIN lokasi l ON j.idlokasi = l.idlokasi AND l.idtenant = j.idtenant
      WHERE 1=1`;
    const params = [];
    // Query dinamis: tambahkan filter hanya jika parameter tersedia
    sql += ' AND j.idlokasi = ?'; params.push(ctx.idlokasi);
    if (tglwal) { sql += ' AND j.tgltrans >= ?'; params.push(tglwal); }
    if (tglakhir) { sql += ' AND j.tgltrans <= ?'; params.push(tglakhir); }
    if (idcustomer) { sql += ' AND j.idcustomer = ?'; params.push(idcustomer); }
    if (jenis) { sql += ' AND j.jenis = ?'; params.push(jenis); }
    if (search) { sql += ' AND j.kodejual LIKE ?'; params.push(`%${search}%`); }
    sql += ' ORDER BY j.tgltrans DESC, j.idjual DESC LIMIT 200';
    const rows = await tenantQuery(sql, params);
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /jual/:id — Detail satu transaksi penjualan beserta item dan status pelunasan
exports.getOne = async (req, res) => {
  try {
    const ctx = getTenantContext();
    let sql18 = `SELECT j.*, DATE_FORMAT(j.tgltrans, '%Y-%m-%d') AS tgltrans, c.kodecustomer, c.namacustomer, c.alamat, c.hp, COALESCE(kp.status,'BELUMLUNAS') as statuslunas, l.*
      FROM jual j
      LEFT JOIN customer c ON j.idcustomer = c.idcustomer AND c.idtenant = j.idtenant
      LEFT JOIN kartupiutang kp on kp.kodetrans = j.kodejual and kp.status ='LUNAS'
      LEFT JOIN lokasi l on l.idlokasi = j.idlokasi AND l.idtenant = j.idtenant 
      WHERE j.idjual = ? AND j.idlokasi = ?`;
    const rows = await tenantQuery(sql18, [req.params.id, ctx.idlokasi]);
    if (rows.length === 0) return res.status(404).json({ message: 'Transaksi tidak ditemukan' });

    // Ambil detail item jual (barang yang dibeli)
    let sql19 = `SELECT jd.*, b.namabarang
      FROM jualdtl jd
      LEFT JOIN barang b ON jd.idbarang = b.idbarang AND b.idtenant = jd.idtenant
      WHERE jd.idjual = ?`;
    const items = await tenantQuery(sql19, [req.params.id]);
    res.json({ ...rows[0], items });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// PATCH /jual/:id/bayar — Catat pembayaran tambahan (split payment) pada transaksi jual
exports.updateBayar = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const { id } = req.params;
    const { bayar } = req.body;

    if (bayar === undefined || bayar === null) return res.status(400).json({ message: 'bayar harus diisi' }); // Validasi: field bayar wajib

    let sql20 = 'SELECT * FROM jual WHERE idjual = ? AND idtenant = ? AND idlokasi = ?';
    const [[jual]] = await conn.query(sql20, [id, ctx.idtenant, ctx.idlokasi]);
    if (!jual) return res.status(404).json({ message: 'Transaksi tidak ditemukan' });
    if (jual.status === 'VOID') return res.status(400).json({ message: 'Transaksi sudah dibatalkan' });

    const totalBayar = parseFloat(jual.bayar) + parseFloat(bayar); // Akumulasi pembayaran sebelumnya + baru
    if (totalBayar > parseFloat(jual.grandtotal)) return res.status(400).json({ message: 'Pembayaran melebihi total transaksi' }); // Validasi: tidak boleh lebih bayar

    // Tentukan status baru: LUNAS jika total bayar >= grandtotal
    const newStatus = totalBayar >= parseFloat(jual.grandtotal) ? 'LUNAS' : 'AKTIF';
    const newKembali = totalBayar - parseFloat(jual.grandtotal); // Bisa 0 atau positif

    let sql21 = 'UPDATE jual SET bayar = ?, kembali = ?, status = ? WHERE idjual = ? AND idtenant = ? AND idlokasi = ?';
    await conn.query(
      sql21,
      [totalBayar, newKembali, newStatus, id, ctx.idtenant, ctx.idlokasi]
    );

    await conn.commit();
    await logger.history('JUAL_BAYAR', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: jual.kodejual, detail: { bayar, totalBayar, newStatus }, req });
    res.json({ message: 'Pembayaran berhasil dicatat', totalBayar, status: newStatus });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// GET /jual/:id/check-edit — Cek apakah transaksi jual bisa diedit (belum lunas & tidak ada retur aktif)
exports.checkEdit = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { id } = req.params;

    // Cek status piutang: jika sudah LUNAS berarti ada pelunasan, harus dihapus dulu
    let sql22 = "SELECT kodetrans, status FROM kartupiutang WHERE kodetrans = (SELECT kodejual FROM jual WHERE idjual = ? AND idtenant = ? AND idlokasi = ?) AND jenis = 'JUAL' AND idtenant = ? AND idlokasi = ?";
    const [piutangRows] = await tenantQuery(
      sql22,
      [id, ctx.idtenant, ctx.idlokasi, ctx.idtenant, ctx.idlokasi]
    );

    if (piutangRows && piutangRows.length > 0 && piutangRows[0].status === 'LUNAS') {
      return res.status(400).json({ canEdit: false, reason: 'PIUTANG_LUNAS', message: 'Hapus pelunasan terlebih dahulu sebelum edit' });
    }

    // Cek apakah ada retur penjualan yang masih aktif untuk transaksi ini
    let sql23 = "SELECT kodereturjual FROM returjual WHERE kodejual = (SELECT kodejual FROM jual WHERE idjual = ? AND idtenant = ? AND idlokasi = ?) AND idtenant = ? AND idlokasi = ? AND status = 'AKTIF'";
    const returRows = await tenantQuery(
      sql23,
      [id, ctx.idtenant, ctx.idlokasi, ctx.idtenant, ctx.idlokasi]
    );

    if (returRows.length > 0) {
      return res.json({ canEdit: false, reason: 'HAS_RETUR', returs: returRows.map(r => r.kodereturjual), message: 'Terdapat Retur Penjualan yang masih aktif' });
    }

    res.json({ canEdit: true });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// POST /jual/:id/cancel — Batalkan (void) transaksi jual, kembalikan stok, hapus piutang
exports.cancel = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const { id } = req.params;

    let sql24 = 'SELECT * FROM jual WHERE idjual = ? AND idtenant = ? AND idlokasi = ?';
    const [[jual]] = await conn.query(sql24, [id, ctx.idtenant, ctx.idlokasi]);
    if (!jual) return res.status(404).json({ message: 'Transaksi tidak ditemukan' });
    if (jual.status === 'VOID') return res.status(400).json({ message: 'Transaksi sudah dibatalkan' });

    // Cek apakah piutang sudah lunas — jika iya, batalkan pelunasan dulu
    let sql25 = "SELECT idkartupiutang FROM kartupiutang WHERE kodetrans = ? AND jenis = 'JUAL' AND status = 'LUNAS' AND idtenant = ? AND idlokasi = ?";
    const [[piutangLunas]] = await conn.query(
      sql25,
      [jual.kodejual, ctx.idtenant, ctx.idlokasi]
    );
    if (piutangLunas) return res.status(400).json({ message: 'Hapus pelunasan terlebih dahulu sebelum membatalkan' });

    // Cek apakah ada retur aktif — harus dibatalkan dulu
    let sql26 = "SELECT kodereturjual FROM returjual WHERE kodejual = ? AND idtenant = ? AND idlokasi = ? AND status = 'AKTIF'";
    const [returRows] = await conn.query(
      sql26,
      [jual.kodejual, ctx.idtenant, ctx.idlokasi]
    );
    if (returRows.length > 0) {
      return res.status(400).json({ message: 'Terdapat Retur Penjualan yang masih aktif', returs: returRows.map(r => r.kodereturjual) });
    }

    // Ubah status header jual menjadi VOID
    let sql27 = 'UPDATE jual SET status = ? WHERE idjual = ? AND idtenant = ? AND idlokasi = ?';
    await conn.query(sql27, ['VOID', id, ctx.idtenant, ctx.idlokasi]);

    // Hapus catatan piutang untuk transaksi ini
    let sql28 = 'DELETE FROM kartupiutang WHERE kodetrans = ? AND idtenant = ? AND idlokasi = ?';
    await conn.query(sql28, [jual.kodejual, ctx.idtenant, ctx.idlokasi]);

    // Nonaktifkan entri jurnal terkait
    let sql29 = "UPDATE jurnal SET status = 'NONAKTIF' WHERE kodetrans = ? AND jenis = 'jual' AND idtenant = ? AND idlokasi = ?";
    await conn.query(sql29, [jual.kodejual, ctx.idtenant, ctx.idlokasi]);

    // Balik stok: catat pergerakan masuk (M) untuk setiap item yang dijual
    let sql30 = 'SELECT * FROM jualdtl WHERE idjual = ? AND idtenant = ?';
    const [details] = await conn.query(sql30, [id, ctx.idtenant]);
    const today = new Date().toISOString().slice(0, 10);
    let sql31 = 'INSERT INTO kartustok (idtenant, idlokasi, kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idref, jenisref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
    for (const dtl of details) {
      await conn.query(
        sql31,
        [ctx.idtenant, ctx.idlokasi, `VOID-${jual.kodejual}`, dtl.idbarang, dtl.jml, 'M', today, `Pembatalan ${jual.kodejual}`, jual.idjual, 'jual_void']
      );
    }

    await conn.commit();
    await logger.history('JUAL_CANCEL', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: jual.kodejual, req });
    res.json({ message: 'Transaksi berhasil dibatalkan' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// PUT /jual/:id — Edit penuh transaksi jual (hapus detail lama, buat ulang item, jurnal, piutang)
exports.update = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();

    const { id } = req.params;
    const { idcustomer, bayar, items, jenis, metodbayar, tgltrans } = req.body;

    if (!items || !items.length) return res.status(400).json({ message: 'Items tidak boleh kosong' }); // Validasi: minimal 1 item

    let sql32 = 'SELECT * FROM jual WHERE idjual = ? AND idtenant = ? AND idlokasi = ?';
    const [[oldJual]] = await conn.query(
      sql32,
      [id, ctx.idtenant, ctx.idlokasi]
    );
    if (!oldJual) return res.status(404).json({ message: 'Transaksi tidak ditemukan' });
    if (oldJual.status === 'VOID') return res.status(400).json({ message: 'Transaksi sudah dibatalkan' });

    // Hapus data pelunasan jika piutang sudah lunas (agar bisa diedit)
    let sql33 = "SELECT idkartupiutang FROM kartupiutang WHERE kodetrans = ? AND jenis = 'JUAL' AND status = 'LUNAS' AND idtenant = ? AND idlokasi = ?";
    const [[piutangLunas]] = await conn.query(
      sql33,
      [oldJual.kodejual, ctx.idtenant, ctx.idlokasi]
    );
    if (piutangLunas) {
      // Hapus pelunasan piutang beserta detailnya
      let sql34 = `
        DELETE pp, ppdtl
        FROM pelunasanpiutang pp 
        JOIN pelunasanpiutangdtl ppdtl on pp.idpelunasan = ppdtl.idpelunasan
        WHERE ppdtl.kodetrans = ?
      `;
      await conn.query(sql34, [oldJual.kodejual]);
    }

    const today = tgltrans || new Date().toISOString().slice(0, 10); // Tanggal transaksi (input atau hari ini)

    // Bersihkan data lama: piutang, stok, detail, jurnal
    let sql35 = 'DELETE FROM kartupiutang WHERE kodetrans = ? AND idtenant = ? AND idlokasi = ?';
    await conn.query(
      sql35,
      [oldJual.kodejual, ctx.idtenant, ctx.idlokasi]
    );

    let sql36 = 'DELETE FROM kartustok WHERE idref = ? AND jenisref = ? AND idtenant = ? AND idlokasi = ?';
    await conn.query(
      sql36,
      [id, 'jual', ctx.idtenant, ctx.idlokasi]
    );

    let sql37 = 'DELETE FROM jualdtl WHERE idjual = ? AND idtenant = ?';
    await conn.query(sql37, [id, ctx.idtenant]);

    let sql38 = "DELETE FROM jurnal WHERE kodetrans = ? AND jenis = 'jual' AND idtenant = ? AND idlokasi = ?";
    await conn.query(
      sql38,
      [oldJual.kodejual, ctx.idtenant, ctx.idlokasi]
    );

    // Ambil ulang PPN tenant
    let sql39 = 'SELECT ppn FROM tenant WHERE idtenant = ?';
    const [[tenant]] = await conn.query(sql39, [ctx.idtenant]);
    const ppnPercent = req.body.useppn === false ? 0 : (tenant ? parseFloat(tenant.ppn) : 11);

    let calculatedGrandTotal = 0;

    // Pre-compile query untuk insert ulang detail & stok
    let sql40 = 'SELECT hargajual FROM hargajual WHERE idbarang = ? AND idtenant = ? ORDER BY tgltrans DESC, idhargajual DESC LIMIT 1';
    let sql41 = 'INSERT INTO jualdtl (idjual, idtenant, idbarang, jml, satuan, harga, ppn, diskon, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';
    let sql42 = 'INSERT INTO kartustok (idtenant, idlokasi, kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idref, jenisref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
    let sql43 = 'INSERT INTO hargajual (idtenant, idbarang, hargajual, tgltrans) VALUES (?, ?, ?, ?)';

    // Iterasi item baru: hitung ulang PPN, diskon, subtotal
    for (const item of items) {
      const [[latestJual]] = await conn.query(
        sql40,
        [item.idbarang, ctx.idtenant]
      );

      const harga = parseFloat(item.harga);

      // Kalkulasi PPN, diskon, subtotal per item
      const ppnAmount    = (harga * item.jml * ppnPercent) / 100;
      const diskonAmount = item.diskon ? (harga * item.jml * item.diskon) / 100 : 0;
      const subtotal     = (harga * item.jml) + ppnAmount - diskonAmount;
      calculatedGrandTotal += subtotal;

      await conn.query(
        sql41,
        [id, ctx.idtenant, item.idbarang, item.jml, item.satuan, harga, ppnAmount, item.diskon || 0, subtotal]
      );

      // Catat stok keluar (K)
      await conn.query(
        sql42,
        [ctx.idtenant, ctx.idlokasi, oldJual.kodejual, item.idbarang, item.jml, 'K', today, `Penjualan ${oldJual.kodejual}`, oldJual.idjual, 'jual']
      );

      // Update history harga jual jika berubah
      if (!latestJual || parseFloat(latestJual.hargajual) !== parseFloat(item.harga)) {
        await conn.query(sql43, [ctx.idtenant, item.idbarang, parseFloat(item.harga), today]);
      }
    }

    // Update header jual dengan data baru
    let sql44 = 'UPDATE jual SET idcustomer = ?, tgltrans = ?, metodbayar = ?, jenis = ?, grandtotal = ?, bayar = ?, kembali = ?, status = ? WHERE idjual = ? AND idtenant = ? AND idlokasi = ?';
    await conn.query(
      sql44,
      [idcustomer || null, today, metodbayar || 'TUNAI', jenis || 'POS', calculatedGrandTotal, bayar || 0, (bayar || 0) - calculatedGrandTotal, 'AKTIF', id, ctx.idtenant, ctx.idlokasi]
    );

    // Buat ulang entri jurnal: DEBET KAS, KREDIT PENJUALAN
    let sql45 = "SELECT idakun FROM akun WHERE namaakun = 'KAS' AND idtenant = ? LIMIT 1";
    const [[akunKas]]  = await conn.query(sql45, [ctx.idtenant]);
    let sql46 = "SELECT idakun FROM akun WHERE namaakun = 'PENJUALAN' AND idtenant = ? LIMIT 1";
    const [[akunJual]] = await conn.query(sql46, [ctx.idtenant]);

    if (akunKas) {
      let sql47 = 'INSERT INTO jurnal (idtenant, idlokasi, idtrans, kodetrans, jenis, idakun, posisi, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
      await conn.query(
        sql47,
        [ctx.idtenant, ctx.idlokasi, oldJual.idjual, oldJual.kodejual, 'jual', akunKas.idakun, 'DEBET', calculatedGrandTotal]
      );
    }
    if (akunJual) {
      let sql48 = 'INSERT INTO jurnal (idtenant, idlokasi, idtrans, kodetrans, jenis, idakun, posisi, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
      await conn.query(
        sql48,
        [ctx.idtenant, ctx.idlokasi, oldJual.idjual, oldJual.kodejual, 'jual', akunJual.idakun, 'KREDIT', calculatedGrandTotal]
      );
    }

    // Buat ulang catatan piutang
    let sql49 = 'INSERT INTO kartupiutang (idtenant, idlokasi, idcustomer, kodetrans, jenis, amount, terbayar, sisa, tgltrans, status) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)';
    await conn.query(
      sql49,
      [ctx.idtenant, ctx.idlokasi, idcustomer || null, oldJual.kodejual, 'JUAL', calculatedGrandTotal, calculatedGrandTotal, today, 'OPEN']
    );

    // Opsi pelunasan langsung setelah edit
    if (req.body.langsung_lunas && calculatedGrandTotal > 0 && idcustomer) {
      const kodepelunasan = await generateKodePelunasanPiutang(conn, ctx.idtenant, ctx.idlokasi);
      let sql50 = 'INSERT INTO pelunasanpiutang (idtenant, idlokasi, idcustomer, kodepelunasan, tgltrans, total_amount, metodbayar, catatan, userentry) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';
      const [pelResult] = await conn.query(
        sql50,
        [ctx.idtenant, ctx.idlokasi, idcustomer, kodepelunasan, tgltrans, calculatedGrandTotal, req.body.metodbayar || 'TUNAI', `Pelunasan Langsung Transaksi Penjualan ${oldJual.kodejual}`, ctx.iduser]
      );
      const idpelunasan = pelResult.insertId;

      let sql51 = 'INSERT INTO pelunasanpiutangdtl (idpelunasan, kodetrans, amount) VALUES (?, ?, ?)';
      await conn.query(
        sql51,
        [idpelunasan, oldJual.kodejual, calculatedGrandTotal]
      );

      // Update kartupiutang: set terbayar = amount, sisa = 0, status = LUNAS
      let sql52 = "UPDATE kartupiutang SET terbayar = amount, sisa = 0, status = 'LUNAS' WHERE kodetrans = ? AND idtenant = ? AND idlokasi = ? AND jenis = 'JUAL'";
      await conn.query(
        sql52,
        [oldJual.kodejual, ctx.idtenant, ctx.idlokasi]
      );
    }

    await conn.commit();
    await logger.history('JUAL_EDIT', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: oldJual.kodejual, detail: { grandtotal: calculatedGrandTotal }, req });
    res.json({ message: 'Transaksi berhasil diupdate', kodejual: oldJual.kodejual, idjual: oldJual.idjual, grandtotal: calculatedGrandTotal });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};
