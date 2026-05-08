const { tenantQuery, getTenantContext, pool } = require('../config/db');
const logger = require('../lib/logger');

exports.salesTransaksi = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tglwal, tglakhir } = req.query;
    const format = req.query.format || 'json';

    let sql = `SELECT j.*, c.namacustomer FROM jual j
      LEFT JOIN customer c ON j.idcustomer = c.idcustomer AND c.idtenant = j.idtenant
      WHERE 1=1`;
    const params = [];
    sql += ' AND j.idlokasi = ?'; params.push(ctx.idlokasi);
    if (tglwal) { sql += ' AND j.tgltrans >= ?'; params.push(tglwal); }
    if (tglakhir) { sql += ' AND j.tgltrans <= ?'; params.push(tglakhir); }
    sql += ' ORDER BY j.tgltrans DESC, j.idjual DESC';

    const rows = await tenantQuery(sql, params);
    let totalTransaksi = rows.length;
    let totalPenjualan = rows.reduce((sum, r) => sum + parseFloat(r.grandtotal || 0), 0);

    if (format === 'html') {
      const [[tenant]] = await pool.query('SELECT * FROM tenant WHERE idtenant = ?', [ctx.idtenant]);
      const [[lokasi]] = await pool.query('SELECT * FROM lokasi WHERE idlokasi = ? AND idtenant = ?', [ctx.idlokasi, ctx.idtenant]);
      return res.render('laporan_sales_transaksi', {
        data: rows,
        totalTransaksi,
        totalPenjualan,
        tglwal: tglwal || '-',
        tglakhir: tglakhir || '-',
        namatoko: tenant?.namatenant || 'Grfyn POS',
        alamat: lokasi?.alamat || '',
        hp: lokasi?.hp || '',
        logo: tenant?.logo || '',
        tglcetak: new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })
      });
    }

    res.json({ data: rows, totalTransaksi, totalPenjualan });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

exports.salesPerCustomer = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tglwal, tglakhir, idcustomer } = req.query;
    const format = req.query.format || 'json';

    let sql = `SELECT c.idcustomer, c.kodecustomer, c.namacustomer,
      COUNT(j.idjual) as total_transaksi,
      COALESCE(SUM(j.grandtotal), 0) as total_penjualan
      FROM customer c
      LEFT JOIN jual j ON c.idcustomer = j.idcustomer AND j.idtenant = c.idtenant AND j.idlokasi = ?`;
    const params = [ctx.idlokasi];
    const conditions = [];
    if (tglwal) { conditions.push('j.tgltrans >= ?'); params.push(tglwal); }
    if (tglakhir) { conditions.push('j.tgltrans <= ?'); params.push(tglakhir); }
    if (conditions.length > 0) { sql += ' AND ' + conditions.join(' AND '); }
    if (idcustomer) { sql += ' WHERE c.idcustomer = ?'; params.push(idcustomer); }
    sql += ' GROUP BY c.idcustomer, c.kodecustomer, c.namacustomer ORDER BY total_penjualan DESC';

    const rows = await tenantQuery(sql, params);
    const grandTotal = rows.reduce((sum, r) => sum + parseFloat(r.total_penjualan || 0), 0);

    if (format === 'html') {
      const [[tenant]] = await pool.query('SELECT * FROM tenant WHERE idtenant = ?', [ctx.idtenant]);
      return res.render('laporan_sales_per_customer', {
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

exports.salesPerBarang = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tglwal, tglakhir, idbarang } = req.query;
    const format = req.query.format || 'json';

    let sql = `SELECT b.idbarang, b.kodebarang, b.namabarang, b.satuankecil as satuan,
      COALESCE(SUM(jd.jml), 0) as total_qty,
      COALESCE(SUM(jd.subtotal), 0) as total_nilai
      FROM barang b
      LEFT JOIN jualdtl jd ON b.idbarang = jd.idbarang AND b.idtenant = jd.idtenant
      LEFT JOIN jual j ON jd.idjual = j.idjual AND j.idtenant = jd.idtenant AND j.idlokasi = ?`;
    const params = [ctx.idlokasi];
    const conditions = [];
    if (tglwal) { conditions.push('j.tgltrans >= ?'); params.push(tglwal); }
    if (tglakhir) { conditions.push('j.tgltrans <= ?'); params.push(tglakhir); }
    if (idbarang) { conditions.push('b.idbarang = ?'); params.push(idbarang); }
    if (conditions.length > 0) { sql += ' WHERE ' + conditions.join(' AND '); }
    sql += ' GROUP BY b.idbarang, b.kodebarang, b.namabarang, b.satuankecil ORDER BY total_nilai DESC';

    const rows = await tenantQuery(sql, params);
    const grandTotal = rows.reduce((sum, r) => sum + parseFloat(r.total_nilai || 0), 0);

    if (format === 'html') {
      const [[tenant]] = await pool.query('SELECT * FROM tenant WHERE idtenant = ?', [ctx.idtenant]);
      return res.render('laporan_sales_per_barang', {
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

exports.pembelian = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tglwal, tglakhir, idsupplier } = req.query;
    const format = req.query.format || 'json';

    let sql = `SELECT b.*, s.namasupplier FROM beli b
      LEFT JOIN supplier s ON b.idsupplier = s.idsupplier AND s.idtenant = b.idtenant
      WHERE 1=1`;
    const params = [];
    sql += ' AND b.idlokasi = ?'; params.push(ctx.idlokasi);
    if (tglwal) { sql += ' AND b.tgltrans >= ?'; params.push(tglwal); }
    if (tglakhir) { sql += ' AND b.tgltrans <= ?'; params.push(tglakhir); }
    if (idsupplier) { sql += ' AND b.idsupplier = ?'; params.push(idsupplier); }
    sql += ' ORDER BY b.tgltrans DESC, b.idbeli DESC';

    const rows = await tenantQuery(sql, params);
    const totalPembelian = rows.reduce((sum, r) => sum + parseFloat(r.grandtotal || 0), 0);

    if (format === 'html') {
      const [[tenant]] = await pool.query('SELECT * FROM tenant WHERE idtenant = ?', [ctx.idtenant]);
      return res.render('laporan_pembelian', {
        data: rows, totalPembelian,
        tglwal: tglwal || '-', tglakhir: tglakhir || '-',
        namatoko: tenant?.namatenant || 'Grfyn POS',
        alamat: '', hp: '', logo: tenant?.logo || '',
        tglcetak: new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })
      });
    }

    res.json({ data: rows, totalPembelian });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

exports.salesPerLokasi = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tglwal, tglakhir } = req.query;
    const format = req.query.format || 'json';

    let sql = `SELECT l.idlokasi, l.kodelokasi, l.namalokasi,
      COUNT(CASE WHEN j.status != 'VOID' THEN j.idjual END) as total_transaksi,
      COALESCE(SUM(CASE WHEN j.status != 'VOID' THEN j.grandtotal ELSE 0 END), 0) as total_penjualan
      FROM lokasi l
      LEFT JOIN jual j ON l.idlokasi = j.idlokasi AND j.idtenant = l.idtenant`;
    const params = [];
    const conditions = [];
    if (tglwal) { conditions.push('j.tgltrans >= ?'); params.push(tglwal); }
    if (tglakhir) { conditions.push('j.tgltrans <= ?'); params.push(tglakhir); }
    if (conditions.length > 0) { sql += ' AND ' + conditions.join(' AND '); }
    sql += ' WHERE l.idtenant = ? GROUP BY l.idlokasi, l.kodelokasi, l.namalokasi ORDER BY total_penjualan DESC';
    params.push(ctx.idtenant);

    const rows = await tenantQuery(sql, params);
    const grandTotal = rows.reduce((sum, r) => sum + parseFloat(r.total_penjualan || 0), 0);

    if (format === 'html') {
      const [[tenant]] = await pool.query('SELECT * FROM tenant WHERE idtenant = ?', [ctx.idtenant]);
      return res.render('laporan_sales_per_lokasi', {
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

exports.pembelianPerSupplier = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tglwal, tglakhir, idsupplier } = req.query;
    const format = req.query.format || 'json';

    let sql = `SELECT s.idsupplier, s.kodesupplier, s.namasupplier,
      COUNT(b.idbeli) as total_transaksi,
      COALESCE(SUM(b.grandtotal), 0) as total_pembelian
      FROM supplier s
      LEFT JOIN beli b ON s.idsupplier = b.idsupplier AND b.idtenant = s.idtenant AND b.idlokasi = ?`;
    const params = [ctx.idlokasi];
    const conditions = [];
    if (tglwal) { conditions.push('b.tgltrans >= ?'); params.push(tglwal); }
    if (tglakhir) { conditions.push('b.tgltrans <= ?'); params.push(tglakhir); }
    if (idsupplier) { conditions.push('s.idsupplier = ?'); params.push(idsupplier); }
    if (conditions.length > 0) { sql += ' AND ' + conditions.join(' AND '); }
    sql += ' WHERE s.idtenant = ? GROUP BY s.idsupplier, s.kodesupplier, s.namasupplier ORDER BY total_pembelian DESC';
    params.push(ctx.idtenant);

    const rows = await tenantQuery(sql, params);
    const grandTotal = rows.reduce((sum, r) => sum + parseFloat(r.total_pembelian || 0), 0);

    if (format === 'html') {
      const [[tenant]] = await pool.query('SELECT * FROM tenant WHERE idtenant = ?', [ctx.idtenant]);
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
      const [[tenant]] = await pool.query('SELECT * FROM tenant WHERE idtenant = ?', [ctx.idtenant]);
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
    if (idbarang) { conditions.push('b.idbarang = ?'); params.push(idbarang); }
    if (conditions.length > 0) { sql += ' WHERE ' + conditions.join(' AND '); }
    sql += ' GROUP BY b.idbarang, b.kodebarang, b.namabarang, b.satuankecil ORDER BY total_nilai DESC';

    const rows = await tenantQuery(sql, params);
    const grandTotal = rows.reduce((sum, r) => sum + parseFloat(r.total_nilai || 0), 0);

    if (format === 'html') {
      const [[tenant]] = await pool.query('SELECT * FROM tenant WHERE idtenant = ?', [ctx.idtenant]);
      return res.render('laporan_pembelian_per_barang', {
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
    if (idsupplier) { sql += ' AND idsupplier = ?'; params.push(idsupplier); }

    const rows = await tenantQuery(sql, params);

    if (req.query.format === 'html') {
      const [[tenant]] = await pool.query('SELECT * FROM tenant WHERE idtenant = ?', [ctx.idtenant]);
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

exports.stok = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tgl } = req.query;
    const format = req.query.format || 'json';

    const [[latestSaldo]] = await pool.query(
      'SELECT idsaldostok, kodesaldostok, tgltrans FROM saldostok WHERE idtenant = ? AND idlokasi = ? ORDER BY tgltrans DESC, idsaldostok DESC LIMIT 1',
      [ctx.idtenant, ctx.idlokasi]
    );

    let sql;
    const params = [];

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
      const [[tenant]] = await pool.query('SELECT * FROM tenant WHERE idtenant = ?', [ctx.idtenant]);
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
      const [[tenant]] = await pool.query('SELECT * FROM tenant WHERE idtenant = ?', [ctx.idtenant]);
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

exports.rekapSales = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tglwal, tglakhir, idcustomer } = req.query;

    let sql = `SELECT
      COUNT(CASE WHEN status != 'VOID' THEN 1 END) as total_transaksi,
      COALESCE(SUM(CASE WHEN status != 'VOID' THEN grandtotal ELSE 0 END), 0) as total_penjualan,
      COALESCE(SUM(CASE WHEN status != 'VOID' AND metodbayar = 'TUNAI' THEN grandtotal ELSE 0 END), 0) as total_tunai,
      COALESCE(SUM(CASE WHEN status != 'VOID' AND metodbayar != 'TUNAI' THEN grandtotal ELSE 0 END), 0) as total_nontunai,
      COALESCE(SUM(CASE WHEN status != 'VOID' THEN bayar ELSE 0 END), 0) as total_sudah_dibayar,
      COALESCE(SUM(CASE WHEN status = 'AKTIF' THEN GREATEST(grandtotal - bayar, 0) ELSE 0 END), 0) as total_piutang
      FROM jual WHERE idlokasi = ?`;
    const params = [ctx.idlokasi];
    if (tglwal) { sql += ' AND tgltrans >= ?'; params.push(tglwal); }
    if (tglakhir) { sql += ' AND tgltrans <= ?'; params.push(tglakhir); }
    if (idcustomer) { sql += ' AND idcustomer = ?'; params.push(idcustomer); }

    const rows = await tenantQuery(sql, params);

    if (req.query.format === 'html') {
      const [[tenant]] = await pool.query('SELECT * FROM tenant WHERE idtenant = ?', [ctx.idtenant]);
      return res.render('laporan_sales_rekap', {
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
      const [[tenant]] = await pool.query('SELECT * FROM tenant WHERE idtenant = ?', [ctx.idtenant]);
      const [[lokasi]] = await pool.query('SELECT * FROM lokasi WHERE idlokasi = ? AND idtenant = ?', [ctx.idlokasi, ctx.idtenant]);
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
      const [[tenant]] = await pool.query('SELECT * FROM tenant WHERE idtenant = ?', [ctx.idtenant]);
      const [[lokasi]] = await pool.query('SELECT * FROM lokasi WHERE idlokasi = ? AND idtenant = ?', [ctx.idlokasi, ctx.idtenant]);
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
