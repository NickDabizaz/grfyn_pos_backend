/**
 * Controller untuk import/export data via CSV.
 * Menyediakan endpoint export (barang, customer, supplier, pembelian, penjualan),
 * import data dari CSV, dan download template CSV.
 * Endpoint: GET /api/impor/export/*, GET /api/impor/template/*, POST /api/impor/import/*
 */
const { pool, getConnection, getTenantContext, tenantQuery, tenantExecute } = require('../config/db');
const fs = require('fs');
const logger = require('../lib/logger');

// Parse konten CSV menjadi array of objects (header sebagai key)
function parseCSV(content) {
  const lines = content.replace(/\r/g, '').split('\n').filter(l => l.trim());
  if (!lines.length) return { headers: [], rows: [] };
  const delimiter = lines[0].includes(';') ? ';' : ',';
  const headers = lines[0].split(delimiter).map(h => h.trim().toLowerCase());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(delimiter).map(v => v.trim());
    if (vals.length < headers.length) continue;
    const row = {};
    headers.forEach((h, idx) => { row[h] = vals[idx] || ''; });
    rows.push(row);
  }
  return { headers, rows };
}

// Generate CSV string dari headers dan rows (dengan BOM UTF-8)
function generateCSV(headers, rows) {
  let csv = '\uFEFF';
  csv += headers.join(',') + '\n';
  for (const row of rows) {
    const escaped = headers.map(h => {
      const val = String(row[h] !== undefined ? row[h] : '');
      if (val.includes(',') || val.includes('"') || val.includes('\n')) {
        return '"' + val.replace(/"/g, '""') + '"';
      }
      return val;
    });
    csv += escaped.join(',') + '\n';
  }
  return csv;
}

// Kirim response CSV ke client dengan header attachment
function sendCSV(res, filename, headers, rows) {
  const csv = generateCSV(headers, rows);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

// GET /api/impor/export/barang — Export data barang ke CSV
exports.exportBarang = async (req, res) => {
  try {
    const ctx = getTenantContext();
    let sql = `SELECT b.kodebarang, b.namabarang, b.satuanbesar, b.satuansedang, b.satuankecil,
      b.konversi1, b.konversi2, b.jenis, b.stokmin, b.status,
      (SELECT hargabeli FROM hargabeli WHERE idbarang = b.idbarang AND idtenant = b.idtenant ORDER BY tgltrans DESC, idhargabeli DESC LIMIT 1) as hargabeli,
      (SELECT hargajual FROM hargajual WHERE idbarang = b.idbarang AND idtenant = b.idtenant ORDER BY tgltrans DESC, idhargajual DESC LIMIT 1) as hargajual
    FROM barang b ORDER BY b.kodebarang`;
    const rows = await tenantQuery(sql);
    sendCSV(res, 'barang.csv', ['kodebarang', 'namabarang', 'satuanbesar', 'satuansedang', 'satuankecil', 'konversi1', 'konversi2', 'jenis', 'stokmin', 'status', 'hargabeli', 'hargajual'], rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /api/impor/export/customer — Export data customer ke CSV
exports.exportCustomer = async (req, res) => {
  try {
    let sql = 'SELECT kodecustomer, namacustomer, alamat, hp FROM customer ORDER BY idcustomer';
    const rows = await tenantQuery(sql);
    sendCSV(res, 'customer.csv', ['kodecustomer', 'namacustomer', 'alamat', 'hp'], rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /api/impor/export/supplier — Export data supplier ke CSV
exports.exportSupplier = async (req, res) => {
  try {
    let sql = 'SELECT kodesupplier, namasupplier, alamat, hp FROM supplier ORDER BY idsupplier';
    const rows = await tenantQuery(sql);
    sendCSV(res, 'supplier.csv', ['kodesupplier', 'namasupplier', 'alamat', 'hp'], rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /api/impor/export/beli — Export data pembelian ke CSV
exports.exportBeli = async (req, res) => {
  try {
    const ctx = getTenantContext();
    let sql = `SELECT b.kodebeli, b.tgltrans, s.kodesupplier, s.namasupplier,
      br.kodebarang, br.namabarang, bd.jml, bd.harga, bd.ppn, bd.diskon, bd.subtotal,
      b.grandtotal, b.bayar, b.status
    FROM belidtl bd
    JOIN beli b ON bd.idbeli = b.idbeli AND bd.idtenant = b.idtenant
    LEFT JOIN supplier s ON b.idsupplier = s.idsupplier AND s.idtenant = b.idtenant
    LEFT JOIN barang br ON bd.idbarang = br.idbarang AND br.idtenant = bd.idtenant
    WHERE b.idlokasi = ? ORDER BY b.tgltrans DESC, b.idbeli DESC`;
    const rows = await tenantQuery(sql, [ctx.idlokasi]);
    sendCSV(res, 'pembelian.csv', ['kodebeli', 'tgltrans', 'kodesupplier', 'namasupplier', 'kodebarang', 'namabarang', 'jml', 'harga', 'ppn', 'diskon', 'subtotal', 'grandtotal', 'bayar', 'status'], rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /api/impor/export/jual — Export data penjualan ke CSV
exports.exportJual = async (req, res) => {
  try {
    const ctx = getTenantContext();
    let sql = `SELECT j.kodejual, j.tgltrans, c.kodecustomer, c.namacustomer,
      br.kodebarang, br.namabarang, jd.jml, jd.harga, jd.ppn, jd.diskon, jd.subtotal,
      j.grandtotal, j.bayar, j.kembali, j.status
    FROM jualdtl jd
    JOIN jual j ON jd.idjual = j.idjual AND jd.idtenant = j.idtenant
    LEFT JOIN customer c ON j.idcustomer = c.idcustomer AND c.idtenant = j.idtenant
    LEFT JOIN barang br ON jd.idbarang = br.idbarang AND br.idtenant = jd.idtenant
    WHERE j.idlokasi = ? ORDER BY j.tgltrans DESC, j.idjual DESC`;
    const rows = await tenantQuery(sql, [ctx.idlokasi]);
    sendCSV(res, 'penjualan.csv', ['kodejual', 'tgltrans', 'kodecustomer', 'namacustomer', 'kodebarang', 'namabarang', 'jml', 'harga', 'ppn', 'diskon', 'subtotal', 'grandtotal', 'bayar', 'kembali', 'status'], rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// POST /api/impor/import/barang — Import data barang dari file CSV
exports.importBarang = async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'File tidak ditemukan' });
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    const content = fs.readFileSync(req.file.path, 'utf-8');
    const { rows } = parseCSV(content);
    if (!rows.length) return res.status(400).json({ message: 'Data kosong' });

    await conn.beginTransaction();
    const today = new Date().toISOString().slice(0, 10);
    let success = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.namabarang) { errors.push({ row: i + 2, message: 'namabarang wajib diisi' }); continue; }

      // Generate kode barang otomatis (BRG0001, BRG0002, ...)
      try {
        let sqlMaxKode = 'SELECT MAX(kodebarang) as maxKode FROM barang WHERE idtenant = ?';
        const [[{ maxKode }]] = await conn.query(sqlMaxKode, [ctx.idtenant]);
        let num = 1;
        if (maxKode) { num = parseInt(maxKode.replace('BRG', '')) + 1; }
        const kodebarang = `BRG${String(num).padStart(4, '0')}`;

        // Insert barang dan harga beli/jual jika ada
        let sqlInsert = 'INSERT INTO barang (idtenant, kodebarang, namabarang, satuanbesar, satuansedang, satuankecil, konversi1, konversi2, jenis, stokmin, status, userentry) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
        const [result] = await conn.query(
          sqlInsert,
          [ctx.idtenant, kodebarang, r.namabarang, r.satuanbesar || '', r.satuansedang || '', r.satuankecil || '', parseInt(r.konversi1) || 0, parseInt(r.konversi2) || 0, r.jenis || 'BAHAN JADI', parseInt(r.stokmin) || 0, 'AKTIF', ctx.iduser]
        );
        const idbarang = result.insertId;

        if (r.hargabeli && parseFloat(r.hargabeli) > 0) {
          let sqlHbeli = 'INSERT INTO hargabeli (idtenant, idbarang, hargabeli, tgltrans) VALUES (?, ?, ?, ?)';
          await conn.query(sqlHbeli, [ctx.idtenant, idbarang, parseFloat(r.hargabeli), today]);
        }
        if (r.hargajual && parseFloat(r.hargajual) > 0) {
          let sqlHjual = 'INSERT INTO hargajual (idtenant, idbarang, hargajual, tgltrans) VALUES (?, ?, ?, ?)';
          await conn.query(sqlHjual, [ctx.idtenant, idbarang, parseFloat(r.hargajual), today]);
        }
        success++;
      } catch (e) {
        errors.push({ row: i + 2, message: e.message });
      }
    }

    await conn.commit();
    await logger.history('IMPORT_BARANG', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: `imported_${success}`, req });
    res.json({ message: `Berhasil import ${success} barang`, success, errors });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
    try { fs.unlinkSync(req.file.path); } catch (_) {}
  }
};

// POST /api/impor/import/customer — Import data customer dari file CSV
exports.importCustomer = async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'File tidak ditemukan' });
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    const content = fs.readFileSync(req.file.path, 'utf-8');
    const { rows } = parseCSV(content);
    if (!rows.length) return res.status(400).json({ message: 'Data kosong' });

    await conn.beginTransaction();
    let success = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.namacustomer) { errors.push({ row: i + 2, message: 'namacustomer wajib diisi' }); continue; }

      try {
        let sqlMaxCust = 'SELECT MAX(kodecustomer) as maxKode FROM customer WHERE idtenant = ?';
        const [[{ maxKode }]] = await conn.query(sqlMaxCust, [ctx.idtenant]);
        let num = 1;
        if (maxKode) { num = parseInt(maxKode.replace('CST', '')) + 1; }
        const kodecustomer = `CST${String(num).padStart(4, '0')}`;

        let sqlInsCust = 'INSERT INTO customer (idtenant, kodecustomer, namacustomer, alamat, hp, status, userentry) VALUES (?, ?, ?, ?, ?, ?, ?)';
        await conn.query(sqlInsCust,
          [ctx.idtenant, kodecustomer, r.namacustomer, r.alamat || '', r.hp || '', 'AKTIF', ctx.iduser]);
        success++;
      } catch (e) {
        errors.push({ row: i + 2, message: e.message });
      }
    }

    await conn.commit();
    await logger.history('IMPORT_CUSTOMER', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: `imported_${success}`, req });
    res.json({ message: `Berhasil import ${success} customer`, success, errors });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
    try { fs.unlinkSync(req.file.path); } catch (_) {}
  }
};

// POST /api/impor/import/supplier — Import data supplier dari file CSV
exports.importSupplier = async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'File tidak ditemukan' });
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    const content = fs.readFileSync(req.file.path, 'utf-8');
    const { rows } = parseCSV(content);
    if (!rows.length) return res.status(400).json({ message: 'Data kosong' });

    await conn.beginTransaction();
    let success = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.namasupplier) { errors.push({ row: i + 2, message: 'namasupplier wajib diisi' }); continue; }

      try {
        let sqlMaxSup = 'SELECT MAX(kodesupplier) as maxKode FROM supplier WHERE idtenant = ?';
        const [[{ maxKode }]] = await conn.query(sqlMaxSup, [ctx.idtenant]);
        let num = 1;
        if (maxKode) { num = parseInt(maxKode.replace('SUP', '')) + 1; }
        const kodesupplier = `SUP${String(num).padStart(4, '0')}`;

        let sqlInsSup = 'INSERT INTO supplier (idtenant, kodesupplier, namasupplier, alamat, hp, status, userentry) VALUES (?, ?, ?, ?, ?, ?, ?)';
        await conn.query(sqlInsSup,
          [ctx.idtenant, kodesupplier, r.namasupplier, r.alamat || '', r.hp || '', 'AKTIF', ctx.iduser]);
        success++;
      } catch (e) {
        errors.push({ row: i + 2, message: e.message });
      }
    }

    await conn.commit();
    await logger.history('IMPORT_SUPPLIER', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: `imported_${success}`, req });
    res.json({ message: `Berhasil import ${success} supplier`, success, errors });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
    try { fs.unlinkSync(req.file.path); } catch (_) {}
  }
};

// POST /api/impor/import/beli — Import pembelian (belum diimplementasikan)
exports.importBeli = async (req, res) => {
  res.status(501).json({ message: 'Import pembelian akan diimplementasikan di fase berikutnya' });
};

// POST /api/impor/import/jual — Import penjualan (belum diimplementasikan)
exports.importJual = async (req, res) => {
  res.status(501).json({ message: 'Import penjualan akan diimplementasikan di fase berikutnya' });
};

// GET /api/impor/template/barang — Download template CSV untuk import barang
exports.templateBarang = (req, res) => {
  sendCSV(res, 'template_barang.csv',
    ['namabarang', 'satuanbesar', 'satuansedang', 'satuankecil', 'konversi1', 'konversi2', 'jenis', 'stokmin', 'hargabeli', 'hargajual'],
    [{ namabarang: 'Contoh Barang', satuanbesar: 'DUS', satuansedang: 'PACK', satuankecil: 'PCS', konversi1: '10', konversi2: '50', jenis: 'BAHAN JADI', stokmin: '5', hargabeli: '10000', hargajual: '15000' }]
  );
};

// GET /api/impor/template/customer — Download template CSV untuk import customer
exports.templateCustomer = (req, res) => {
  sendCSV(res, 'template_customer.csv',
    ['namacustomer', 'alamat', 'hp'],
    [{ namacustomer: 'Contoh Customer', alamat: 'Jl. Contoh 123', hp: '081234567890' }]
  );
};

// GET /api/impor/template/supplier — Download template CSV untuk import supplier
exports.templateSupplier = (req, res) => {
  sendCSV(res, 'template_supplier.csv',
    ['namasupplier', 'alamat', 'hp'],
    [{ namasupplier: 'Contoh Supplier', alamat: 'Jl. Contoh 123', hp: '081234567890' }]
  );
};

// GET /api/impor/template/beli — Download template CSV untuk import pembelian
exports.templateBeli = (req, res) => {
  sendCSV(res, 'template_pembelian.csv',
    ['tgltrans', 'idsupplier', 'kodebarang', 'jml', 'harga', 'ppn', 'diskon'],
    [{ tgltrans: '2025-01-01', idsupplier: '1', kodebarang: 'BRG0001', jml: '10', harga: '10000', ppn: '11000', diskon: '0' }]
  );
};

// GET /api/impor/template/jual — Download template CSV untuk import penjualan
exports.templateJual = (req, res) => {
  sendCSV(res, 'template_penjualan.csv',
    ['tgltrans', 'idcustomer', 'kodebarang', 'jml', 'harga', 'ppn', 'diskon'],
    [{ tgltrans: '2025-01-01', idcustomer: '1', kodebarang: 'BRG0001', jml: '5', harga: '15000', ppn: '8250', diskon: '0' }]
  );
};

// POST /api/impor/import/jual-batch — Import batch penjualan dari CSV
// Validasi: header wajib, duplikasi kode, lookup lokasi/customer/barang, validasi perhitungan subtotal
exports.importJualBatch = async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'File CSV wajib diupload' });
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const content = fs.readFileSync(req.file.path, 'utf-8');
    const { rows } = parseCSV(content);

    if (!rows.length) return res.status(400).json({ message: 'File CSV kosong' });

    // Validasi header wajib ada
    const requiredHeaders = ['kodejual', 'tgltrans', 'namacustomer', 'namalokasi', 'namabarang', 'qty', 'harga', 'diskon', 'ppn', 'subtotal', 'grandtotal'];
    const firstRow = rows[0];
    const missingHeaders = requiredHeaders.filter(h => !(h in firstRow));
    if (missingHeaders.length > 0) {
      return res.status(400).json({ message: `Header wajib tidak ditemukan: ${missingHeaders.join(', ')}` });
    }

    // Ambil persentase PPN dari tenant
    let sqlPpn = 'SELECT ppn FROM tenant WHERE idtenant = ?';
    const [[tenant]] = await conn.query(sqlPpn, [ctx.idtenant]);
    const ppnPercent = tenant ? parseFloat(tenant.ppn) : 11;
    const errors = [];
    const grouped = {};

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const row = i + 2;
      const kodejual = (r.kodejual || '').trim().toUpperCase();
      const tgltrans = (r.tgltrans || '').trim();
      const namacustomer = (r.namacustomer || '').trim().toUpperCase();
      const namalokasi = (r.namalokasi || '').trim().toUpperCase();
      const namabarang = (r.namabarang || '').trim().toUpperCase();
      const qty = parseFloat(r.qty);
      const harga = parseFloat(r.harga);
      const diskon = parseFloat(r.diskon || 0);
      const ppn = parseFloat(r.ppn || 0);
      const subtotal = parseFloat(r.subtotal);
      const grandtotal = parseFloat(r.grandtotal);

      // Validasi: cek duplikasi kodejual, lookup lokasi/customer/barang, validasi qty/harga/diskon
      let sqlDupJual = 'SELECT kodejual FROM jual WHERE kodejual = ? AND idtenant = ? AND idlokasi = ?';
      const [[dupJual]] = await conn.query(
        sqlDupJual,
        [kodejual, ctx.idtenant, ctx.idlokasi]
      );
      if (dupJual) { errors.push(`Baris ${row}: kodejual ${kodejual} sudah terdaftar`); continue; }

      let sqlLokasi = "SELECT idlokasi FROM lokasi WHERE UPPER(namalokasi) = ? AND idtenant = ?";
      const [[lokasiRow]] = await conn.query(
        sqlLokasi,
        [namalokasi, ctx.idtenant]
      );
      if (!lokasiRow) { errors.push(`Baris ${row}: lokasi ${namalokasi} tidak ditemukan`); continue; }

      let sqlCustomer = "SELECT idcustomer FROM customer WHERE UPPER(namacustomer) = ? AND idtenant = ?";
      const [[customerRow]] = await conn.query(
        sqlCustomer,
        [namacustomer, ctx.idtenant]
      );
      if (!customerRow && namacustomer) { errors.push(`Baris ${row}: customer ${namacustomer} tidak ditemukan`); continue; }

      let sqlBarang = "SELECT idbarang FROM barang WHERE UPPER(namabarang) = ? AND idtenant = ?";
      const [[barangRow]] = await conn.query(
        sqlBarang,
        [namabarang, ctx.idtenant]
      );
      if (!barangRow) { errors.push(`Baris ${row}: barang ${namabarang} tidak ditemukan`); continue; }

      if (isNaN(qty) || qty <= 0) { errors.push(`Baris ${row}: qty tidak valid`); continue; }
      if (isNaN(harga) || harga < 0) { errors.push(`Baris ${row}: harga tidak valid`); continue; }
      if (isNaN(diskon) || diskon < 0) { errors.push(`Baris ${row}: diskon tidak valid`); continue; }

      // Validasi perhitungan subtotal: (harga * qty) - (harga * qty * diskon/100) + ppn
      const calcSubtotal = (harga * qty) - (harga * qty * diskon / 100) + ppn;
      if (Math.abs(calcSubtotal - subtotal) > 1) {
        errors.push(`Baris ${row}: subtotal di file ${subtotal} tidak cocok hitungan ${calcSubtotal.toFixed(0)}`);
        continue;
      }

      if (!grouped[kodejual]) {
        grouped[kodejual] = { tgltrans, idlokasi: lokasiRow.idlokasi, idcustomer: customerRow ? customerRow.idcustomer : null, grandtotal: parseFloat(grandtotal), items: [] };
      }
      grouped[kodejual].items.push({ idbarang: barangRow.idbarang, jml: qty, harga, diskon, ppn_mode: ppn > 0 ? 'INCLUDE' : 'TIDAK_PAKAI' });
    }

    // Jika ada error validasi, rollback dan kembalikan pesan error
    if (errors.length > 0) {
      await conn.rollback();
      return res.status(400).json({ message: `Import gagal. Ditemukan ${errors.length} kesalahan:\n${errors.join('\n')}` });
    }

    let totalTransactions = 0;
    let totalItems = 0;

    const { generateKodeJual } = require('../lib/kodetrans');

    for (const [kodejual, group] of Object.entries(grouped)) {
      // Validasi grandtotal per transaksi
      const calculatedGrandTotal = group.items.reduce((s, i) => s + (i.harga * i.jml) - (i.harga * i.jml * (i.diskon || 0) / 100) + (i.ppn_mode === 'INCLUDE' ? (i.harga * i.jml * ppnPercent) / 100 : 0), 0);
      if (Math.abs(calculatedGrandTotal - group.grandtotal) > 1) {
        await conn.rollback();
        return res.status(400).json({ message: `grandtotal untuk ${kodejual} tidak cocok` });
      }

      // Insert header jual (status LUNAS, metode TUNAI)
      const effectiveKode = kodejual;
      let sqlInsJual = 'INSERT INTO jual (idtenant, idlokasi, kodejual, tgltrans, idcustomer, iduser, grandtotal, bayar, kembali, jenis, metodbayar, status, userentry) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)';
      await conn.query(
        sqlInsJual,
        [ctx.idtenant, group.idlokasi, effectiveKode, group.tgltrans, group.idcustomer, ctx.iduser, calculatedGrandTotal, calculatedGrandTotal, 'JUAL', 'TUNAI', 'LUNAS', ctx.iduser]
      );

      let sqlSelJual = 'SELECT idjual FROM jual WHERE kodejual = ? AND idtenant = ? AND idlokasi = ?';
      const [[header]] = await conn.query(
        sqlSelJual,
        [effectiveKode, ctx.idtenant, group.idlokasi]
      );

      for (const item of group.items) {
        // Insert detail penjualan, kartu stok (jenis K), dan update harga jual jika berbeda
        const ppnAmount = item.ppn_mode === 'INCLUDE' ? (item.harga * item.jml * ppnPercent) / 100 : 0;
        const diskonAmt = item.diskon ? (item.harga * item.jml * item.diskon) / 100 : 0;
        const subtotal = (item.harga * item.jml) + ppnAmount - diskonAmt;

        let sqlInsDtl = 'INSERT INTO jualdtl (idjual, idtenant, idbarang, jml, harga, ppn, diskon, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
        await conn.query(
          sqlInsDtl,
          [header.idjual, ctx.idtenant, item.idbarang, item.jml, item.harga, ppnAmount, item.diskon || 0, subtotal]
        );

        let sqlInsStok = 'INSERT INTO kartustok (idtenant, idlokasi, kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idref, jenisref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
        await conn.query(
          sqlInsStok,
          [ctx.idtenant, group.idlokasi, effectiveKode, item.idbarang, item.jml, 'K', group.tgltrans, `Penjualan ${effectiveKode}`, header.idjual, 'jual']
        );

        let sqlLatestJual = 'SELECT hargajual FROM hargajual WHERE idbarang = ? AND idtenant = ? ORDER BY tgltrans DESC, idhargajual DESC LIMIT 1';
        const [[latestJual]] = await conn.query(
          sqlLatestJual,
          [item.idbarang, ctx.idtenant]
        );
        if (!latestJual || parseFloat(latestJual.hargajual) !== item.harga) {
          let sqlInsHjual = 'INSERT INTO hargajual (idtenant, idbarang, hargajual, tgltrans) VALUES (?, ?, ?, ?)';
          await conn.query(sqlInsHjual,
            [ctx.idtenant, item.idbarang, item.harga, group.tgltrans]);
        }

        totalItems++;
      }

      // Insert kartu piutang (status LUNAS)
      let sqlInsPiut = 'INSERT INTO kartupiutang (idtenant, idlokasi, idcustomer, kodetrans, jenis, amount, terbayar, sisa, tgltrans, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
      await conn.query(
        sqlInsPiut,
        [ctx.idtenant, group.idlokasi, group.idcustomer, effectiveKode, 'JUAL', calculatedGrandTotal, calculatedGrandTotal, 0, group.tgltrans, 'LUNAS']
      );

      // Insert jurnal: DEBET KAS, KREDIT PENJUALAN
      let sqlAkunKas = "SELECT idakun FROM akun WHERE namaakun = 'KAS' AND idtenant = ? LIMIT 1";
      const [[akunKas]] = await conn.query(sqlAkunKas, [ctx.idtenant]);
      let sqlAkunJual = "SELECT idakun FROM akun WHERE namaakun = 'PENJUALAN' AND idtenant = ? LIMIT 1";
      const [[akunJual]] = await conn.query(sqlAkunJual, [ctx.idtenant]);
      if (akunKas) {
        let sqlJurnalDebet = 'INSERT INTO jurnal (idtenant, idlokasi, idtrans, kodetrans, jenis, idakun, posisi, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
        await conn.query(sqlJurnalDebet,
          [ctx.idtenant, group.idlokasi, header.idjual, effectiveKode, 'jual', akunKas.idakun, 'DEBET', calculatedGrandTotal]);
      }
      if (akunJual) {
        let sqlJurnalKredit = 'INSERT INTO jurnal (idtenant, idlokasi, idtrans, kodetrans, jenis, idakun, posisi, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
        await conn.query(sqlJurnalKredit,
          [ctx.idtenant, group.idlokasi, header.idjual, effectiveKode, 'jual', akunJual.idakun, 'KREDIT', calculatedGrandTotal]);
      }

      totalTransactions++;
    }

    await conn.commit();
    if (req.file && req.file.path) fs.unlinkSync(req.file.path);
    await logger.history('IMPORT_JUAL_BATCH', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, detail: { transactions: totalTransactions, items: totalItems }, req });
    res.json({ message: `Import berhasil: ${totalTransactions} transaksi, ${totalItems} item` });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
    }
  }
};

// GET /api/impor/template/jual-batch — Download template CSV untuk import batch penjualan
exports.templateJualBatch = (req, res) => {
  sendCSV(res, 'template_penjualan_batch.csv',
    ['kodejual', 'tgltrans', 'namacustomer', 'namalokasi', 'namabarang', 'qty', 'harga', 'diskon', 'ppn', 'subtotal', 'grandtotal'],
    [
      { kodejual: 'JL.EXA.250109.001', tgltrans: '2025-01-09', namacustomer: 'TOKO MAJU', namalokasi: 'CABANG UTAMA', namabarang: 'ROTI TAWAR', qty: '10', harga: '15000', diskon: '0', ppn: '16500', subtotal: '166500', grandtotal: '166500' }
    ]
  );
};
