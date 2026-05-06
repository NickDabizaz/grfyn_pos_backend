const { tenantQuery, tenantExecute, getTenantContext } = require('../config/db');
const { generateKodeMaster } = require('../lib/kodetrans');

exports.getAll = async (req, res) => {
  try {
    const { search } = req.query;
    let sql = 'SELECT * FROM supplier WHERE 1=1';
    const params = [];
    if (search) { sql += ' AND (namasupplier LIKE ? OR kodesupplier LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    sql += ' ORDER BY idsupplier ASC';
    const rows = await tenantQuery(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.create = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { namasupplier, alamat, hp } = req.body;
    const kodesupplier = await generateKodeMaster(await require('../config/db').getConnection(), 'SUP', ctx.idtenant, 'supplier', 'kodesupplier', 4);
    await tenantExecute(
      'INSERT INTO supplier (idtenant, kodesupplier, namasupplier, alamat, hp, status, userentry) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [ctx.idtenant, kodesupplier, namasupplier, alamat || '', hp || '', 'AKTIF', ctx.iduser]
    );
    res.status(201).json({ message: 'Supplier berhasil ditambah', kodesupplier });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.update = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { namasupplier, alamat, hp } = req.body;
    await tenantExecute('UPDATE supplier SET namasupplier = ?, alamat = ?, hp = ? WHERE idsupplier = ? AND idtenant = ?',
      [namasupplier, alamat, hp, req.params.id, ctx.idtenant]);
    res.json({ message: 'Supplier berhasil diupdate' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const conn = await require('../config/db').getConnection();
    const [[{ cnt }]] = await conn.query('SELECT COUNT(*) as cnt FROM beli WHERE idsupplier = ? AND idtenant = ?', [req.params.id, ctx.idtenant]);
    conn.release();
    if (cnt > 0) {
      return res.status(400).json({ message: 'Supplier sudah digunakan di transaksi. Nonaktifkan saja.' });
    }
    await tenantExecute('DELETE FROM supplier WHERE idsupplier = ? AND idtenant = ?', [req.params.id, ctx.idtenant]);
    res.json({ message: 'Supplier berhasil dihapus' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
