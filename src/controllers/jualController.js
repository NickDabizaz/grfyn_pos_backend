const { tenantQuery, tenantExecute, getConnection, getTenantContext } = require('../config/db');
const { generateKodeJual } = require('../lib/kodetrans');
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

      const harga = latestJual ? parseFloat(latestJual.hargajual) : parseFloat(item.harga);

      const ppnAmount = (harga * item.jml * ppnPercent) / 100;
      const diskonAmount = item.diskon ? (harga * item.jml * item.diskon) / 100 : 0;
      const subtotal = (harga * item.jml) + ppnAmount - diskonAmount;
      calculatedGrandTotal += subtotal;

      await conn.query(
        'INSERT INTO jualdtl (idjual, idtenant, idbarang, jml, harga, ppn, diskon, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [header.idjual, ctx.idtenant, item.idbarang, item.jml, harga, ppnAmount, item.diskon || 0, subtotal]
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
    let sql = `SELECT j.*, c.namacustomer
      FROM jual j
      LEFT JOIN customer c ON j.idcustomer = c.idcustomer AND c.idtenant = j.idtenant
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
    const rows = await tenantQuery(`SELECT j.*, c.namacustomer
      FROM jual j
      LEFT JOIN customer c ON j.idcustomer = c.idcustomer AND c.idtenant = j.idtenant
      WHERE j.idjual = ? AND j.idlokasi = ?`, [req.params.id, ctx.idlokasi]);
    if (rows.length === 0) return res.status(404).json({ message: 'Transaksi tidak ditemukan' });

    const items = await tenantQuery(`SELECT jd.*, b.namabarang, b.satuankecil
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

exports.cancel = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const { id } = req.params;

    const [[jual]] = await conn.query('SELECT * FROM jual WHERE idjual = ? AND idtenant = ? AND idlokasi = ?', [id, ctx.idtenant, ctx.idlokasi]);
    if (!jual) return res.status(404).json({ message: 'Transaksi tidak ditemukan' });
    if (jual.status === 'VOID') return res.status(400).json({ message: 'Transaksi sudah dibatalkan' });

    await conn.query('UPDATE jual SET status = ? WHERE idjual = ? AND idtenant = ? AND idlokasi = ?', ['VOID', id, ctx.idtenant, ctx.idlokasi]);

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
