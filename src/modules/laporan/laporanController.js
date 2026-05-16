/**
 * Controller untuk berbagai laporan: penjualan (transaksi, per customer, per barang, per lokasi, rekap),
 * pembelian (transaksi, per supplier, per lokasi, per barang, rekap), stok, kartu stok, struk, dan faktur.
 * Mendukung output format JSON (default) dan HTML (render EJS).
 * Endpoint: GET /api/laporan/*
 */
const { tenantQuery, getTenantContext, pool } = require('../../config/db');
const logger = require('../../lib/logger');

// GET /api/laporan/jenistransaksi-kartustok
exports.getJenisTransaksiKartuStok = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const sql = `SELECT DISTINCT jenistransaksi FROM kartustok WHERE idtenant = ? AND idlokasi = ? AND jenistransaksi IS NOT NULL AND jenistransaksi != '' ORDER BY jenistransaksi`;
    const rows = await tenantQuery(sql, [ctx.idtenant, ctx.idlokasi]);
    res.json(rows.map(r => r.jenistransaksi));
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};
exports.getJenisRef = exports.getJenisTransaksiKartuStok;


// Helper: membuat klausa LIKE multi-value untuk filter (misal "A,B,C" -> kodelokasi LIKE '%A%' OR kodelokasi LIKE '%B%')
function multiLike(column, raw) {
  const vals = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (!vals.length) return { clause: '', params: [] };
  const likes = vals.map(() => `${column} LIKE ?`);
  return { clause: `(${likes.join(' OR ')})`, params: vals.map(v => `%${v}%`) };
}

// Helper: membuat klausa IN multi-ID (misal "1,2,3" -> column IN (1,2,3))
function multiIdIn(column, raw) {
  const vals = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (!vals.length) return { clause: '', params: [] };
  if (vals.length === 1) return { clause: `${column} = ?`, params: [vals[0]] };
  const placeholders = vals.map(() => '?').join(',');
  return { clause: `${column} IN (${placeholders})`, params: vals };
}



/**
 * GET /api/laporan/sales-transaksi
 * Controller untuk menghasilkan laporan detail transaksi penjualan (per item).
 * Mendukung format output JSON untuk API dan HTML untuk kebutuhan cetak (Print).
 */
exports.salesTransaksi = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { 
      tglwal, tglakhir, kodelokasi, namalokasi, 
      kodecustomer, namacustomer, statusLunas 
    } = req.query;
    
    // Default format adalah JSON jika tidak secara eksplisit di-request 'html'
    const format = req.query.format || 'json';

    // 1. PERSIAPAN BASE QUERY
    // Mengambil data header penjualan, detail item, serta informasi pelunasan piutang jika ada.
    let sql = `
    SELECT 
      j.kodejual, j.tgltrans, l.namalokasi,
      c.kodecustomer, c.namacustomer,
      b.kodebarang, b.namabarang,
      jdtl.idjualdtl, jdtl.jml, jdtl.satuan, jdtl.harga, jdtl.ppn, jdtl.subtotal, j.grandtotal, j.jenistransaksi AS jenis,
      pp.tgltrans AS tglpelunasan, kp.terbayar as amount, kp.sisa
    FROM jual j
      JOIN jualdtl jdtl ON j.idjual = jdtl.idjual AND jdtl.idtenant = j.idtenant
      JOIN lokasi l ON l.idlokasi = j.idlokasi AND l.idtenant = j.idtenant
      JOIN customer c ON c.idcustomer = j.idcustomer AND c.idtenant = j.idtenant
      JOIN barang b ON b.idbarang = jdtl.idbarang AND b.idtenant = j.idtenant
      LEFT JOIN kartupiutang kp ON kp.kodetrans = j.kodejual AND kp.jenis = 'JUAL'
      LEFT JOIN pelunasanpiutangdtl ppdtl ON ppdtl.kodetrans = kp.kodetrans
      LEFT JOIN pelunasanpiutang pp ON pp.idpelunasan = ppdtl.idpelunasan
    WHERE j.status IN ('APPROVED', 'CONFIRMED')`;
    
    const params = [];

    // 2. TERAPKAN FILTER PENCARIAN (DYNAMIC QUERY)
    if (tglwal) { 
      sql += ' AND j.tgltrans >= ?'; 
      params.push(tglwal); 
    }
    if (tglakhir) { 
      sql += ' AND j.tgltrans <= ?'; 
      params.push(tglakhir); 
    }

    if (kodelokasi) {
      const { clause, params: p } = multiLike('l.kodelokasi', kodelokasi);
      if (clause) { sql += ' AND ' + clause; params.push(...p); }
    }
    if (namalokasi) {
      const { clause, params: p } = multiLike('l.namalokasi', namalokasi);
      if (clause) { sql += ' AND ' + clause; params.push(...p); }
    }
    if (kodecustomer) {
      const { clause, params: p } = multiLike('c.kodecustomer', kodecustomer);
      if (clause) { sql += ' AND ' + clause; params.push(...p); }
    }
    if (namacustomer) {
      const { clause, params: p } = multiLike('c.namacustomer', namacustomer);
      if (clause) { sql += ' AND ' + clause; params.push(...p); }
    }

    if (statusLunas === 'lunas') {
      sql += ' AND kp.sisa <= 0';
    } else if (statusLunas === 'belum') {
      sql += ' AND (kp.sisa > 0 OR kp.sisa IS NULL)';
    }

    // 3. GROUPING & SORTING
    sql += ' GROUP BY jdtl.idjualdtl ORDER BY j.tgltrans DESC, j.kodejual DESC, jdtl.idjualdtl ASC';

    // 4. EKSEKUSI QUERY
    const rows = await tenantQuery(sql, params);

    // 5. FORMATTING: KELOMPOKKAN ITEM KE DALAM TRANSAKSI MASING-MASING
    const transactions = [];
    let currentKode = null;
    let currentGroup = null;
    const seenKodejual = new Set();

    for (const row of rows) {
      // Jika kodejual beda dengan sebelumnya, buat grup parent transaksi baru
      if (row.kodejual !== currentKode) {
        currentKode = row.kodejual;
        const sisaVal = parseFloat(row.sisa) || 0;
        
        currentGroup = {
          kodejual    : row.kodejual,
          tgltrans    : row.tgltrans,
          namalokasi  : row.namalokasi,
          kodecustomer: row.kodecustomer,
          namacustomer: row.namacustomer,
          grandtotal  : parseFloat(row.grandtotal) || 0,
          tglpelunasan: row.tglpelunasan,
          amount      : parseFloat(row.amount) || 0,
          sisa        : sisaVal,
          statusLunas : sisaVal <= 0 ? 'LUNAS' : 'Belum Lunas', // <-- [FIX]: Safety check untuk status lunas
          jenis       : row.jenis,
          items       : [] // Array untuk menampung baris detail barang
        };
        
        transactions.push(currentGroup);
        seenKodejual.add(row.kodejual);
      }
      
      // Masukkan baris item/barang ke dalam parent transaksi saat ini
      currentGroup.items.push({
        kodebarang: row.kodebarang,
        namabarang: row.namabarang,
        jml       : row.jml,
        satuan    : row.satuan,
        harga     : parseFloat(row.harga) || 0,
        ppn       : parseFloat(row.ppn) || 0,
        subtotal  : parseFloat(row.subtotal) || 0
      });
    }

    // Kalkulasi rekapitulasi data
    const totalTransaksi = seenKodejual.size;
    const totalPenjualan = transactions.reduce((sum, t) => sum + t.grandtotal, 0);

    // 6. TANGANI RESPONSE BERDASARKAN FORMAT YANG DIMINTA
    if (format === 'html') {
      // Query tambahan untuk header cetakan (informasi toko/tenant)
      const sqlTenant = 'SELECT * FROM tenant WHERE idtenant = ?';
      const [[tenant]] = await pool.query(sqlTenant, [ctx.idtenant]);
      
      const sqlLokasi = 'SELECT * FROM lokasi WHERE idlokasi = ? AND idtenant = ?';
      const [[lokasi]] = await pool.query(sqlLokasi, [ctx.idlokasi, ctx.idtenant]);
      
      return res.render('laporan_sales_transaksi', {
        transactions,
        totalTransaksi,
        totalPenjualan,
        tglwal      : tglwal || '-',
        tglakhir    : tglakhir || '-',
        statusLunas : statusLunas || '',
        kodelokasi  : kodelokasi || '',
        namalokasi  : namalokasi || '',
        kodecustomer: kodecustomer || '',
        namacustomer: namacustomer || '',
        namatoko    : tenant?.namatenant || 'Grfyn POS',
        alamat      : lokasi?.alamat || '',
        hp          : lokasi?.hp || '',
        logo        : tenant?.logo || '',
        tglcetak    : new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })
      });
    }

    // Response default (JSON) untuk dikonsumsi frontend (React/Vue/dsb)
    return res.json({ transactions, totalTransaksi, totalPenjualan });

  } catch (err) {
    // Logging error yang informatif di sisi server
    logger.error(`[API Laporan Sales Transaksi] Error: ${err.message}`, { req });
    return res.status(500).json({ 
      message: "Terjadi kesalahan server saat memuat laporan.",
      error: err.message // Opsional: Hapus line ini di production agar aman
    });
  }
};
// GET /api/laporan/sales-per-customer — Laporan penjualan dikelompokkan per customer
// GET /api/laporan/sales-per-customer — Laporan penjualan detail per customer
exports.salesPerCustomer = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { 
      tglwal, tglakhir, kodelokasi, namalokasi, 
      kodecustomer, namacustomer, statusLunas 
    } = req.query;
    
    const format = req.query.format || 'json';

    // 1. BASE QUERY (Ambil detail barang seperti sales transaksi)
    let sql = `
    SELECT 
      j.kodejual, j.tgltrans, l.namalokasi,
      c.kodecustomer, c.namacustomer,
      b.kodebarang, b.namabarang,
      jdtl.jml, jdtl.satuan, jdtl.harga, jdtl.ppn, jdtl.subtotal, j.grandtotal, j.jenistransaksi AS jenis,
      kp.terbayar as amount, kp.sisa
    FROM jual j
      JOIN jualdtl jdtl ON j.idjual = jdtl.idjual AND jdtl.idtenant = j.idtenant
      JOIN lokasi l ON l.idlokasi = j.idlokasi AND l.idtenant = j.idtenant
      JOIN customer c ON c.idcustomer = j.idcustomer AND c.idtenant = j.idtenant
      JOIN barang b ON b.idbarang = jdtl.idbarang AND b.idtenant = j.idtenant
      LEFT JOIN kartupiutang kp ON kp.kodetrans = j.kodejual AND kp.jenis = 'JUAL'
    WHERE j.idtenant = ? AND j.status IN ('APPROVED', 'CONFIRMED')`;

    const params = [ctx.idtenant];

    // 2. FILTERING
    if (tglwal) { sql += ' AND j.tgltrans >= ?'; params.push(tglwal); }
    if (tglakhir) { sql += ' AND j.tgltrans <= ?'; params.push(tglakhir); }

    if (kodelokasi) {
      const { clause, params: p } = multiLike('l.kodelokasi', kodelokasi);
      if (clause) { sql += ' AND ' + clause; params.push(...p); }
    }
    if (namalokasi) {
      const { clause, params: p } = multiLike('l.namalokasi', namalokasi);
      if (clause) { sql += ' AND ' + clause; params.push(...p); }
    }
    if (kodecustomer) {
      const { clause, params: p } = multiLike('c.kodecustomer', kodecustomer);
      if (clause) { sql += ' AND ' + clause; params.push(...p); }
    }
    if (namacustomer) {
      const { clause, params: p } = multiLike('c.namacustomer', namacustomer);
      if (clause) { sql += ' AND ' + clause; params.push(...p); }
    }

    if (statusLunas === 'lunas') {
      sql += ' AND (kp.sisa <= 0 OR kp.sisa IS NULL)';
    } else if (statusLunas === 'belum') {
      sql += ' AND kp.sisa > 0';
    }

    // 3. SORTING (PENTING: Harus urut customer dulu baru kodejual)
    sql += ' ORDER BY c.namacustomer ASC, j.tgltrans DESC, j.kodejual DESC, jdtl.idjualdtl ASC';

    const rows = await tenantQuery(sql, params);

    // 4. FORMATTING: Grouping Item ke dalam Transaksi
    const transactions = [];
    let currentKodejual = null;
    let currentGroupTrx = null;

    for (const row of rows) {
      if (row.kodejual !== currentKodejual) {
        currentKodejual = row.kodejual;
        const sisaVal = parseFloat(row.sisa) || 0;

        currentGroupTrx = {
          kodejual    : row.kodejual,
          tgltrans    : row.tgltrans,
          namalokasi  : row.namalokasi,
          kodecustomer: row.kodecustomer,
          namacustomer: row.namacustomer,
          grandtotal  : parseFloat(row.grandtotal) || 0,
          amount      : parseFloat(row.amount) || 0,
          sisa        : sisaVal,
          statusLunas : sisaVal <= 0 ? 'LUNAS' : 'BELUM LUNAS',
          jenis       : row.jenis,
          items       : []
        };
        transactions.push(currentGroupTrx);
      }

      currentGroupTrx.items.push({
        kodebarang: row.kodebarang,
        namabarang: row.namabarang,
        jml       : row.jml,
        satuan    : row.satuan,
        harga     : parseFloat(row.harga) || 0,
        ppn       : parseFloat(row.ppn) || 0,
        subtotal  : parseFloat(row.subtotal) || 0
      });
    }

    // Hitung Grand Total Penjualan (Berdasarkan unique transaksi)
    const totalPenjualan = transactions.reduce((sum, t) => sum + t.grandtotal, 0);

    // 5. RESPONSE
    if (format === 'html') {
      const [[tenant]] = await pool.query('SELECT * FROM tenant WHERE idtenant = ?', [ctx.idtenant]);
      const [[lokasi]] = await pool.query('SELECT * FROM lokasi WHERE idlokasi = ? AND idtenant = ?', [ctx.idlokasi, ctx.idtenant]);

      return res.render('laporan_sales_per_customer', {
        transactions, // Data yang sudah di-group per transaksi
        totalPenjualan,
        tglwal      : tglwal || '-',
        tglakhir    : tglakhir || '-',
        statusLunas : statusLunas || '',
        kodelokasi  : kodelokasi || '',
        namalokasi  : namalokasi || '',
        kodecustomer: kodecustomer || '',
        namacustomer: namacustomer || '',
        namatoko    : tenant?.namatenant || 'Grfyn POS',
        alamat      : lokasi?.alamat || '',
        hp          : lokasi?.hp || '',
        logo        : tenant?.logo || '',
        tglcetak    : new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })
      });
    }

    res.json({ transactions, totalPenjualan });

  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /api/laporan/sales-per-barang — Laporan penjualan dikelompokkan per barang
exports.salesPerBarang = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tglwal, tglakhir, kodelokasi, namalokasi, kodecustomer, namacustomer, statusLunas } = req.query;
    const format = req.query.format || 'json';

    if (format === 'html') {
      // Query detail-level per item penjualan untuk HTML grouping
      let sqlDetail = `
      SELECT b.idbarang, b.kodebarang, b.namabarang, b.satuankecil as satuan,
        j.kodejual, j.tgltrans, j.jenistransaksi AS jenis, c.namacustomer, l.namalokasi,
        jd.jml, jd.harga, jd.subtotal,
        kp.sisa
      FROM barang b
        JOIN jualdtl jd ON b.idbarang = jd.idbarang AND b.idtenant = jd.idtenant
        JOIN jual j ON jd.idjual = j.idjual AND j.idtenant = jd.idtenant AND j.status IN ('APPROVED', 'CONFIRMED')
        LEFT JOIN customer c ON j.idcustomer = c.idcustomer AND c.idtenant = j.idtenant
        LEFT JOIN lokasi l ON j.idlokasi = l.idlokasi AND l.idtenant = j.idtenant
        LEFT JOIN kartupiutang kp ON kp.kodetrans = j.kodejual AND kp.jenis = 'JUAL'
      WHERE b.idtenant = ?`;
      const detailParams = [ctx.idtenant];

      if (tglwal) { sqlDetail += ' AND j.tgltrans >= ?'; detailParams.push(tglwal); }
      if (tglakhir) { sqlDetail += ' AND j.tgltrans <= ?'; detailParams.push(tglakhir); }
      if (kodelokasi) {
        sqlDetail += ` AND j.idlokasi IN (SELECT idlokasi FROM lokasi WHERE idtenant = b.idtenant AND (`;
        const vals = kodelokasi.split(',').map(s => s.trim()).filter(Boolean);
        sqlDetail += vals.map(() => 'kodelokasi LIKE ?').join(' OR ');
        sqlDetail += '))';
        vals.forEach(v => detailParams.push(`%${v}%`));
      }
      if (namalokasi) {
        sqlDetail += ` AND j.idlokasi IN (SELECT idlokasi FROM lokasi WHERE idtenant = b.idtenant AND (`;
        const vals = namalokasi.split(',').map(s => s.trim()).filter(Boolean);
        sqlDetail += vals.map(() => 'namalokasi LIKE ?').join(' OR ');
        sqlDetail += '))';
        vals.forEach(v => detailParams.push(`%${v}%`));
      }
      if (kodecustomer) {
        sqlDetail += ` AND j.idcustomer IN (SELECT idcustomer FROM customer WHERE idtenant = b.idtenant AND (`;
        const vals = kodecustomer.split(',').map(s => s.trim()).filter(Boolean);
        sqlDetail += vals.map(() => 'kodecustomer LIKE ?').join(' OR ');
        sqlDetail += '))';
        vals.forEach(v => detailParams.push(`%${v}%`));
      }
      if (namacustomer) {
        sqlDetail += ` AND j.idcustomer IN (SELECT idcustomer FROM customer WHERE idtenant = b.idtenant AND (`;
        const vals = namacustomer.split(',').map(s => s.trim()).filter(Boolean);
        sqlDetail += vals.map(() => 'namacustomer LIKE ?').join(' OR ');
        sqlDetail += '))';
        vals.forEach(v => detailParams.push(`%${v}%`));
      }
      if (statusLunas === 'lunas') {
        sqlDetail += ' AND kp.sisa <= 0';
      } else if (statusLunas === 'belum') {
        sqlDetail += ' AND (kp.sisa > 0 OR kp.sisa IS NULL)';
      }
      sqlDetail += ' ORDER BY b.namabarang ASC, j.tgltrans DESC';

      const detailRows = await tenantQuery(sqlDetail, detailParams);
      const grandTotal = detailRows.reduce((sum, r) => sum + parseFloat(r.subtotal || 0), 0);

      let sqlTenant3 = 'SELECT * FROM tenant WHERE idtenant = ?';
      const [[tenant]] = await pool.query(sqlTenant3, [ctx.idtenant]);
      return res.render('laporan_sales_per_barang', {
        data        : detailRows,                        grandTotal,
        tglwal      : tglwal || '-',                     tglakhir    : tglakhir || '-',
        statusLunas : statusLunas || '',
        kodelokasi  : kodelokasi || '',                  namalokasi  : namalokasi || '',
        kodecustomer: kodecustomer || '',                namacustomer: namacustomer || '',
        namatoko    : tenant?.namatenant || 'Grfyn POS',
        alamat      : '',                                hp          : '',                 logo: tenant?.logo || '',
        tglcetak    : new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })
      });
    }

    // JSON: tetap gunakan query agregasi
    let sql = `
    SELECT b.idbarang, b.kodebarang, b.namabarang, b.satuankecil as satuan,
      COALESCE(SUM(jd.jml), 0) as total_qty,
      COALESCE(SUM(jd.subtotal), 0) as total_nilai
    FROM barang b
      LEFT JOIN jualdtl jd ON b.idbarang = jd.idbarang AND b.idtenant = jd.idtenant
      LEFT JOIN jual j ON jd.idjual = j.idjual AND j.idtenant = jd.idtenant AND j.status = 'AKTIF'
      LEFT JOIN kartupiutang kp ON kp.kodetrans = j.kodejual AND kp.jenis = 'JUAL'
    WHERE b.idtenant = ?`;
    const params = [ctx.idtenant];

    if (tglwal) { sql += ' AND j.tgltrans >= ?'; params.push(tglwal); }
    if (tglakhir) { sql += ' AND j.tgltrans <= ?'; params.push(tglakhir); }
    if (kodelokasi) {
      sql += ` AND j.idlokasi IN (SELECT idlokasi FROM lokasi WHERE idtenant = b.idtenant AND (`;
      const vals = kodelokasi.split(',').map(s => s.trim()).filter(Boolean);
      sql += vals.map(() => 'kodelokasi LIKE ?').join(' OR ');
      sql += '))';
      vals.forEach(v => params.push(`%${v}%`));
    }
    if (namalokasi) {
      sql += ` AND j.idlokasi IN (SELECT idlokasi FROM lokasi WHERE idtenant = b.idtenant AND (`;
      const vals = namalokasi.split(',').map(s => s.trim()).filter(Boolean);
      sql += vals.map(() => 'namalokasi LIKE ?').join(' OR ');
      sql += '))';
      vals.forEach(v => params.push(`%${v}%`));
    }
    if (kodecustomer) {
      sql += ` AND j.idcustomer IN (SELECT idcustomer FROM customer WHERE idtenant = b.idtenant AND (`;
      const vals = kodecustomer.split(',').map(s => s.trim()).filter(Boolean);
      sql += vals.map(() => 'kodecustomer LIKE ?').join(' OR ');
      sql += '))';
      vals.forEach(v => params.push(`%${v}%`));
    }
    if (namacustomer) {
      sql += ` AND j.idcustomer IN (SELECT idcustomer FROM customer WHERE idtenant = b.idtenant AND (`;
      const vals = namacustomer.split(',').map(s => s.trim()).filter(Boolean);
      sql += vals.map(() => 'namacustomer LIKE ?').join(' OR ');
      sql += '))';
      vals.forEach(v => params.push(`%${v}%`));
    }
    if (statusLunas === 'lunas') {
      sql += ' AND kp.sisa <= 0';
    } else if (statusLunas === 'belum') {
      sql += ' AND (kp.sisa > 0 OR kp.sisa IS NULL)';
    }
    sql += ' GROUP BY b.idbarang, b.kodebarang, b.namabarang, b.satuankecil ORDER BY total_nilai DESC';

    const rows = await tenantQuery(sql, params);
    const grandTotal = rows.reduce((sum, r) => sum + parseFloat(r.total_nilai || 0), 0);
    res.json({ data: rows, grandTotal });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /api/laporan/pembelian — Laporan daftar transaksi pembelian
exports.pembelian = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tglwal, tglakhir, idsupplier } = req.query;
    const format = req.query.format || 'json';

    let sql = `SELECT b.*, s.namasupplier FROM beli b
      LEFT JOIN supplier s ON b.idsupplier = s.idsupplier AND s.idtenant = b.idtenant
      WHERE 1=1 and b.status IN ('APPROVED', 'CONFIRMED')`;
    const params = [];
    if (ctx.idlokasi) { sql += ' AND b.idlokasi = ?'; params.push(ctx.idlokasi); }
    if (tglwal) { sql += ' AND b.tgltrans >= ?'; params.push(tglwal); }
    if (tglakhir) { sql += ' AND b.tgltrans <= ?'; params.push(tglakhir); }
    if (idsupplier) {
      const { clause, params: p } = multiIdIn('b.idsupplier', idsupplier);
      if (clause) { sql += ' AND ' + clause; params.push(...p); }
    }
    sql += ' ORDER BY b.tgltrans DESC, b.idbeli DESC';

    const rows = await tenantQuery(sql, params);
    const totalPembelian = rows.reduce((sum, r) => sum + parseFloat(r.grandtotal || 0), 0);

    if (format === 'html') {
      // Ambil detail item per transaksi pembelian
      let sqlDetail = `
        SELECT b.idbeli, b.kodebeli, b.tgltrans, b.grandtotal, b.bayar, b.status,
          s.kodesupplier, s.namasupplier,
          l.namalokasi,
          bg.kodebarang, bg.namabarang, bg.satuankecil as satuan,
          bd.idbeli as bd_idbeli, bd.jml, bd.harga, bd.ppn, bd.subtotal
        FROM beli b
          LEFT JOIN supplier s ON b.idsupplier = s.idsupplier AND s.idtenant = b.idtenant
          LEFT JOIN lokasi l ON b.idlokasi = l.idlokasi AND l.idtenant = b.idtenant
          LEFT JOIN belidtl bd ON b.idbeli = bd.idbeli AND bd.idtenant = b.idtenant
          LEFT JOIN barang bg ON bd.idbarang = bg.idbarang AND bg.idtenant = b.idtenant
        WHERE b.status IN ('APPROVED', 'CONFIRMED')`;
      const detailParams = [];
      if (ctx.idlokasi) { sqlDetail += ' AND b.idlokasi = ?'; detailParams.push(ctx.idlokasi); }
      if (tglwal) { sqlDetail += ' AND b.tgltrans >= ?'; detailParams.push(tglwal); }
      if (tglakhir) { sqlDetail += ' AND b.tgltrans <= ?'; detailParams.push(tglakhir); }
      if (idsupplier) {
        const { clause, params: p } = multiIdIn('b.idsupplier', idsupplier);
        if (clause) { sqlDetail += ' AND ' + clause; detailParams.push(...p); }
      }
      sqlDetail += ' ORDER BY b.tgltrans DESC, b.idbeli DESC, bd.idbelidtl ASC';

      const detailRows = await tenantQuery(sqlDetail, detailParams);

      // Kelompokkan item ke dalam transaksi masing-masing
      const transactions = [];
      let currentKode = null;
      let currentGroup = null;
      for (const row of detailRows) {
        if (row.kodebeli !== currentKode) {
          currentKode = row.kodebeli;
          const sisa = parseFloat(row.grandtotal || 0) - parseFloat(row.bayar || 0);
          currentGroup = {
            kodebeli    : row.kodebeli,
            tgltrans    : row.tgltrans,
            namalokasi  : row.namalokasi,
            kodesupplier: row.kodesupplier,
            namasupplier: row.namasupplier,
            grandtotal  : parseFloat(row.grandtotal) || 0,
            bayar       : parseFloat(row.bayar) || 0,
            sisa        : sisa,
            statusLunas : sisa <= 0 ? 'LUNAS' : 'Belum Lunas',
            items       : []
          };
          transactions.push(currentGroup);
        }
        if (row.kodebarang) {
          currentGroup.items.push({
            kodebarang: row.kodebarang,
            namabarang: row.namabarang,
            jml       : row.jml,
            satuan    : row.satuan,
            harga     : parseFloat(row.harga) || 0,
            ppn       : parseFloat(row.ppn) || 0,
            subtotal  : parseFloat(row.subtotal) || 0
          });
        }
      }

      const totalTransaksi = transactions.length;
      let sqlTenant4 = 'SELECT * FROM tenant WHERE idtenant = ?';
      const [[tenant]] = await pool.query(sqlTenant4, [ctx.idtenant]);
      const [[lokasi]] = await pool.query('SELECT * FROM lokasi WHERE idlokasi = ? AND idtenant = ?', [ctx.idlokasi, ctx.idtenant]);
      return res.render('laporan_pembelian', {
        transactions, totalTransaksi, totalPembelian,
        tglwal  : tglwal || '-',   tglakhir: tglakhir || '-',
        namatoko: tenant?.namatenant || 'Grfyn POS',
        alamat  : lokasi?.alamat || '', hp: lokasi?.hp || '', logo: tenant?.logo || '',
        tglcetak: new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })
      });
    }

    res.json({ data: rows, totalPembelian });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /api/laporan/sales-per-lokasi — Laporan penjualan dikelompokkan per lokasi/cabang
exports.salesPerLokasi = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tglwal, tglakhir, kodelokasi, namalokasi, kodecustomer, namacustomer, statusLunas } = req.query;
    const format = req.query.format || 'json';

    if (format === 'html') {
      // Query detail-level per item penjualan untuk HTML grouping
      let sqlDetail = `
      SELECT l.idlokasi, l.kodelokasi, l.namalokasi,
        j.kodejual, j.tgltrans, c.namacustomer, j.grandtotal, j.jenistransaksi AS jenis, kp.sisa,
        b.kodebarang, b.namabarang, jd.jml, jd.satuan, jd.harga, jd.ppn, jd.subtotal
      FROM lokasi l
        JOIN jual j ON l.idlokasi = j.idlokasi AND j.idtenant = l.idtenant AND j.status IN ('APPROVED', 'CONFIRMED')
        JOIN jualdtl jd ON j.idjual = jd.idjual AND jd.idtenant = j.idtenant
        JOIN barang b ON b.idbarang = jd.idbarang AND b.idtenant = j.idtenant
        LEFT JOIN customer c ON j.idcustomer = c.idcustomer AND c.idtenant = j.idtenant
        LEFT JOIN kartupiutang kp ON kp.kodetrans = j.kodejual AND kp.jenis = 'JUAL'
      WHERE l.idtenant = ?`;
      const detailParams = [ctx.idtenant];

      if (tglwal) { sqlDetail += ' AND j.tgltrans >= ?'; detailParams.push(tglwal); }
      if (tglakhir) { sqlDetail += ' AND j.tgltrans <= ?'; detailParams.push(tglakhir); }
      if (kodelokasi) {
        const { clause, params: p } = multiLike('l.kodelokasi', kodelokasi);
        if (clause) { sqlDetail += ' AND ' + clause; detailParams.push(...p); }
      }
      if (namalokasi) {
        const { clause, params: p } = multiLike('l.namalokasi', namalokasi);
        if (clause) { sqlDetail += ' AND ' + clause; detailParams.push(...p); }
      }
      if (kodecustomer) {
        sqlDetail += ` AND j.idcustomer IN (SELECT idcustomer FROM customer WHERE idtenant = l.idtenant AND (`;
        const vals = kodecustomer.split(',').map(s => s.trim()).filter(Boolean);
        sqlDetail += vals.map(() => 'kodecustomer LIKE ?').join(' OR ');
        sqlDetail += '))';
        vals.forEach(v => detailParams.push(`%${v}%`));
      }
      if (namacustomer) {
        sqlDetail += ` AND j.idcustomer IN (SELECT idcustomer FROM customer WHERE idtenant = l.idtenant AND (`;
        const vals = namacustomer.split(',').map(s => s.trim()).filter(Boolean);
        sqlDetail += vals.map(() => 'namacustomer LIKE ?').join(' OR ');
        sqlDetail += '))';
        vals.forEach(v => detailParams.push(`%${v}%`));
      }
      if (statusLunas === 'lunas') {
        sqlDetail += ' AND kp.sisa <= 0';
      } else if (statusLunas === 'belum') {
        sqlDetail += ' AND (kp.sisa > 0 OR kp.sisa IS NULL)';
      }
      sqlDetail += ' ORDER BY l.namalokasi ASC, j.tgltrans DESC, j.kodejual DESC, jd.idjualdtl ASC';

      const detailRows = await tenantQuery(sqlDetail, detailParams);

      // Grouping item ke dalam transaksi
      const transactions = [];
      let currentKode = null;
      let currentGroup = null;
      for (const row of detailRows) {
        if (row.kodejual !== currentKode) {
          currentKode = row.kodejual;
          const sisaVal = parseFloat(row.sisa) || 0;
          currentGroup = {
            kodejual    : row.kodejual,
            tgltrans    : row.tgltrans,
            namalokasi  : row.namalokasi,
            kodelokasi  : row.kodelokasi,
            namacustomer: row.namacustomer,
            grandtotal  : parseFloat(row.grandtotal) || 0,
            jenis       : row.jenis,
            sisa        : sisaVal,
            statusLunas : sisaVal <= 0 ? 'LUNAS' : 'Belum Lunas',
            items       : []
          };
          transactions.push(currentGroup);
        }
        currentGroup.items.push({
          kodebarang: row.kodebarang,
          namabarang: row.namabarang,
          jml       : row.jml,
          satuan    : row.satuan,
          harga     : parseFloat(row.harga) || 0,
          ppn       : parseFloat(row.ppn) || 0,
          subtotal  : parseFloat(row.subtotal) || 0
        });
      }

      const grandTotal = transactions.reduce((sum, t) => sum + t.grandtotal, 0);

      let sqlTenant5 = 'SELECT * FROM tenant WHERE idtenant = ?';
      const [[tenant]] = await pool.query(sqlTenant5, [ctx.idtenant]);
      return res.render('laporan_sales_per_lokasi', {
        transactions,
        grandTotal,
        tglwal      : tglwal || '-',                     tglakhir    : tglakhir || '-',
        statusLunas : statusLunas || '',
        kodelokasi  : kodelokasi || '',                  namalokasi  : namalokasi || '',
        kodecustomer: kodecustomer || '',                namacustomer: namacustomer || '',
        namatoko    : tenant?.namatenant || 'Grfyn POS',
        alamat      : '',                                hp          : '',                 logo: tenant?.logo || '',
        tglcetak    : new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })
      });
    }

    // JSON: tetap gunakan query agregasi
    let sql = `
    SELECT l.idlokasi, l.kodelokasi, l.namalokasi,
      COUNT(DISTINCT j.kodejual) as total_transaksi,
      COALESCE(SUM(j.grandtotal), 0) as total_penjualan,
      COALESCE(SUM(CASE WHEN kp.sisa <= 0 OR kp.sisa IS NULL THEN j.grandtotal ELSE 0 END), 0) as total_lunas,
      COALESCE(SUM(CASE WHEN kp.sisa > 0 THEN kp.sisa ELSE 0 END), 0) as total_piutang
    FROM lokasi l
      LEFT JOIN jual j ON l.idlokasi = j.idlokasi AND j.idtenant = l.idtenant AND j.status IN ('APPROVED', 'CONFIRMED')
      LEFT JOIN kartupiutang kp ON kp.kodetrans = j.kodejual AND kp.jenis = 'JUAL'
    WHERE l.idtenant = ?`;
    const params = [ctx.idtenant];

    if (tglwal) { sql += ' AND j.tgltrans >= ?'; params.push(tglwal); }
    if (tglakhir) { sql += ' AND j.tgltrans <= ?'; params.push(tglakhir); }
    if (kodelokasi) {
      const { clause, params: p } = multiLike('l.kodelokasi', kodelokasi);
      if (clause) { sql += ' AND ' + clause; params.push(...p); }
    }
    if (namalokasi) {
      const { clause, params: p } = multiLike('l.namalokasi', namalokasi);
      if (clause) { sql += ' AND ' + clause; params.push(...p); }
    }
    if (kodecustomer) {
      sql += ` AND j.idcustomer IN (SELECT idcustomer FROM customer WHERE idtenant = l.idtenant AND (`;
      const vals = kodecustomer.split(',').map(s => s.trim()).filter(Boolean);
      sql += vals.map(() => 'kodecustomer LIKE ?').join(' OR ');
      sql += '))';
      vals.forEach(v => params.push(`%${v}%`));
    }
    if (namacustomer) {
      sql += ` AND j.idcustomer IN (SELECT idcustomer FROM customer WHERE idtenant = l.idtenant AND (`;
      const vals = namacustomer.split(',').map(s => s.trim()).filter(Boolean);
      sql += vals.map(() => 'namacustomer LIKE ?').join(' OR ');
      sql += '))';
      vals.forEach(v => params.push(`%${v}%`));
    }
    if (statusLunas === 'lunas') {
      sql += ' AND kp.sisa <= 0';
    } else if (statusLunas === 'belum') {
      sql += ' AND (kp.sisa > 0 OR kp.sisa IS NULL)';
    }
    sql += ' GROUP BY l.idlokasi, l.kodelokasi, l.namalokasi ORDER BY total_penjualan DESC';

    const rows = await tenantQuery(sql, params);
    const grandTotal = rows.reduce((sum, r) => sum + parseFloat(r.total_penjualan || 0), 0);
    res.json({ data: rows, grandTotal });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /api/laporan/pembelian-per-supplier — Laporan pembelian dikelompokkan per supplier
exports.pembelianPerSupplier = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tglwal, tglakhir, idsupplier } = req.query;
    const format = req.query.format || 'json';

    let sql = `
      SELECT s.idsupplier, s.kodesupplier, s.namasupplier,
        COUNT(b.idbeli) as total_transaksi,
        COALESCE(SUM(b.grandtotal), 0) as total_pembelian
      FROM supplier s
      LEFT JOIN beli b ON s.idsupplier = b.idsupplier AND b.idtenant = s.idtenant AND b.status IN ('APPROVED', 'CONFIRMED')`;
    const params = [];
    if (ctx.idlokasi) { sql += ' AND b.idlokasi = ?'; params.push(ctx.idlokasi); }
    if (tglwal) { sql += ' AND b.tgltrans >= ?'; params.push(tglwal); }
    if (tglakhir) { sql += ' AND b.tgltrans <= ?'; params.push(tglakhir); }
    sql += ' WHERE s.idtenant = ?';
    params.push(ctx.idtenant);
    if (idsupplier) {
      const { clause, params: p } = multiIdIn('s.idsupplier', idsupplier);
      if (clause) { sql += ' AND ' + clause; params.push(...p); }
    }
    sql += ' GROUP BY s.idsupplier, s.kodesupplier, s.namasupplier ORDER BY total_pembelian DESC';

    const rows = await tenantQuery(sql, params);
    const grandTotal = rows.reduce((sum, r) => sum + parseFloat(r.total_pembelian || 0), 0);

    if (format === 'html') {
      // Query detail-level per transaksi beli untuk HTML grouping per supplier
      let sqlDetail = `SELECT s.idsupplier, s.kodesupplier, s.namasupplier,
        b.kodebeli, b.tgltrans, l.namalokasi,
        bg.kodebarang, bg.namabarang, bg.satuankecil as satuan,
        bd.jml, bd.harga, bd.ppn, bd.subtotal, b.grandtotal, b.bayar
        FROM supplier s
          JOIN beli b ON s.idsupplier = b.idsupplier AND b.idtenant = s.idtenant AND b.status IN ('APPROVED', 'CONFIRMED')
          JOIN belidtl bd ON b.idbeli = bd.idbeli AND bd.idtenant = b.idtenant
          JOIN barang bg ON bd.idbarang = bg.idbarang AND bg.idtenant = b.idtenant
          JOIN lokasi l ON b.idlokasi = l.idlokasi AND l.idtenant = b.idtenant
        WHERE s.idtenant = ?`;
      const detailParams = [ctx.idtenant];
      if (ctx.idlokasi) { sqlDetail += ' AND b.idlokasi = ?'; detailParams.push(ctx.idlokasi); }
      if (tglwal) { sqlDetail += ' AND b.tgltrans >= ?'; detailParams.push(tglwal); }
      if (tglakhir) { sqlDetail += ' AND b.tgltrans <= ?'; detailParams.push(tglakhir); }
      if (idsupplier) {
        const { clause, params: p } = multiIdIn('s.idsupplier', idsupplier);
        if (clause) { sqlDetail += ' AND ' + clause; detailParams.push(...p); }
      }
      sqlDetail += ' ORDER BY s.namasupplier ASC, b.tgltrans DESC, b.kodebeli DESC, bd.idbelidtl ASC';

      const detailRows = await tenantQuery(sqlDetail, detailParams);
      const grandTotal = detailRows.reduce((sum, r) => sum + parseFloat(r.grandtotal || 0), 0);

      // Grouping item ke dalam transaksi masing-masing
      const transactions = [];
      let currentKode = null;
      let currentGroup = null;
      for (const row of detailRows) {
        if (row.kodebeli !== currentKode) {
          currentKode = row.kodebeli;
          const sisa = parseFloat(row.grandtotal || 0) - parseFloat(row.bayar || 0);
          currentGroup = {
            kodebeli    : row.kodebeli,
            tgltrans    : row.tgltrans,
            namalokasi  : row.namalokasi,
            kodesupplier: row.kodesupplier,
            namasupplier: row.namasupplier,
            grandtotal  : parseFloat(row.grandtotal) || 0,
            bayar       : parseFloat(row.bayar) || 0,
            sisa        : sisa,
            statusLunas : sisa <= 0 ? 'LUNAS' : 'Belum Lunas',
            items       : []
          };
          transactions.push(currentGroup);
        }
        currentGroup.items.push({
          kodebarang: row.kodebarang,
          namabarang: row.namabarang,
          jml       : row.jml,
          satuan    : row.satuan,
          harga     : parseFloat(row.harga) || 0,
          ppn       : parseFloat(row.ppn) || 0,
          subtotal  : parseFloat(row.subtotal) || 0
        });
      }

      let sqlTenant6 = 'SELECT * FROM tenant WHERE idtenant = ?';
      const [[tenant]] = await pool.query(sqlTenant6, [ctx.idtenant]);
      return res.render('laporan_pembelian_per_supplier', {
        transactions, grandTotal,
        tglwal: tglwal || '-', tglakhir: tglakhir || '-',
        namatoko: tenant?.namatenant || 'Grfyn POS',
        alamat: '', hp: '', logo: tenant?.logo || '',
        tglcetak: new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })
      });
    }

    res.json({ data: rows, grandTotal });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /api/laporan/pembelian-per-lokasi — Laporan pembelian dikelompokkan per lokasi/cabang
exports.pembelianPerLokasi = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tglwal, tglakhir } = req.query;
    const format = req.query.format || 'json';

    if (format === 'html') {
      // Query detail-level per item pembelian untuk HTML grouping
      let sqlDetail = `SELECT l.idlokasi, l.kodelokasi, l.namalokasi,
        bl.kodebeli, bl.tgltrans, s.namasupplier, bl.grandtotal, bl.bayar,
        bg.kodebarang, bg.namabarang, bg.satuankecil as satuan,
        bd.jml, bd.harga, bd.ppn, bd.subtotal
        FROM lokasi l
        JOIN beli bl ON l.idlokasi = bl.idlokasi AND bl.idtenant = l.idtenant AND bl.status IN ('APPROVED', 'CONFIRMED')
        JOIN belidtl bd ON bl.idbeli = bd.idbeli AND bd.idtenant = bl.idtenant
        JOIN barang bg ON bd.idbarang = bg.idbarang AND bg.idtenant = bl.idtenant
        LEFT JOIN supplier s ON bl.idsupplier = s.idsupplier AND s.idtenant = bl.idtenant
        WHERE l.idtenant = ?`;
      const detailParams = [ctx.idtenant];
      if (tglwal) { sqlDetail += ' AND bl.tgltrans >= ?'; detailParams.push(tglwal); }
      if (tglakhir) { sqlDetail += ' AND bl.tgltrans <= ?'; detailParams.push(tglakhir); }
      sqlDetail += ' ORDER BY l.namalokasi ASC, bl.tgltrans DESC, bl.kodebeli DESC, bd.idbelidtl ASC';

      const detailRows = await tenantQuery(sqlDetail, detailParams);

      // Grouping item ke dalam transaksi
      const transactions = [];
      let currentKode = null;
      let currentGroup = null;
      for (const row of detailRows) {
        if (row.kodebeli !== currentKode) {
          currentKode = row.kodebeli;
          const sisa = parseFloat(row.grandtotal || 0) - parseFloat(row.bayar || 0);
          currentGroup = {
            kodebeli    : row.kodebeli,
            tgltrans    : row.tgltrans,
            kodelokasi  : row.kodelokasi,
            namalokasi  : row.namalokasi,
            namasupplier: row.namasupplier,
            grandtotal  : parseFloat(row.grandtotal) || 0,
            bayar       : parseFloat(row.bayar) || 0,
            sisa        : sisa,
            statusLunas : sisa <= 0 ? 'LUNAS' : 'Belum Lunas',
            items       : []
          };
          transactions.push(currentGroup);
        }
        currentGroup.items.push({
          kodebarang: row.kodebarang,
          namabarang: row.namabarang,
          jml       : row.jml,
          satuan    : row.satuan,
          harga     : parseFloat(row.harga) || 0,
          ppn       : parseFloat(row.ppn) || 0,
          subtotal  : parseFloat(row.subtotal) || 0
        });
      }

      const grandTotal = transactions.reduce((sum, t) => sum + t.grandtotal, 0);

      let sqlTenant7 = 'SELECT * FROM tenant WHERE idtenant = ?';
      const [[tenant]] = await pool.query(sqlTenant7, [ctx.idtenant]);
      return res.render('laporan_pembelian_per_lokasi', {
        transactions, grandTotal,
        tglwal: tglwal || '-', tglakhir: tglakhir || '-',
        namatoko: tenant?.namatenant || 'Grfyn POS',
        alamat: '', hp: '', logo: tenant?.logo || '',
        tglcetak: new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })
      });
    }

    // JSON: tetap gunakan query agregasi
    let sql = `SELECT l.idlokasi, l.kodelokasi, l.namalokasi,
      COUNT(b.idbeli) as total_transaksi,
      COALESCE(SUM(b.grandtotal), 0) as total_pembelian
      FROM lokasi l
      LEFT JOIN beli b ON l.idlokasi = b.idlokasi AND b.idtenant = l.idtenant AND b.status IN ('APPROVED', 'CONFIRMED')`;
    const params = [];
    if (tglwal) { sql += ' AND b.tgltrans >= ?'; params.push(tglwal); }
    if (tglakhir) { sql += ' AND b.tgltrans <= ?'; params.push(tglakhir); }
    sql += ' WHERE l.idtenant = ? GROUP BY l.idlokasi, l.kodelokasi, l.namalokasi ORDER BY total_pembelian DESC';
    params.push(ctx.idtenant);

    const rows = await tenantQuery(sql, params);
    const grandTotal = rows.reduce((sum, r) => sum + parseFloat(r.total_pembelian || 0), 0);
    res.json({ data: rows, grandTotal });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /api/laporan/pembelian-per-barang — Laporan pembelian dikelompokkan per barang
exports.pembelianPerBarang = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tglwal, tglakhir, idbarang } = req.query;
    const format = req.query.format || 'json';

    if (format === 'html') {
      // Query detail-level untuk HTML grouping view
      let sqlDetail = `SELECT b.idbarang, b.kodebarang, b.namabarang, b.satuankecil as satuan,
        bl.kodebeli, bl.tgltrans, s.namasupplier,
        bd.jml, bd.harga, bd.subtotal
        FROM barang b
        JOIN belidtl bd ON b.idbarang = bd.idbarang AND b.idtenant = bd.idtenant
        JOIN beli bl ON bd.idbeli = bl.idbeli AND bl.idtenant = bd.idtenant AND bl.status IN ('APPROVED', 'CONFIRMED')
        LEFT JOIN supplier s ON bl.idsupplier = s.idsupplier AND s.idtenant = bl.idtenant`;
      const detailParams = [];
      if (ctx.idlokasi) { sqlDetail += ' AND bl.idlokasi = ?'; detailParams.push(ctx.idlokasi); }
      const detailConds = [];
      if (tglwal) { detailConds.push('bl.tgltrans >= ?'); detailParams.push(tglwal); }
      if (tglakhir) { detailConds.push('bl.tgltrans <= ?'); detailParams.push(tglakhir); }
      if (idbarang) {
        const { clause, params: p } = multiIdIn('b.idbarang', idbarang);
        if (clause) { detailConds.push(clause); detailParams.push(...p); }
      }
      if (detailConds.length) sqlDetail += ' AND ' + detailConds.join(' AND ');
      sqlDetail += ' ORDER BY b.namabarang ASC, bl.tgltrans DESC';

      const detailRows = await tenantQuery(sqlDetail, detailParams);
      const grandTotal = detailRows.reduce((sum, r) => sum + parseFloat(r.subtotal || 0), 0);

      let sqlTenant8 = 'SELECT * FROM tenant WHERE idtenant = ?';
      const [[tenant]] = await pool.query(sqlTenant8, [ctx.idtenant]);
      return res.render('laporan_pembelian_per_barang', {
        data    : detailRows,                        grandTotal,
        tglwal  : tglwal || '-',                     tglakhir  : tglakhir || '-',
        namatoko: tenant?.namatenant || 'Grfyn POS',
        alamat  : '',                                hp        : '',              logo: tenant?.logo || '',
        tglcetak: new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })
      });
    }

    // JSON: tetap gunakan query agregasi
    let sql = `SELECT b.idbarang, b.kodebarang, b.namabarang, b.satuankecil as satuan,
      COALESCE(SUM(bd.jml), 0) as total_qty,
      COALESCE(SUM(bd.subtotal), 0) as total_nilai
      FROM barang b
      LEFT JOIN belidtl bd ON b.idbarang = bd.idbarang AND b.idtenant = bd.idtenant
      LEFT JOIN beli bl ON bd.idbeli = bl.idbeli AND bl.idtenant = bd.idtenant AND bl.status IN ('APPROVED', 'CONFIRMED')`;
    const params = [];
    if (ctx.idlokasi) { sql += ' AND bl.idlokasi = ?'; params.push(ctx.idlokasi); }
    const conditions = [];
    if (tglwal) { conditions.push('bl.tgltrans >= ?'); params.push(tglwal); }
    if (tglakhir) { conditions.push('bl.tgltrans <= ?'); params.push(tglakhir); }
    if (idbarang) {
      const { clause, params: p } = multiIdIn('b.idbarang', idbarang);
      if (clause) { conditions.push(clause); params.push(...p); }
    }
    if (conditions.length > 0) { sql += ' WHERE ' + conditions.join(' AND '); }
    sql += ' GROUP BY b.idbarang, b.kodebarang, b.namabarang, b.satuankecil ORDER BY total_nilai DESC';

    const rows = await tenantQuery(sql, params);
    const grandTotal = rows.reduce((sum, r) => sum + parseFloat(r.total_nilai || 0), 0);
    res.json({ data: rows, grandTotal });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /api/laporan/pembelian-rekap — Rekap pembelian (total transaksi, total pembelian, total dibayar, total hutang)
exports.pembelianRekap = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tglwal, tglakhir, idsupplier } = req.query;

    let sql = `SELECT
      COUNT(CASE WHEN status = 'APPROVED' THEN 1 END) as total_transaksi,
      COALESCE(SUM(CASE WHEN status = 'APPROVED' THEN grandtotal ELSE 0 END), 0) as total_pembelian,
      COALESCE(SUM(CASE WHEN status = 'APPROVED' THEN bayar ELSE 0 END), 0) as total_dibayar,
      COALESCE(SUM(CASE WHEN status = 'APPROVED' THEN GREATEST(grandtotal - bayar, 0) ELSE 0 END), 0) as total_hutang
      FROM beli WHERE idlokasi = ?`;
    const params = [ctx.idlokasi];
    if (tglwal) { sql += ' AND tgltrans >= ?'; params.push(tglwal); }
    if (tglakhir) { sql += ' AND tgltrans <= ?'; params.push(tglakhir); }
    if (idsupplier) {
      const { clause, params: p } = multiIdIn('idsupplier', idsupplier);
      if (clause) { sql += ' AND ' + clause; params.push(...p); }
    }

    const rows = await tenantQuery(sql, params);

    if (req.query.format === 'html') {
      let sqlTenant9 = 'SELECT * FROM tenant WHERE idtenant = ?';
      const [[tenant]] = await pool.query(sqlTenant9, [ctx.idtenant]);
      return res.render('laporan_pembelian_rekap', {
        data: rows[0],
        tglwal: tglwal || '-', tglakhir: tglakhir || '-',
        namatoko: tenant?.namatenant || 'Grfyn POS',
        alamat: '', hp: '', logo: tenant?.logo || '',
        tglcetak: new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })
      });
    }

    res.json(rows[0]);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /api/laporan/stok — Laporan stok terkini per barang
exports.stok = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tgl } = req.query;
    const format = req.query.format || 'json';

    // Cari saldo stok snapshot terbaru
    let sqlSaldo = 'SELECT idsaldostok, kodesaldostok, tgltrans FROM saldostok WHERE idtenant = ? AND idlokasi = ? ORDER BY tgltrans DESC, idsaldostok DESC LIMIT 1';
    const [[latestSaldo]] = await pool.query(
      sqlSaldo,
      [ctx.idtenant, ctx.idlokasi]
    );

    let sql;
    const params = [];

    // Jika ada snapshot: stok = saldo snapshot + mutasi masuk - mutasi keluar setelahnya
    if (latestSaldo) {
      sql = `SELECT b.idbarang, b.kodebarang, b.namabarang, b.satuankecil as satuan, b.stokmin,
        COALESCE(sd.qty, 0) + COALESCE(km.masuk, 0) - COALESCE(km.keluar, 0) as stok
        FROM barang b
        LEFT JOIN saldostokdtl sd ON sd.idbarang = b.idbarang AND sd.idsaldostok = ?
        LEFT JOIN (
          SELECT idbarang,
            COALESCE(SUM(CASE WHEN jenis = 'M' THEN jml ELSE 0 END), 0) as masuk,
            COALESCE(SUM(CASE WHEN jenis = 'K' THEN jml ELSE 0 END), 0) as keluar
          FROM kartustok WHERE idtenant = ? AND idlokasi = ? AND tgltrans > ? GROUP BY idbarang
        ) km ON km.idbarang = b.idbarang
        WHERE b.status = 'AKTIF' ORDER BY b.namabarang`;
      params.push(latestSaldo.idsaldostok, ctx.idtenant, ctx.idlokasi, latestSaldo.tgltrans);
    // Jika tidak ada snapshot: stok langsung dari kartustok (masuk - keluar)
    } else {
      sql = `SELECT b.idbarang, b.kodebarang, b.namabarang, b.satuankecil as satuan, b.stokmin,
        COALESCE(m.total, 0) - COALESCE(k.total, 0) as stok
        FROM barang b
        LEFT JOIN (SELECT idbarang, SUM(jml) as total FROM kartustok WHERE jenis = 'M' AND idtenant = ? AND idlokasi = ? GROUP BY idbarang) m ON b.idbarang = m.idbarang
        LEFT JOIN (SELECT idbarang, SUM(jml) as total FROM kartustok WHERE jenis = 'K' AND idtenant = ? AND idlokasi = ? GROUP BY idbarang) k ON b.idbarang = k.idbarang
        WHERE b.status = 'AKTIF' ORDER BY b.namabarang`;
      params.push(ctx.idtenant, ctx.idlokasi, ctx.idtenant, ctx.idlokasi);
    }

    const rows = await tenantQuery(sql, params);
    const totalBarang = rows.length;
    const totalStok = rows.reduce((sum, r) => sum + (parseInt(r.stok) || 0), 0);

    if (format === 'html') {
      let sqlTenantStok = 'SELECT * FROM tenant WHERE idtenant = ?';
      const [[tenant]] = await pool.query(sqlTenantStok, [ctx.idtenant]);
      return res.render('laporan_stok', {
        data: rows, totalBarang, totalStok,
        periodSaldo: latestSaldo ? latestSaldo.tgltrans : '-',
        namatoko: tenant?.namatenant || 'Grfyn POS',
        alamat: '', hp: '', logo: tenant?.logo || '',
        tglcetak: new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })
      });
    }

    res.json({ data: rows, totalBarang, totalStok, periodSaldo: latestSaldo?.tgltrans });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /api/laporan/kartu-stok — Laporan mutasi stok (kartu stok) per barang
exports.kartuStok = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { idbarang, tglwal, tglakhir, jenistransaksi, jenisref } = req.query;
    const format = req.query.format || 'json';
    const selectedBarangFilter = idbarang ? multiIdIn('ks.idbarang', idbarang) : null;

    let sql = `SELECT ks.*, b.kodebarang, b.namabarang, b.satuankecil as satuan
      FROM kartustok ks
      LEFT JOIN barang b ON ks.idbarang = b.idbarang AND b.idtenant = ks.idtenant
      WHERE 1=1`;
    const params = [];
    sql += ' AND ks.idtenant = ?'; params.push(ctx.idtenant);
    sql += ' AND ks.idlokasi = ?'; params.push(ctx.idlokasi);
    if (selectedBarangFilter?.clause) {
      sql += ` AND ${selectedBarangFilter.clause}`;
      params.push(...selectedBarangFilter.params);
    }
    if (tglwal) { sql += ' AND ks.tgltrans >= ?'; params.push(tglwal); }
    if (tglakhir) { sql += ' AND ks.tgltrans <= ?'; params.push(tglakhir); }
    const jenisFilter = jenistransaksi || jenisref;
    if (jenisFilter) {
      const vals = jenisFilter.split(',').map(s => s.trim()).filter(Boolean);
      if (vals.length) {
        sql += ` AND ks.jenistransaksi IN (${vals.map(() => '?').join(',')})`;
        params.push(...vals);
      }
    }
    sql += ' ORDER BY b.namabarang ASC, ks.tgltrans ASC, ks.idkartustok ASC';

    const rows = await tenantQuery(sql, params);
    const selectedBarangIds = idbarang ? idbarang.split(',').map(s => s.trim()).filter(Boolean) : [];
    const barangIds = [...new Set([...selectedBarangIds, ...rows.map(row => String(row.idbarang))])];
    let latestSaldo = null;
    let saldoAwalByBarang = {};
    let barangById = {};
    const [[lokasi]] = await pool.query(
      'SELECT namalokasi FROM lokasi WHERE idlokasi = ? AND idtenant = ?',
      [ctx.idlokasi, ctx.idtenant]
    );

    const [[latestSaldoRow]] = await pool.query(
      `SELECT idsaldostok, tgltrans
       FROM saldostok
       WHERE idtenant = ? AND idlokasi = ?
       ORDER BY tgltrans DESC, idsaldostok DESC
       LIMIT 1`,
      [ctx.idtenant, ctx.idlokasi]
    );
    latestSaldo = latestSaldoRow || null;

    if (barangIds.length) {
      const barangPlaceholders = barangIds.map(() => '?').join(',');
      const barangRows = await tenantQuery(
        `SELECT idbarang, kodebarang, namabarang, satuankecil as satuan
         FROM barang
         WHERE idbarang IN (${barangPlaceholders})
         ORDER BY namabarang`,
        barangIds
      );
      barangById = barangRows.reduce((acc, row) => {
        acc[String(row.idbarang)] = row;
        return acc;
      }, {});

      if (latestSaldo) {
        const saldoRows = await tenantQuery(
          `SELECT idbarang, qty
           FROM saldostokdtl
           WHERE idsaldostok = ? AND idbarang IN (${barangPlaceholders})`,
          [latestSaldo.idsaldostok, ...barangIds]
        );
        saldoAwalByBarang = saldoRows.reduce((acc, row) => {
          acc[String(row.idbarang)] = parseFloat(row.qty || 0);
          return acc;
        }, {});
      }
    }

    const groupedMap = new Map();
    for (const id of barangIds) {
      const barang = barangById[String(id)] || rows.find(row => String(row.idbarang) === String(id)) || {};
      groupedMap.set(String(id), {
        idbarang: id,
        kodebarang: barang.kodebarang || '',
        namabarang: barang.namabarang || '-',
        satuan: barang.satuan || '',
        saldoAwal: saldoAwalByBarang[String(id)] || 0,
        rows: []
      });
    }
    for (const row of rows) {
      const key = String(row.idbarang);
      if (!groupedMap.has(key)) {
        groupedMap.set(key, {
          idbarang: row.idbarang,
          kodebarang: row.kodebarang || '',
          namabarang: row.namabarang || '-',
          satuan: row.satuan || '',
          saldoAwal: saldoAwalByBarang[key] || 0,
          rows: []
        });
      }
      groupedMap.get(key).rows.push(row);
    }
    const groupedData = Array.from(groupedMap.values()).sort((a, b) => a.namabarang.localeCompare(b.namabarang));

    if (format === 'html') {
      let sqlTenantKartu = 'SELECT * FROM tenant WHERE idtenant = ?';
      const [[tenant]] = await pool.query(sqlTenantKartu, [ctx.idtenant]);
      return res.render('laporan_kartu_stok', {
        data: rows,
        groupedData,
        periodSaldo: latestSaldo ? latestSaldo.tgltrans : '-',
        namalokasi: lokasi?.namalokasi || '-',
        tglwal: tglwal || '-', tglakhir: tglakhir || '-',
        namatoko: tenant?.namatenant || 'Grfyn POS',
        alamat: '', hp: '', logo: tenant?.logo || '',
        tglcetak: new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })
      });
    }

    res.json({ data: rows, groupedData, periodSaldo: latestSaldo?.tgltrans || null, namalokasi: lokasi?.namalokasi || '-' });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /api/laporan/rekap-sales — Rekap penjualan (per transaksi, dengan status lunas/belum)
exports.rekapSales = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tglwal, tglakhir, kodelokasi, namalokasi, kodecustomer, namacustomer, statusLunas } = req.query;
    const format = req.query.format || 'json';

    let sql = `SELECT j.kodejual, j.tgltrans, l.namalokasi,
      c.kodecustomer, c.namacustomer,
      COUNT(jdtl.idjualdtl) AS totalitem,
      j.grandtotal,
      pp.tgltrans AS tglpelunasan, kp.terbayar, kp.sisa
    FROM jual j
    JOIN jualdtl jdtl ON j.idjual = jdtl.idjual AND jdtl.idtenant = j.idtenant
    JOIN lokasi l ON l.idlokasi = j.idlokasi AND l.idtenant = j.idtenant
    JOIN customer c ON c.idcustomer = j.idcustomer AND c.idtenant = j.idtenant
    LEFT JOIN kartupiutang kp ON kp.kodetrans = j.kodejual AND kp.jenis = 'JUAL'
    LEFT JOIN pelunasanpiutangdtl ppdtl ON ppdtl.kodetrans = kp.kodetrans
    LEFT JOIN pelunasanpiutang pp ON pp.idpelunasan = ppdtl.idpelunasan
    WHERE j.status = 'AKTIF'`;
    const params = [];

    if (tglwal) { sql += ' AND j.tgltrans >= ?'; params.push(tglwal); }
    if (tglakhir) { sql += ' AND j.tgltrans <= ?'; params.push(tglakhir); }

    if (kodelokasi) {
      const { clause, params: p } = multiLike('l.kodelokasi', kodelokasi);
      if (clause) { sql += ' AND ' + clause; params.push(...p); }
    }
    if (namalokasi) {
      const { clause, params: p } = multiLike('l.namalokasi', namalokasi);
      if (clause) { sql += ' AND ' + clause; params.push(...p); }
    }
    if (kodecustomer) {
      const { clause, params: p } = multiLike('c.kodecustomer', kodecustomer);
      if (clause) { sql += ' AND ' + clause; params.push(...p); }
    }
    if (namacustomer) {
      const { clause, params: p } = multiLike('c.namacustomer', namacustomer);
      if (clause) { sql += ' AND ' + clause; params.push(...p); }
    }

    if (statusLunas === 'lunas') {
      sql += ' AND kp.sisa <= 0';
    } else if (statusLunas === 'belum') {
      sql += ' AND (kp.sisa > 0 OR kp.sisa IS NULL)';
    }

    sql += ' GROUP BY j.kodejual, j.tgltrans, l.namalokasi, c.kodecustomer, c.namacustomer, j.grandtotal, pp.tgltrans, kp.terbayar, kp.sisa ORDER BY j.tgltrans DESC, j.kodejual DESC';

    const rows = await tenantQuery(sql, params);

    // Proses hasil query: hitung sisa dan status lunas
    const processed = rows.map(r => {
      const sisaVal = parseFloat(r.sisa) || 0;
      return {
        ...r,
        sisa: sisaVal,
        statusLunas: sisaVal === 0 ? 'LUNAS' : 'Belum Lunas',
        totalitem: parseInt(r.totalitem) || 0,
        grandtotal: parseFloat(r.grandtotal) || 0,
        amount: parseFloat(r.amount) || 0
      };
    });

    const totalTransaksi = processed.length;
    const totalPenjualan = processed.reduce((sum, r) => sum + r.grandtotal, 0);
    const totalLunas = processed.filter(r => r.sisa === 0).reduce((sum, r) => sum + r.grandtotal, 0);
    const totalPiutang = processed.reduce((sum, r) => sum + r.sisa, 0);

    if (format === 'html') {
      let sqlTenantRekap = 'SELECT * FROM tenant WHERE idtenant = ?';
      const [[tenant]] = await pool.query(sqlTenantRekap, [ctx.idtenant]);
      let sqlLokasiRekap = 'SELECT * FROM lokasi WHERE idlokasi = ? AND idtenant = ?';
      const [[lokasi]] = await pool.query(sqlLokasiRekap, [ctx.idlokasi, ctx.idtenant]);
      return res.render('laporan_sales_rekap', {
        data: processed,
        totalTransaksi, totalPenjualan, totalLunas, totalPiutang,
        tglwal: tglwal || '-', tglakhir: tglakhir || '-',
        statusLunas: statusLunas || '',
        kodelokasi: kodelokasi || '', namalokasi: namalokasi || '',
        kodecustomer: kodecustomer || '', namacustomer: namacustomer || '',
        namatoko: tenant?.namatenant || 'Grfyn POS',
        alamat: lokasi?.alamat || '',
        hp: lokasi?.hp || '',
        logo: tenant?.logo || '',
        tglcetak: new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })
      });
    }

    res.json({ data: processed, totalTransaksi, totalPenjualan, totalLunas, totalPiutang });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /api/laporan/struk/:id — Cetak struk penjualan (HTML)
exports.struk = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { id } = req.params;
    const format = req.query.format || 'json';

    const rows = await tenantQuery(
      `SELECT j.*, c.namacustomer, c.alamat as alamatcustomer
       FROM jual j
       LEFT JOIN customer c ON j.idcustomer = c.idcustomer AND c.idtenant = j.idtenant
       WHERE j.idjual = ? AND j.idlokasi = ?`,
      [id, ctx.idlokasi]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Transaksi tidak ditemukan' });
    const jual = rows[0];

    const detail = await tenantQuery(
      `SELECT jd.*, b.namabarang, b.kodebarang, b.satuankecil as satuan
       FROM jualdtl jd
       LEFT JOIN barang b ON jd.idbarang = b.idbarang AND b.idtenant = jd.idtenant
       WHERE jd.idjual = ?`,
      [id]
    );

    if (format === 'html') {
      let sqlTenantStruk = 'SELECT * FROM tenant WHERE idtenant = ?';
      const [[tenant]] = await pool.query(sqlTenantStruk, [ctx.idtenant]);
      let sqlLokasiStruk = 'SELECT * FROM lokasi WHERE idlokasi = ? AND idtenant = ?';
      const [[lokasi]] = await pool.query(sqlLokasiStruk, [ctx.idlokasi, ctx.idtenant]);
      return res.render('struk', {
        jual, detail,
        namatoko: tenant?.namatenant || 'Grfyn POS',
        alamat: lokasi?.alamat || '',
        hp: lokasi?.hp || '',
        logo: tenant?.logo || '',
        tglcetak: new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })
      });
    }

    res.json({ data: jual, detail });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /api/laporan/faktur/:id — Cetak faktur penjualan (HTML)
exports.faktur = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { id } = req.params;
    const format = req.query.format || 'json';

    const rows = await tenantQuery(
      `SELECT j.*, c.namacustomer, c.alamat as alamatcustomer, c.hp as hpcustomer
       FROM jual j
       LEFT JOIN customer c ON j.idcustomer = c.idcustomer AND c.idtenant = j.idtenant
       WHERE j.idjual = ? AND j.idlokasi = ?`,
      [id, ctx.idlokasi]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Transaksi tidak ditemukan' });
    const jual = rows[0];

    const detail = await tenantQuery(
      `SELECT jd.*, b.namabarang, b.kodebarang, b.satuankecil as satuan
       FROM jualdtl jd
       LEFT JOIN barang b ON jd.idbarang = b.idbarang AND b.idtenant = jd.idtenant
       WHERE jd.idjual = ?`,
      [id]
    );

    if (format === 'html') {
      let sqlTenantFaktur = 'SELECT * FROM tenant WHERE idtenant = ?';
      const [[tenant]] = await pool.query(sqlTenantFaktur, [ctx.idtenant]);
      let sqlLokasiFaktur = 'SELECT * FROM lokasi WHERE idlokasi = ? AND idtenant = ?';
      const [[lokasi]] = await pool.query(sqlLokasiFaktur, [ctx.idlokasi, ctx.idtenant]);
      return res.render('faktur', {
        jual, detail,
        namatoko: tenant?.namatenant || 'Grfyn POS',
        alamat: lokasi?.alamat || '',
        hp: lokasi?.hp || '',
        logo: tenant?.logo || '',
        tglcetak: new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })
      });
    }

    res.json({ data: jual, detail });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};
