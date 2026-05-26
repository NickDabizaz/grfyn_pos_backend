const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { tenantQuery, getTenantContext } = require('../../config/db');
const logger = require('../../lib/logger');

function todayStr() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

function formatRupiah(num) {
  return Number(num || 0).toLocaleString('id-ID');
}

async function streamExcel(res, filename, headers, rows, formatters) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Grfyn POS';
  const sheet = workbook.addWorksheet('Laporan');

  sheet.addRow(headers).eachCell(cell => {
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
    cell.border = { bottom: { style: 'thin' } };
  });

  rows.forEach((row, i) => {
    const values = formatters.map(fn => fn(row, i));
    sheet.addRow(values);
  });

  sheet.columns.forEach(col => { col.width = Math.max(12, col.width || 12); });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);
  res.end();
}

function streamPdf(res, filename, title, period, headers, rows, formatters) {
  const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);

  doc.fontSize(14).font('Helvetica-Bold').text(title, { align: 'center' });
  if (period) doc.fontSize(10).font('Helvetica').text(period, { align: 'center' });
  doc.moveDown(0.5);

  const colWidths = headers.map(() => Math.floor((doc.page.width - 60) / headers.length));
  let x = 30;
  const headerY = doc.y;

  doc.font('Helvetica-Bold').fontSize(9);
  headers.forEach((h, i) => {
    doc.text(h, x, headerY, { width: colWidths[i], ellipsis: true });
    x += colWidths[i];
  });
  doc.moveDown(0.3);
  doc.moveTo(30, doc.y).lineTo(doc.page.width - 30, doc.y).stroke();
  doc.moveDown(0.2);

  doc.font('Helvetica').fontSize(8);
  rows.forEach((row, idx) => {
    if (doc.y > doc.page.height - 60) {
      doc.addPage();
      doc.font('Helvetica').fontSize(8);
    }
    x = 30;
    const rowY = doc.y;
    formatters.forEach((fn, i) => {
      doc.text(String(fn(row, idx) ?? ''), x, rowY, { width: colWidths[i], ellipsis: true });
      x += colWidths[i];
    });
    doc.moveDown(0.3);
  });

  doc.end();
}

exports.exportSalesTransaksi = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tglawal, tglakhir, search, idcustomer, format = 'excel' } = req.query;
    let sql = `SELECT j.kodejual, j.tgltrans, COALESCE(c.namacustomer, 'UMUM') as namacustomer,
        j.grandtotal, j.bayar, j.status, j.jalurpenjualan
      FROM jual j LEFT JOIN customer c ON j.idcustomer = c.idcustomer AND c.idtenant = j.idtenant
      WHERE j.idlokasi = ?`;
    const params = [ctx.idlokasi];
    if (tglawal) { sql += ' AND j.tgltrans >= ?'; params.push(tglawal); }
    if (tglakhir) { sql += ' AND j.tgltrans <= ?'; params.push(tglakhir); }
    if (idcustomer) { sql += ' AND j.idcustomer = ?'; params.push(idcustomer); }
    if (search) { sql += ' AND j.kodejual LIKE ?'; params.push(`%${search}%`); }
    sql += ' ORDER BY j.tgltrans DESC LIMIT 5000';
    const rows = await tenantQuery(sql, params);

    const headers = ['No', 'Kode Jual', 'Tanggal', 'Customer', 'Grand Total', 'Bayar', 'Status', 'Jalur'];
    const formatters = [
      (r, i) => i + 1,
      r => r.kodejual,
      r => r.tgltrans,
      r => r.namacustomer,
      r => format === 'excel' ? Number(r.grandtotal) : formatRupiah(r.grandtotal),
      r => format === 'excel' ? Number(r.bayar) : formatRupiah(r.bayar),
      r => r.status,
      r => r.jalurpenjualan,
    ];
    const period = tglawal && tglakhir ? `${tglawal} s/d ${tglakhir}` : '';

    if (format === 'pdf') return streamPdf(res, `laporan-penjualan-${todayStr()}.pdf`, 'Laporan Penjualan', period, headers, rows, formatters);
    await streamExcel(res, `laporan-penjualan-${todayStr()}.xlsx`, headers, rows, formatters);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

exports.exportSalesPerBarang = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tglawal, tglakhir, format = 'excel' } = req.query;
    let sql = `SELECT b.kodebarang, b.namabarang, b.satuankecil,
        SUM(jd.jml) as total_qty, SUM(jd.subtotal) as total_penjualan
      FROM jualdtl jd
      LEFT JOIN barang b ON jd.idbarang = b.idbarang AND b.idtenant = jd.idtenant
      JOIN jual j ON jd.idjual = j.idjual
      WHERE j.idlokasi = ? AND j.status = 'APPROVED'`;
    const params = [ctx.idlokasi];
    if (tglawal) { sql += ' AND j.tgltrans >= ?'; params.push(tglawal); }
    if (tglakhir) { sql += ' AND j.tgltrans <= ?'; params.push(tglakhir); }
    sql += ' GROUP BY jd.idbarang ORDER BY total_penjualan DESC LIMIT 5000';
    const rows = await tenantQuery(sql, params);

    const headers = ['No', 'Kode Barang', 'Nama Barang', 'Satuan', 'Total Qty', 'Total Penjualan'];
    const formatters = [
      (r, i) => i + 1,
      r => r.kodebarang,
      r => r.namabarang,
      r => r.satuankecil,
      r => Number(r.total_qty),
      r => format === 'excel' ? Number(r.total_penjualan) : formatRupiah(r.total_penjualan),
    ];
    const period = tglawal && tglakhir ? `${tglawal} s/d ${tglakhir}` : '';

    if (format === 'pdf') return streamPdf(res, `laporan-penjualan-per-barang-${todayStr()}.pdf`, 'Laporan Penjualan per Barang', period, headers, rows, formatters);
    await streamExcel(res, `laporan-penjualan-per-barang-${todayStr()}.xlsx`, headers, rows, formatters);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

exports.exportPembelian = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tglawal, tglakhir, format = 'excel' } = req.query;
    let sql = `SELECT b.kodebeli, b.tgltrans, COALESCE(s.namasupplier, '-') as namasupplier,
        b.grandtotal, b.bayar, b.status
      FROM beli b LEFT JOIN supplier s ON b.idsupplier = s.idsupplier AND s.idtenant = b.idtenant
      WHERE b.idlokasi = ?`;
    const params = [ctx.idlokasi];
    if (tglawal) { sql += ' AND b.tgltrans >= ?'; params.push(tglawal); }
    if (tglakhir) { sql += ' AND b.tgltrans <= ?'; params.push(tglakhir); }
    sql += ' ORDER BY b.tgltrans DESC LIMIT 5000';
    const rows = await tenantQuery(sql, params);

    const headers = ['No', 'Kode Beli', 'Tanggal', 'Supplier', 'Grand Total', 'Bayar', 'Status'];
    const formatters = [
      (r, i) => i + 1,
      r => r.kodebeli,
      r => r.tgltrans,
      r => r.namasupplier,
      r => format === 'excel' ? Number(r.grandtotal) : formatRupiah(r.grandtotal),
      r => format === 'excel' ? Number(r.bayar) : formatRupiah(r.bayar),
      r => r.status,
    ];
    const period = tglawal && tglakhir ? `${tglawal} s/d ${tglakhir}` : '';

    if (format === 'pdf') return streamPdf(res, `laporan-pembelian-${todayStr()}.pdf`, 'Laporan Pembelian', period, headers, rows, formatters);
    await streamExcel(res, `laporan-pembelian-${todayStr()}.xlsx`, headers, rows, formatters);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

exports.exportStok = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { format = 'excel' } = req.query;
    const rows = await tenantQuery(
      `SELECT b.kodebarang, b.namabarang, b.satuankecil,
        COALESCE(SUM(CASE WHEN ks.jenis='M' THEN ks.jml ELSE -ks.jml END), 0) as stok,
        b.stokmin
       FROM barang b
       LEFT JOIN kartustok ks ON ks.idbarang = b.idbarang AND ks.idlokasi = ? AND ks.idtenant = b.idtenant
       WHERE b.status = 'AKTIF'
       GROUP BY b.idbarang ORDER BY b.kodebarang`,
      [ctx.idlokasi]
    );

    const headers = ['No', 'Kode Barang', 'Nama Barang', 'Satuan', 'Stok', 'Stok Min', 'Kondisi'];
    const formatters = [
      (r, i) => i + 1,
      r => r.kodebarang,
      r => r.namabarang,
      r => r.satuankecil,
      r => Number(r.stok),
      r => Number(r.stokmin),
      r => Number(r.stok) <= Number(r.stokmin) ? 'KRITIS' : 'AMAN',
    ];

    if (format === 'pdf') return streamPdf(res, `laporan-stok-${todayStr()}.pdf`, 'Laporan Stok', '', headers, rows, formatters);
    await streamExcel(res, `laporan-stok-${todayStr()}.xlsx`, headers, rows, formatters);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

exports.exportKartuStok = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tglawal, tglakhir, idbarang, format = 'excel' } = req.query;
    let sql = `SELECT ks.tgltrans, ks.kodetrans, ks.jenistransaksi, b.namabarang, b.satuankecil,
        ks.jml, ks.jenis
      FROM kartustok ks
      LEFT JOIN barang b ON ks.idbarang = b.idbarang AND b.idtenant = ks.idtenant
      WHERE ks.idlokasi = ?`;
    const params = [ctx.idlokasi];
    if (idbarang) { sql += ' AND ks.idbarang = ?'; params.push(idbarang); }
    if (tglawal) { sql += ' AND ks.tgltrans >= ?'; params.push(tglawal); }
    if (tglakhir) { sql += ' AND ks.tgltrans <= ?'; params.push(tglakhir); }
    sql += ' ORDER BY ks.tgltrans, ks.idkartustok LIMIT 10000';
    const rows = await tenantQuery(sql, params);

    const headers = ['No', 'Tanggal', 'Kode Trans', 'Jenis Transaksi', 'Barang', 'Satuan', 'Qty', 'IN/OUT'];
    const formatters = [
      (r, i) => i + 1,
      r => r.tgltrans,
      r => r.kodetrans,
      r => r.jenistransaksi,
      r => r.namabarang,
      r => r.satuankecil,
      r => Number(r.jml),
      r => r.jenis === 'M' ? 'IN' : 'OUT',
    ];
    const period = tglawal && tglakhir ? `${tglawal} s/d ${tglakhir}` : '';

    if (format === 'pdf') return streamPdf(res, `kartu-stok-${todayStr()}.pdf`, 'Kartu Stok', period, headers, rows, formatters);
    await streamExcel(res, `kartu-stok-${todayStr()}.xlsx`, headers, rows, formatters);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};
