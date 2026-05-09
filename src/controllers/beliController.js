const { tenantQuery, tenantExecute, getConnection, getTenantContext } = require('../config/db');
const { generateKodeBeli } = require('../lib/kodetrans');
const { generateKodePelunasanHutang } = require('../lib/kodetrans');
const logger = require('../lib/logger');

// Add satuan column to belidtl on first use (idempotent, ER_DUP_FIELDNAME is silently ignored)
let _satuanMigrated = false;
async function ensureSatuanColumn(conn) {
  if (_satuanMigrated) return;
  try {
    await conn.query('ALTER TABLE belidtl ADD COLUMN satuan VARCHAR(20) DEFAULT NULL');
  } catch (_) { /* column already exists */ }
  _satuanMigrated = true;
}

// Convert item quantity to satuankecil units for consistent kartustok entries
function toKecilJml(jml, satuan, b) {
  const k1 = Math.max(parseInt(b.konversi1) || 1, 1);
  const k2 = Math.max(parseInt(b.konversi2) || 1, 1);
  if (satuan && b.satuanbesar && satuan === b.satuanbesar) return jml * k1 * k2;
  if (satuan && b.satuansedang && satuan === b.satuansedang) return jml * k2;
  return jml;
}

exports.create = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();

    const { idsupplier, bayar, items, kodebeli: customKodebeli, idlokasi: customIdlokasi } = req.body;

    if (!items || !items.length) return res.status(400).json({ message: 'Items tidak boleh kosong' });

    await ensureSatuanColumn(conn);

    const [[tenant]] = await conn.query('SELECT ppn FROM tenant WHERE idtenant = ?', [ctx.idtenant]);
    const ppnPercent = tenant ? parseFloat(tenant.ppn) : 11;

    // Accept custom kodebeli (manual entry) or auto-generate
    const kodebeli = (customKodebeli && customKodebeli.trim())
      ? customKodebeli.trim()
      : await generateKodeBeli(conn, ctx.idtenant, ctx.idlokasi);

    const tgltrans = req.body.tgltrans || new Date().toISOString().slice(0, 10);

    // Accept idlokasi override from form (user may change location)
    const idlokasi = (customIdlokasi && parseInt(customIdlokasi)) ? parseInt(customIdlokasi) : ctx.idlokasi;

    await conn.query(
      'INSERT INTO beli (idtenant, idlokasi, kodebeli, tgltrans, idsupplier, iduser, grandtotal, bayar, status, userentry) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)',
      [ctx.idtenant, idlokasi, kodebeli, tgltrans, idsupplier || null, ctx.iduser, bayar || 0, 'AKTIF', ctx.iduser]
    );

    const [[header]] = await conn.query(
      'SELECT idbeli FROM beli WHERE kodebeli = ? AND idtenant = ? AND idlokasi = ?',
      [kodebeli, ctx.idtenant, idlokasi]
    );

    let calculatedGrandTotal = 0;

    for (const item of items) {
      const [[latestBeli]] = await conn.query(
        'SELECT hargabeli FROM hargabeli WHERE idbarang = ? AND idtenant = ? ORDER BY tgltrans DESC, idhargabeli DESC LIMIT 1',
        [item.idbarang, ctx.idtenant]
      );

      const harga = parseFloat(item.harga);

      // Per-item PPN: INCLUDE applies tenant rate, TIDAK_PAKAI skips tax
      const ppn_mode = item.ppn_mode || 'INCLUDE';
      const ppnAmount = ppn_mode === 'INCLUDE' ? (harga * item.jml * ppnPercent) / 100 : 0;
      const diskonAmount = item.diskon ? (harga * item.jml * item.diskon) / 100 : 0;
      const subtotal = (harga * item.jml) + ppnAmount - diskonAmount;
      calculatedGrandTotal += subtotal;

      await conn.query(
        'INSERT INTO belidtl (idbeli, idtenant, idbarang, jml, harga, ppn, diskon, subtotal, satuan) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [header.idbeli, ctx.idtenant, item.idbarang, item.jml, harga, ppnAmount, item.diskon || 0, subtotal, item.satuan || null]
      );

      // Fetch barang unit info for stock conversion
      const [[barangInfo]] = await conn.query(
        'SELECT satuanbesar, satuansedang, satuankecil, konversi1, konversi2 FROM barang WHERE idbarang = ? AND idtenant = ?',
        [item.idbarang, ctx.idtenant]
      );

      // Record stock movement in satuankecil units for consistency
      const jmlKartustok = barangInfo ? toKecilJml(item.jml, item.satuan, barangInfo) : item.jml;

      await conn.query(
        'INSERT INTO kartustok (idtenant, idlokasi, kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idref, jenisref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [ctx.idtenant, idlokasi, kodebeli, item.idbarang, jmlKartustok, 'M', tgltrans, `Pembelian ${kodebeli}`, header.idbeli, 'beli']
      );

      // Update harga beli history if price changed
      if (!latestBeli || parseFloat(latestBeli.hargabeli) !== harga) {
        await conn.query('INSERT INTO hargabeli (idtenant, idbarang, hargabeli, tgltrans) VALUES (?, ?, ?, ?)',
          [ctx.idtenant, item.idbarang, harga, tgltrans]);
      }
    }

    await conn.query('UPDATE beli SET grandtotal = ? WHERE idbeli = ? AND idtenant = ? AND idlokasi = ?',
      [calculatedGrandTotal, header.idbeli, ctx.idtenant, idlokasi]);

    await conn.query(
      'INSERT INTO kartuhutang (idtenant, idlokasi, idsupplier, kodetrans, jenis, amount, tgltrans, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [ctx.idtenant, idlokasi, idsupplier || null, kodebeli, 'BELI', calculatedGrandTotal, tgltrans, 'OPEN']
    );

    if (req.body.langsung_lunas && calculatedGrandTotal > 0 && idsupplier) {
      const kodepelunasan = await generateKodePelunasanHutang(conn, ctx.idtenant, idlokasi);
      const [pelResult] = await conn.query(
        'INSERT INTO pelunasanhutang (idtenant, idlokasi, idsupplier, kodepelunasan, tgltrans, total_amount, metodbayar, catatan, userentry) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [ctx.idtenant, idlokasi, idsupplier, kodepelunasan, tgltrans, calculatedGrandTotal, req.body.metodbayar || 'TUNAI', `Pelunasan Langsung Transaksi Pembelian  ${kodebeli}`, ctx.iduser]
      );
      const idpelunasan = pelResult.insertId;

      await conn.query(
        'INSERT INTO pelunasanhutangdtl (idpelunasan, kodetrans, amount) VALUES (?, ?, ?)',
        [idpelunasan, kodebeli, calculatedGrandTotal]
      );

      await conn.query(
        'INSERT INTO kartuhutang (idtenant, idlokasi, idsupplier, kodetrans, jenis, kodetransreferensi, amount, tgltrans, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [ctx.idtenant, idlokasi, idsupplier, kodebeli, 'PELUNASAN', kodepelunasan, -calculatedGrandTotal, tgltrans, 'OPEN']
      );

      await conn.query(
        "UPDATE kartuhutang SET status = 'LUNAS' WHERE kodetrans = ? AND idtenant = ? AND idlokasi = ? AND jenis = 'BELI'",
        [kodebeli, ctx.idtenant, idlokasi]
      );
    }

    await conn.commit();
    await logger.history('BELI_CREATE', { idtenant: ctx.idtenant, idlokasi, iduser: ctx.iduser, ref: kodebeli, detail: { grandtotal: calculatedGrandTotal }, req });
    res.status(201).json({ message: 'Pembelian berhasil', kodebeli, idbeli: header.idbeli, grandtotal: calculatedGrandTotal });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.getAll = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tglwal, tglakhir, idsupplier, idlokasi, search } = req.query;
    let sql = `SELECT b.*, DATE_FORMAT(b.tgltrans, '%Y-%m-%d') AS tgltrans, s.namasupplier, l.namalokasi
      FROM beli b
      LEFT JOIN supplier s ON b.idsupplier = s.idsupplier AND s.idtenant = b.idtenant
      LEFT JOIN lokasi l ON b.idlokasi = l.idlokasi AND l.idtenant = b.idtenant
      WHERE b.idtenant = ?`;
    const params = [ctx.idtenant];
    if (idlokasi)   { sql += ' AND b.idlokasi = ?';  params.push(idlokasi); }
    if (tglwal)     { sql += ' AND b.tgltrans >= ?'; params.push(tglwal); }
    if (tglakhir)   { sql += ' AND b.tgltrans <= ?'; params.push(tglakhir); }
    if (idsupplier) { sql += ' AND b.idsupplier = ?'; params.push(idsupplier); }
    if (search)     { sql += ' AND b.kodebeli LIKE ?'; params.push(`%${search}%`); }
    sql += ' ORDER BY b.tgltrans DESC, b.idbeli DESC LIMIT 200';
    const rows = await tenantQuery(sql, params);
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

exports.getOne = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const rows = await tenantQuery(`SELECT b.*, DATE_FORMAT(b.tgltrans, '%Y-%m-%d') AS tgltrans,
      s.namasupplier, s.kodesupplier, s.alamat AS salamat, s.hp AS shp,
      l.namalokasi, l.kodelokasi, COALESCE(kh.status, 'BELUMLUNAS') as statuslunas
      FROM beli b
      LEFT JOIN supplier s ON b.idsupplier = s.idsupplier AND s.idtenant = b.idtenant
      LEFT JOIN lokasi l ON b.idlokasi = l.idlokasi AND l.idtenant = b.idtenant
      LEFT JOIN kartuhutang kh on kh.kodetrans = b.kodebeli and kh.status = 'LUNAS'
      WHERE b.idbeli = ? AND b.idtenant = ?`, [req.params.id, ctx.idtenant]);
    if (rows.length === 0) return res.status(404).json({ message: 'Pembelian tidak ditemukan' });

    const items = await tenantQuery(`SELECT bd.*, br.namabarang, br.kodebarang,
      br.satuanbesar, br.satuansedang, br.satuankecil, br.konversi1, br.konversi2
      FROM belidtl bd
      LEFT JOIN barang br ON bd.idbarang = br.idbarang AND br.idtenant = bd.idtenant
      WHERE bd.idbeli = ? AND bd.idtenant = ?`, [req.params.id, ctx.idtenant]);

    const mappedItems = items.map(item => ({
      ...item,
      ppn_mode: parseFloat(item.ppn || 0) > 0 ? 'INCLUDE' : 'TIDAK_PAKAI',
    }));

    res.json({ ...rows[0], items: mappedItems });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

exports.update = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();

    const { id } = req.params;
    const { tgltrans, idsupplier, idlokasi: newIdlokasi, items, kodebeli } = req.body;

    if (!items || !items.length) return res.status(400).json({ message: 'Items tidak boleh kosong' });

    const [[beli]] = await conn.query('SELECT * FROM beli WHERE idbeli = ? AND idtenant = ?', [id, ctx.idtenant]);
if (!beli) return res.status(404).json({ message: 'Pembelian tidak ditemukan' });
    if (beli.status === 'VOID') return res.status(400).json({ message: 'Pembelian sudah dibatalkan' });

    const [[hutangLunas]] = await conn.query(
      "SELECT idkartuhutang FROM kartuhutang WHERE kodetrans = ? AND jenis = 'BELI' AND status = 'LUNAS' AND idtenant = ?",
      [beli.kodebeli, ctx.idtenant]
    );

    if (hutangLunas){
      // delete dulu pelunasanhutang nya 
      await conn.query(`
        DELETE ph, phdtl
        FROM pelunasanhutang ph 
        JOIN pelunasanhutangdtl phdtl on ph.idpelunasan = phdtl.idpelunasan
        WHERE phdtl.kodetrans = ?
      `,[beli.kodebeli]);
    }

    await ensureSatuanColumn(conn);

    const [[tenant]] = await conn.query('SELECT ppn FROM tenant WHERE idtenant = ?', [ctx.idtenant]);
    const ppnPercent = tenant ? parseFloat(tenant.ppn) : 11;

    const idlokasi = (newIdlokasi && parseInt(newIdlokasi)) ? parseInt(newIdlokasi) : beli.idlokasi;
    const newTgltrans = tgltrans || String(beli.tgltrans).slice(0, 10);

    await conn.query(
      'DELETE FROM kartuhutang WHERE kodetrans = ? AND idtenant = ?',
      [beli.kodebeli, ctx.idtenant]
    );

    await conn.query("DELETE FROM kartustok WHERE idref = ? AND jenisref = 'beli' AND idtenant = ?", [id, ctx.idtenant]);
    await conn.query('DELETE FROM belidtl WHERE idbeli = ? AND idtenant = ?', [id, ctx.idtenant]);

    let calculatedGrandTotal = 0;
    for (const item of items) {
      const harga = parseFloat(item.harga);
      const jml = parseInt(item.jml) || 1;
      const ppn_mode = item.ppn_mode || 'INCLUDE';
      const ppnAmount = ppn_mode === 'INCLUDE' ? (harga * jml * ppnPercent) / 100 : 0;
      const subtotal = (harga * jml) + ppnAmount;
      calculatedGrandTotal += subtotal;

      await conn.query(
        'INSERT INTO belidtl (idbeli, idtenant, idbarang, jml, harga, ppn, diskon, subtotal, satuan) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, ctx.idtenant, item.idbarang, jml, harga, ppnAmount, 0, subtotal, item.satuan || null]
      );

      const [[barangInfo]] = await conn.query(
        'SELECT satuanbesar, satuansedang, satuankecil, konversi1, konversi2 FROM barang WHERE idbarang = ? AND idtenant = ?',
        [item.idbarang, ctx.idtenant]
      );
      const jmlKartustok = barangInfo ? toKecilJml(jml, item.satuan, barangInfo) : jml;

      await conn.query(
        'INSERT INTO kartustok (idtenant, idlokasi, kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idref, jenisref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [ctx.idtenant, idlokasi, beli.kodebeli, item.idbarang, jmlKartustok, 'M', newTgltrans, `Pembelian ${beli.kodebeli}`, id, 'beli']
      );

      const [[latestBeli]] = await conn.query(
        'SELECT hargabeli FROM hargabeli WHERE idbarang = ? AND idtenant = ? ORDER BY tgltrans DESC, idhargabeli DESC LIMIT 1',
        [item.idbarang, ctx.idtenant]
      );
      if (!latestBeli || parseFloat(latestBeli.hargabeli) !== harga) {
        await conn.query('INSERT INTO hargabeli (idtenant, idbarang, hargabeli, tgltrans) VALUES (?, ?, ?, ?)',
          [ctx.idtenant, item.idbarang, harga, newTgltrans]);
      }
    }

    await conn.query('UPDATE beli SET grandtotal = ? WHERE idbeli = ? AND idtenant = ?',
      [calculatedGrandTotal, id, ctx.idtenant]);

    await conn.query(
      'INSERT INTO kartuhutang (idtenant, idlokasi, idsupplier, kodetrans, jenis, amount, tgltrans, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [ctx.idtenant, idlokasi, idsupplier || null, beli.kodebeli, 'BELI', calculatedGrandTotal, newTgltrans, 'OPEN']
    );

    if (req.body.langsung_lunas && calculatedGrandTotal > 0 && idsupplier) {
      const kodepelunasan = await generateKodePelunasanHutang(conn, ctx.idtenant, idlokasi);
      const [pelResult] = await conn.query(
        'INSERT INTO pelunasanhutang (idtenant, idlokasi, idsupplier, kodepelunasan, tgltrans, total_amount, metodbayar, catatan, userentry) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [ctx.idtenant, idlokasi, idsupplier, kodepelunasan, tgltrans, calculatedGrandTotal, req.body.metodbayar || 'TUNAI', `Pelunasan Langsung Transaksi Pembelian  ${kodebeli}`, ctx.iduser]
      );
      const idpelunasan = pelResult.insertId;

      await conn.query(
        'INSERT INTO pelunasanhutangdtl (idpelunasan, kodetrans, amount) VALUES (?, ?, ?)',
        [idpelunasan, kodebeli, calculatedGrandTotal]
      );

      await conn.query(
        "UPDATE kartuhutang SET status = 'LUNAS' WHERE kodetrans = ? AND idtenant = ? AND idlokasi = ? AND jenis = 'BELI'",
        [kodebeli, ctx.idtenant, idlokasi]
      );
    }

    await conn.commit();
    await logger.history('BELI_UPDATE', { idtenant: ctx.idtenant, idlokasi, iduser: ctx.iduser, ref: beli.kodebeli, req });
    res.json({ message: 'Pembelian berhasil diupdate', grandtotal: calculatedGrandTotal });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.checkEdit = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { id } = req.params;

    const [hutangRows] = await tenantQuery(
      "SELECT kodetrans, status FROM kartuhutang WHERE kodetrans = (SELECT kodebeli FROM beli WHERE idbeli = ? AND idtenant = ?) AND jenis = 'BELI' AND idtenant = ?",
      [id, ctx.idtenant, ctx.idtenant]
    );

    if (hutangRows && hutangRows.length > 0 && hutangRows[0].status === 'LUNAS') {
      return res.status(400).json({ canEdit: false, reason: 'HUTANG_LUNAS', message: 'Hapus pelunasan hutang terlebih dahulu sebelum edit' });
    }

    res.json({ canEdit: true });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

exports.cancel = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const { id } = req.params;

    const [[beli]] = await conn.query('SELECT * FROM beli WHERE idbeli = ? AND idtenant = ?', [id, ctx.idtenant]);
    if (!beli) return res.status(404).json({ message: 'Pembelian tidak ditemukan' });
    if (beli.status === 'VOID') return res.status(400).json({ message: 'Pembelian sudah dibatalkan' });

    const [[hutangLunas]] = await conn.query(
      "SELECT idkartuhutang FROM kartuhutang WHERE kodetrans = ? AND jenis = 'BELI' AND status = 'LUNAS' AND idtenant = ?",
      [beli.kodebeli, ctx.idtenant]
    );
    if (hutangLunas) return res.status(400).json({ message: 'Hapus pelunasan hutang terlebih dahulu sebelum membatalkan' });

    await conn.query('UPDATE beli SET status = ? WHERE idbeli = ? AND idtenant = ?', ['VOID', id, ctx.idtenant]);

    await conn.query('DELETE FROM kartuhutang WHERE kodetrans = ? AND idtenant = ?', [beli.kodebeli, ctx.idtenant]);

    const [details] = await conn.query('SELECT * FROM belidtl WHERE idbeli = ? AND idtenant = ?', [id, ctx.idtenant]);
    const today = new Date().toISOString().slice(0, 10);
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
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};
