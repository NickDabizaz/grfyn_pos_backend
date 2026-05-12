const { tenantQuery, getConnection, getTenantContext } = require('../config/db');
const logger = require('../lib/logger');

// GET /absensi
exports.getAll = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { idkaryawan, bulan, tglwal, tglakhir } = req.query;
    let sql = `SELECT a.*, k.namakaryawan, k.kodekaryawan FROM absensi a
      LEFT JOIN karyawan k ON a.idkaryawan = k.idkaryawan AND k.idtenant = a.idtenant
      WHERE a.idtenant = ? AND a.idlokasi = ?`;
    const params = [ctx.idtenant, ctx.idlokasi];
    if (idkaryawan) { sql += ' AND a.idkaryawan = ?'; params.push(idkaryawan); }
    if (bulan) { sql += ' AND DATE_FORMAT(a.tglabsensi, \'%Y-%m\') = ?'; params.push(bulan); }
    if (tglwal) { sql += ' AND a.tglabsensi >= ?'; params.push(tglwal); }
    if (tglakhir) { sql += ' AND a.tglabsensi <= ?'; params.push(tglakhir); }
    sql += ' ORDER BY a.tglabsensi DESC, k.namakaryawan LIMIT 500';
    const rows = await tenantQuery(sql, params);
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// POST /absensi — Catat absensi (satu record per karyawan per hari)
exports.create = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();

    const { idkaryawan, tglabsensi, jampinmasuk, jampinkeluar, jenisabsensi, keterangan } = req.body;
    if (!idkaryawan) return res.status(400).json({ message: 'idkaryawan wajib diisi' });
    const tgl = tglabsensi || new Date().toISOString().slice(0, 10);

    const [result] = await conn.query(
      `INSERT INTO absensi (idtenant, idlokasi, idkaryawan, tglabsensi, jampinmasuk, jampinkeluar, jenisabsensi, keterangan, userentry, tglentry)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [ctx.idtenant, ctx.idlokasi, idkaryawan, tgl, jampinmasuk || null, jampinkeluar || null, jenisabsensi || 'HADIR', keterangan || null, ctx.iduser]
    );

    await conn.commit();
    res.status(201).json({ message: 'Absensi berhasil dicatat', idabsensi: result.insertId });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Absensi untuk karyawan ini pada tanggal tersebut sudah ada' });
    }
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// PUT /absensi/:id — Update absensi
exports.update = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();

    const [[absensi]] = await conn.query(
      'SELECT * FROM absensi WHERE idabsensi = ? AND idtenant = ?',
      [req.params.id, ctx.idtenant]
    );
    if (!absensi) return res.status(404).json({ message: 'Absensi tidak ditemukan' });

    const { jampinmasuk, jampinkeluar, jenisabsensi, keterangan } = req.body;

    await conn.query(
      'UPDATE absensi SET jampinmasuk = ?, jampinkeluar = ?, jenisabsensi = ?, keterangan = ? WHERE idabsensi = ? AND idtenant = ?',
      [jampinmasuk || absensi.jampinmasuk, jampinkeluar || absensi.jampinkeluar, jenisabsensi || absensi.jenisabsensi, keterangan || absensi.keterangan, req.params.id, ctx.idtenant]
    );

    await conn.commit();
    res.json({ message: 'Absensi berhasil diupdate' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// GET /absensi/rekap — Rekap absensi per karyawan per bulan
exports.rekapBulanan = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { bulan } = req.query;
    if (!bulan) return res.status(400).json({ message: 'Parameter bulan wajib diisi (format: YYYY-MM)' });

    const rows = await tenantQuery(
      `SELECT k.idkaryawan, k.kodekaryawan, k.namakaryawan,
         COUNT(*) AS total_hari,
         SUM(CASE WHEN a.jenisabsensi='HADIR' THEN 1 ELSE 0 END) AS hadir,
         SUM(CASE WHEN a.jenisabsensi='IZIN' THEN 1 ELSE 0 END) AS izin,
         SUM(CASE WHEN a.jenisabsensi='SAKIT' THEN 1 ELSE 0 END) AS sakit,
         SUM(CASE WHEN a.jenisabsensi='CUTI' THEN 1 ELSE 0 END) AS cuti,
         SUM(CASE WHEN a.jenisabsensi='ALPHA' THEN 1 ELSE 0 END) AS alpha
       FROM karyawan k
       LEFT JOIN absensi a ON a.idkaryawan = k.idkaryawan AND a.idtenant = k.idtenant
         AND DATE_FORMAT(a.tglabsensi, '%Y-%m') = ? AND a.idlokasi = ?
       WHERE k.idtenant = ? AND k.status = 'AKTIF'
       GROUP BY k.idkaryawan ORDER BY k.namakaryawan`,
      [bulan, ctx.idlokasi, ctx.idtenant]
    );
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};
