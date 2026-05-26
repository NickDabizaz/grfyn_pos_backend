const { tenantQuery, tenantExecute, getConnection, getTenantContext } = require('../../config/db');
const logger = require('../../lib/logger');

async function generateKodeAnggaran(conn, idtenant, idlokasi, periode) {
  const pattern = `ANGG-${periode}-%`;
  const [[{ maxKode }]] = await conn.query(
    'SELECT MAX(kodeanggaran) AS maxKode FROM anggaran WHERE idtenant = ? AND idlokasi = ? AND kodeanggaran LIKE ?',
    [idtenant, idlokasi, pattern]
  );
  let num = 1;
  if (maxKode) {
    const parts = maxKode.split('-');
    num = parseInt(parts[parts.length - 1]) + 1;
  }
  return `ANGG-${periode}-${String(num).padStart(3, '0')}`;
}

exports.getAll = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { status, periode } = req.query;
    let sql = 'SELECT a.* FROM anggaran a WHERE a.idlokasi = ?';
    const params = [ctx.idlokasi];
    if (status) { sql += ' AND a.status = ?'; params.push(status); }
    if (periode) { sql += ' AND a.periode = ?'; params.push(periode); }
    sql += ' ORDER BY a.idanggaran DESC';
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
    const rows = await tenantQuery(
      'SELECT a.* FROM anggaran a WHERE a.idanggaran = ? AND a.idlokasi = ?',
      [req.params.id, ctx.idlokasi]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Anggaran tidak ditemukan' });

    const details = await tenantQuery(
      `SELECT ad.*, ak.kodeakun, ak.namaakun, ak.jenisak, ak.saldo AS saldo_normal
       FROM anggarandtl ad
       JOIN akun ak ON ad.idakun = ak.idakun AND ak.idtenant = ad.idtenant
       WHERE ad.idanggaran = ?
       ORDER BY ak.kodeakun, ad.bulan`,
      [req.params.id]
    );

    const akunMap = {};
    for (const d of details) {
      if (!akunMap[d.idakun]) {
        akunMap[d.idakun] = {
          idakun: d.idakun,
          kodeakun: d.kodeakun,
          namaakun: d.namaakun,
          jenisak: d.jenisak,
          saldo_normal: d.saldo_normal,
          bulan: Array(12).fill(0),
        };
      }
      akunMap[d.idakun].bulan[d.bulan - 1] = parseFloat(d.nilai_anggaran);
    }

    res.json({ ...rows[0], items: Object.values(akunMap) });
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

    const { namaanggaran, periode, tglawal, tglakhir, items } = req.body;

    if (!namaanggaran || !periode || !tglawal || !tglakhir) {
      await conn.rollback();
      return res.status(400).json({ message: 'namaanggaran, periode, tglawal, tglakhir wajib diisi' });
    }
    if (!/^\d{4}$/.test(String(periode))) {
      await conn.rollback();
      return res.status(400).json({ message: 'periode harus berupa tahun 4 digit (YYYY)' });
    }
    if (tglawal > tglakhir) {
      await conn.rollback();
      return res.status(400).json({ message: 'tglawal tidak boleh lebih besar dari tglakhir' });
    }
    if (!items || !items.length) {
      await conn.rollback();
      return res.status(400).json({ message: 'items tidak boleh kosong' });
    }

    const kodeanggaran = await generateKodeAnggaran(conn, ctx.idtenant, ctx.idlokasi, periode);
    const total_anggaran = items.reduce((sum, it) => sum + (parseFloat(it.nilai_anggaran) || 0), 0);

    const [result] = await conn.query(
      `INSERT INTO anggaran (idtenant, idlokasi, kodeanggaran, namaanggaran, periode, tglawal, tglakhir, total_anggaran, status, userentry)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?)`,
      [ctx.idtenant, ctx.idlokasi, kodeanggaran, namaanggaran, periode, tglawal, tglakhir, total_anggaran, ctx.iduser]
    );
    const idanggaran = result.insertId;

    for (const it of items) {
      await conn.query(
        `INSERT INTO anggarandtl (idanggaran, idtenant, idakun, bulan, nilai_anggaran, nilai_realisasi)
         VALUES (?, ?, ?, ?, ?, 0)`,
        [idanggaran, ctx.idtenant, it.idakun, it.bulan, parseFloat(it.nilai_anggaran) || 0]
      );
    }

    await conn.commit();
    await logger.history('ANGGARAN_CREATE', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: kodeanggaran, req });
    res.status(201).json({ message: 'Anggaran berhasil ditambah', idanggaran, kodeanggaran });
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
    const { namaanggaran, tglawal, tglakhir, items } = req.body;

    const [[anggaran]] = await conn.query(
      'SELECT * FROM anggaran WHERE idanggaran = ? AND idtenant = ? AND idlokasi = ?',
      [id, ctx.idtenant, ctx.idlokasi]
    );
    if (!anggaran) {
      await conn.rollback();
      return res.status(404).json({ message: 'Anggaran tidak ditemukan' });
    }
    if (anggaran.status !== 'DRAFT') {
      await conn.rollback();
      return res.status(400).json({ message: 'Hanya anggaran DRAFT yang bisa diedit' });
    }
    if (!items || !items.length) {
      await conn.rollback();
      return res.status(400).json({ message: 'items tidak boleh kosong' });
    }

    const newTglawal = tglawal || anggaran.tglawal;
    const newTglakhir = tglakhir || anggaran.tglakhir;
    if (newTglawal > newTglakhir) {
      await conn.rollback();
      return res.status(400).json({ message: 'tglawal tidak boleh lebih besar dari tglakhir' });
    }

    const total_anggaran = items.reduce((sum, it) => sum + (parseFloat(it.nilai_anggaran) || 0), 0);

    await conn.query('DELETE FROM anggarandtl WHERE idanggaran = ? AND idtenant = ?', [id, ctx.idtenant]);

    for (const it of items) {
      await conn.query(
        `INSERT INTO anggarandtl (idanggaran, idtenant, idakun, bulan, nilai_anggaran, nilai_realisasi)
         VALUES (?, ?, ?, ?, ?, 0)`,
        [id, ctx.idtenant, it.idakun, it.bulan, parseFloat(it.nilai_anggaran) || 0]
      );
    }

    await conn.query(
      'UPDATE anggaran SET namaanggaran = ?, tglawal = ?, tglakhir = ?, total_anggaran = ? WHERE idanggaran = ? AND idtenant = ?',
      [namaanggaran || anggaran.namaanggaran, newTglawal, newTglakhir, total_anggaran, id, ctx.idtenant]
    );

    await conn.commit();
    await logger.history('ANGGARAN_UPDATE', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: anggaran.kodeanggaran, req });
    res.json({ message: 'Anggaran berhasil diupdate' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.approve = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const { id } = req.params;

    const [[anggaran]] = await conn.query(
      'SELECT * FROM anggaran WHERE idanggaran = ? AND idtenant = ?',
      [id, ctx.idtenant]
    );
    if (!anggaran) {
      await conn.rollback();
      return res.status(404).json({ message: 'Anggaran tidak ditemukan' });
    }
    if (anggaran.status !== 'DRAFT') {
      await conn.rollback();
      return res.status(400).json({ message: 'Hanya anggaran DRAFT yang bisa di-approve' });
    }

    await conn.query("UPDATE anggaran SET status = 'AKTIF' WHERE idanggaran = ? AND idtenant = ?", [id, ctx.idtenant]);

    await conn.commit();
    await logger.history('ANGGARAN_APPROVE', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: anggaran.kodeanggaran, req });
    res.json({ message: 'Anggaran berhasil di-approve' });
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
    const [[anggaran]] = await conn.query(
      'SELECT kodeanggaran, status FROM anggaran WHERE idanggaran = ? AND idtenant = ? AND idlokasi = ?',
      [req.params.id, ctx.idtenant, ctx.idlokasi]
    );
    if (!anggaran) return res.status(404).json({ message: 'Anggaran tidak ditemukan' });
    if (anggaran.status !== 'DRAFT') {
      return res.status(400).json({ message: 'Hanya anggaran DRAFT yang bisa dihapus' });
    }

    await conn.query('DELETE FROM anggarandtl WHERE idanggaran = ? AND idtenant = ?', [req.params.id, ctx.idtenant]);
    await conn.query('DELETE FROM anggaran WHERE idanggaran = ? AND idtenant = ? AND idlokasi = ?', [req.params.id, ctx.idtenant, ctx.idlokasi]);

    await logger.history('ANGGARAN_DELETE', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: anggaran.kodeanggaran, req });
    res.json({ message: 'Anggaran berhasil dihapus' });
  } catch (err) {
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.getRealisasi = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const rows = await tenantQuery(
      'SELECT a.* FROM anggaran a WHERE a.idanggaran = ? AND a.idlokasi = ?',
      [req.params.id, ctx.idlokasi]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Anggaran tidak ditemukan' });
    const anggaran = rows[0];

    const details = await tenantQuery(
      `SELECT ad.idanggarandtl, ad.idakun, ad.bulan, ad.nilai_anggaran,
              ak.kodeakun, ak.namaakun, ak.jenisak, ak.saldo AS saldo_normal
       FROM anggarandtl ad
       JOIN akun ak ON ad.idakun = ak.idakun AND ak.idtenant = ad.idtenant
       WHERE ad.idanggaran = ?
       ORDER BY ak.kodeakun, ad.bulan`,
      [req.params.id]
    );

    const jurnalRows = await tenantQuery(
      `SELECT j.idakun, MONTH(j.tgltrans) AS bulan,
              SUM(CASE WHEN j.posisi = 'DEBET' THEN j.amount ELSE 0 END) AS total_debet,
              SUM(CASE WHEN j.posisi = 'KREDIT' THEN j.amount ELSE 0 END) AS total_kredit
       FROM jurnal j
       WHERE j.idlokasi = ? AND YEAR(j.tgltrans) = ?
         AND j.tgltrans >= ? AND j.tgltrans <= ?
       GROUP BY j.idakun, MONTH(j.tgltrans)`,
      [ctx.idlokasi, anggaran.periode, anggaran.tglawal, anggaran.tglakhir]
    );

    const jurnalMap = {};
    for (const j of jurnalRows) {
      const key = `${j.idakun}_${j.bulan}`;
      jurnalMap[key] = j;
    }

    const akunMap = {};
    for (const d of details) {
      if (!akunMap[d.idakun]) {
        akunMap[d.idakun] = {
          idakun: d.idakun,
          kodeakun: d.kodeakun,
          namaakun: d.namaakun,
          jenisak: d.jenisak,
          saldo_normal: d.saldo_normal,
          bulan: [],
          total_anggaran: 0,
          total_realisasi: 0,
        };
      }

      const jKey = `${d.idakun}_${d.bulan}`;
      const j = jurnalMap[jKey];
      let nilai_realisasi = 0;
      if (j) {
        if (d.saldo_normal === 'DEBET') {
          nilai_realisasi = parseFloat(j.total_debet) - parseFloat(j.total_kredit);
        } else {
          nilai_realisasi = parseFloat(j.total_kredit) - parseFloat(j.total_debet);
        }
      }

      const nilai_anggaran = parseFloat(d.nilai_anggaran);
      const variance = nilai_anggaran - nilai_realisasi;
      const persentase = nilai_anggaran !== 0 ? (nilai_realisasi / nilai_anggaran) * 100 : 0;

      akunMap[d.idakun].bulan.push({
        bulan: d.bulan,
        nilai_anggaran,
        nilai_realisasi,
        variance,
        persentase: Math.round(persentase * 100) / 100,
      });
      akunMap[d.idakun].total_anggaran += nilai_anggaran;
      akunMap[d.idakun].total_realisasi += nilai_realisasi;
    }

    const items = Object.values(akunMap).map(ak => ({
      ...ak,
      total_variance: ak.total_anggaran - ak.total_realisasi,
      total_persentase: ak.total_anggaran !== 0
        ? Math.round((ak.total_realisasi / ak.total_anggaran) * 10000) / 100
        : 0,
    }));

    res.json({ anggaran, items });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

exports.syncRealisasi = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const { id } = req.params;

    const [[anggaran]] = await conn.query(
      'SELECT * FROM anggaran WHERE idanggaran = ? AND idtenant = ? AND idlokasi = ?',
      [id, ctx.idtenant, ctx.idlokasi]
    );
    if (!anggaran) {
      await conn.rollback();
      return res.status(404).json({ message: 'Anggaran tidak ditemukan' });
    }

    const [details] = await conn.query(
      `SELECT ad.idanggarandtl, ad.idakun, ad.bulan, ak.saldo AS saldo_normal
       FROM anggarandtl ad
       JOIN akun ak ON ad.idakun = ak.idakun AND ak.idtenant = ad.idtenant
       WHERE ad.idanggaran = ? AND ad.idtenant = ?`,
      [id, ctx.idtenant]
    );

    const [jurnalRows] = await conn.query(
      `SELECT j.idakun, MONTH(j.tgltrans) AS bulan,
              SUM(CASE WHEN j.posisi = 'DEBET' THEN j.amount ELSE 0 END) AS total_debet,
              SUM(CASE WHEN j.posisi = 'KREDIT' THEN j.amount ELSE 0 END) AS total_kredit
       FROM jurnal j
       WHERE j.idtenant = ? AND j.idlokasi = ? AND YEAR(j.tgltrans) = ?
         AND j.tgltrans >= ? AND j.tgltrans <= ?
       GROUP BY j.idakun, MONTH(j.tgltrans)`,
      [ctx.idtenant, ctx.idlokasi, anggaran.periode, anggaran.tglawal, anggaran.tglakhir]
    );

    const jurnalMap = {};
    for (const j of jurnalRows) {
      jurnalMap[`${j.idakun}_${j.bulan}`] = j;
    }

    for (const d of details) {
      const j = jurnalMap[`${d.idakun}_${d.bulan}`];
      let nilai_realisasi = 0;
      if (j) {
        if (d.saldo_normal === 'DEBET') {
          nilai_realisasi = parseFloat(j.total_debet) - parseFloat(j.total_kredit);
        } else {
          nilai_realisasi = parseFloat(j.total_kredit) - parseFloat(j.total_debet);
        }
      }
      await conn.query(
        'UPDATE anggarandtl SET nilai_realisasi = ? WHERE idanggarandtl = ? AND idtenant = ?',
        [nilai_realisasi, d.idanggarandtl, ctx.idtenant]
      );
    }

    await conn.commit();
    await logger.history('ANGGARAN_SYNC_REALISASI', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: anggaran.kodeanggaran, req });
    res.json({ message: 'Realisasi anggaran berhasil disinkronkan' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message });
  } finally {
    conn.release();
  }
};
