const { tenantQuery, tenantExecute, getConnection, getTenantContext } = require('../../config/db');
const logger = require('../../lib/logger');

exports.getAll = async (req, res) => {
  try {
    const rows = await tenantQuery(
      `SELECT * FROM hargajual_level WHERE 1=1 ORDER BY urutan ASC, idhargajuallevel ASC`
    );
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

exports.getOne = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { id } = req.params;

    const rows = await tenantQuery(
      'SELECT * FROM hargajual_level WHERE idhargajuallevel = ? AND idtenant = ?',
      [id, ctx.idtenant]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Harga level tidak ditemukan' });

    const items = await tenantQuery(
      `SELECT ld.*, b.namabarang, b.kodebarang
       FROM hargajual_leveldtl ld
       LEFT JOIN barang b ON ld.idbarang = b.idbarang AND b.idtenant = ld.idtenant
       WHERE ld.idhargajuallevel = ? AND ld.idtenant = ?
       ORDER BY b.kodebarang ASC`,
      [id, ctx.idtenant]
    );

    res.json({ ...rows[0], items });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

exports.create = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();

    const { namalevel, deskripsi, urutan, status, items } = req.body;

    if (!namalevel) {
      await conn.rollback();
      return res.status(400).json({ message: 'namalevel wajib diisi' });
    }

    if (items && items.length > 0) {
      for (const item of items) {
        if (parseFloat(item.hargajual) < 0) {
          await conn.rollback();
          return res.status(400).json({ message: 'hargajual tidak boleh negatif' });
        }
      }
    }

    const [result] = await conn.query(
      `INSERT INTO hargajual_level (idtenant, namalevel, deskripsi, urutan, status, userentry)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        ctx.idtenant,
        namalevel,
        deskripsi || null,
        parseInt(urutan) || 0,
        status || 'AKTIF',
        ctx.iduser,
      ]
    );
    const idhargajuallevel = result.insertId;

    if (items && items.length > 0) {
      for (const item of items) {
        await conn.query(
          `INSERT INTO hargajual_leveldtl (idhargajuallevel, idtenant, idbarang, satuan, hargajual)
           VALUES (?, ?, ?, ?, ?)`,
          [idhargajuallevel, ctx.idtenant, item.idbarang, item.satuan || null, parseFloat(item.hargajual) || 0]
        );
      }
    }

    await conn.commit();
    res.status(201).json({ message: 'Harga level berhasil ditambah', idhargajuallevel });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message });
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
    const { namalevel, deskripsi, urutan, status, items } = req.body;

    const [[existing]] = await conn.query(
      'SELECT idhargajuallevel FROM hargajual_level WHERE idhargajuallevel = ? AND idtenant = ?',
      [id, ctx.idtenant]
    );
    if (!existing) {
      await conn.rollback();
      return res.status(404).json({ message: 'Harga level tidak ditemukan' });
    }

    if (items && items.length > 0) {
      for (const item of items) {
        if (parseFloat(item.hargajual) < 0) {
          await conn.rollback();
          return res.status(400).json({ message: 'hargajual tidak boleh negatif' });
        }
      }
    }

    await conn.query(
      `UPDATE hargajual_level SET namalevel = ?, deskripsi = ?, urutan = ?, status = ?
       WHERE idhargajuallevel = ? AND idtenant = ?`,
      [namalevel, deskripsi || null, parseInt(urutan) || 0, status || 'AKTIF', id, ctx.idtenant]
    );

    await conn.query(
      'DELETE FROM hargajual_leveldtl WHERE idhargajuallevel = ? AND idtenant = ?',
      [id, ctx.idtenant]
    );

    if (items && items.length > 0) {
      for (const item of items) {
        await conn.query(
          `INSERT INTO hargajual_leveldtl (idhargajuallevel, idtenant, idbarang, satuan, hargajual)
           VALUES (?, ?, ?, ?, ?)`,
          [id, ctx.idtenant, item.idbarang, item.satuan || null, parseFloat(item.hargajual) || 0]
        );
      }
    }

    await conn.commit();
    res.json({ message: 'Harga level berhasil diupdate' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.remove = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();

    const { id } = req.params;

    const [[existing]] = await conn.query(
      'SELECT idhargajuallevel FROM hargajual_level WHERE idhargajuallevel = ? AND idtenant = ?',
      [id, ctx.idtenant]
    );
    if (!existing) {
      await conn.rollback();
      return res.status(404).json({ message: 'Harga level tidak ditemukan' });
    }

    await conn.query(
      'DELETE FROM hargajual_leveldtl WHERE idhargajuallevel = ? AND idtenant = ?',
      [id, ctx.idtenant]
    );
    await conn.query(
      'DELETE FROM hargajual_level WHERE idhargajuallevel = ? AND idtenant = ?',
      [id, ctx.idtenant]
    );

    await conn.commit();
    res.json({ message: 'Harga level berhasil dihapus' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.getBarangPrice = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { idbarang } = req.params;

    const levels = await tenantQuery(
      `SELECT l.idhargajuallevel, l.namalevel, l.urutan, l.status,
              COALESCE(ld.hargajual, 0) AS hargajual,
              ld.satuan
       FROM hargajual_level l
       LEFT JOIN hargajual_leveldtl ld
         ON ld.idhargajuallevel = l.idhargajuallevel
        AND ld.idbarang = ?
        AND ld.idtenant = l.idtenant
       WHERE l.idtenant = ?
       ORDER BY l.urutan ASC, l.idhargajuallevel ASC`,
      [idbarang, ctx.idtenant]
    );

    res.json(levels);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

exports.applyToCustomer = async (req, res) => {
  let conn;
  try {
    const ctx = getTenantContext();
    const { idcustomer, idhargajuallevel } = req.body;

    if (!idcustomer) {
      return res.status(400).json({ message: 'idcustomer wajib diisi' });
    }

    conn = await getConnection();
    const [[customer]] = await conn.query(
      'SELECT idcustomer FROM customer WHERE idcustomer = ? AND idtenant = ?',
      [idcustomer, ctx.idtenant]
    );
    if (!customer) {
      return res.status(404).json({ message: 'Customer tidak ditemukan' });
    }

    await conn.query(
      'UPDATE customer SET idhargajuallevel = ? WHERE idcustomer = ? AND idtenant = ?',
      [idhargajuallevel || null, idcustomer, ctx.idtenant]
    );

    res.json({ message: 'Harga level customer berhasil diset' });
  } catch (err) {
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message });
  } finally {
    if (conn) conn.release();
  }
};
