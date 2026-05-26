const { tenantQuery, getConnection, getTenantContext } = require('../../config/db');
const logger = require('../../lib/logger');

function parseTimeToHours(timeStr) {
  const parts = String(timeStr || '00:00:00').split(':');
  return parseInt(parts[0]) + parseInt(parts[1]) / 60 + parseInt(parts[2] || 0) / 3600;
}

function calcTotalJam(jamMulai, jamSelesai) {
  let mulai = parseTimeToHours(jamMulai);
  let selesai = parseTimeToHours(jamSelesai);
  if (selesai <= mulai) selesai += 24;
  return Math.round((selesai - mulai) * 100) / 100;
}

exports.getAll = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { idkaryawan, status, bulan } = req.query;
    let sql = `SELECT l.*, k.namakaryawan, k.kodekaryawan FROM lembur_karyawan l
      LEFT JOIN karyawan k ON l.idkaryawan = k.idkaryawan AND k.idtenant = l.idtenant
      WHERE l.idlokasi = ?`;
    const params = [ctx.idlokasi];
    if (idkaryawan) { sql += ' AND l.idkaryawan = ?'; params.push(idkaryawan); }
    if (status) { sql += ' AND l.status = ?'; params.push(status); }
    if (bulan) { sql += ' AND DATE_FORMAT(l.tgllembur, "%Y-%m") = ?'; params.push(bulan); }
    sql += ' ORDER BY l.tgllembur DESC, l.idlembur DESC LIMIT 200';
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
      `SELECT l.*, k.namakaryawan, k.kodekaryawan, k.jabatan FROM lembur_karyawan l
       LEFT JOIN karyawan k ON l.idkaryawan = k.idkaryawan AND k.idtenant = l.idtenant
       WHERE l.idlembur = ? AND l.idlokasi = ?`,
      [req.params.id, ctx.idlokasi]
    );
    if (!rows.length) return res.status(404).json({ message: 'Data lembur tidak ditemukan' });
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
    const { idkaryawan, tgllembur, jam_mulai, jam_selesai, tarif_per_jam, keterangan } = req.body;
    if (!idkaryawan || !tgllembur || !jam_mulai || !jam_selesai) {
      return res.status(400).json({ message: 'idkaryawan, tgllembur, jam_mulai, jam_selesai wajib diisi' });
    }

    const [[kary]] = await conn.query(
      'SELECT idkaryawan, gajipoko FROM karyawan WHERE idkaryawan = ? AND idtenant = ? AND status = "AKTIF"',
      [idkaryawan, ctx.idtenant]
    );
    if (!kary) return res.status(404).json({ message: 'Karyawan tidak ditemukan' });

    const total_jam = calcTotalJam(jam_mulai, jam_selesai);
    const tarifEfektif = tarif_per_jam
      ? parseFloat(tarif_per_jam)
      : Math.round((parseFloat(kary.gajipoko) / 173) * 1.5 * 100) / 100;
    const total_bayar = Math.round(total_jam * tarifEfektif * 100) / 100;

    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO lembur_karyawan (idtenant, idlokasi, idkaryawan, tgllembur, jam_mulai, jam_selesai, total_jam, tarif_per_jam, total_bayar, keterangan, status, userentry)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?)`,
      [ctx.idtenant, ctx.idlokasi, idkaryawan, tgllembur, jam_mulai, jam_selesai, total_jam, tarifEfektif, total_bayar, keterangan || null, ctx.iduser]
    );
    await conn.commit();
    res.status(201).json({ message: 'Data lembur berhasil disimpan', idlembur: result.insertId, total_jam, total_bayar });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ message: 'Data lembur untuk karyawan ini pada jam tersebut sudah ada' });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.approve = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    const [[row]] = await conn.query(
      'SELECT * FROM lembur_karyawan WHERE idlembur = ? AND idtenant = ?',
      [req.params.id, ctx.idtenant]
    );
    if (!row) return res.status(404).json({ message: 'Data lembur tidak ditemukan' });
    if (row.status !== 'DRAFT') return res.status(400).json({ message: 'Hanya data DRAFT yang bisa diapprove' });
    await conn.query('UPDATE lembur_karyawan SET status = "APPROVED" WHERE idlembur = ?', [req.params.id]);
    res.json({ message: 'Lembur diapprove' });
  } catch (err) {
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
    const [[row]] = await conn.query(
      'SELECT * FROM lembur_karyawan WHERE idlembur = ? AND idtenant = ?',
      [req.params.id, ctx.idtenant]
    );
    if (!row) return res.status(404).json({ message: 'Data lembur tidak ditemukan' });
    if (row.status !== 'DRAFT') return res.status(400).json({ message: 'Hanya data DRAFT yang bisa dihapus' });
    await conn.query('DELETE FROM lembur_karyawan WHERE idlembur = ?', [req.params.id]);
    res.json({ message: 'Data lembur dihapus' });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.getRekapLembur = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { bulan } = req.query;
    if (!bulan) return res.status(400).json({ message: 'bulan wajib diisi (format YYYY-MM)' });
    const rows = await tenantQuery(
      `SELECT l.idkaryawan, k.namakaryawan, k.kodekaryawan,
        SUM(l.total_jam) as total_jam,
        SUM(l.total_bayar) as total_bayar,
        COUNT(*) as jumlah_lembur
       FROM lembur_karyawan l
       LEFT JOIN karyawan k ON l.idkaryawan = k.idkaryawan AND k.idtenant = l.idtenant
       WHERE l.idlokasi = ? AND l.status = 'APPROVED' AND DATE_FORMAT(l.tgllembur, '%Y-%m') = ?
       GROUP BY l.idkaryawan ORDER BY k.namakaryawan`,
      [ctx.idlokasi, bulan]
    );
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};
