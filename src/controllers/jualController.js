const { tenantQuery, tenantExecute, getConnection, getTenantContext } = require('../config/db');
const { generateKodeJual } = require('../lib/kodetrans');
const { generateKodePelunasanPiutang } = require('../lib/kodetrans');
const logger = require('../lib/logger');

exports.create = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const { idcustomer, bayar, items, jenis } = req.body;

    if (!items || !items.length) return res.status(400).json({ message: 'Items tidak boleh kosong' });

    const [[tenant]] = await conn.query('SELECT ppn FROM tenant WHERE idtenant = ?', [ctx.idtenant]);
    const ppnPercent = req.body.useppn === false ? 0 : (tenant ? parseFloat(tenant.ppn) : 11);

    const kodejual = await generateKodeJual(conn, ctx.idtenant, ctx.idlokasi);
    const tgltrans = req.body.tgltrans || new Date().toISOString().slice(0, 10);

    await conn.query(
      'INSERT INTO jual (idtenant, idlokasi, kodejual, tgltrans, idcustomer, iduser, grandtotal, bayar, kembali, jenis, metodbayar, status, userentry) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?, ?, ?)',
      [ctx.idtenant, ctx.idlokasi, kodejual, tgltrans, idcustomer || null, ctx.iduser, bayar || 0, jenis || 'POS', req.body.metodbayar || 'TUNAI', 'AKTIF', ctx.iduser]
    );

    const [[header]] = await conn.query(
      'SELECT idjual FROM jual WHERE kodejual = ? AND idtenant = ? AND idlokasi = ?',
      [kodejual, ctx.idtenant, ctx.idlokasi]
    );

    let calculatedGrandTotal = 0;

    for (const item of items) {
      const [[latestJual]] = await conn.query(
        'SELECT hargajual FROM hargajual WHERE idbarang = ? AND idtenant = ? ORDER BY tgltrans DESC, idhargajual DESC LIMIT 1',
        [item.idbarang, ctx.idtenant]
      );

      const harga = parseFloat(item.harga);

      const ppnAmount = (harga * item.jml * ppnPercent) / 100;
      const diskonAmount = item.diskon ? (harga * item.jml * item.diskon) / 100 : 0;
      const subtotal = (harga * item.jml) + ppnAmount - diskonAmount;
      calculatedGrandTotal += subtotal;

      await conn.query(
        'INSERT INTO jualdtl (idjual, idtenant, idbarang, jml, satuan, harga, ppn, diskon, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [header.idjual, ctx.idtenant, item.idbarang, item.jml, item.satuan, harga, ppnAmount, item.diskon || 0, subtotal]
      );

      await conn.query(
        'INSERT INTO kartustok (idtenant, idlokasi, kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idref, jenisref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [ctx.idtenant, ctx.idlokasi, kodejual, item.idbarang, item.jml, 'K', tgltrans, `Penjualan ${kodejual}`, header.idjual, 'jual']
      );

      if (!latestJual || parseFloat(latestJual.hargajual) !== parseFloat(item.harga)) {
        await conn.query('INSERT INTO hargajual (idtenant, idbarang, hargajual, tgltrans) VALUES (?, ?, ?, ?)',
          [ctx.idtenant, item.idbarang, parseFloat(item.harga), tgltrans]);
      }
    }

    const calculatedKembali = (bayar || 0) - calculatedGrandTotal;
    const statusJual = (bayar || 0) >= calculatedGrandTotal ? 'LUNAS' : 'AKTIF';
    await conn.query('UPDATE jual SET grandtotal = ?, kembali = ?, status = ? WHERE idjual = ? AND idtenant = ? AND idlokasi = ?',
      [calculatedGrandTotal, calculatedKembali, statusJual, header.idjual, ctx.idtenant, ctx.idlokasi]);

    // Jurnal
    const [[akunKas]] = await conn.query("SELECT idakun FROM akun WHERE namaakun = 'KAS' AND idtenant = ? LIMIT 1", [ctx.idtenant]);
    const [[akunJual]] = await conn.query("SELECT idakun FROM akun WHERE namaakun = 'PENJUALAN' AND idtenant = ? LIMIT 1", [ctx.idtenant]);
    if (akunKas) {
      await conn.query('INSERT INTO jurnal (idtenant, idlokasi, idtrans, kodetrans, jenis, idakun, posisi, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [ctx.idtenant, ctx.idlokasi, header.idjual, kodejual, 'jual', akunKas.idakun, 'DEBET', calculatedGrandTotal]);
    }
    if (akunJual) {
      await conn.query('INSERT INTO jurnal (idtenant, idlokasi, idtrans, kodetrans, jenis, idakun, posisi, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [ctx.idtenant, ctx.idlokasi, header.idjual, kodejual, 'jual', akunJual.idakun, 'KREDIT', calculatedGrandTotal]);
    }

    await conn.query(
      'INSERT INTO kartupiutang (idtenant, idlokasi, idcustomer, kodetrans, jenis, amount, tgltrans, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [ctx.idtenant, ctx.idlokasi, idcustomer || null, kodejual, 'JUAL', calculatedGrandTotal, tgltrans, 'OPEN']
    );

    if (req.body.langsung_lunas && calculatedGrandTotal > 0 && idcustomer) {
      const kodepelunasan = await generateKodePelunasanPiutang(conn, ctx.idtenant, ctx.idlokasi);
      const [pelResult] = await conn.query(
        'INSERT INTO pelunasanpiutang (idtenant, idlokasi, idcustomer, kodepelunasan, tgltrans, total_amount, metodbayar, catatan, userentry) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [ctx.idtenant, ctx.idlokasi, idcustomer, kodepelunasan, tgltrans, calculatedGrandTotal, req.body.metodbayar || 'TUNAI', `Pelunasan Langsung Transaksi Penjualan ${kodejual}`, ctx.iduser]
      );
      const idpelunasan = pelResult.insertId;

      await conn.query(
        'INSERT INTO pelunasanpiutangdtl (idpelunasan, kodetrans, amount) VALUES (?, ?, ?)',
        [idpelunasan, kodejual, calculatedGrandTotal]
      );

      await conn.query(
        'INSERT INTO kartupiutang (idtenant, idlokasi, idcustomer, kodetrans, jenis, kodetransreferensi, amount, tgltrans, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [ctx.idtenant, ctx.idlokasi, idcustomer, kodejual, 'PELUNASAN', kodepelunasan, -calculatedGrandTotal, tgltrans, 'OPEN']
      );

      await conn.query(
        "UPDATE kartupiutang SET status = 'LUNAS' WHERE kodetrans = ? AND idtenant = ? AND idlokasi = ? AND jenis = 'JUAL'",
        [kodejual, ctx.idtenant, ctx.idlokasi]
      );
    }

    await conn.commit();
    await logger.history('JUAL_CREATE', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: kodejual, detail: { grandtotal: calculatedGrandTotal }, req });
    res.status(201).json({ message: 'Transaksi berhasil', kodejual, idjual: header.idjual, grandtotal: calculatedGrandTotal });
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
    const { tglwal, tglakhir, idcustomer, jenis, search } = req.query;
    let sql = `SELECT j.*, DATE_FORMAT(j.tgltrans, '%Y-%m-%d') AS tgltrans, c.namacustomer, l.namalokasi
      FROM jual j
      LEFT JOIN customer c ON j.idcustomer = c.idcustomer AND c.idtenant = j.idtenant
      LEFT JOIN lokasi l ON j.idlokasi = l.idlokasi AND l.idtenant = j.idtenant
      WHERE 1=1`;
    const params = [];
    sql += ' AND j.idlokasi = ?'; params.push(ctx.idlokasi);
    if (tglwal) { sql += ' AND j.tgltrans >= ?'; params.push(tglwal); }
    if (tglakhir) { sql += ' AND j.tgltrans <= ?'; params.push(tglakhir); }
    if (idcustomer) { sql += ' AND j.idcustomer = ?'; params.push(idcustomer); }
    if (jenis) { sql += ' AND j.jenis = ?'; params.push(jenis); }
    if (search) { sql += ' AND j.kodejual LIKE ?'; params.push(`%${search}%`); }
    sql += ' ORDER BY j.tgltrans DESC, j.idjual DESC LIMIT 200';
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
    const rows = await tenantQuery(`SELECT j.*, DATE_FORMAT(j.tgltrans, '%Y-%m-%d') AS tgltrans, c.kodecustomer, c.namacustomer, c.alamat, c.hp, COALESCE(kp.status,'BELUMLUNAS') as statuslunas, l.*
      FROM jual j
      LEFT JOIN customer c ON j.idcustomer = c.idcustomer AND c.idtenant = j.idtenant
      LEFT JOIN kartupiutang kp on kp.kodetrans = j.kodejual and kp.status ='LUNAS'
      LEFT JOIN lokasi l on l.idlokasi = j.idlokasi AND l.idtenant = j.idtenant 
      WHERE j.idjual = ? AND j.idlokasi = ?`, [req.params.id, ctx.idlokasi]);
    if (rows.length === 0) return res.status(404).json({ message: 'Transaksi tidak ditemukan' });

    const items = await tenantQuery(`SELECT jd.*, b.namabarang
      FROM jualdtl jd
      LEFT JOIN barang b ON jd.idbarang = b.idbarang AND b.idtenant = jd.idtenant
      WHERE jd.idjual = ?`, [req.params.id]);
    res.json({ ...rows[0], items });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

exports.updateBayar = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const { id } = req.params;
    const { bayar } = req.body;

    if (bayar === undefined || bayar === null) return res.status(400).json({ message: 'bayar harus diisi' });

    const [[jual]] = await conn.query('SELECT * FROM jual WHERE idjual = ? AND idtenant = ? AND idlokasi = ?', [id, ctx.idtenant, ctx.idlokasi]);
    if (!jual) return res.status(404).json({ message: 'Transaksi tidak ditemukan' });
    if (jual.status === 'VOID') return res.status(400).json({ message: 'Transaksi sudah dibatalkan' });

    const totalBayar = parseFloat(jual.bayar) + parseFloat(bayar);
    if (totalBayar > parseFloat(jual.grandtotal)) return res.status(400).json({ message: 'Pembayaran melebihi total transaksi' });

    const newStatus = totalBayar >= parseFloat(jual.grandtotal) ? 'LUNAS' : 'AKTIF';
    const newKembali = totalBayar - parseFloat(jual.grandtotal);

    await conn.query(
      'UPDATE jual SET bayar = ?, kembali = ?, status = ? WHERE idjual = ? AND idtenant = ? AND idlokasi = ?',
      [totalBayar, newKembali, newStatus, id, ctx.idtenant, ctx.idlokasi]
    );

    await conn.commit();
    await logger.history('JUAL_BAYAR', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: jual.kodejual, detail: { bayar, totalBayar, newStatus }, req });
    res.json({ message: 'Pembayaran berhasil dicatat', totalBayar, status: newStatus });
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

    const [piutangRows] = await tenantQuery(
      "SELECT kodetrans, status FROM kartupiutang WHERE kodetrans = (SELECT kodejual FROM jual WHERE idjual = ? AND idtenant = ? AND idlokasi = ?) AND jenis = 'JUAL' AND idtenant = ? AND idlokasi = ?",
      [id, ctx.idtenant, ctx.idlokasi, ctx.idtenant, ctx.idlokasi]
    );

    if (piutangRows && piutangRows.length > 0 && piutangRows[0].status === 'LUNAS') {
      return res.status(400).json({ canEdit: false, reason: 'PIUTANG_LUNAS', message: 'Hapus pelunasan terlebih dahulu sebelum edit' });
    }

    const returRows = await tenantQuery(
      "SELECT kodereturjual FROM returjual WHERE kodejual = (SELECT kodejual FROM jual WHERE idjual = ? AND idtenant = ? AND idlokasi = ?) AND idtenant = ? AND idlokasi = ? AND status = 'AKTIF'",
      [id, ctx.idtenant, ctx.idlokasi, ctx.idtenant, ctx.idlokasi]
    );

    if (returRows.length > 0) {
      return res.json({ canEdit: false, reason: 'HAS_RETUR', returs: returRows.map(r => r.kodereturjual), message: 'Terdapat Retur Penjualan yang masih aktif' });
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

    const [[jual]] = await conn.query('SELECT * FROM jual WHERE idjual = ? AND idtenant = ? AND idlokasi = ?', [id, ctx.idtenant, ctx.idlokasi]);
    if (!jual) return res.status(404).json({ message: 'Transaksi tidak ditemukan' });
    if (jual.status === 'VOID') return res.status(400).json({ message: 'Transaksi sudah dibatalkan' });

    const [[piutangLunas]] = await conn.query(
      "SELECT idkartupiutang FROM kartupiutang WHERE kodetrans = ? AND jenis = 'JUAL' AND status = 'LUNAS' AND idtenant = ? AND idlokasi = ?",
      [jual.kodejual, ctx.idtenant, ctx.idlokasi]
    );
    if (piutangLunas) return res.status(400).json({ message: 'Hapus pelunasan terlebih dahulu sebelum membatalkan' });

    const [returRows] = await conn.query(
      "SELECT kodereturjual FROM returjual WHERE kodejual = ? AND idtenant = ? AND idlokasi = ? AND status = 'AKTIF'",
      [jual.kodejual, ctx.idtenant, ctx.idlokasi]
    );
    if (returRows.length > 0) {
      return res.status(400).json({ message: 'Terdapat Retur Penjualan yang masih aktif', returs: returRows.map(r => r.kodereturjual) });
    }

    await conn.query('UPDATE jual SET status = ? WHERE idjual = ? AND idtenant = ? AND idlokasi = ?', ['VOID', id, ctx.idtenant, ctx.idlokasi]);

    await conn.query('DELETE FROM kartupiutang WHERE kodetrans = ? AND idtenant = ? AND idlokasi = ?', [jual.kodejual, ctx.idtenant, ctx.idlokasi]);

    await conn.query("UPDATE jurnal SET status = 'NONAKTIF' WHERE kodetrans = ? AND jenis = 'jual' AND idtenant = ? AND idlokasi = ?", [jual.kodejual, ctx.idtenant, ctx.idlokasi]);

    const [details] = await conn.query('SELECT * FROM jualdtl WHERE idjual = ? AND idtenant = ?', [id, ctx.idtenant]);
    const today = new Date().toISOString().slice(0, 10);
    for (const dtl of details) {
      await conn.query(
        'INSERT INTO kartustok (idtenant, idlokasi, kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idref, jenisref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [ctx.idtenant, ctx.idlokasi, `VOID-${jual.kodejual}`, dtl.idbarang, dtl.jml, 'M', today, `Pembatalan ${jual.kodejual}`, jual.idjual, 'jual_void']
      );
    }

    await conn.commit();
    await logger.history('JUAL_CANCEL', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: jual.kodejual, req });
    res.json({ message: 'Transaksi berhasil dibatalkan' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.update = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();

    const { id } = req.params;
    const { idcustomer, bayar, items, jenis, metodbayar, tgltrans } = req.body;

    if (!items || !items.length) return res.status(400).json({ message: 'Items tidak boleh kosong' });

    const [[oldJual]] = await conn.query(
      'SELECT * FROM jual WHERE idjual = ? AND idtenant = ? AND idlokasi = ?',
      [id, ctx.idtenant, ctx.idlokasi]
    );
    if (!oldJual) return res.status(404).json({ message: 'Transaksi tidak ditemukan' });
    if (oldJual.status === 'VOID') return res.status(400).json({ message: 'Transaksi sudah dibatalkan' });

    const [[piutangLunas]] = await conn.query(
      "SELECT idkartupiutang FROM kartupiutang WHERE kodetrans = ? AND jenis = 'JUAL' AND status = 'LUNAS' AND idtenant = ? AND idlokasi = ?",
      [oldJual.kodejual, ctx.idtenant, ctx.idlokasi]
    );
    if (piutangLunas) {
      // delete dulu pelunasanpiutang nya 
      await conn.query(`
        DELETE pp, ppdtl
        FROM pelunasanpiutang pp 
        JOIN pelunasanpiutangdtl ppdtl on pp.idpelunasan = ppdtl.idpelunasan
        WHERE ppdtl.kodetrans = ?
      `,[oldJual.kodejual]);
    }

    const today = tgltrans || new Date().toISOString().slice(0, 10);

    await conn.query(
      'DELETE FROM kartupiutang WHERE kodetrans = ? AND idtenant = ? AND idlokasi = ?',
      [oldJual.kodejual, ctx.idtenant, ctx.idlokasi]
    );

    await conn.query(
      'DELETE FROM kartustok WHERE idref = ? AND jenisref = ? AND idtenant = ? AND idlokasi = ?',
      [id, 'jual', ctx.idtenant, ctx.idlokasi]
    );

    await conn.query('DELETE FROM jualdtl WHERE idjual = ? AND idtenant = ?', [id, ctx.idtenant]);

    await conn.query(
      "DELETE FROM jurnal WHERE kodetrans = ? AND jenis = 'jual' AND idtenant = ? AND idlokasi = ?",
      [oldJual.kodejual, ctx.idtenant, ctx.idlokasi]
    );

    const [[tenant]] = await conn.query('SELECT ppn FROM tenant WHERE idtenant = ?', [ctx.idtenant]);
    const ppnPercent = req.body.useppn === false ? 0 : (tenant ? parseFloat(tenant.ppn) : 11);

    let calculatedGrandTotal = 0;

    for (const item of items) {
      const [[latestJual]] = await conn.query(
        'SELECT hargajual FROM hargajual WHERE idbarang = ? AND idtenant = ? ORDER BY tgltrans DESC, idhargajual DESC LIMIT 1',
        [item.idbarang, ctx.idtenant]
      );

      const harga = parseFloat(item.harga);

      const ppnAmount    = (harga * item.jml * ppnPercent) / 100;
      const diskonAmount = item.diskon ? (harga * item.jml * item.diskon) / 100 : 0;
      const subtotal     = (harga * item.jml) + ppnAmount - diskonAmount;
      calculatedGrandTotal += subtotal;

      await conn.query(
        'INSERT INTO jualdtl (idjual, idtenant, idbarang, jml, satuan, harga, ppn, diskon, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, ctx.idtenant, item.idbarang, item.jml, item.satuan, harga, ppnAmount, item.diskon || 0, subtotal]
      );

      await conn.query(
        'INSERT INTO kartustok (idtenant, idlokasi, kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idref, jenisref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [ctx.idtenant, ctx.idlokasi, oldJual.kodejual, item.idbarang, item.jml, 'K', today, `Penjualan ${oldJual.kodejual}`, oldJual.idjual, 'jual']
      );

      if (!latestJual || parseFloat(latestJual.hargajual) !== parseFloat(item.harga)) {
        await conn.query('INSERT INTO hargajual (idtenant, idbarang, hargajual, tgltrans) VALUES (?, ?, ?, ?)',
          [ctx.idtenant, item.idbarang, parseFloat(item.harga), today]);
      }
    }

    await conn.query(
      'UPDATE jual SET idcustomer = ?, tgltrans = ?, metodbayar = ?, jenis = ?, grandtotal = ?, bayar = ?, kembali = ?, status = ? WHERE idjual = ? AND idtenant = ? AND idlokasi = ?',
      [idcustomer || null, today, metodbayar || 'TUNAI', jenis || 'POS', calculatedGrandTotal, bayar || 0, (bayar || 0) - calculatedGrandTotal, 'AKTIF', id, ctx.idtenant, ctx.idlokasi]
    );

    const [[akunKas]]  = await conn.query("SELECT idakun FROM akun WHERE namaakun = 'KAS' AND idtenant = ? LIMIT 1", [ctx.idtenant]);
    const [[akunJual]] = await conn.query("SELECT idakun FROM akun WHERE namaakun = 'PENJUALAN' AND idtenant = ? LIMIT 1", [ctx.idtenant]);

    if (akunKas) {
      await conn.query(
        'INSERT INTO jurnal (idtenant, idlokasi, idtrans, kodetrans, jenis, idakun, posisi, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [ctx.idtenant, ctx.idlokasi, oldJual.idjual, oldJual.kodejual, 'jual', akunKas.idakun, 'DEBET', calculatedGrandTotal]
      );
    }
    if (akunJual) {
      await conn.query(
        'INSERT INTO jurnal (idtenant, idlokasi, idtrans, kodetrans, jenis, idakun, posisi, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [ctx.idtenant, ctx.idlokasi, oldJual.idjual, oldJual.kodejual, 'jual', akunJual.idakun, 'KREDIT', calculatedGrandTotal]
      );
    }

    await conn.query(
      'INSERT INTO kartupiutang (idtenant, idlokasi, idcustomer, kodetrans, jenis, amount, tgltrans, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [ctx.idtenant, ctx.idlokasi, idcustomer || null, oldJual.kodejual, 'JUAL', calculatedGrandTotal, today, 'OPEN']
    );

    if (req.body.langsung_lunas && calculatedGrandTotal > 0 && idcustomer) {
      const kodepelunasan = await generateKodePelunasanPiutang(conn, ctx.idtenant, ctx.idlokasi);
      const [pelResult] = await conn.query(
        'INSERT INTO pelunasanpiutang (idtenant, idlokasi, idcustomer, kodepelunasan, tgltrans, total_amount, metodbayar, catatan, userentry) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [ctx.idtenant, ctx.idlokasi, idcustomer, kodepelunasan, tgltrans, calculatedGrandTotal, req.body.metodbayar || 'TUNAI', `Pelunasan Langsung Transaksi Penjualan ${oldJual.kodejual}`, ctx.iduser]
      );
      const idpelunasan = pelResult.insertId;

      await conn.query(
        'INSERT INTO pelunasanpiutangdtl (idpelunasan, kodetrans, amount) VALUES (?, ?, ?)',
        [idpelunasan, oldJual.kodejual, calculatedGrandTotal]
      );

      await conn.query(
        "UPDATE kartupiutang SET status = 'LUNAS' WHERE kodetrans = ? AND idtenant = ? AND idlokasi = ? AND jenis = 'JUAL'",
        [oldJual.kodejual, ctx.idtenant, ctx.idlokasi]
      );
    }

    await conn.commit();
    await logger.history('JUAL_EDIT', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: oldJual.kodejual, detail: { grandtotal: calculatedGrandTotal }, req });
    res.json({ message: 'Transaksi berhasil diupdate', kodejual: oldJual.kodejual, idjual: oldJual.idjual, grandtotal: calculatedGrandTotal });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};
