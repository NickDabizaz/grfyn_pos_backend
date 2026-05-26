const { tenantQuery, tenantExecute, getConnection, getTenantContext } = require('../../config/db');
const logger = require('../../lib/logger');

const VALID_JENIS = ['PERSEN', 'NOMINAL', 'BELI_X_GRATIS_Y'];

exports.hitungDiskon = function hitungDiskon(diskon, grandtotal, jumlahItem) {
  if (!diskon || !diskon.status || diskon.status !== 'AKTIF') return 0;

  const nilai       = parseFloat(diskon.nilai) || 0;
  const minBeli     = parseFloat(diskon.min_pembelian) || 0;
  const maxDiskon   = diskon.max_diskon != null ? parseFloat(diskon.max_diskon) : null;

  if (grandtotal < minBeli) return 0;

  if (diskon.jenis === 'PERSEN') {
    let nominal = (nilai / 100) * grandtotal;
    if (maxDiskon !== null && nominal > maxDiskon) nominal = maxDiskon;
    return nominal;
  }

  if (diskon.jenis === 'NOMINAL') {
    return Math.min(nilai, grandtotal);
  }

  // BELI_X_GRATIS_Y is product-level; not computable from grandtotal alone
  return 0;
};

exports.getAll = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { search, status, jenis } = req.query;

    let sql = `
      SELECT d.*,
             DATE_FORMAT(d.tglawal, '%Y-%m-%d')  AS tglawal,
             DATE_FORMAT(d.tglakhir, '%Y-%m-%d') AS tglakhir,
             COUNT(dd.iddiskondtl) AS jumlah_item
      FROM diskon d
      LEFT JOIN diskondtl dd ON dd.iddiskon = d.idiskon AND dd.idtenant = d.idtenant
      WHERE d.idtenant = ?
    `;
    const params = [ctx.idtenant];

    if (search) {
      sql += ' AND (d.namadiskon LIKE ? OR d.kodediskon LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (status) {
      sql += ' AND d.status = ?';
      params.push(status);
    }
    if (jenis) {
      sql += ' AND d.jenis = ?';
      params.push(jenis);
    }

    sql += ' GROUP BY d.idiskon ORDER BY d.tglawal DESC, d.idiskon DESC';

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
    const { id } = req.params;

    const rows = await tenantQuery(
      `SELECT d.*,
              DATE_FORMAT(d.tglawal, '%Y-%m-%d')  AS tglawal,
              DATE_FORMAT(d.tglakhir, '%Y-%m-%d') AS tglakhir
       FROM diskon d
       WHERE d.idiskon = ? AND d.idtenant = ?`,
      [id, ctx.idtenant]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Diskon tidak ditemukan' });

    const items = await tenantQuery(
      `SELECT dd.*, b.namabarang, b.kodebarang
       FROM diskondtl dd
       LEFT JOIN barang b ON dd.idbarang = b.idbarang AND b.idtenant = dd.idtenant
       WHERE dd.iddiskon = ? AND dd.idtenant = ?`,
      [id, ctx.idtenant]
    );

    res.json({ ...rows[0], items });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

exports.getAktif = async (req, res) => {
  try {
    const ctx   = getTenantContext();
    const today = new Date().toISOString().slice(0, 10);

    const rows = await tenantQuery(
      `SELECT d.*,
              DATE_FORMAT(d.tglawal, '%Y-%m-%d')  AS tglawal,
              DATE_FORMAT(d.tglakhir, '%Y-%m-%d') AS tglakhir
       FROM diskon d
       WHERE d.idtenant = ? AND d.status = 'AKTIF'
         AND d.tglawal <= ? AND d.tglakhir >= ?
       ORDER BY d.idiskon ASC`,
      [ctx.idtenant, today, today]
    );
    res.json(rows);
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

    const {
      kodediskon, namadiskon, jenis, nilai,
      min_pembelian, min_qty, max_diskon,
      nilai_x, nilai_y,
      tglawal, tglakhir,
      berlaku_semua_barang,
      status,
      items,
    } = req.body;

    if (!kodediskon || !namadiskon) {
      await conn.rollback();
      return res.status(400).json({ message: 'kodediskon dan namadiskon wajib diisi' });
    }
    if (!VALID_JENIS.includes(jenis)) {
      await conn.rollback();
      return res.status(400).json({ message: `jenis harus salah satu dari: ${VALID_JENIS.join(', ')}` });
    }
    if (!tglawal || !tglakhir) {
      await conn.rollback();
      return res.status(400).json({ message: 'tglawal dan tglakhir wajib diisi' });
    }
    if (tglawal > tglakhir) {
      await conn.rollback();
      return res.status(400).json({ message: 'tglawal tidak boleh melebihi tglakhir' });
    }

    const semuaBarang = berlaku_semua_barang === false || berlaku_semua_barang === 0 ? 0 : 1;

    if (!semuaBarang && (!items || items.length === 0)) {
      await conn.rollback();
      return res.status(400).json({ message: 'items (idbarang) wajib diisi jika berlaku_semua_barang = false' });
    }

    const [result] = await conn.query(
      `INSERT INTO diskon
         (idtenant, kodediskon, namadiskon, jenis, nilai, min_pembelian, min_qty, max_diskon,
          nilai_x, nilai_y, tglawal, tglakhir, berlaku_semua_barang, status, userentry)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ctx.idtenant, kodediskon, namadiskon, jenis,
        parseFloat(nilai) || 0,
        parseFloat(min_pembelian) || 0,
        parseFloat(min_qty) || 0,
        max_diskon != null ? parseFloat(max_diskon) : null,
        nilai_x || null, nilai_y || null,
        tglawal, tglakhir,
        semuaBarang,
        status || 'AKTIF',
        ctx.iduser,
      ]
    );
    const idiskon = result.insertId;

    if (!semuaBarang && items && items.length > 0) {
      for (const idbarang of items) {
        await conn.query(
          'INSERT INTO diskondtl (iddiskon, idtenant, idbarang) VALUES (?, ?, ?)',
          [idiskon, ctx.idtenant, idbarang]
        );
      }
    }

    await conn.commit();
    res.status(201).json({ message: 'Diskon berhasil ditambah', idiskon });
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
    const {
      kodediskon, namadiskon, jenis, nilai,
      min_pembelian, min_qty, max_diskon,
      nilai_x, nilai_y,
      tglawal, tglakhir,
      berlaku_semua_barang,
      status,
      items,
    } = req.body;

    const [[existing]] = await conn.query(
      'SELECT idiskon FROM diskon WHERE idiskon = ? AND idtenant = ?',
      [id, ctx.idtenant]
    );
    if (!existing) {
      await conn.rollback();
      return res.status(404).json({ message: 'Diskon tidak ditemukan' });
    }

    if (jenis && !VALID_JENIS.includes(jenis)) {
      await conn.rollback();
      return res.status(400).json({ message: `jenis harus salah satu dari: ${VALID_JENIS.join(', ')}` });
    }
    if (tglawal && tglakhir && tglawal > tglakhir) {
      await conn.rollback();
      return res.status(400).json({ message: 'tglawal tidak boleh melebihi tglakhir' });
    }

    const semuaBarang = berlaku_semua_barang === false || berlaku_semua_barang === 0 ? 0 : 1;

    if (!semuaBarang && (!items || items.length === 0)) {
      await conn.rollback();
      return res.status(400).json({ message: 'items (idbarang) wajib diisi jika berlaku_semua_barang = false' });
    }

    await conn.query(
      `UPDATE diskon SET
         kodediskon = ?, namadiskon = ?, jenis = ?, nilai = ?,
         min_pembelian = ?, min_qty = ?, max_diskon = ?,
         nilai_x = ?, nilai_y = ?,
         tglawal = ?, tglakhir = ?,
         berlaku_semua_barang = ?, status = ?
       WHERE idiskon = ? AND idtenant = ?`,
      [
        kodediskon, namadiskon, jenis,
        parseFloat(nilai) || 0,
        parseFloat(min_pembelian) || 0,
        parseFloat(min_qty) || 0,
        max_diskon != null ? parseFloat(max_diskon) : null,
        nilai_x || null, nilai_y || null,
        tglawal, tglakhir,
        semuaBarang,
        status || 'AKTIF',
        id, ctx.idtenant,
      ]
    );

    await conn.query('DELETE FROM diskondtl WHERE iddiskon = ? AND idtenant = ?', [id, ctx.idtenant]);

    if (!semuaBarang && items && items.length > 0) {
      for (const idbarang of items) {
        await conn.query(
          'INSERT INTO diskondtl (iddiskon, idtenant, idbarang) VALUES (?, ?, ?)',
          [id, ctx.idtenant, idbarang]
        );
      }
    }

    await conn.commit();
    res.json({ message: 'Diskon berhasil diupdate' });
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
      'SELECT idiskon FROM diskon WHERE idiskon = ? AND idtenant = ?',
      [id, ctx.idtenant]
    );
    if (!existing) {
      await conn.rollback();
      return res.status(404).json({ message: 'Diskon tidak ditemukan' });
    }

    await conn.query('DELETE FROM diskondtl WHERE iddiskon = ? AND idtenant = ?', [id, ctx.idtenant]);
    await conn.query('DELETE FROM diskon WHERE idiskon = ? AND idtenant = ?', [id, ctx.idtenant]);

    await conn.commit();
    res.json({ message: 'Diskon berhasil dihapus' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message });
  } finally {
    conn.release();
  }
};
