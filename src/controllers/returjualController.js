const { tenantQuery, tenantExecute, getConnection, getTenantContext } = require('../config/db');
const { generateKodeReturJual } = require('../lib/kodetrans');
const logger = require('../lib/logger');

const VALID_TINDAKLANJUT = ['MASUK_STOK', 'MASUK_STOK_2ND', 'HANGUS'];

exports.create = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const { idcustomer, idjual, kodejual, items, catatan } = req.body;

    if (!items || !items.length) return res.status(400).json({ message: 'Items tidak boleh kosong' });

    for (const item of items) {
      if (!VALID_TINDAKLANJUT.includes(item.tindaklanjut)) {
        return res.status(400).json({ message: `tindaklanjut tidak valid: ${item.tindaklanjut}` });
      }
      if (item.tindaklanjut === 'MASUK_STOK_2ND' && !item.idbarang2nd) {
        return res.status(400).json({ message: 'idbarang2nd wajib diisi untuk tindaklanjut MASUK_STOK_2ND' });
      }
    }

    const kodereturjual = await generateKodeReturJual(conn, ctx.idtenant, ctx.idlokasi);
    const tgltrans = req.body.tgltrans || new Date().toISOString().slice(0, 10);

    await conn.query(
      'INSERT INTO returjual (idtenant, idlokasi, kodereturjual, tgltrans, idcustomer, idjual, kodejual, iduser, total, catatan, status, userentry) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)',
      [ctx.idtenant, ctx.idlokasi, kodereturjual, tgltrans, idcustomer || null, idjual || null, kodejual || null, ctx.iduser, catatan || null, 'AKTIF', ctx.iduser]
    );

    const [[header]] = await conn.query(
      'SELECT idreturjual FROM returjual WHERE kodereturjual = ? AND idtenant = ? AND idlokasi = ?',
      [kodereturjual, ctx.idtenant, ctx.idlokasi]
    );

    let calculatedTotal = 0;

    for (const item of items) {
      const subtotal = parseFloat(item.harga || 0) * item.jml;
      calculatedTotal += subtotal;

      await conn.query(
        'INSERT INTO returjualdtl (idreturjual, idtenant, idbarang, jml, harga, subtotal, tindaklanjut, idbarang2nd) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [header.idreturjual, ctx.idtenant, item.idbarang, item.jml, item.harga || 0, subtotal, item.tindaklanjut, item.idbarang2nd || null]
      );

      if (item.tindaklanjut === 'MASUK_STOK') {
        await conn.query(
          'INSERT INTO kartustok (idtenant, idlokasi, kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idref, jenisref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [ctx.idtenant, ctx.idlokasi, kodereturjual, item.idbarang, item.jml, 'M', tgltrans, `Retur Penjualan ${kodereturjual}`, header.idreturjual, 'returjual']
        );
      } else if (item.tindaklanjut === 'MASUK_STOK_2ND') {
        await conn.query(
          'INSERT INTO kartustok (idtenant, idlokasi, kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idref, jenisref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [ctx.idtenant, ctx.idlokasi, kodereturjual, item.idbarang2nd, item.jml, 'M', tgltrans, `Retur Penjualan 2nd ${kodereturjual}`, header.idreturjual, 'returjual']
        );
      }
      // HANGUS: tidak ada pergerakan stok
    }

    await conn.query('UPDATE returjual SET total = ? WHERE idreturjual = ? AND idtenant = ?',
      [calculatedTotal, header.idreturjual, ctx.idtenant]);

    await conn.commit();
    await logger.history('RETURJUAL_CREATE', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: kodereturjual, detail: { total: calculatedTotal }, req });
    res.status(201).json({ message: 'Retur berhasil dibuat', kodereturjual, idreturjual: header.idreturjual, total: calculatedTotal });
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
    const { tglwal, tglakhir, idcustomer, search } = req.query;
    let sql = `SELECT r.*, c.namacustomer
      FROM returjual r
      LEFT JOIN customer c ON r.idcustomer = c.idcustomer AND c.idtenant = r.idtenant
      WHERE r.idlokasi = ?`;
    const params = [ctx.idlokasi];
    if (tglwal) { sql += ' AND r.tgltrans >= ?'; params.push(tglwal); }
    if (tglakhir) { sql += ' AND r.tgltrans <= ?'; params.push(tglakhir); }
    if (idcustomer) { sql += ' AND r.idcustomer = ?'; params.push(idcustomer); }
    if (search) { sql += ' AND r.kodereturjual LIKE ?'; params.push(`%${search}%`); }
    sql += ' ORDER BY r.tgltrans DESC, r.idreturjual DESC LIMIT 200';
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
    const rows = await tenantQuery(`SELECT r.*, c.namacustomer
      FROM returjual r
      LEFT JOIN customer c ON r.idcustomer = c.idcustomer AND c.idtenant = r.idtenant
      WHERE r.idreturjual = ? AND r.idlokasi = ?`, [req.params.id, ctx.idlokasi]);
    if (rows.length === 0) return res.status(404).json({ message: 'Retur tidak ditemukan' });

    const items = await tenantQuery(`SELECT rd.*, b.namabarang, b.satuankecil,
        b2.namabarang as namabarang2nd
      FROM returjualdtl rd
      LEFT JOIN barang b ON rd.idbarang = b.idbarang AND b.idtenant = rd.idtenant
      LEFT JOIN barang b2 ON rd.idbarang2nd = b2.idbarang AND b2.idtenant = rd.idtenant
      WHERE rd.idreturjual = ?`, [req.params.id]);
    res.json({ ...rows[0], items });
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

    const [[retur]] = await conn.query('SELECT * FROM returjual WHERE idreturjual = ? AND idtenant = ? AND idlokasi = ?', [id, ctx.idtenant, ctx.idlokasi]);
    if (!retur) return res.status(404).json({ message: 'Retur tidak ditemukan' });
    if (retur.status === 'VOID') return res.status(400).json({ message: 'Retur sudah dibatalkan' });

    await conn.query('UPDATE returjual SET status = ? WHERE idreturjual = ? AND idtenant = ? AND idlokasi = ?', ['VOID', id, ctx.idtenant, ctx.idlokasi]);

    const [details] = await conn.query('SELECT * FROM returjualdtl WHERE idreturjual = ? AND idtenant = ?', [id, ctx.idtenant]);
    const today = new Date().toISOString().slice(0, 10);

    for (const dtl of details) {
      if (dtl.tindaklanjut === 'MASUK_STOK') {
        await conn.query(
          'INSERT INTO kartustok (idtenant, idlokasi, kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idref, jenisref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [ctx.idtenant, ctx.idlokasi, `VOID-${retur.kodereturjual}`, dtl.idbarang, dtl.jml, 'K', today, `Batal Retur ${retur.kodereturjual}`, retur.idreturjual, 'returjual_void']
        );
      } else if (dtl.tindaklanjut === 'MASUK_STOK_2ND' && dtl.idbarang2nd) {
        await conn.query(
          'INSERT INTO kartustok (idtenant, idlokasi, kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idref, jenisref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [ctx.idtenant, ctx.idlokasi, `VOID-${retur.kodereturjual}`, dtl.idbarang2nd, dtl.jml, 'K', today, `Batal Retur 2nd ${retur.kodereturjual}`, retur.idreturjual, 'returjual_void']
        );
      }
    }

    await conn.commit();
    await logger.history('RETURJUAL_CANCEL', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: retur.kodereturjual, req });
    res.json({ message: 'Retur berhasil dibatalkan' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};
