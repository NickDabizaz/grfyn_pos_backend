const { tenantQuery, tenantExecute, getConnection, getTenantContext } = require('../config/db');
const { generateKodeMaster } = require('../lib/kodetrans');

exports.getAll = async (req, res) => {
  try {
    const { search } = req.query;
    let sql = 'SELECT * FROM akun WHERE 1=1';
    const params = [];
    if (search) { sql += ' AND (namaakun LIKE ? OR kodeakun LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    sql += ' ORDER BY idakun DESC';
    const rows = await tenantQuery(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getOne = async (req, res) => {
  try {
    const rows = await tenantQuery('SELECT * FROM akun WHERE idakun = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Akun tidak ditemukan' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.create = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const { namaakun, saldo } = req.body;

    const kodeakun = await generateKodeMaster(conn, 'AKN', ctx.idtenant, 'akun', 'kodeakun', 4);

    await conn.query(
      'INSERT INTO akun (idtenant, kodeakun, namaakun, saldo, status, userentry) VALUES (?, ?, ?, ?, ?, ?)',
      [ctx.idtenant, kodeakun, namaakun, saldo || 'DEBET', 'AKTIF', ctx.iduser]
    );

    await conn.commit();
    res.status(201).json({ message: 'Akun berhasil ditambah', kodeakun });
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
    const { namaakun, saldo, status } = req.body;
    const { id } = req.params;

    const [rows] = await conn.query('SELECT * FROM akun WHERE idakun = ? AND idtenant = ?', [id, ctx.idtenant]);
    if (rows.length === 0) return res.status(404).json({ message: 'Akun tidak ditemukan' });

    await conn.query(
      'UPDATE akun SET namaakun = ?, saldo = ?, status = ? WHERE idakun = ? AND idtenant = ?',
      [namaakun || rows[0].namaakun, saldo ?? rows[0].saldo, status ?? rows[0].status, id, ctx.idtenant]
    );

    await conn.commit();
    res.json({ message: 'Akun berhasil diupdate' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.remove = async (req, res) => {
  try {
    const ctx         = getTenantContext();
    const conn        = await getConnection();
    const [[{ cnt }]] = await conn.query('SELECT COUNT(*) as cnt FROM jurnal WHERE idakun = ? AND idtenant = ?', [req.params.id, ctx.idtenant]);
    conn.release();
    if (cnt > 0) {
      return res.status(400).json({ message: 'Akun sudah digunakan di jurnal. Nonaktifkan saja.' });
    }
    await tenantExecute('DELETE FROM akun WHERE idakun = ? AND idtenant = ?', [req.params.id, ctx.idtenant]);
    res.json({ message: 'Akun berhasil dihapus' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
