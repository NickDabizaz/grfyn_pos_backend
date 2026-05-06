const { tenantQuery, getTenantContext } = require('../config/db');

exports.summary = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const today = new Date().toISOString().slice(0, 10);

    const salesToday = await tenantQuery(
      `SELECT COUNT(*) as total_transaksi, COALESCE(SUM(grandtotal), 0) as total_sales
       FROM jual WHERE tgltrans = ? AND idlokasi = ?`,
      [today, ctx.idlokasi]
    );

    const profit = await tenantQuery(
      `SELECT COALESCE(SUM((jd.harga - COALESCE(
        (SELECT hb.hargabeli FROM hargabeli hb WHERE hb.idbarang = jd.idbarang AND hb.idtenant = ? ORDER BY hb.tgltrans DESC, hb.idhargabeli DESC LIMIT 1), 0
      )) * jd.jml), 0) as laba_kotor
       FROM jualdtl jd
       JOIN jual j ON jd.idjual = j.idjual AND jd.idtenant = j.idtenant
       WHERE j.tgltrans = ? AND j.idlokasi = ?`,
      [ctx.idtenant, today, ctx.idlokasi]
    );

    const topProducts = await tenantQuery(
      `SELECT b.namabarang, SUM(jd.jml) as total_jml, SUM(jd.subtotal) as total_nilai
       FROM jualdtl jd
       JOIN jual j ON jd.idjual = j.idjual AND jd.idtenant = j.idtenant
       JOIN barang b ON jd.idbarang = b.idbarang AND b.idtenant = jd.idtenant
       WHERE j.tgltrans = ? AND j.idlokasi = ?
       GROUP BY jd.idbarang, b.namabarang ORDER BY total_jml DESC LIMIT 5`,
      [today, ctx.idlokasi]
    );

    const lowStock = await tenantQuery(
      `SELECT b.idbarang, b.namabarang, b.satuankecil, b.stokmin,
        COALESCE(m.total, 0) - COALESCE(k.total, 0) as stok
       FROM barang b
       LEFT JOIN (SELECT idbarang, SUM(jml) as total FROM kartustok WHERE jenis = 'M' AND idtenant = ? AND idlokasi = ? GROUP BY idbarang) m ON b.idbarang = m.idbarang
       LEFT JOIN (SELECT idbarang, SUM(jml) as total FROM kartustok WHERE jenis = 'K' AND idtenant = ? AND idlokasi = ? GROUP BY idbarang) k ON b.idbarang = k.idbarang
       WHERE b.status = 'AKTIF'
       HAVING stok <= b.stokmin ORDER BY stok ASC LIMIT 5`,
      [ctx.idtenant, ctx.idlokasi, ctx.idtenant, ctx.idlokasi]
    );

    res.json({
      total_transaksi: salesToday[0]?.total_transaksi || 0,
      total_sales: salesToday[0]?.total_sales || 0,
      laba_kotor: profit[0]?.laba_kotor || 0,
      top_products: topProducts,
      low_stock: lowStock
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.lowStock = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const rows = await tenantQuery(
      `SELECT b.idbarang, b.kodebarang, b.namabarang, b.satuankecil, b.stokmin,
        COALESCE(m.total, 0) - COALESCE(k.total, 0) as stok
       FROM barang b
       LEFT JOIN (SELECT idbarang, SUM(jml) as total FROM kartustok WHERE jenis = 'M' AND idtenant = ? AND idlokasi = ? GROUP BY idbarang) m ON b.idbarang = m.idbarang
       LEFT JOIN (SELECT idbarang, SUM(jml) as total FROM kartustok WHERE jenis = 'K' AND idtenant = ? AND idlokasi = ? GROUP BY idbarang) k ON b.idbarang = k.idbarang
       WHERE b.status = 'AKTIF'
       HAVING stok <= b.stokmin ORDER BY stok ASC`,
      [ctx.idtenant, ctx.idlokasi, ctx.idtenant, ctx.idlokasi]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.chart = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const days = parseInt(req.query.days) || 7;
    const rows = await tenantQuery(
      `SELECT tgltrans, SUM(grandtotal) as total
       FROM jual WHERE tgltrans >= DATE_SUB(CURDATE(), INTERVAL ? DAY) AND idlokasi = ?
       GROUP BY tgltrans ORDER BY tgltrans ASC`,
      [days - 1, ctx.idlokasi]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
