/**
 * Controller untuk berbagai laporan: penjualan (transaksi, per customer, per barang, per lokasi, rekap),
 * pembelian (transaksi, per supplier, per lokasi, per barang, rekap), stok, kartu stok, struk, dan faktur.
 * Mendukung output format JSON (default) dan HTML (render EJS).
 * Endpoint: GET /api/laporan/*
 */
const { tenantQuery, getTenantContext, pool } = require('../config/db');
const logger = require('../lib/logger');

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



// GET /api/laporan/sales-transaksi — Laporan detail transaksi penjualan (per item)
exports.salesTransaksi = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tglwal, tglakhir, kodelokasi, namalokasi, kodecustomer, namacustomer, statusLunas } = req.query;
    const format = req.query.format || 'json';

    let sql = `
    SELECT j.kodejual, j.tgltrans, l.namalokasi,
      c.kodecustomer, c.namacustomer,
      b.kodebarang, b.namabarang,
      jdtl.jml, jdtl.satuan, jdtl.harga, jdtl.ppn, jdtl.subtotal, j.grandtotal,
      pp.tgltrans AS tglpelunasan, kp.terbayar as amount, kp.sisa
    FROM jual j
      JOIN jualdtl jdtl ON j.idjual = jdtl.idjual AND jdtl.idtenant = j.idtenant
      JOIN lokasi l ON l.idlokasi = j.idlokasi AND l.idtenant = j.idtenant
      JOIN customer c ON c.idcustomer = j.idcustomer AND c.idtenant = j.idtenant
      JOIN barang b ON b.idbarang = jdtl.idbarang AND b.idtenant = j.idtenant
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

    sql += 'GROUP BY jdtl.idbarang ORDER BY j.tgltrans DESC, j.kodejual DESC, jdtl.idjualdtl ASC';

    const rows = await tenantQuery(sql, params);

    // Grouping: menggabungkan item per kodejual ke dalam satu transaksi
    const transactions = [];
    let currentKode = null;
    let currentGroup = null;
    const seenKodejual = new Set();

    for (const row of rows) {
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
          statusLunas : sisaVal === 0 ? 'LUNAS'        : 'Belum Lunas',
          items       : []
        };
        transactions.push(currentGroup);
        seenKodejual.add(row.kodejual);
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

    const totalTransaksi = seenKodejual.size;
    const totalPenjualan = transactions.reduce((sum, t) => sum + t.grandtotal, 0);

    // Render HTML jika format=html diminta
    if (format === 'html') {
      let sqlTenant = 'SELECT * FROM tenant WHERE idtenant = ?';
      const [[tenant]] = await pool.query(sqlTenant, [ctx.idtenant]);
      let sqlLokasi = 'SELECT * FROM lokasi WHERE idlokasi = ? AND idtenant = ?';
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

    res.json({ transactions, totalTransaksi, totalPenjualan });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /api/laporan/sales-per-customer — Laporan penjualan dikelompokkan per customer
exports.salesPerCustomer = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tglwal, tglakhir, kodelokasi, namalokasi, kodecustomer, namacustomer, statusLunas } = req.query;
    const format = req.query.format || 'json';

    let sql = `
    SELECT c.idcustomer, c.kodecustomer, c.namacustomer,
      COUNT(DISTINCT j.kodejual) as total_transaksi,
      COALESCE(SUM(j.grandtotal), 0) as total_penjualan,
      COALESCE(SUM(CASE WHEN kp.sisa <= 0 OR kp.sisa IS NULL THEN j.grandtotal ELSE 0 END), 0) as total_lunas,
      COALESCE(SUM(CASE WHEN kp.sisa > 0 THEN kp.sisa ELSE 0 END), 0) as total_piutang
    FROM customer c
      LEFT JOIN jual j ON c.idcustomer = j.idcustomer AND j.idtenant = c.idtenant AND j.status = 'AKTIF'
      LEFT JOIN kartupiutang kp ON kp.kodetrans = j.kodejual AND kp.jenis = 'JUAL'
    WHERE c.idtenant = ?`;
    const params = [ctx.idtenant];

    if (tglwal) { sql += ' AND j.tgltrans >= ?'; params.push(tglwal); }
    if (tglakhir) { sql += ' AND j.tgltrans <= ?'; params.push(tglakhir); }

    if (kodelokasi) {
      sql += ` AND j.idlokasi IN (SELECT idlokasi FROM lokasi WHERE idtenant = c.idtenant AND (`;
      const vals = kodelokasi.split(',').map(s => s.trim()).filter(Boolean);
      sql += vals.map(() => 'kodelokasi LIKE ?').join(' OR ');
      sql += '))';
      vals.forEach(v => params.push(`%${v}%`));
    }
    if (namalokasi) {
      sql += ` AND j.idlokasi IN (SELECT idlokasi FROM lokasi WHERE idtenant = c.idtenant AND (`;
      const vals = namalokasi.split(',').map(s => s.trim()).filter(Boolean);
      sql += vals.map(() => 'namalokasi LIKE ?').join(' OR ');
      sql += '))';
      vals.forEach(v => params.push(`%${v}%`));
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

    sql += ' GROUP BY c.idcustomer, c.kodecustomer, c.namacustomer ORDER BY total_penjualan DESC';

    const rows = await tenantQuery(sql, params);
    const grandTotal = rows.reduce((sum, r) => sum + parseFloat(r.total_penjualan || 0), 0);

    if (format === 'html') {
      let sqlTenant2 = 'SELECT * FROM tenant WHERE idtenant = ?';
      const [[tenant]] = await pool.query(sqlTenant2, [ctx.idtenant]);
      return res.render('laporan_sales_per_customer', {
        data        : rows,                              grandTotal,
        tglwal      : tglwal || '-',                     tglakhir    : tglakhir || '-',
        statusLunas : statusLunas || '',
        kodelokasi  : kodelokasi || '',                  namalokasi  : namalokasi || '',
        kodecustomer: kodecustomer || '',                namacustomer: namacustomer || '',
        namatoko    : tenant?.namatenant || 'Grfyn POS',
        alamat      : '',                                hp          : '',                 logo: tenant?.logo || '',
        tglcetak    : new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })
      });
    }

    res.json({ data: rows, grandTotal });
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

    if (format === 'html') {
      let sqlTenant3 = 'SELECT * FROM tenant WHERE idtenant = ?';
      const [[tenant]] = await pool.query(sqlTenant3, [ctx.idtenant]);
      return res.render('laporan_sales_per_barang', {
        data        : rows,                              grandTotal,
        tglwal      : tglwal || '-',                     tglakhir    : tglakhir || '-',
        statusLunas : statusLunas || '',
        kodelokasi  : kodelokasi || '',                  namalokasi  : namalokasi || '',
        kodecustomer: kodecustomer || '',                namacustomer: namacustomer || '',
        namatoko    : tenant?.namatenant || 'Grfyn POS',
        alamat      : '',                                hp          : '',                 logo: tenant?.logo || '',
        tglcetak    : new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })
      });
    }

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
      WHERE 1=1 and b.status <> 'VOID'`;
    const params = [];
    sql += ' AND b.idlokasi = ?'; params.push(ctx.idlokasi);
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
      let sqlTenant4 = 'SELECT * FROM tenant WHERE idtenant = ?';
      const [[tenant]] = await pool.query(sqlTenant4, [ctx.idtenant]);
      return res.render('laporan_pembelian', {
        data    : rows,                              totalPembelian,
        tglwal  : tglwal || '-',                     tglakhir      : tglakhir || '-',
        namatoko: tenant?.namatenant || 'Grfyn POS',
        alamat  : '',                                hp            : '',              logo: tenant?.logo || '',
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

    let sql = `
    SELECT l.idlokasi, l.kodelokasi, l.namalokasi,
      COUNT(DISTINCT j.kodejual) as total_transaksi,
      COALESCE(SUM(j.grandtotal), 0) as total_penjualan,
      COALESCE(SUM(CASE WHEN kp.sisa <= 0 OR kp.sisa IS NULL THEN j.grandtotal ELSE 0 END), 0) as total_lunas,
      COALESCE(SUM(CASE WHEN kp.sisa > 0 THEN kp.sisa ELSE 0 END), 0) as total_piutang
    FROM lokasi l
      LEFT JOIN jual j ON l.idlokasi = j.idlokasi AND j.idtenant = l.idtenant AND j.status = 'AKTIF'
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

    if (format === 'html') {
      let sqlTenant5 = 'SELECT * FROM tenant WHERE idtenant = ?';
      const [[tenant]] = await pool.query(sqlTenant5, [ctx.idtenant]);
      return res.render('laporan_sales_per_lokasi', {
        data        : rows,                              grandTotal,
        tglwal      : tglwal || '-',                     tglakhir    : tglakhir || '-',
        statusLunas : statusLunas || '',
        kodelokasi  : kodelokasi || '',                  namalokasi  : namalokasi || '',
        kodecustomer: kodecustomer || '',                namacustomer: namacustomer || '',
        namatoko    : tenant?.namatenant || 'Grfyn POS',
        alamat      : '',                                hp          : '',                 logo: tenant?.logo || '',
        tglcetak    : new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })
      });
    }

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
      LEFT JOIN beli b ON s.idsupplier = b.idsupplier AND b.idtenant = s.idtenant AND b.idlokasi = ?`;
    const params = [ctx.idlokasi];
    const conditions = [];
    if (tglwal) { conditions.push('b.tgltrans >= ?'); params.push(tglwal); }
    if (tglakhir) { conditions.push('b.tgltrans <= ?'); params.push(tglakhir); }
    if (idsupplier) {
      const { clause, params: p } = multiIdIn('s.idsupplier', idsupplier);
      if (clause) { conditions.push(clause); params.push(...p); }
    }
    if (conditions.length > 0) { sql += ' AND ' + conditions.join(' AND '); }
    sql += ' WHERE s.idtenant = ? GROUP BY s.idsupplier, s.kodesupplier, s.namasupplier ORDER BY total_pembelian DESC';
    params.push(ctx.idtenant);

    const rows = await tenantQuery(sql, params);
    const grandTotal = rows.reduce((sum, r) => sum + parseFloat(r.total_pembelian || 0), 0);

    if (format === 'html') {
      let sqlTenant6 = 'SELECT * FROM tenant WHERE idtenant = ?';
      const [[tenant]] = await pool.query(sqlTenant6, [ctx.idtenant]);
      return res.render('laporan_pembelian_per_supplier', {
        data: rows, grandTotal,
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

    let sql = `SELECT l.idlokasi, l.kodelokasi, l.namalokasi,
      COUNT(b.idbeli) as total_transaksi,
      COALESCE(SUM(b.grandtotal), 0) as total_pembelian
      FROM lokasi l
      LEFT JOIN beli b ON l.idlokasi = b.idlokasi AND b.idtenant = l.idtenant`;
    const params = [];
    const conditions = [];
    if (tglwal) { conditions.push('b.tgltrans >= ?'); params.push(tglwal); }
    if (tglakhir) { conditions.push('b.tgltrans <= ?'); params.push(tglakhir); }
    if (conditions.length > 0) { sql += ' AND ' + conditions.join(' AND '); }
    sql += ' WHERE l.idtenant = ? GROUP BY l.idlokasi, l.kodelokasi, l.namalokasi ORDER BY total_pembelian DESC';
    params.push(ctx.idtenant);

    const rows = await tenantQuery(sql, params);
    const grandTotal = rows.reduce((sum, r) => sum + parseFloat(r.total_pembelian || 0), 0);

    if (format === 'html') {
      let sqlTenant7 = 'SELECT * FROM tenant WHERE idtenant = ?';
      const [[tenant]] = await pool.query(sqlTenant7, [ctx.idtenant]);
      return res.render('laporan_pembelian_per_lokasi', {
        data: rows, grandTotal,
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

// GET /api/laporan/pembelian-per-barang — Laporan pembelian dikelompokkan per barang
exports.pembelianPerBarang = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tglwal, tglakhir, idbarang } = req.query;
    const format = req.query.format || 'json';

    let sql = `SELECT b.idbarang, b.kodebarang, b.namabarang, b.satuankecil as satuan,
      COALESCE(SUM(bd.jml), 0) as total_qty,
      COALESCE(SUM(bd.subtotal), 0) as total_nilai
      FROM barang b
      LEFT JOIN belidtl bd ON b.idbarang = bd.idbarang AND b.idtenant = bd.idtenant
      LEFT JOIN beli bl ON bd.idbeli = bl.idbeli AND bl.idtenant = bd.idtenant AND bl.idlokasi = ?`;
    const params = [ctx.idlokasi];
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

    if (format === 'html') {
      let sqlTenant8 = 'SELECT * FROM tenant WHERE idtenant = ?';
      const [[tenant]] = await pool.query(sqlTenant8, [ctx.idtenant]);
      return res.render('laporan_pembelian_per_barang', {
        data    : rows,                              grandTotal,
        tglwal  : tglwal || '-',                     tglakhir  : tglakhir || '-',
        namatoko: tenant?.namatenant || 'Grfyn POS',
        alamat  : '',                                hp        : '',              logo: tenant?.logo || '',
        tglcetak: new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })
      });
    }

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
      COUNT(CASE WHEN status != 'VOID' THEN 1 END) as total_transaksi,
      COALESCE(SUM(CASE WHEN status != 'VOID' THEN grandtotal ELSE 0 END), 0) as total_pembelian,
      COALESCE(SUM(CASE WHEN status != 'VOID' THEN bayar ELSE 0 END), 0) as total_dibayar,
      COALESCE(SUM(CASE WHEN status = 'AKTIF' THEN GREATEST(grandtotal - bayar, 0) ELSE 0 END), 0) as total_hutang
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
    const { idbarang, tglwal, tglakhir } = req.query;
    const format = req.query.format || 'json';

    let sql = `SELECT ks.*, b.kodebarang, b.namabarang, b.satuankecil as satuan
      FROM kartustok ks
      LEFT JOIN barang b ON ks.idbarang = b.idbarang AND b.idtenant = ks.idtenant
      WHERE 1=1`;
    const params = [];
    sql += ' AND ks.idlokasi = ?'; params.push(ctx.idlokasi);
    if (idbarang) { sql += ' AND ks.idbarang = ?'; params.push(idbarang); }
    if (tglwal) { sql += ' AND ks.tgltrans >= ?'; params.push(tglwal); }
    if (tglakhir) { sql += ' AND ks.tgltrans <= ?'; params.push(tglakhir); }
    sql += ' ORDER BY ks.tgltrans ASC, ks.idkartustok ASC';

    const rows = await tenantQuery(sql, params);

    if (format === 'html') {
      let sqlTenantKartu = 'SELECT * FROM tenant WHERE idtenant = ?';
      const [[tenant]] = await pool.query(sqlTenantKartu, [ctx.idtenant]);
      return res.render('laporan_kartu_stok', {
        data: rows,
        tglwal: tglwal || '-', tglakhir: tglakhir || '-',
        namatoko: tenant?.namatenant || 'Grfyn POS',
        alamat: '', hp: '', logo: tenant?.logo || '',
        tglcetak: new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })
      });
    }

    res.json({ data: rows });
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
