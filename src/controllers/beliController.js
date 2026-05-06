const { tenantQuery, tenantExecute, getConnection, getTenantContext } = require('../config/db');
const { generateKodeBeli } = require('../lib/kodetrans');

exports.create = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const { idsupplier, bayar, items } = req.body;

    if (!items || !items.length) return res.status(400).json({ message: 'Items tidak boleh kosong' });

    const [[tenant]] = await conn.query('SELECT ppn FROM tenant WHERE idtenant = ?', [ctx.idtenant]);
    const ppnPercent = req.body.useppn === false ? 0 : (tenant ? parseFloat(tenant.ppn) : 11);

    const kodebeli = await generateKodeBeli(conn, ctx.idtenant, ctx.idlokasi);
    const tgltrans = req.body.tgltrans || new Date().toISOString().slice(0, 10);

    await conn.query(
      'INSERT INTO beli (idtenant, idlokasi, kodebeli, tgltrans, idsupplier, iduser, grandtotal, bayar, status, userentry) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)',
      [ctx.idtenant, ctx.idlokasi, kodebeli, tgltrans, idsupplier || null, ctx.iduser, bayar || 0, 'AKTIF', ctx.iduser]
    );

    const [[header]] = await conn.query(
      'SELECT idbeli FROM beli WHERE kodebeli = ? AND idtenant = ? AND idlokasi = ?',
      [kodebeli, ctx.idtenant, ctx.idlokasi]
    );

    let calculatedGrandTotal = 0;

    for (const item of items) {
      const [[latestBeli]] = await conn.query(
        'SELECT hargabeli FROM hargabeli WHERE idbarang = ? AND idtenant = ? ORDER BY tgltrans DESC, idhargabeli DESC LIMIT 1',
        [item.idbarang, ctx.idtenant]
      );

      const harga = latestBeli ? parseFloat(latestBeli.hargabeli) : parseFloat(item.harga);

      const ppnAmount = (harga * item.jml * ppnPercent) / 100;
      const diskonAmount = item.diskon ? (harga * item.jml * item.diskon) / 100 : 0;
      const subtotal = (harga * item.jml) + ppnAmount - diskonAmount;
      calculatedGrandTotal += subtotal;

      await conn.query(
        'INSERT INTO belidtl (idbeli, idtenant, idbarang, jml, harga, ppn, diskon, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [header.idbeli, ctx.idtenant, item.idbarang, item.jml, harga, ppnAmount, item.diskon || 0, subtotal]
      );

      await conn.query(
        'INSERT INTO kartustok (idtenant, idlokasi, kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idref, jenisref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [ctx.idtenant, ctx.idlokasi, kodebeli, item.idbarang, item.jml, 'M', tgltrans, `Pembelian ${kodebeli}`, header.idbeli, 'beli']
      );

      if (!latestBeli || parseFloat(latestBeli.hargabeli) !== parseFloat(item.harga)) {
        await conn.query('INSERT INTO hargabeli (idtenant, idbarang, hargabeli, tgltrans) VALUES (?, ?, ?, ?)',
          [ctx.idtenant, item.idbarang, parseFloat(item.harga), tgltrans]);
      }
    }

    await conn.query('UPDATE beli SET grandtotal = ? WHERE idbeli = ? AND idtenant = ? AND idlokasi = ?',
      [calculatedGrandTotal, header.idbeli, ctx.idtenant, ctx.idlokasi]);

    await conn.commit();
    res.status(201).json({ message: 'Pembelian berhasil', kodebeli, idbeli: header.idbeli, grandtotal: calculatedGrandTotal });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.getAll = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tglwal, tglakhir, idsupplier, search } = req.query;
    let sql = `SELECT b.*, s.namasupplier
      FROM beli b
      LEFT JOIN supplier s ON b.idsupplier = s.idsupplier AND s.idtenant = b.idtenant
      WHERE 1=1`;
    const params = [];
    sql += ' AND b.idlokasi = ?'; params.push(ctx.idlokasi);
    if (tglwal) { sql += ' AND b.tgltrans >= ?'; params.push(tglwal); }
    if (tglakhir) { sql += ' AND b.tgltrans <= ?'; params.push(tglakhir); }
    if (idsupplier) { sql += ' AND b.idsupplier = ?'; params.push(idsupplier); }
    if (search) { sql += ' AND b.kodebeli LIKE ?'; params.push(`%${search}%`); }
    sql += ' ORDER BY b.tgltrans DESC, b.idbeli DESC LIMIT 200';
    const rows = await tenantQuery(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getOne = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const rows = await tenantQuery(`SELECT b.*, s.namasupplier
      FROM beli b
      LEFT JOIN supplier s ON b.idsupplier = s.idsupplier AND s.idtenant = b.idtenant
      WHERE b.idbeli = ? AND b.idlokasi = ?`, [req.params.id, ctx.idlokasi]);
    if (rows.length === 0) return res.status(404).json({ message: 'Pembelian tidak ditemukan' });

    const items = await tenantQuery(`SELECT bd.*, br.namabarang, br.satuankecil
      FROM belidtl bd
      LEFT JOIN barang br ON bd.idbarang = br.idbarang AND br.idtenant = bd.idtenant
      WHERE bd.idbeli = ?`, [req.params.id]);
    res.json({ ...rows[0], items });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.cancel = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const { id } = req.params;

    const [[beli]] = await conn.query('SELECT * FROM beli WHERE idbeli = ? AND idtenant = ? AND idlokasi = ?', [id, ctx.idtenant, ctx.idlokasi]);
    if (!beli) return res.status(404).json({ message: 'Pembelian tidak ditemukan' });
    if (beli.status === 'VOID') return res.status(400).json({ message: 'Pembelian sudah dibatalkan' });

    await conn.query('UPDATE beli SET status = ? WHERE idbeli = ? AND idtenant = ? AND idlokasi = ?', ['VOID', id, ctx.idtenant, ctx.idlokasi]);

    const [details] = await conn.query('SELECT * FROM belidtl WHERE idbeli = ? AND idtenant = ?', [id, ctx.idtenant]);
    const today = new Date().toISOString().slice(0, 10);
    for (const dtl of details) {
      await conn.query(
        'INSERT INTO kartustok (idtenant, idlokasi, kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idref, jenisref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [ctx.idtenant, ctx.idlokasi, `VOID-${beli.kodebeli}`, dtl.idbarang, dtl.jml, 'K', today, `Pembatalan ${beli.kodebeli}`, beli.idbeli, 'beli_void']
      );
    }

    await conn.commit();
    res.json({ message: 'Pembelian berhasil dibatalkan' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};
