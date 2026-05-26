const { tenantQuery, getConnection, getTenantContext } = require('../../config/db');
const logger = require('../../lib/logger');

function daysBetween(tglawal, tglakhir) {
  const a = new Date(tglawal);
  const b = new Date(tglakhir);
  return Math.round((b - a) / 86400000) + 1;
}

function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

exports.getAll = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { idkaryawan, jeniscuti, status, bulan } = req.query;
    let sql = `SELECT c.*, k.namakaryawan, k.kodekaryawan FROM cuti_karyawan c
      LEFT JOIN karyawan k ON c.idkaryawan = k.idkaryawan AND k.idtenant = c.idtenant
      WHERE c.idtenant = ? AND c.idlokasi = ?`;
    const params = [ctx.idtenant, ctx.idlokasi];
    if (idkaryawan) { sql += ' AND c.idkaryawan = ?'; params.push(idkaryawan); }
    if (jeniscuti) { sql += ' AND c.jeniscuti = ?'; params.push(jeniscuti); }
    if (status) { sql += ' AND c.status = ?'; params.push(status); }
    if (bulan) { sql += " AND DATE_FORMAT(c.tglawal, '%Y-%m') = ?"; params.push(bulan); }
    sql += ' ORDER BY c.tglawal DESC, k.namakaryawan LIMIT 500';
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
      `SELECT c.*, k.namakaryawan, k.kodekaryawan, k.jabatan FROM cuti_karyawan c
       LEFT JOIN karyawan k ON c.idkaryawan = k.idkaryawan AND k.idtenant = c.idtenant
       WHERE c.idcuti = ? AND c.idtenant = ?`,
      [req.params.id, ctx.idtenant]
    );
    if (!rows.length) return res.status(404).json({ message: 'Cuti tidak ditemukan' });
    res.json(rows[0]);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

exports.create = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    const { idkaryawan, jeniscuti, tglawal, tglakhir, keterangan } = req.body;

    if (!idkaryawan) return res.status(400).json({ message: 'idkaryawan wajib diisi' });
    if (!tglawal) return res.status(400).json({ message: 'tglawal wajib diisi' });
    if (!tglakhir) return res.status(400).json({ message: 'tglakhir wajib diisi' });
    if (tglawal > tglakhir) return res.status(400).json({ message: 'tglawal tidak boleh lebih besar dari tglakhir' });

    const [[karyawan]] = await conn.query(
      'SELECT idkaryawan FROM karyawan WHERE idkaryawan = ? AND idtenant = ?',
      [idkaryawan, ctx.idtenant]
    );
    if (!karyawan) return res.status(404).json({ message: 'Karyawan tidak ditemukan' });

    const jumlah_hari = daysBetween(tglawal, tglakhir);

    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO cuti_karyawan (idtenant, idlokasi, idkaryawan, jeniscuti, tglawal, tglakhir, jumlah_hari, keterangan, status, userentry, tglentry)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, NOW())`,
      [ctx.idtenant, ctx.idlokasi, idkaryawan, jeniscuti || 'TAHUNAN', tglawal, tglakhir, jumlah_hari, keterangan || null, ctx.iduser]
    );

    await conn.commit();
    res.status(201).json({ message: 'Pengajuan cuti berhasil disimpan', idcuti: result.insertId, jumlah_hari });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.approve = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();

    const [[cuti]] = await conn.query(
      'SELECT * FROM cuti_karyawan WHERE idcuti = ? AND idtenant = ?',
      [req.params.id, ctx.idtenant]
    );
    if (!cuti) return res.status(404).json({ message: 'Cuti tidak ditemukan' });
    if (cuti.status === 'APPROVED') return res.status(400).json({ message: 'Cuti sudah diapprove' });

    await conn.query(
      "UPDATE cuti_karyawan SET status = 'APPROVED' WHERE idcuti = ? AND idtenant = ?",
      [req.params.id, ctx.idtenant]
    );

    const tglawal = cuti.tglawal instanceof Date
      ? cuti.tglawal.toISOString().slice(0, 10)
      : String(cuti.tglawal).slice(0, 10);
    const tglakhir = cuti.tglakhir instanceof Date
      ? cuti.tglakhir.toISOString().slice(0, 10)
      : String(cuti.tglakhir).slice(0, 10);
    const total = daysBetween(tglawal, tglakhir);

    for (let i = 0; i < total; i++) {
      const tgl = addDays(tglawal, i);
      const [[existing]] = await conn.query(
        'SELECT idabsensi FROM absensi WHERE idtenant = ? AND idkaryawan = ? AND tglabsensi = ?',
        [ctx.idtenant, cuti.idkaryawan, tgl]
      );
      if (!existing) {
        await conn.query(
          `INSERT INTO absensi (idtenant, idlokasi, idkaryawan, tglabsensi, jenisabsensi, userentry, tglentry)
           VALUES (?, ?, ?, ?, ?, ?, NOW())`,
          [ctx.idtenant, cuti.idlokasi, cuti.idkaryawan, tgl, cuti.jeniscuti, ctx.iduser]
        );
      }
    }

    await conn.commit();
    res.json({ message: 'Cuti berhasil diapprove' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.reject = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();

    const [[cuti]] = await conn.query(
      'SELECT * FROM cuti_karyawan WHERE idcuti = ? AND idtenant = ?',
      [req.params.id, ctx.idtenant]
    );
    if (!cuti) return res.status(404).json({ message: 'Cuti tidak ditemukan' });
    if (cuti.status === 'REJECTED') return res.status(400).json({ message: 'Cuti sudah ditolak' });

    await conn.query(
      "UPDATE cuti_karyawan SET status = 'REJECTED' WHERE idcuti = ? AND idtenant = ?",
      [req.params.id, ctx.idtenant]
    );

    await conn.commit();
    res.json({ message: 'Cuti berhasil ditolak' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.remove = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();

    const [[cuti]] = await conn.query(
      'SELECT * FROM cuti_karyawan WHERE idcuti = ? AND idtenant = ?',
      [req.params.id, ctx.idtenant]
    );
    if (!cuti) return res.status(404).json({ message: 'Cuti tidak ditemukan' });
    if (cuti.status !== 'DRAFT') return res.status(400).json({ message: 'Hanya cuti berstatus DRAFT yang bisa dihapus' });

    await conn.query('DELETE FROM cuti_karyawan WHERE idcuti = ? AND idtenant = ?', [req.params.id, ctx.idtenant]);

    await conn.commit();
    res.json({ message: 'Cuti berhasil dihapus' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.getSaldoCuti = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { idkaryawan } = req.params;
    const tahun = new Date().getFullYear();

    const [[karyawan]] = await (await getConnection()).query(
      'SELECT idkaryawan FROM karyawan WHERE idkaryawan = ? AND idtenant = ?',
      [idkaryawan, ctx.idtenant]
    ).then(async r => { return r; }).catch(e => { throw e; });

    const rows = await tenantQuery(
      `SELECT jeniscuti, SUM(jumlah_hari) AS total_hari
       FROM cuti_karyawan
       WHERE idtenant = ? AND idkaryawan = ? AND status = 'APPROVED' AND YEAR(tglawal) = ?
       GROUP BY jeniscuti`,
      [ctx.idtenant, idkaryawan, tahun]
    );

    const saldo = { TAHUNAN: 0, SAKIT: 0, IZIN: 0, MELAHIRKAN: 0, LAINNYA: 0 };
    for (const row of rows) {
      if (saldo.hasOwnProperty(row.jeniscuti)) {
        saldo[row.jeniscuti] = Number(row.total_hari);
      }
    }

    res.json({ idkaryawan: Number(idkaryawan), tahun, saldo });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};
