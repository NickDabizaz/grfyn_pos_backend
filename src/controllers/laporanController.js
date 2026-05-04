const pool = require('../config/db');

// ============ SALES TRANSACTION REPORT ============
exports.salesTransaksi = async (req, res) => {
  try {
    const { tglwal, tglakhir } = req.query;
    const format = req.query.format || 'json';

    let sql = `SELECT j.*, c.namacustomer, u.username as kasir
      FROM jual j
      LEFT JOIN customer c ON j.idcustomer = c.idcustomer
      LEFT JOIN users u ON j.idkasir = u.iduser
      WHERE 1=1`;
    const params = [];
    if (tglwal) { sql += ' AND j.tgltrans >= ?'; params.push(tglwal); }
    if (tglakhir) { sql += ' AND j.tgltrans <= ?'; params.push(tglakhir); }
    sql += ' ORDER BY j.tgltrans DESC, j.idjual DESC';

    const [rows] = await pool.query(sql, params);

    // Calculate totals
    let totalTransaksi = rows.length;
    let totalPenjualan = rows.reduce((sum, r) => sum + parseFloat(r.grandtotal || 0), 0);

    if (format === 'html') {
      const [user] = await pool.query('SELECT * FROM users LIMIT 1');
      return res.render('laporan_sales_transaksi', {
        data: rows,
        totalTransaksi,
        totalPenjualan,
        tglwal: tglwal || '-',
        tglakhir: tglakhir || '-',
        namatoko: user[0]?.namatoko || 'Grfyn POS',
        alamat: user[0]?.alamat || '',
        hp: user[0]?.hp || '',
        logo: user[0]?.logo || '',
        tglcetak: new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })
      });
    }

    res.json({ data: rows, totalTransaksi, totalPenjualan });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ============ SALES PER CUSTOMER ============
exports.salesPerCustomer = async (req, res) => {
  try {
    const { tglwal, tglakhir, idcustomer } = req.query;
    const format = req.query.format || 'json';

    let sql = `SELECT c.idcustomer, c.kodecustomer, c.namacustomer,
      COUNT(j.idjual) as total_transaksi,
      COALESCE(SUM(j.grandtotal), 0) as total_penjualan
      FROM customer c
      LEFT JOIN jual j ON c.idcustomer = j.idcustomer`;
    const params = [];
    const conditions = [];
    if (tglwal) { conditions.push('j.tgltrans >= ?'); params.push(tglwal); }
    if (tglakhir) { conditions.push('j.tgltrans <= ?'); params.push(tglakhir); }
    if (conditions.length > 0) {
      sql += ' AND ' + conditions.join(' AND ');
    }
    if (idcustomer) {
      sql += ' WHERE c.idcustomer = ?';
      params.push(idcustomer);
    }
    sql += ' GROUP BY c.idcustomer, c.kodecustomer, c.namacustomer ORDER BY total_penjualan DESC';

    const [rows] = await pool.query(sql, params);
    const grandTotal = rows.reduce((sum, r) => sum + parseFloat(r.total_penjualan || 0), 0);

    if (format === 'html') {
      const [user] = await pool.query('SELECT * FROM users LIMIT 1');
      return res.render('laporan_sales_per_customer', {
        data: rows,
        grandTotal,
        tglwal: tglwal || '-',
        tglakhir: tglakhir || '-',
        namatoko: user[0]?.namatoko || 'Grfyn POS',
        alamat: user[0]?.alamat || '',
        hp: user[0]?.hp || '',
        logo: user[0]?.logo || '',
        tglcetak: new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })
      });
    }

    res.json({ data: rows, grandTotal });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ============ SALES PER BARANG ============
exports.salesPerBarang = async (req, res) => {
  try {
    const { tglwal, tglakhir, idbarang } = req.query;
    const format = req.query.format || 'json';

    let sql = `SELECT b.idbarang, b.kodebarang, b.namabarang, b.satuan,
      COALESCE(SUM(jd.jml), 0) as total_qty,
      COALESCE(SUM(jd.subtotal), 0) as total_nilai
      FROM barang b
      LEFT JOIN jualdtl jd ON b.idbarang = jd.idbarang
      LEFT JOIN jual j ON jd.idjual = j.idjual`;
    const params = [];
    const conditions = [];
    if (tglwal) { conditions.push('j.tgltrans >= ?'); params.push(tglwal); }
    if (tglakhir) { conditions.push('j.tgltrans <= ?'); params.push(tglakhir); }
    if (idbarang) { conditions.push('b.idbarang = ?'); params.push(idbarang); }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' GROUP BY b.idbarang, b.kodebarang, b.namabarang, b.satuan ORDER BY total_nilai DESC';

    const [rows] = await pool.query(sql, params);
    const grandTotal = rows.reduce((sum, r) => sum + parseFloat(r.total_nilai || 0), 0);

    if (format === 'html') {
      const [user] = await pool.query('SELECT * FROM users LIMIT 1');
      return res.render('laporan_sales_per_barang', {
        data: rows,
        grandTotal,
        tglwal: tglwal || '-',
        tglakhir: tglakhir || '-',
        namatoko: user[0]?.namatoko || 'Grfyn POS',
        alamat: user[0]?.alamat || '',
        hp: user[0]?.hp || '',
        logo: user[0]?.logo || '',
        tglcetak: new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })
      });
    }

    res.json({ data: rows, grandTotal });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ============ PEMBELIAN REPORT ============
exports.pembelian = async (req, res) => {
  try {
    const { tglwal, tglakhir, idsupplier } = req.query;
    const format = req.query.format || 'json';

    let sql = `SELECT b.*, s.namasupplier, u.username as kasir
      FROM beli b
      LEFT JOIN supplier s ON b.idsupplier = s.idsupplier
      LEFT JOIN users u ON b.idkasir = u.iduser
      WHERE 1=1`;
    const params = [];
    if (tglwal) { sql += ' AND b.tgltrans >= ?'; params.push(tglwal); }
    if (tglakhir) { sql += ' AND b.tgltrans <= ?'; params.push(tglakhir); }
    if (idsupplier) { sql += ' AND b.idsupplier = ?'; params.push(idsupplier); }
    sql += ' ORDER BY b.tgltrans DESC, b.idbeli DESC';

    const [rows] = await pool.query(sql, params);
    const totalPembelian = rows.reduce((sum, r) => sum + parseFloat(r.grandtotal || 0), 0);

    if (format === 'html') {
      const [user] = await pool.query('SELECT * FROM users LIMIT 1');
      return res.render('laporan_pembelian', {
        data: rows,
        totalPembelian,
        tglwal: tglwal || '-',
        tglakhir: tglakhir || '-',
        namatoko: user[0]?.namatoko || 'Grfyn POS',
        alamat: user[0]?.alamat || '',
        hp: user[0]?.hp || '',
        logo: user[0]?.logo || '',
        tglcetak: new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })
      });
    }

    res.json({ data: rows, totalPembelian });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ============ STOCK REPORT ============
exports.stok = async (req, res) => {
  try {
    const { tgl } = req.query;
    const format = req.query.format || 'json';

    // Get latest saldostok
    const [[latestSaldo]] = await pool.query(
      'SELECT idsaldostok, kodesaldostok, tgltrans FROM saldostok ORDER BY tgltrans DESC, idsaldostok DESC LIMIT 1'
    );

    let sql;
    const params = [];

    if (latestSaldo) {
      sql = `SELECT b.idbarang, b.kodebarang, b.namabarang, b.satuan, b.stokmin,
        COALESCE(sd.jml, 0) + COALESCE(km.masuk, 0) - COALESCE(km.keluar, 0) as stok
        FROM barang b
        LEFT JOIN saldostokdtl sd ON sd.idbarang = b.idbarang AND sd.idsaldostok = ?
        LEFT JOIN (
          SELECT idbarang,
            COALESCE(SUM(CASE WHEN jenis = 'M' THEN jml ELSE 0 END), 0) as masuk,
            COALESCE(SUM(CASE WHEN jenis = 'K' THEN jml ELSE 0 END), 0) as keluar
          FROM kartustok WHERE tgltrans > ? GROUP BY idbarang
        ) km ON km.idbarang = b.idbarang
        WHERE b.status = 1 ORDER BY b.namabarang`;
      params.push(latestSaldo.idsaldostok, latestSaldo.tgltrans);
    } else {
      sql = `SELECT b.idbarang, b.kodebarang, b.namabarang, b.satuan, b.stokmin,
        COALESCE(m.total, 0) - COALESCE(k.total, 0) as stok
        FROM barang b
        LEFT JOIN (SELECT idbarang, SUM(jml) as total FROM kartustok WHERE jenis = 'M' GROUP BY idbarang) m ON b.idbarang = m.idbarang
        LEFT JOIN (SELECT idbarang, SUM(jml) as total FROM kartustok WHERE jenis = 'K' GROUP BY idbarang) k ON b.idbarang = k.idbarang
        WHERE b.status = 1 ORDER BY b.namabarang`;
    }

    const [rows] = await pool.query(sql, params);
    const totalBarang = rows.length;
    const totalStok = rows.reduce((sum, r) => sum + (parseInt(r.stok) || 0), 0);

    if (format === 'html') {
      const [user] = await pool.query('SELECT * FROM users LIMIT 1');
      return res.render('laporan_stok', {
        data: rows,
        totalBarang,
        totalStok,
        periodSaldo: latestSaldo ? latestSaldo.tgltrans : '-',
        namatoko: user[0]?.namatoko || 'Grfyn POS',
        alamat: user[0]?.alamat || '',
        hp: user[0]?.hp || '',
        logo: user[0]?.logo || '',
        tglcetak: new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })
      });
    }

    res.json({ data: rows, totalBarang, totalStok, periodSaldo: latestSaldo?.tgltrans });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ============ KARTU STOK ============
exports.kartuStok = async (req, res) => {
  try {
    const { idbarang, tglwal, tglakhir } = req.query;
    const format = req.query.format || 'json';

    let sql = `SELECT ks.*, b.kodebarang, b.namabarang, b.satuan
      FROM kartustok ks
      LEFT JOIN barang b ON ks.idbarang = b.idbarang
      WHERE 1=1`;
    const params = [];
    if (idbarang) { sql += ' AND ks.idbarang = ?'; params.push(idbarang); }
    if (tglwal) { sql += ' AND ks.tgltrans >= ?'; params.push(tglwal); }
    if (tglakhir) { sql += ' AND ks.tgltrans <= ?'; params.push(tglakhir); }
    sql += ' ORDER BY ks.tgltrans ASC, ks.idkartustok ASC';

    const [rows] = await pool.query(sql, params);

    if (format === 'html') {
      const [user] = await pool.query('SELECT * FROM users LIMIT 1');
      return res.render('laporan_kartu_stok', {
        data: rows,
        tglwal: tglwal || '-',
        tglakhir: tglakhir || '-',
        namatoko: user[0]?.namatoko || 'Grfyn POS',
        alamat: user[0]?.alamat || '',
        hp: user[0]?.hp || '',
        logo: user[0]?.logo || '',
        tglcetak: new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })
      });
    }

    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ============ STRUK ============
exports.struk = async (req, res) => {
  try {
    const { id } = req.params;
    const format = req.query.format || 'json';

    const [[jual]] = await pool.query(
      `SELECT j.*, c.namacustomer, c.alamat as alamatcustomer, u.username as kasir
       FROM jual j
       LEFT JOIN customer c ON j.idcustomer = c.idcustomer
       LEFT JOIN users u ON j.idkasir = u.iduser
       WHERE j.idjual = ?`,
      [id]
    );
    if (!jual) return res.status(404).json({ message: 'Transaksi tidak ditemukan' });

    const [detail] = await pool.query(
      `SELECT jd.*, b.namabarang, b.kodebarang, b.satuan
       FROM jualdtl jd
       LEFT JOIN barang b ON jd.idbarang = b.idbarang
       WHERE jd.idjual = ?`,
      [id]
    );

    if (format === 'html') {
      const [user] = await pool.query('SELECT * FROM users LIMIT 1');
      return res.render('struk', {
        jual,
        detail,
        namatoko: user[0]?.namatoko || 'Grfyn POS',
        alamat: user[0]?.alamat || '',
        hp: user[0]?.hp || '',
        logo: user[0]?.logo || '',
        tglcetak: new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })
      });
    }

    res.json({ data: jual, detail });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ============ FAKTUR ============
exports.faktur = async (req, res) => {
  try {
    const { id } = req.params;
    const format = req.query.format || 'json';

    const [[jual]] = await pool.query(
      `SELECT j.*, c.namacustomer, c.alamat as alamatcustomer, c.hp as hpcustomer, u.username as kasir
       FROM jual j
       LEFT JOIN customer c ON j.idcustomer = c.idcustomer
       LEFT JOIN users u ON j.idkasir = u.iduser
       WHERE j.idjual = ?`,
      [id]
    );
    if (!jual) return res.status(404).json({ message: 'Transaksi tidak ditemukan' });

    const [detail] = await pool.query(
      `SELECT jd.*, b.namabarang, b.kodebarang, b.satuan
       FROM jualdtl jd
       LEFT JOIN barang b ON jd.idbarang = b.idbarang
       WHERE jd.idjual = ?`,
      [id]
    );

    if (format === 'html') {
      const [user] = await pool.query('SELECT * FROM users LIMIT 1');
      return res.render('faktur', {
        jual,
        detail,
        namatoko: user[0]?.namatoko || 'Grfyn POS',
        alamat: user[0]?.alamat || '',
        hp: user[0]?.hp || '',
        logo: user[0]?.logo || '',
        tglcetak: new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })
      });
    }

    res.json({ data: jual, detail });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
