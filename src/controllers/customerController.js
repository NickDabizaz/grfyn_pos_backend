const { tenantQuery, tenantExecute, getTenantContext } = require('../config/db');
const { generateKodeMaster } = require('../lib/kodetrans');

exports.getAll = async (req, res) => {
  try {
    const { search } = req.query;
    let sql = 'SELECT * FROM customer WHERE 1=1';
    const params = [];
    if (search) { sql += ' AND (namacustomer LIKE ? OR kodecustomer LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    sql += ' ORDER BY idcustomer ASC';
    const rows = await tenantQuery(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.create = async (req, res) => {
  try {
    const ctx                          = getTenantContext();
    const { namacustomer, alamat, hp } = req.body;
    const kodecustomer                 = await generateKodeMaster(await require('../config/db').getConnection(), 'CST', ctx.idtenant, 'customer', 'kodecustomer', 4);
    await tenantExecute(
      'INSERT INTO customer (idtenant, kodecustomer, namacustomer, alamat, hp, status, userentry) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [ctx.idtenant, kodecustomer, namacustomer, alamat || '', hp || '', 'AKTIF', ctx.iduser]
    );
    res.status(201).json({ message: 'Customer berhasil ditambah', kodecustomer });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.update = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { namacustomer, alamat, hp } = req.body;
    await tenantExecute('UPDATE customer SET namacustomer = ?, alamat = ?, hp = ? WHERE idcustomer = ? AND idtenant = ?',
      [namacustomer, alamat, hp, req.params.id, ctx.idtenant]);
    res.json({ message: 'Customer berhasil diupdate' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const conn = await require('../config/db').getConnection();
    const [[{ cnt }]] = await conn.query('SELECT COUNT(*) as cnt FROM jual WHERE idcustomer = ? AND idtenant = ?', [req.params.id, ctx.idtenant]);
    conn.release();
    if (cnt > 0) {
      return res.status(400).json({ message: 'Customer sudah digunakan di transaksi. Nonaktifkan saja.' });
    }
    await tenantExecute('DELETE FROM customer WHERE idcustomer = ? AND idtenant = ?', [req.params.id, ctx.idtenant]);
    res.json({ message: 'Customer berhasil dihapus' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
