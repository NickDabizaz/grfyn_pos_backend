const { tenantQuery, tenantExecute, getConnection, getTenantContext } = require('../config/db');
const { generateKodeKas } = require('../lib/kodetrans');

exports.getAll = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { search } = req.query;
    let sql = 'SELECT k.* FROM kas k WHERE 1=1';
    const params = [];
    sql += ' AND k.idlokasi = ?'; params.push(ctx.idlokasi);
    if (search) { sql += ' AND k.kodekas LIKE ?'; params.push(`%${search}%`); }
    sql += ' ORDER BY k.idkas DESC';
    const rows = await tenantQuery(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getOne = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const rows = await tenantQuery('SELECT k.* FROM kas k WHERE k.idkas = ? AND k.idlokasi = ?', [req.params.id, ctx.idlokasi]);
    if (rows.length === 0) return res.status(404).json({ message: 'Kas tidak ditemukan' });

    const details = await tenantQuery(
      'SELECT kd.*, a.kodeakun, a.namaakun FROM kasdtl kd JOIN akun a ON kd.idakun = a.idakun AND a.idtenant = kd.idtenant WHERE kd.idkas = ?',
      [req.params.id]
    );

    res.json({ ...rows[0], details });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.create = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const { details } = req.body;

    const kodekas = await generateKodeKas(conn, ctx.idtenant, ctx.idlokasi);
    const tgltrans = new Date().toISOString().slice(0, 10);

    const [result] = await conn.query(
      'INSERT INTO kas (idtenant, idlokasi, kodekas, tgltrans, iduser, status, userentry) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [ctx.idtenant, ctx.idlokasi, kodekas, tgltrans, ctx.iduser, 'AKTIF', ctx.iduser]
    );
    const idkas = result.insertId;

    for (const d of details) {
      await conn.query(
        'INSERT INTO kasdtl (idkas, idtenant, idakun, catatan, amount) VALUES (?, ?, ?, ?, ?)',
        [idkas, ctx.idtenant, d.idakun, d.catatan || '', d.amount]
      );

      const [[akun]] = await conn.query('SELECT namaakun FROM akun WHERE idakun = ? AND idtenant = ?', [d.idakun, ctx.idtenant]);
      const posisi = akun && akun.namaakun === 'KAS' ? 'DEBET' : (d.amount >= 0 ? 'DEBET' : 'KREDIT');

      await conn.query(
        'INSERT INTO jurnal (idtenant, idlokasi, idtrans, kodetrans, jenis, idakun, posisi, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [ctx.idtenant, ctx.idlokasi, idkas, kodekas, 'kas', d.idakun, posisi, Math.abs(d.amount)]
      );
    }

    await conn.commit();
    res.status(201).json({ message: 'Kas berhasil ditambah', idkas, kodekas });
  } catch (err) {
    await conn.rollback();
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
    const { details } = req.body;
    const { id } = req.params;

    const [rows] = await conn.query('SELECT * FROM kas WHERE idkas = ? AND idtenant = ? AND idlokasi = ?', [id, ctx.idtenant, ctx.idlokasi]);
    if (rows.length === 0) return res.status(404).json({ message: 'Kas tidak ditemukan' });

    await conn.query("DELETE FROM jurnal WHERE jenis = ? AND idtrans = ? AND idtenant = ? AND idlokasi = ?", ['kas', id, ctx.idtenant, ctx.idlokasi]);
    await conn.query('DELETE FROM kasdtl WHERE idkas = ? AND idtenant = ?', [id, ctx.idtenant]);

    for (const d of details) {
      await conn.query(
        'INSERT INTO kasdtl (idkas, idtenant, idakun, catatan, amount) VALUES (?, ?, ?, ?, ?)',
        [id, ctx.idtenant, d.idakun, d.catatan || '', d.amount]
      );

      const [[akun]] = await conn.query('SELECT namaakun FROM akun WHERE idakun = ? AND idtenant = ?', [d.idakun, ctx.idtenant]);
      const posisi = akun && akun.namaakun === 'KAS' ? 'DEBET' : (d.amount >= 0 ? 'DEBET' : 'KREDIT');

      await conn.query(
        'INSERT INTO jurnal (idtenant, idlokasi, idtrans, kodetrans, jenis, idakun, posisi, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [ctx.idtenant, ctx.idlokasi, id, rows[0].kodekas, 'kas', d.idakun, posisi, Math.abs(d.amount)]
      );
    }

    await conn.commit();
    res.json({ message: 'Kas berhasil diupdate' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.remove = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.query("DELETE FROM jurnal WHERE jenis = ? AND idtrans = ? AND idtenant = ? AND idlokasi = ?", ['kas', req.params.id, ctx.idtenant, ctx.idlokasi]);
    await conn.query('DELETE FROM kas WHERE idkas = ? AND idtenant = ? AND idlokasi = ?', [req.params.id, ctx.idtenant, ctx.idlokasi]);
    res.json({ message: 'Kas berhasil dihapus' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};
