const { tenantQuery, getConnection, getTenantContext } = require('../../config/db');
const { generateKodeReturBeli } = require('../../lib/kodetrans');
const logger = require('../../lib/logger');

async function calculateAndInsertDetails(conn, { idreturbeli, idtenant, items }) {
  const [[tenant]] = await conn.query('SELECT ppn FROM tenant WHERE idtenant = ?', [idtenant]);
  const ppnPercent = tenant ? parseFloat(tenant.ppn) : 11;
  let total = 0;

  for (const item of items) {
    const harga = parseFloat(item.harga || 0);
    const jml = parseFloat(item.jml || 0);
    const diskon = parseFloat(item.diskon || 0);
    const base = harga * jml;
    const ppn = item.ppn_mode === 'INCLUDE' ? (base * ppnPercent) / 100 : 0;
    const subtotal = base + ppn - ((base * diskon) / 100);
    total += subtotal;

    await conn.query(
      'INSERT INTO returbelidtl (idreturbeli, idtenant, idbarang, satuan, jml, harga, ppn, diskon, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [idreturbeli, idtenant, item.idbarang, item.satuan || null, jml, harga, ppn, diskon, subtotal]
    );
  }

  return total;
}

async function postApprovedRetur(conn, { idtenant, idlokasi, idsupplier, kodereturbeli, kodebeli, idreturbeli, tgltrans, total }) {
  const [details] = await conn.query(
    'SELECT * FROM returbelidtl WHERE idreturbeli = ? AND idtenant = ?',
    [idreturbeli, idtenant]
  );

  for (const item of details) {
    await conn.query(
      'INSERT INTO kartustok (idtenant, idlokasi, kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idref, jenisref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [idtenant, idlokasi, kodereturbeli, item.idbarang, item.jml, 'K', tgltrans, `Retur Pembelian ${kodereturbeli}`, idreturbeli, 'returbeli']
    );
  }

  if (kodebeli && idsupplier) {
    await conn.query(
      'INSERT INTO kartuhutang (idtenant, idlokasi, idsupplier, kodetrans, jenis, kodetransreferensi, amount, terbayar, sisa, tgltrans, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [idtenant, idlokasi, idsupplier, kodebeli, 'RETUR', kodereturbeli, -total, 0, -total, tgltrans, 'OPEN']
    );
  }
}

async function deletePostedRetur(conn, { idtenant, idlokasi, kodereturbeli }) {
  await conn.query(
    "DELETE FROM kartuhutang WHERE kodetransreferensi = ? AND idtenant = ? AND idlokasi = ? AND jenis = 'RETUR'",
    [kodereturbeli, idtenant, idlokasi]
  );
}

exports.create = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const { idsupplier, idlokasi, idbeli, kodebeli, items, catatan, tgltrans } = req.body;
    const approve = req.body.approve === true || req.body.status === 'APPROVED';
    const status = approve ? 'APPROVED' : 'DRAFT';

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

    await conn.query(
      'INSERT INTO returbeli (idtenant, idlokasi, kodereturbeli, tgltrans, idsupplier, idbeli, kodebeli, iduser, total, catatan, status, userentry) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)',
      [ctx.idtenant, idlokasi, kodereturbeli, tgl, idsupplier, idbeli || null, kodebeli || null, ctx.iduser, catatan || null, status, ctx.iduser]
    );

    const [[header]] = await conn.query(
      'SELECT idreturbeli FROM returbeli WHERE kodereturbeli = ? AND idtenant = ? AND idlokasi = ?',
      [kodereturbeli, ctx.idtenant, idlokasi]
    );

    const total = await calculateAndInsertDetails(conn, { idreturbeli: header.idreturbeli, idtenant: ctx.idtenant, items });
    await conn.query('UPDATE returbeli SET total = ? WHERE idreturbeli = ? AND idtenant = ?', [total, header.idreturbeli, ctx.idtenant]);

    if (approve) {
      await postApprovedRetur(conn, {
        idtenant: ctx.idtenant,
        idlokasi,
        idsupplier,
        kodereturbeli,
        kodebeli,
        idreturbeli: header.idreturbeli,
        tgltrans: tgl,
        total,
      });
    }

    await conn.commit();
    await logger.history('RETURBELI_CREATE', { idtenant: ctx.idtenant, idlokasi, iduser: ctx.iduser, ref: kodereturbeli, detail: { total, status }, req });
    res.status(201).json({ message: 'Retur pembelian berhasil dibuat', kodereturbeli, idreturbeli: header.idreturbeli, total, status });
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
    const { idsupplier, idlokasi, idbeli, kodebeli, items, catatan, tgltrans } = req.body;
    const approve = req.body.approve === true || req.body.status === 'APPROVED';
    const status = approve ? 'APPROVED' : 'DRAFT';

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

    const [[retur]] = await conn.query('SELECT * FROM returbeli WHERE idreturbeli = ? AND idtenant = ?', [id, ctx.idtenant]);
    if (!retur) {
      await conn.rollback();
      return res.status(404).json({ message: 'Retur pembelian tidak ditemukan' });
    }
    if (retur.status === 'CANCELLED') {
      await conn.rollback();
      return res.status(400).json({ message: 'Retur pembelian sudah dibatalkan' });
    }
    if (retur.status !== 'DRAFT') {
      await conn.rollback();
      return res.status(400).json({ message: 'Hanya Retur Pembelian DRAFT yang bisa diedit' });
    }

    const tgl = tgltrans || String(retur.tgltrans).slice(0, 10);
    await conn.query('DELETE FROM returbelidtl WHERE idreturbeli = ? AND idtenant = ?', [id, ctx.idtenant]);
    const total = await calculateAndInsertDetails(conn, { idreturbeli: id, idtenant: ctx.idtenant, items });
    await conn.query(
      'UPDATE returbeli SET tgltrans = ?, idlokasi = ?, idsupplier = ?, idbeli = ?, kodebeli = ?, total = ?, catatan = ?, status = ? WHERE idreturbeli = ? AND idtenant = ?',
      [tgl, idlokasi, idsupplier, idbeli || null, kodebeli || null, total, catatan || null, status, id, ctx.idtenant]
    );

    if (approve) {
      await postApprovedRetur(conn, {
        idtenant: ctx.idtenant,
        idlokasi,
        idsupplier,
        kodereturbeli: retur.kodereturbeli,
        kodebeli,
        idreturbeli: id,
        tgltrans: tgl,
        total,
      });
    }

    await conn.commit();
    await logger.history('RETURBELI_UPDATE', { idtenant: ctx.idtenant, idlokasi, iduser: ctx.iduser, ref: retur.kodereturbeli, detail: { total, status }, req });
    res.json({ message: 'Retur pembelian berhasil diupdate', total, status });
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
    let sql = `SELECT r.*, s.namasupplier
      FROM returbeli r
      LEFT JOIN supplier s ON r.idsupplier = s.idsupplier AND s.idtenant = r.idtenant
      WHERE r.idtenant = ?`;
    const params = [ctx.idtenant];
    if (idlokasi)   { sql += ' AND r.idlokasi = ?'; params.push(idlokasi); }
    if (tglwal)     { sql += ' AND r.tgltrans >= ?'; params.push(tglwal); }
    if (tglakhir)   { sql += ' AND r.tgltrans <= ?'; params.push(tglakhir); }
    if (idsupplier) { sql += ' AND r.idsupplier = ?'; params.push(idsupplier); }
    if (search)     { sql += ' AND r.kodereturbeli LIKE ?'; params.push(`%${search}%`); }
    sql += ' ORDER BY r.tgltrans DESC, r.idreturbeli DESC LIMIT 200';
    const rows = await tenantQuery(sql, params);
    res.json(rows.map(row => ({
      ...row,
      status: row.status === 'AKTIF' ? 'APPROVED' : row.status,
    })));
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

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
    res.json({
      ...rows[0],
      status: rows[0].status === 'AKTIF' ? 'APPROVED' : rows[0].status,
      items: mappedItems,
    });
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

    const [[retur]] = await conn.query(
      'SELECT * FROM returbeli WHERE idreturbeli = ? AND idtenant = ?',
      [id, ctx.idtenant]
    );
    if (!retur) {
      await conn.rollback();
      return res.status(404).json({ message: 'Retur pembelian tidak ditemukan' });
    }
    if (retur.status === 'CANCELLED') {
      await conn.rollback();
      return res.status(400).json({ message: 'Retur pembelian sudah dibatalkan' });
    }

    await conn.query(
      'UPDATE returbeli SET status = ? WHERE idreturbeli = ? AND idtenant = ? AND idlokasi = ?',
      ['CANCELLED', id, ctx.idtenant, retur.idlokasi]
    );

    if (retur.status === 'APPROVED' || retur.status === 'AKTIF') {
      await deletePostedRetur(conn, {
        idtenant: ctx.idtenant,
        idlokasi: retur.idlokasi,
        kodereturbeli: retur.kodereturbeli,
      });

      const [details] = await conn.query(
        'SELECT * FROM returbelidtl WHERE idreturbeli = ? AND idtenant = ?',
        [id, ctx.idtenant]
      );
      const today = new Date().toISOString().slice(0, 10);

      for (const dtl of details) {
        await conn.query(
          'INSERT INTO kartustok (idtenant, idlokasi, kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idref, jenisref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [ctx.idtenant, retur.idlokasi, `CANCEL-${retur.kodereturbeli}`, dtl.idbarang, dtl.jml, 'M', today, `Batal Retur Beli ${retur.kodereturbeli}`, retur.idreturbeli, 'returbeli_cancel']
        );
      }
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

exports.unapprove = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const { id } = req.params;

    const [[retur]] = await conn.query(
      'SELECT * FROM returbeli WHERE idreturbeli = ? AND idtenant = ?',
      [id, ctx.idtenant]
    );
    if (!retur) {
      await conn.rollback();
      return res.status(404).json({ message: 'Retur pembelian tidak ditemukan' });
    }
    if (retur.status !== 'APPROVED' && retur.status !== 'AKTIF') {
      await conn.rollback();
      return res.status(400).json({ message: 'Hanya Retur Pembelian APPROVED yang bisa batal approve' });
    }

    await deletePostedRetur(conn, {
      idtenant: ctx.idtenant,
      idlokasi: retur.idlokasi,
      kodereturbeli: retur.kodereturbeli,
    });

    const [details] = await conn.query(
      'SELECT * FROM returbelidtl WHERE idreturbeli = ? AND idtenant = ?',
      [id, ctx.idtenant]
    );
    const today = new Date().toISOString().slice(0, 10);

    for (const dtl of details) {
      await conn.query(
        'INSERT INTO kartustok (idtenant, idlokasi, kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idref, jenisref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [ctx.idtenant, retur.idlokasi, `UNAPPROVE-${retur.kodereturbeli}`, dtl.idbarang, dtl.jml, 'M', today, `Batal Approve Retur Beli ${retur.kodereturbeli}`, retur.idreturbeli, 'returbeli_unapprove']
      );
    }

    await conn.query(
      "UPDATE returbeli SET status = 'DRAFT' WHERE idreturbeli = ? AND idtenant = ?",
      [id, ctx.idtenant]
    );

    await conn.commit();
    await logger.history('RETURBELI_UNAPPROVE', { idtenant: ctx.idtenant, idlokasi: retur.idlokasi, iduser: ctx.iduser, ref: retur.kodereturbeli, req });
    res.json({ message: 'Approve Retur Pembelian dibatalkan' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};
