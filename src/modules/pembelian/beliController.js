const { tenantQuery, tenantExecute, getConnection, getTenantContext } = require('../../config/db');
const { generateKodeBeli, generateKodePelunasanHutang }               = require('../../lib/kodetrans');
const logger                                                          = require('../../lib/logger');

// Konversi jumlah item ke satuan terkecil (satuankecil) untuk konsistensi kartu stok
function toKecilJml(jml, satuan, barang) {
  const k1 = Math.max(parseInt(barang.konversi1) || 1, 1); // Konversi: Besar -> Sedang
  const k2 = Math.max(parseInt(barang.konversi2) || 1, 1); // Konversi: Sedang -> Kecil

  if (satuan && barang.satuanbesar  && satuan === barang.satuanbesar)  return jml * k1 * k2;
  if (satuan && barang.satuansedang && satuan === barang.satuansedang) return jml * k2;
  
  return jml; // Jika tidak cocok atau sudah satuan kecil
}

// POST /beli — Buat transaksi pembelian baru
exports.create = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();

    // 1. Ekstrak & Siapkan Data dari Request Body
    const items          = req.body.items;
    const customKodebeli = req.body.kodebeli;
    const customIdlokasi = req.body.idlokasi;
    
    if (!items || !items.length) {
      await conn.rollback();
      return res.status(400).json({ message: 'Items tidak boleh kosong' });
    }

    // Ambil default values & identitas
    const idsupplier = req.body.idsupplier || null;
    const langsungLunas = req.body.langsung_lunas === true;
    const idlokasi   = (customIdlokasi && parseInt(customIdlokasi)) ? parseInt(customIdlokasi) : null;
    const tgltrans   = req.body.tgltrans   || new Date().toISOString().slice(0, 10);
    const kodebeli   = (customKodebeli && customKodebeli.trim()) ? customKodebeli.trim() : await generateKodeBeli(conn, ctx.idtenant, idlokasi);
    const jenistransaksi = langsungLunas ? 'BELI LUNAS' : 'BELI';
    const idgrn      = req.body.idgrn   || null;
    const kodegrn    = req.body.kodegrn || null;

    if (!idlokasi) {
      await conn.rollback();
      return res.status(400).json({ message: 'Lokasi wajib dipilih' });
    }
    if (!idsupplier) {
      await conn.rollback();
      return res.status(400).json({ message: 'Supplier wajib dipilih' });
    }

    // Ambil PPN Tenant (Default 11%)
    const [[tenant]]   = await conn.query('SELECT ppn FROM tenant WHERE idtenant = ?', [ctx.idtenant]);
    const ppnPercent   = tenant ? parseFloat(tenant.ppn) : 11;
    let   grandTotal   = 0;

    // 2. Insert Header Pembelian (Beli)
    const queryInsertHeader = `
      INSERT INTO beli (idtenant, idlokasi, kodebeli, tgltrans, idsupplier, iduser, grandtotal, bayar, jenistransaksi, idgrn, kodegrn, status, userentry)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'AKTIF', ?)
    `;
    await conn.query(queryInsertHeader, [
      ctx.idtenant, idlokasi, kodebeli, tgltrans, idsupplier, ctx.iduser, 0, jenistransaksi, idgrn, kodegrn, ctx.iduser
    ]);

    // Ambil ID Header yang baru dibuat
    const [[header]] = await conn.query('SELECT idbeli FROM beli WHERE kodebeli = ? AND idtenant = ?', [kodebeli, ctx.idtenant]);
    const idbeli     = header.idbeli;

    // 3. Proses Detail Items & Kartu Stok
    for (const item of items) {
      const harga   = parseFloat(item.harga);
      const jml     = parseInt(item.jml) || 1;
      const diskon  = parseFloat(item.diskon) || 0;
      
      // Hitung PPN & Subtotal
      const ppnMode = item.ppn_mode || 'INCLUDE';
      const ppnRp   = ppnMode === 'INCLUDE' ? (harga * jml * ppnPercent) / 100 : 0;
      const disknRp = (harga * jml * diskon) / 100;
      const subTtl  = (harga * jml) + ppnRp - disknRp;
      
      grandTotal += subTtl;

      // Insert Detail Pembelian
      const queryInsertDetail = `
        INSERT INTO belidtl (idbeli, idtenant, idbarang, jml, harga, ppn, diskon, subtotal, satuan) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      await conn.query(queryInsertDetail, [
        idbeli, ctx.idtenant, item.idbarang, jml, harga, ppnRp, diskon, subTtl, item.satuan || null
      ]);

      // Ambil Info Barang untuk Konversi Stok & Insert Kartu Stok
      const [[barangInfo]] = await conn.query('SELECT satuanbesar, satuansedang, satuankecil, konversi1, konversi2 FROM barang WHERE idbarang = ? AND idtenant = ?', [item.idbarang, ctx.idtenant]);
      const jmlStokKecil   = barangInfo ? toKecilJml(jml, item.satuan, barangInfo) : jml;

      const queryInsertStok = `
        INSERT INTO kartustok (idtenant, idlokasi, kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idref, jenisref) 
        VALUES (?, ?, ?, ?, ?, 'M', ?, ?, ?, 'beli')
      `;
      await conn.query(queryInsertStok, [
        ctx.idtenant, idlokasi, kodebeli, item.idbarang, jmlStokKecil, tgltrans, `Pembelian ${kodebeli}`, idbeli
      ]);

      // Update History Harga Beli (Jika Berubah)
      const [[latestHarga]] = await conn.query('SELECT hargabeli FROM hargabeli WHERE idbarang = ? AND idtenant = ? ORDER BY tgltrans DESC, idhargabeli DESC LIMIT 1', [item.idbarang, ctx.idtenant]);
      if (!latestHarga || parseFloat(latestHarga.hargabeli) !== harga) {
        await conn.query('INSERT INTO hargabeli (idtenant, idbarang, hargabeli, tgltrans) VALUES (?, ?, ?, ?)', [ctx.idtenant, item.idbarang, harga, tgltrans]);
      }
    }

    // 4. Update Grandtotal di Header
    const bayarFinal = langsungLunas ? grandTotal : 0;
    await conn.query('UPDATE beli SET grandtotal = ?, bayar = ? WHERE idbeli = ?', [grandTotal, bayarFinal, idbeli]);

    // 5. Catat Kartu Hutang
    const queryInsertHutang = `
      INSERT INTO kartuhutang (idtenant, idlokasi, idsupplier, kodetrans, jenis, amount, terbayar, sisa, tgltrans, status) 
      VALUES (?, ?, ?, ?, 'BELI', ?, ?, ?, ?, ?)
    `;
    await conn.query(queryInsertHutang, [
      ctx.idtenant,
      idlokasi,
      idsupplier,
      kodebeli,
      grandTotal,
      langsungLunas ? grandTotal : 0,
      langsungLunas ? 0 : grandTotal,
      tgltrans,
      langsungLunas ? 'LUNAS' : 'OPEN',
    ]);

    // 6. Opsi Pelunasan Langsung (Jika Dicentang)
    if (langsungLunas && grandTotal > 0 && idsupplier) {
      const kodepelunasan = await generateKodePelunasanHutang(conn, ctx.idtenant, idlokasi);
      const metodbayar    = req.body.metodbayar || 'TUNAI';
      const catatan       = `Pelunasan Langsung Beli ${kodebeli}`;

      // Insert Pelunasan Header
      const [pelResult] = await conn.query(
        'INSERT INTO pelunasanhutang (idtenant, idlokasi, idsupplier, kodepelunasan, tgltrans, total_amount, metodbayar, catatan, userentry) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [ctx.idtenant, idlokasi, idsupplier, kodepelunasan, tgltrans, grandTotal, metodbayar, catatan, ctx.iduser]
      );
      
      // Insert Pelunasan Detail
      await conn.query(
        'INSERT INTO pelunasanhutangdtl (idpelunasan, kodetrans, amount) VALUES (?, ?, ?)',
        [pelResult.insertId, kodebeli, grandTotal]
      );

    }

    await conn.commit();
    await logger.history('BELI_CREATE', { idtenant: ctx.idtenant, idlokasi, iduser: ctx.iduser, ref: kodebeli, detail: { grandtotal: grandTotal }, req });
    
    res.status(201).json({ message: 'Pembelian berhasil', kodebeli, idbeli, grandtotal: grandTotal });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message });
  } finally {
    conn.release();
  }
};


// GET /beli — Daftar transaksi pembelian dengan pencarian & filter
exports.getAll = async (req, res) => {
  let conn;
  try {
    conn = await getConnection();
    const ctx = getTenantContext();
    const { tglwal, tglakhir, idsupplier, idlokasi, search, available } = req.query;

    let sql = `
      SELECT b.*,
             CASE
               WHEN b.jenistransaksi = 'PEMBELIAN LUNAS' THEN 'BELI LUNAS'
               WHEN b.jenistransaksi = 'PEMBELIAN' THEN 'BELI'
               ELSE COALESCE(b.jenistransaksi, 'BELI')
             END AS jenistransaksi,
             DATE_FORMAT(b.tgltrans, '%Y-%m-%d') AS tgltrans,
             s.namasupplier, l.namalokasi, COALESCE(kh.status, 'BELUMLUNAS') as statuslunas
      FROM beli b
      LEFT JOIN supplier s ON b.idsupplier = s.idsupplier AND s.idtenant = b.idtenant
      LEFT JOIN lokasi l ON b.idlokasi = l.idlokasi AND l.idtenant = b.idtenant
      LEFT JOIN kartuhutang kh ON kh.kodetrans = b.kodebeli AND kh.status = 'LUNAS' AND kh.idtenant = b.idtenant
      WHERE b.idtenant = ?
    `;
    const params = [ctx.idtenant];

    // Filter Dinamis
    if (available === '1' || available == 1) {
      sql += ` AND NOT EXISTS (
        SELECT 1 FROM returbeli rb WHERE rb.idbeli = b.idbeli AND rb.status != 'VOID' AND rb.idtenant = b.idtenant
      )`;
    }
    if (idlokasi)   { sql += ' AND b.idlokasi = ?';   params.push(idlokasi); }
    if (tglwal)     { sql += ' AND b.tgltrans >= ?';  params.push(tglwal); }
    if (tglakhir)   { sql += ' AND b.tgltrans <= ?';  params.push(tglakhir); }
    if (idsupplier) { sql += ' AND b.idsupplier = ?'; params.push(idsupplier); }
    if (search)     { sql += ' AND b.kodebeli LIKE ?';params.push(`%${search}%`); }

    sql += ' ORDER BY b.tgltrans DESC, b.idbeli DESC LIMIT 200';

    const rows = await tenantQuery(sql, params);
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message });
  } finally {
    if (conn) conn.release();
  }
};


// GET /beli/:id — Detail satu transaksi pembelian beserta item
exports.getOne = async (req, res) => {
  let conn;
  try {
    conn = await getConnection();
    const ctx = getTenantContext();
    const { id } = req.params;

    const queryHeader = `
      SELECT b.*, DATE_FORMAT(b.tgltrans, '%Y-%m-%d') AS tgltrans,
             s.namasupplier, s.kodesupplier, s.alamat AS salamat, s.hp AS shp,
             l.namalokasi, l.kodelokasi, COALESCE(kh.status, 'BELUMLUNAS') as statuslunas
      FROM beli b
      LEFT JOIN supplier s ON b.idsupplier = s.idsupplier AND s.idtenant = b.idtenant
      LEFT JOIN lokasi l ON b.idlokasi = l.idlokasi AND l.idtenant = b.idtenant
      LEFT JOIN kartuhutang kh ON kh.kodetrans = b.kodebeli AND kh.status = 'LUNAS' AND kh.idtenant = b.idtenant
      WHERE b.idbeli = ? AND b.idtenant = ?
    `;
    const rows = await tenantQuery(queryHeader, [id, ctx.idtenant]);
    if (rows.length === 0) return res.status(404).json({ message: 'Pembelian tidak ditemukan' });

    const queryDetail = `
      SELECT bd.*, br.namabarang, br.kodebarang, br.satuanbesar, br.satuansedang, br.satuankecil, br.konversi1, br.konversi2
      FROM belidtl bd
      LEFT JOIN barang br ON bd.idbarang = br.idbarang AND br.idtenant = bd.idtenant
      WHERE bd.idbeli = ? AND bd.idtenant = ?
    `;
    const items = await tenantQuery(queryDetail, [id, ctx.idtenant]);

    // Format boolean semu untuk PPN
    const mappedItems = items.map(item => ({
      ...item,
      ppn_mode: parseFloat(item.ppn || 0) > 0 ? 'INCLUDE' : 'TIDAK_PAKAI',
    }));

    res.json({ ...rows[0], items: mappedItems });
  } catch (err) {
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message });
  } finally {
    if (conn) conn.release();
  }
};


// PUT /beli/:id — Edit transaksi pembelian (Clean Slate & Rebuild)
exports.update = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();

    const { id }         = req.params;
    const items          = req.body.items;
    const newIdlokasi    = req.body.idlokasi;
    const newIdsupplier  = req.body.idsupplier || null;
    const newTgltrans    = req.body.tgltrans;
    const langsungLunas  = req.body.langsung_lunas === true;
    const newIdgrn       = req.body.idgrn   || null;
    const newKodegrn     = req.body.kodegrn || null;

    if (!items || !items.length) {
      await conn.rollback();
      return res.status(400).json({ message: 'Items tidak boleh kosong' });
    }

    // 1. Validasi Beli Eksisting
    const [[beli]] = await conn.query('SELECT * FROM beli WHERE idbeli = ? AND idtenant = ?', [id, ctx.idtenant]);
    if (!beli) {
      await conn.rollback();
      return res.status(404).json({ message: 'Pembelian tidak ditemukan' });
    }
    if (beli.status === 'VOID') {
      await conn.rollback();
      return res.status(400).json({ message: 'Pembelian sudah dibatalkan' });
    }

    const kodebeli = beli.kodebeli;
    const idlokasi = (newIdlokasi && parseInt(newIdlokasi)) ? parseInt(newIdlokasi) : null;
    const tgltrans = newTgltrans || String(beli.tgltrans).slice(0, 10);
    const jenistransaksi = langsungLunas ? 'BELI LUNAS' : 'BELI';

    if (!idlokasi) {
      await conn.rollback();
      return res.status(400).json({ message: 'Lokasi wajib dipilih' });
    }
    if (!newIdsupplier) {
      await conn.rollback();
      return res.status(400).json({ message: 'Supplier wajib dipilih' });
    }

    // 2. CLEAN UP - Hapus Pelunasan, Hutang, Stok, dan Detail Lama
    // Hapus header dan detail pelunasan sekaligus agar tidak dobel/menumpuk
    const queryDeletePelunasan = `
      DELETE ph, phdtl
      FROM pelunasanhutang ph 
      JOIN pelunasanhutangdtl phdtl ON ph.idpelunasan = phdtl.idpelunasan
      WHERE phdtl.kodetrans = ?
    `;
    await conn.query(queryDeletePelunasan, [kodebeli]);
    
    // Hapus kartuhutang, stok, dan detail lama
    await conn.query('DELETE FROM kartuhutang WHERE kodetrans = ? AND idtenant = ?', [kodebeli, ctx.idtenant]);
    await conn.query("DELETE FROM kartustok WHERE idref = ? AND jenisref = 'beli' AND idtenant = ?", [id, ctx.idtenant]);
    await conn.query('DELETE FROM belidtl WHERE idbeli = ? AND idtenant = ?', [id, ctx.idtenant]);

    // 3. Update Header Beli (TERMASUK UPDATE LOKASI & SUPPLIER)
    await conn.query(
      'UPDATE beli SET tgltrans = ?, idlokasi = ?, idsupplier = ?, jenistransaksi = ?, idgrn = ?, kodegrn = ? WHERE idbeli = ? AND idtenant = ?',
      [tgltrans, idlokasi, newIdsupplier, jenistransaksi, newIdgrn, newKodegrn, id, ctx.idtenant]
    );

    // 4. Proses Rekonstruksi Detail Items & Stok
    const [[tenant]] = await conn.query('SELECT ppn FROM tenant WHERE idtenant = ?', [ctx.idtenant]);
    const ppnPercent = tenant ? parseFloat(tenant.ppn) : 11;
    let grandTotal   = 0;

    for (const item of items) {
      const harga   = parseFloat(item.harga);
      const jml     = parseInt(item.jml) || 1;
      const diskon  = parseFloat(item.diskon) || 0;
      
      const ppnMode = item.ppn_mode || 'INCLUDE';
      const ppnRp   = ppnMode === 'INCLUDE' ? (harga * jml * ppnPercent) / 100 : 0;
      const disknRp = (harga * jml * diskon) / 100;
      const subTtl  = (harga * jml) + ppnRp - disknRp;
      
      grandTotal += subTtl;

      // Insert Detail Baru
      await conn.query(
        'INSERT INTO belidtl (idbeli, idtenant, idbarang, jml, harga, ppn, diskon, subtotal, satuan) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, ctx.idtenant, item.idbarang, jml, harga, ppnRp, diskon, subTtl, item.satuan || null]
      );

      // Konversi Stok & Insert Kartu Stok Baru (menggunakan idlokasi baru jika berubah)
      const [[barangInfo]] = await conn.query('SELECT satuanbesar, satuansedang, satuankecil, konversi1, konversi2 FROM barang WHERE idbarang = ? AND idtenant = ?', [item.idbarang, ctx.idtenant]);
      const jmlStokKecil   = barangInfo ? toKecilJml(jml, item.satuan, barangInfo) : jml;

      await conn.query(
        'INSERT INTO kartustok (idtenant, idlokasi, kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idref, jenisref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [ctx.idtenant, idlokasi, kodebeli, item.idbarang, jmlStokKecil, 'M', tgltrans, `Pembelian ${kodebeli}`, id, 'beli']
      );

      // Update History Harga
      const [[latestHarga]] = await conn.query('SELECT hargabeli FROM hargabeli WHERE idbarang = ? AND idtenant = ? ORDER BY tgltrans DESC, idhargabeli DESC LIMIT 1', [item.idbarang, ctx.idtenant]);
      if (!latestHarga || parseFloat(latestHarga.hargabeli) !== harga) {
        await conn.query('INSERT INTO hargabeli (idtenant, idbarang, hargabeli, tgltrans) VALUES (?, ?, ?, ?)', [ctx.idtenant, item.idbarang, harga, tgltrans]);
      }
    }

    // 5. Update Ulang Grandtotal di Header
    const bayarFinal = langsungLunas ? grandTotal : 0;
    await conn.query('UPDATE beli SET grandtotal = ?, bayar = ? WHERE idbeli = ? AND idtenant = ?', [grandTotal, bayarFinal, id, ctx.idtenant]);

    // 6. Buat Ulang Kartu Hutang dengan supplier dan lokasi terbaru
    await conn.query(
      'INSERT INTO kartuhutang (idtenant, idlokasi, idsupplier, kodetrans, jenis, amount, terbayar, sisa, tgltrans, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        ctx.idtenant,
        idlokasi,
        newIdsupplier,
        kodebeli,
        'BELI',
        grandTotal,
        langsungLunas ? grandTotal : 0,
        langsungLunas ? 0 : grandTotal,
        tgltrans,
        langsungLunas ? 'LUNAS' : 'OPEN',
      ]
    );

    // 7. Jika Checkbox Lunas Dicentang, Buat Pelunasan
    if (langsungLunas && grandTotal > 0 && newIdsupplier) {
      const kodepelunasan = await generateKodePelunasanHutang(conn, ctx.idtenant, idlokasi);
      const metodbayar    = req.body.metodbayar || 'TUNAI';

      const [pelResult] = await conn.query(
        'INSERT INTO pelunasanhutang (idtenant, idlokasi, idsupplier, kodepelunasan, tgltrans, total_amount, metodbayar, catatan, userentry) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [ctx.idtenant, idlokasi, newIdsupplier, kodepelunasan, tgltrans, grandTotal, metodbayar, `Pelunasan Langsung Edit Beli ${kodebeli}`, ctx.iduser]
      );

      await conn.query(
        'INSERT INTO pelunasanhutangdtl (idpelunasan, kodetrans, amount) VALUES (?, ?, ?)',
        [pelResult.insertId, kodebeli, grandTotal]
      );

    }

    await conn.commit();
    await logger.history('BELI_UPDATE', { idtenant: ctx.idtenant, idlokasi, iduser: ctx.iduser, ref: kodebeli, req });
    
    res.json({ message: 'Pembelian berhasil diupdate', grandtotal: grandTotal });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message });
  } finally {
    conn.release();
  }
};


// GET /beli/:id/check-edit — Cek kelayakan edit (Jika Lunas dari pembayaran terpisah, block edit)
exports.checkEdit = async (req, res) => {
  try {
    const ctx  = getTenantContext();
    const { id } = req.params;

    // Cek apakah hutang pembelian ini sudah lunas di tabel kartuhutang
    const queryCheck = `
      SELECT kh.status, b.jenistransaksi
      FROM beli b
      LEFT JOIN kartuhutang kh ON kh.kodetrans = b.kodebeli AND kh.jenis = 'BELI' AND kh.idtenant = b.idtenant
      WHERE b.idbeli = ? AND b.idtenant = ?
    `;
    const hutangRows = await tenantQuery(queryCheck, [id, ctx.idtenant]);

    if (hutangRows && hutangRows.length > 0 && hutangRows[0].status === 'LUNAS' && !['BELI LUNAS', 'PEMBELIAN LUNAS'].includes(hutangRows[0].jenistransaksi)) {
      return res.status(400).json({ 
        canEdit: false, 
        reason: 'HUTANG_LUNAS', 
        message: 'Hapus pelunasan hutang terlebih dahulu sebelum melakukan edit/batal' 
      });
    }

    res.json({ canEdit: true });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};


// POST /beli/:id/cancel — Void Transaksi, Balikkan Stok, Hapus Hutang
exports.cancel = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const { id } = req.params;

    const [[beli]] = await conn.query('SELECT * FROM beli WHERE idbeli = ? AND idtenant = ?', [id, ctx.idtenant]);
    if (!beli) {
      await conn.rollback();
      return res.status(404).json({ message: 'Pembelian tidak ditemukan' });
    }
    if (beli.status === 'VOID') {
      await conn.rollback();
      return res.status(400).json({ message: 'Pembelian sudah dibatalkan' });
    }

    // Validasi: Tolak void jika hutang sudah LUNAS
    const [[hutangLunas]] = await conn.query("SELECT idkartuhutang FROM kartuhutang WHERE kodetrans = ? AND jenis = 'BELI' AND status = 'LUNAS' AND idtenant = ?", [beli.kodebeli, ctx.idtenant]);
    if (hutangLunas && !['BELI LUNAS', 'PEMBELIAN LUNAS'].includes(beli.jenistransaksi)) {
      await conn.rollback();
      return res.status(400).json({ message: 'Hapus pelunasan hutang terlebih dahulu sebelum membatalkan' });
    }

    if (['BELI LUNAS', 'PEMBELIAN LUNAS'].includes(beli.jenistransaksi)) {
      await conn.query(
        `DELETE ph, phdtl
         FROM pelunasanhutang ph
         JOIN pelunasanhutangdtl phdtl ON ph.idpelunasan = phdtl.idpelunasan
         WHERE phdtl.kodetrans = ? AND ph.idtenant = ?`,
        [beli.kodebeli, ctx.idtenant]
      );
    }

    // 1. Ubah status jadi VOID
    await conn.query("UPDATE beli SET status = 'VOID' WHERE idbeli = ? AND idtenant = ?", [id, ctx.idtenant]);

    // 2. Hapus tagihan (Kartu Hutang)
    await conn.query('DELETE FROM kartuhutang WHERE kodetrans = ? AND idtenant = ?', [beli.kodebeli, ctx.idtenant]);

    // 3. Balik Stok: Catat keluar (K) sesuai jumlah item yang tadinya masuk
    const [details] = await conn.query('SELECT * FROM belidtl WHERE idbeli = ? AND idtenant = ?', [id, ctx.idtenant]);
    const today     = new Date().toISOString().slice(0, 10);
    
    for (const dtl of details) {
      await conn.query(
        'INSERT INTO kartustok (idtenant, idlokasi, kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idref, jenisref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [ctx.idtenant, beli.idlokasi, `VOID-${beli.kodebeli}`, dtl.idbarang, dtl.jml, 'K', today, `Pembatalan ${beli.kodebeli}`, beli.idbeli, 'beli_void']
      );
    }

    await conn.commit();
    await logger.history('BELI_CANCEL', { idtenant: ctx.idtenant, idlokasi: beli.idlokasi, iduser: ctx.iduser, ref: beli.kodebeli, req });
    
    res.json({ message: 'Pembelian berhasil dibatalkan' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message });
  } finally {
    conn.release();
  }
};
