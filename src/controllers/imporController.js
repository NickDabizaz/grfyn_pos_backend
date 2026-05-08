const { pool, getConnection, getTenantContext, tenantQuery, tenantExecute } = require('../config/db');
const fs = require('fs');
const logger = require('../lib/logger');

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

function sendCSV(res, filename, headers, rows) {
  const csv = generateCSV(headers, rows);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

exports.exportBarang = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const rows = await tenantQuery(`SELECT b.kodebarang, b.namabarang, b.satuanbesar, b.satuansedang, b.satuankecil,
      b.konversi1, b.konversi2, b.jenis, b.stokmin, b.status,
      (SELECT hargabeli FROM hargabeli WHERE idbarang = b.idbarang AND idtenant = b.idtenant ORDER BY tgltrans DESC, idhargabeli DESC LIMIT 1) as hargabeli,
      (SELECT hargajual FROM hargajual WHERE idbarang = b.idbarang AND idtenant = b.idtenant ORDER BY tgltrans DESC, idhargajual DESC LIMIT 1) as hargajual
    FROM barang b ORDER BY b.kodebarang`);
    sendCSV(res, 'barang.csv', ['kodebarang', 'namabarang', 'satuanbesar', 'satuansedang', 'satuankecil', 'konversi1', 'konversi2', 'jenis', 'stokmin', 'status', 'hargabeli', 'hargajual'], rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

exports.exportCustomer = async (req, res) => {
  try {
    const rows = await tenantQuery('SELECT kodecustomer, namacustomer, alamat, hp FROM customer ORDER BY idcustomer');
    sendCSV(res, 'customer.csv', ['kodecustomer', 'namacustomer', 'alamat', 'hp'], rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

exports.exportSupplier = async (req, res) => {
  try {
    const rows = await tenantQuery('SELECT kodesupplier, namasupplier, alamat, hp FROM supplier ORDER BY idsupplier');
    sendCSV(res, 'supplier.csv', ['kodesupplier', 'namasupplier', 'alamat', 'hp'], rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

exports.exportBeli = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const rows = await tenantQuery(`SELECT b.kodebeli, b.tgltrans, s.kodesupplier, s.namasupplier,
      br.kodebarang, br.namabarang, bd.jml, bd.harga, bd.ppn, bd.diskon, bd.subtotal,
      b.grandtotal, b.bayar, b.status
    FROM belidtl bd
    JOIN beli b ON bd.idbeli = b.idbeli AND bd.idtenant = b.idtenant
    LEFT JOIN supplier s ON b.idsupplier = s.idsupplier AND s.idtenant = b.idtenant
    LEFT JOIN barang br ON bd.idbarang = br.idbarang AND br.idtenant = bd.idtenant
    WHERE b.idlokasi = ? ORDER BY b.tgltrans DESC, b.idbeli DESC`, [ctx.idlokasi]);
    sendCSV(res, 'pembelian.csv', ['kodebeli', 'tgltrans', 'kodesupplier', 'namasupplier', 'kodebarang', 'namabarang', 'jml', 'harga', 'ppn', 'diskon', 'subtotal', 'grandtotal', 'bayar', 'status'], rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

exports.exportJual = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const rows = await tenantQuery(`SELECT j.kodejual, j.tgltrans, c.kodecustomer, c.namacustomer,
      br.kodebarang, br.namabarang, jd.jml, jd.harga, jd.ppn, jd.diskon, jd.subtotal,
      j.grandtotal, j.bayar, j.kembali, j.status
    FROM jualdtl jd
    JOIN jual j ON jd.idjual = j.idjual AND jd.idtenant = j.idtenant
    LEFT JOIN customer c ON j.idcustomer = c.idcustomer AND c.idtenant = j.idtenant
    LEFT JOIN barang br ON jd.idbarang = br.idbarang AND br.idtenant = jd.idtenant
    WHERE j.idlokasi = ? ORDER BY j.tgltrans DESC, j.idjual DESC`, [ctx.idlokasi]);
    sendCSV(res, 'penjualan.csv', ['kodejual', 'tgltrans', 'kodecustomer', 'namacustomer', 'kodebarang', 'namabarang', 'jml', 'harga', 'ppn', 'diskon', 'subtotal', 'grandtotal', 'bayar', 'kembali', 'status'], rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

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

      try {
        const [[{ maxKode }]] = await conn.query('SELECT MAX(kodebarang) as maxKode FROM barang WHERE idtenant = ?', [ctx.idtenant]);
        let num = 1;
        if (maxKode) { num = parseInt(maxKode.replace('BRG', '')) + 1; }
        const kodebarang = `BRG${String(num).padStart(4, '0')}`;

        const [result] = await conn.query(
          'INSERT INTO barang (idtenant, kodebarang, namabarang, satuanbesar, satuansedang, satuankecil, konversi1, konversi2, jenis, stokmin, status, userentry) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [ctx.idtenant, kodebarang, r.namabarang, r.satuanbesar || '', r.satuansedang || '', r.satuankecil || '', parseInt(r.konversi1) || 0, parseInt(r.konversi2) || 0, r.jenis || 'BAHAN JADI', parseInt(r.stokmin) || 0, 'AKTIF', ctx.iduser]
        );
        const idbarang = result.insertId;

        if (r.hargabeli && parseFloat(r.hargabeli) > 0) {
          await conn.query('INSERT INTO hargabeli (idtenant, idbarang, hargabeli, tgltrans) VALUES (?, ?, ?, ?)', [ctx.idtenant, idbarang, parseFloat(r.hargabeli), today]);
        }
        if (r.hargajual && parseFloat(r.hargajual) > 0) {
          await conn.query('INSERT INTO hargajual (idtenant, idbarang, hargajual, tgltrans) VALUES (?, ?, ?, ?)', [ctx.idtenant, idbarang, parseFloat(r.hargajual), today]);
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
        const [[{ maxKode }]] = await conn.query('SELECT MAX(kodecustomer) as maxKode FROM customer WHERE idtenant = ?', [ctx.idtenant]);
        let num = 1;
        if (maxKode) { num = parseInt(maxKode.replace('CST', '')) + 1; }
        const kodecustomer = `CST${String(num).padStart(4, '0')}`;

        await conn.query('INSERT INTO customer (idtenant, kodecustomer, namacustomer, alamat, hp, status, userentry) VALUES (?, ?, ?, ?, ?, ?, ?)',
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
        const [[{ maxKode }]] = await conn.query('SELECT MAX(kodesupplier) as maxKode FROM supplier WHERE idtenant = ?', [ctx.idtenant]);
        let num = 1;
        if (maxKode) { num = parseInt(maxKode.replace('SUP', '')) + 1; }
        const kodesupplier = `SUP${String(num).padStart(4, '0')}`;

        await conn.query('INSERT INTO supplier (idtenant, kodesupplier, namasupplier, alamat, hp, status, userentry) VALUES (?, ?, ?, ?, ?, ?, ?)',
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

exports.importBeli = async (req, res) => {
  res.status(501).json({ message: 'Import pembelian akan diimplementasikan di fase berikutnya' });
};

exports.importJual = async (req, res) => {
  res.status(501).json({ message: 'Import penjualan akan diimplementasikan di fase berikutnya' });
};

exports.templateBarang = (req, res) => {
  sendCSV(res, 'template_barang.csv',
    ['namabarang', 'satuanbesar', 'satuansedang', 'satuankecil', 'konversi1', 'konversi2', 'jenis', 'stokmin', 'hargabeli', 'hargajual'],
    [{ namabarang: 'Contoh Barang', satuanbesar: 'DUS', satuansedang: 'PACK', satuankecil: 'PCS', konversi1: '10', konversi2: '50', jenis: 'BAHAN JADI', stokmin: '5', hargabeli: '10000', hargajual: '15000' }]
  );
};

exports.templateCustomer = (req, res) => {
  sendCSV(res, 'template_customer.csv',
    ['namacustomer', 'alamat', 'hp'],
    [{ namacustomer: 'Contoh Customer', alamat: 'Jl. Contoh 123', hp: '081234567890' }]
  );
};

exports.templateSupplier = (req, res) => {
  sendCSV(res, 'template_supplier.csv',
    ['namasupplier', 'alamat', 'hp'],
    [{ namasupplier: 'Contoh Supplier', alamat: 'Jl. Contoh 123', hp: '081234567890' }]
  );
};

exports.templateBeli = (req, res) => {
  sendCSV(res, 'template_pembelian.csv',
    ['tgltrans', 'idsupplier', 'kodebarang', 'jml', 'harga', 'ppn', 'diskon'],
    [{ tgltrans: '2025-01-01', idsupplier: '1', kodebarang: 'BRG0001', jml: '10', harga: '10000', ppn: '11000', diskon: '0' }]
  );
};

exports.templateJual = (req, res) => {
  sendCSV(res, 'template_penjualan.csv',
    ['tgltrans', 'idcustomer', 'kodebarang', 'jml', 'harga', 'ppn', 'diskon'],
    [{ tgltrans: '2025-01-01', idcustomer: '1', kodebarang: 'BRG0001', jml: '5', harga: '15000', ppn: '8250', diskon: '0' }]
  );
};
