const { tenantQuery, tenantExecute, getConnection, getTenantContext } = require('../../config/db');
const { generateKodeReturBeli } = require('../../lib/kodetrans');
const logger = require('../../lib/logger');

// POST — Membuat retur pembelian baru. Menyimpan header, detail, pergerakan stok (keluar), dan kartu hutang jika ada supplier.
exports.create = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const { idsupplier, idlokasi, idbeli, kodebeli, items, catatan, tgltrans } = req.body;

    if (!items || !items.length) {
      await conn.rollback();
      return res.status(400).json({ message: 'Items tidak boleh kosong' });
    }
    if (!idsupplier) {
      await conn.rollback();
      return res.status(400).json({ message: 'Supplier wajib dipilih' });
    }
    if (!idlokasi) {
      await conn.rollback();
      return res.status(400).json({ message: 'Lokasi wajib dipilih' });
    }

    const kodereturbeli = await generateKodeReturBeli(conn, ctx.idtenant, idlokasi);
    const tgl = tgltrans || new Date().toISOString().slice(0, 10);

    // Insert header returbeli
    let sql = 'INSERT INTO returbeli (idtenant, idlokasi, kodereturbeli, tgltrans, idsupplier, idbeli, kodebeli, iduser, total, catatan, status, userentry) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)';
    await conn.query(sql,
      [ctx.idtenant, idlokasi, kodereturbeli, tgl, idsupplier, idbeli || null, kodebeli || null, ctx.iduser, catatan || null, 'AKTIF', ctx.iduser]
    );

    let [[header]] = await conn.query(
      'SELECT idreturbeli FROM returbeli WHERE kodereturbeli = ? AND idtenant = ? AND idlokasi = ?',
      [kodereturbeli, ctx.idtenant, idlokasi]
    );

    let calculatedTotal = 0;

    for (const item of items) {
      const subtotal = parseFloat(item.harga || 0) * parseFloat(item.jml);
      calculatedTotal += subtotal;

      // Insert detail retur
      const ppnAmt = parseFloat(item.ppn || 0);
      const diskon = parseFloat(item.diskon || 0);
      await conn.query(
        'INSERT INTO returbelidtl (idreturbeli, idtenant, idbarang, satuan, jml, harga, ppn, diskon, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [header.idreturbeli, ctx.idtenant, item.idbarang, item.satuan || null, item.jml, item.harga || 0, ppnAmt, diskon, subtotal]
      );

      // Stok keluar: barang dikembalikan ke supplier → kurangi stok
      await conn.query(
        'INSERT INTO kartustok (idtenant, idlokasi, kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idref, jenisref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [ctx.idtenant, idlokasi, kodereturbeli, item.idbarang, item.jml, 'K', tgl, `Retur Pembelian ${kodereturbeli}`, header.idreturbeli, 'returbeli']
      );
    }

    // Update total di header
    await conn.query(
      'UPDATE returbeli SET total = ? WHERE idreturbeli = ? AND idtenant = ?',
      [calculatedTotal, header.idreturbeli, ctx.idtenant]
    );

    // Jika retur terkait pembelian & supplier, catat pengurang hutang di kartu hutang
    if (kodebeli && idsupplier) {
      await conn.query(
        'INSERT INTO kartuhutang (idtenant, idlokasi, idsupplier, kodetrans, jenis, kodetransreferensi, amount, terbayar, sisa, tgltrans, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [ctx.idtenant, idlokasi, idsupplier, kodebeli, 'RETUR', kodereturbeli, -calculatedTotal, 0, -calculatedTotal, tgl, 'OPEN']
      );
    }

    await conn.commit();
    await logger.history('RETURBELI_CREATE', { idtenant: ctx.idtenant, idlokasi, iduser: ctx.iduser, ref: kodereturbeli, detail: { total: calculatedTotal }, req });
    res.status(201).json({ message: 'Retur pembelian berhasil dibuat', kodereturbeli, idreturbeli: header.idreturbeli, total: calculatedTotal });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// GET — Daftar retur pembelian dengan filter tanggal, supplier, dan pencarian kode
exports.getAll = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tglwal, tglakhir, idsupplier, idlokasi, search } = req.query;
    let sql = `SELECT r.*, s.namasupplier
      FROM returbeli r
      LEFT JOIN supplier s ON r.idsupplier = s.idsupplier AND s.idtenant = r.idtenant
      WHERE r.idtenant = ?`;
    const params = [ctx.idtenant];
    if (idlokasi)    { sql += ' AND r.idlokasi = ?'; params.push(idlokasi); }
    if (tglwal)      { sql += ' AND r.tgltrans >= ?'; params.push(tglwal); }
    if (tglakhir)    { sql += ' AND r.tgltrans <= ?'; params.push(tglakhir); }
    if (idsupplier)  { sql += ' AND r.idsupplier = ?'; params.push(idsupplier); }
    if (search)      { sql += ' AND r.kodereturbeli LIKE ?'; params.push(`%${search}%`); }
    sql += ' ORDER BY r.tgltrans DESC, r.idreturbeli DESC LIMIT 200';
    const rows = await tenantQuery(sql, params);
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET — Detail satu retur pembelian beserta item-itemnya
exports.getOne = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const rows = await tenantQuery(
      `SELECT r.*, s.namasupplier, s.kodesupplier, s.alamat AS salamat, s.hp AS shp,
              l.namalokasi, l.kodelokasi
       FROM returbeli r
       LEFT JOIN supplier s ON r.idsupplier = s.idsupplier AND s.idtenant = r.idtenant
       LEFT JOIN lokasi l ON r.idlokasi = l.idlokasi AND l.idtenant = r.idtenant
       WHERE r.idreturbeli = ? AND r.idtenant = ?`,
      [req.params.id, ctx.idtenant]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Retur pembelian tidak ditemukan' });

    const items = await tenantQuery(
      `SELECT rd.*, b.namabarang, b.kodebarang, b.satuanbesar, b.satuansedang, b.satuankecil, b.konversi1, b.konversi2
       FROM returbelidtl rd
       LEFT JOIN barang b ON rd.idbarang = b.idbarang AND b.idtenant = rd.idtenant
       WHERE rd.idreturbeli = ?`,
      [req.params.id]
    );
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

// PUT — Membatalkan retur pembelian: ubah status ke VOID, balik stok (masuk kembali), hapus kartu hutang retur
exports.cancel = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const { id } = req.params;

    let [[retur]] = await conn.query(
      'SELECT * FROM returbeli WHERE idreturbeli = ? AND idtenant = ?',
      [id, ctx.idtenant]
    );
    if (!retur) {
      await conn.rollback();
      return res.status(404).json({ message: 'Retur pembelian tidak ditemukan' });
    }
    if (retur.status === 'VOID') {
      await conn.rollback();
      return res.status(400).json({ message: 'Retur pembelian sudah dibatalkan' });
    }

    await conn.query(
      'UPDATE returbeli SET status = ? WHERE idreturbeli = ? AND idtenant = ? AND idlokasi = ?',
      ['VOID', id, ctx.idtenant, retur.idlokasi]
    );

    // Hapus catatan hutang retur terkait
    await conn.query(
      "DELETE FROM kartuhutang WHERE kodetransreferensi = ? AND idtenant = ? AND idlokasi = ? AND jenis = 'RETUR'",
      [retur.kodereturbeli, ctx.idtenant, retur.idlokasi]
    );

    const [details] = await conn.query(
      'SELECT * FROM returbelidtl WHERE idreturbeli = ? AND idtenant = ?',
      [id, ctx.idtenant]
    );
    const today = new Date().toISOString().slice(0, 10);

    // Balik stok: barang yang sudah keluar dikembalikan masuk (VOID retur → stok masuk kembali)
    for (const dtl of details) {
      await conn.query(
        'INSERT INTO kartustok (idtenant, idlokasi, kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idref, jenisref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [ctx.idtenant, retur.idlokasi, `VOID-${retur.kodereturbeli}`, dtl.idbarang, dtl.jml, 'M', today, `Batal Retur Beli ${retur.kodereturbeli}`, retur.idreturbeli, 'returbeli_void']
      );
    }

    await conn.commit();
    await logger.history('RETURBELI_CANCEL', { idtenant: ctx.idtenant, idlokasi: retur.idlokasi, iduser: ctx.iduser, ref: retur.kodereturbeli, req });
    res.json({ message: 'Retur pembelian berhasil dibatalkan' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};
