// Controller laporan akuntansi: Jurnal Transaksi, Buku Besar, dan Neraca bulanan.
// Semua laporan membaca tabel `jurnal` (status AKTIF) dan di-scope per tenant.

const { pool, getTenantContext } = require('../../config/db');
const logger = require('../../lib/logger');

// Parsing filter idakun (mendukung satu id atau beberapa id dipisah koma)
function parseIdakun(raw) {
  if (!raw) return null;
  const ids = String(raw).split(',').map(s => parseInt(s.trim(), 10)).filter(n => n > 0);
  return ids.length ? ids : null;
}

function num(v) {
  return Math.round((parseFloat(v) || 0) * 100) / 100;
}

// GET /jurnal — Jurnal Transaksi (dikelompokkan per kode transaksi)
// Filter: tglwal, tglakhir, kodetrans (opsional), idakun (opsional)
exports.jurnalTransaksi = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tglwal, tglakhir, kodetrans } = req.query;
    const idakun = parseIdakun(req.query.idakun);

    let sql = `
      SELECT j.idjurnal, j.kodetrans, j.jenis, DATE_FORMAT(j.tgltrans, '%Y-%m-%d') AS tgltrans,
             j.idakun, a.kodeakun, a.namaakun, j.posisi, j.amount
      FROM jurnal j
      JOIN akun a ON a.idakun = j.idakun AND a.idtenant = j.idtenant
      WHERE j.idtenant = ? AND j.status = 'AKTIF'`;
    const params = [ctx.idtenant];
    if (tglwal)    { sql += ' AND j.tgltrans >= ?'; params.push(tglwal); }
    if (tglakhir)  { sql += ' AND j.tgltrans <= ?'; params.push(tglakhir); }
    if (kodetrans) { sql += ' AND j.kodetrans = ?'; params.push(kodetrans); }
    if (idakun)    { sql += ' AND j.idakun IN (?)'; params.push(idakun); }
    sql += ' ORDER BY j.tgltrans ASC, j.kodetrans ASC, j.idjurnal ASC';

    const [rows] = await pool.query(sql, params);

    // Kelompokkan per kode transaksi
    const groups = [];
    const byKode = new Map();
    for (const r of rows) {
      let g = byKode.get(r.kodetrans);
      if (!g) {
        g = { kodetrans: r.kodetrans, jenis: r.jenis, tgltrans: r.tgltrans, lines: [], total_debet: 0, total_kredit: 0 };
        byKode.set(r.kodetrans, g);
        groups.push(g);
      }
      const debet = r.posisi === 'DEBET' ? num(r.amount) : 0;
      const kredit = r.posisi === 'KREDIT' ? num(r.amount) : 0;
      g.lines.push({
        idjurnal: r.idjurnal, idakun: r.idakun, kodeakun: r.kodeakun, namaakun: r.namaakun,
        posisi: r.posisi, debet, kredit,
      });
      g.total_debet = num(g.total_debet + debet);
      g.total_kredit = num(g.total_kredit + kredit);
    }

    res.json(groups);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /buku-besar — Buku Besar per akun dengan saldo awal, mutasi, dan saldo berjalan
// Filter: tglwal, tglakhir, kodetrans (opsional), idakun (opsional)
exports.bukuBesar = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tglwal, tglakhir, kodetrans } = req.query;
    const idakun = parseIdakun(req.query.idakun);

    // Info semua akun milik tenant
    const [akunRows] = await pool.query(
      'SELECT idakun, kodeakun, namaakun, jenisak, saldo AS saldo_normal FROM akun WHERE idtenant = ? ORDER BY kodeakun',
      [ctx.idtenant]
    );
    const akunMap = new Map(akunRows.map(a => [a.idakun, a]));

    // Saldo awal per akun (akumulasi jurnal sebelum tglwal)
    const saldoAwal = new Map();
    if (tglwal) {
      let sqlAwal = `
        SELECT j.idakun,
               COALESCE(SUM(CASE WHEN j.posisi='DEBET'  THEN j.amount ELSE 0 END), 0) AS debet,
               COALESCE(SUM(CASE WHEN j.posisi='KREDIT' THEN j.amount ELSE 0 END), 0) AS kredit
        FROM jurnal j
        WHERE j.idtenant = ? AND j.status = 'AKTIF' AND j.tgltrans < ?`;
      const pAwal = [ctx.idtenant, tglwal];
      if (kodetrans) { sqlAwal += ' AND j.kodetrans = ?'; pAwal.push(kodetrans); }
      if (idakun)    { sqlAwal += ' AND j.idakun IN (?)'; pAwal.push(idakun); }
      sqlAwal += ' GROUP BY j.idakun';
      const [awalRows] = await pool.query(sqlAwal, pAwal);
      for (const r of awalRows) saldoAwal.set(r.idakun, { debet: num(r.debet), kredit: num(r.kredit) });
    }

    // Entri jurnal dalam rentang tanggal
    let sqlEntries = `
      SELECT j.idjurnal, j.idakun, DATE_FORMAT(j.tgltrans, '%Y-%m-%d') AS tgltrans,
             j.kodetrans, j.jenis, j.posisi, j.amount
      FROM jurnal j
      WHERE j.idtenant = ? AND j.status = 'AKTIF'`;
    const pEntries = [ctx.idtenant];
    if (tglwal)    { sqlEntries += ' AND j.tgltrans >= ?'; pEntries.push(tglwal); }
    if (tglakhir)  { sqlEntries += ' AND j.tgltrans <= ?'; pEntries.push(tglakhir); }
    if (kodetrans) { sqlEntries += ' AND j.kodetrans = ?'; pEntries.push(kodetrans); }
    if (idakun)    { sqlEntries += ' AND j.idakun IN (?)'; pEntries.push(idakun); }
    sqlEntries += ' ORDER BY j.idakun ASC, j.tgltrans ASC, j.idjurnal ASC';
    const [entryRows] = await pool.query(sqlEntries, pEntries);

    const entriesByAkun = new Map();
    for (const r of entryRows) {
      if (!entriesByAkun.has(r.idakun)) entriesByAkun.set(r.idakun, []);
      entriesByAkun.get(r.idakun).push(r);
    }

    // Tentukan akun yang ditampilkan
    let akunIds;
    if (idakun) {
      akunIds = idakun.filter(id => akunMap.has(id));
    } else {
      akunIds = [...new Set([...saldoAwal.keys(), ...entriesByAkun.keys()])]
        .filter(id => akunMap.has(id))
        .sort((a, b) => String(akunMap.get(a).kodeakun).localeCompare(String(akunMap.get(b).kodeakun)));
    }

    const result = akunIds.map(id => {
      const akun = akunMap.get(id);
      const aw = saldoAwal.get(id) || { debet: 0, kredit: 0 };
      const isDebet = akun.saldo_normal === 'DEBET';
      let saldo = isDebet ? num(aw.debet - aw.kredit) : num(aw.kredit - aw.debet);
      const saldo_awal = saldo;

      const entries = (entriesByAkun.get(id) || []).map(e => {
        const debet = e.posisi === 'DEBET' ? num(e.amount) : 0;
        const kredit = e.posisi === 'KREDIT' ? num(e.amount) : 0;
        saldo = num(saldo + (isDebet ? debet - kredit : kredit - debet));
        return { idjurnal: e.idjurnal, tgltrans: e.tgltrans, kodetrans: e.kodetrans, jenis: e.jenis, debet, kredit, saldo };
      });

      return {
        idakun: id, kodeakun: akun.kodeakun, namaakun: akun.namaakun, jenisak: akun.jenisak,
        saldo_normal: akun.saldo_normal, saldo_awal, entries, saldo_akhir: saldo,
      };
    });

    res.json(result);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /neraca — Neraca bulanan: saldo awal, mutasi, saldo akhir per akun
// Filter: bulan, tahun, kodetrans (opsional), idakun (opsional)
exports.neraca = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const now = new Date();
    const bulan = parseInt(req.query.bulan, 10) || (now.getMonth() + 1);
    const tahun = parseInt(req.query.tahun, 10) || now.getFullYear();
    if (bulan < 1 || bulan > 12) return res.status(400).json({ message: 'Bulan tidak valid' });

    const kodetrans = req.query.kodetrans;
    const idakun = parseIdakun(req.query.idakun);

    const mm = String(bulan).padStart(2, '0');
    const firstDay = `${tahun}-${mm}-01`;
    const lastDayNum = new Date(tahun, bulan, 0).getDate();
    const lastDay = `${tahun}-${mm}-${String(lastDayNum).padStart(2, '0')}`;

    let sql = `
      SELECT a.idakun, a.kodeakun, a.namaakun, a.jenisak, a.saldo AS saldo_normal,
        COALESCE(SUM(CASE WHEN j.tgltrans <  ? AND j.posisi='DEBET'  THEN j.amount ELSE 0 END), 0) AS awal_debet,
        COALESCE(SUM(CASE WHEN j.tgltrans <  ? AND j.posisi='KREDIT' THEN j.amount ELSE 0 END), 0) AS awal_kredit,
        COALESCE(SUM(CASE WHEN j.tgltrans >= ? AND j.tgltrans <= ? AND j.posisi='DEBET'  THEN j.amount ELSE 0 END), 0) AS mut_debet,
        COALESCE(SUM(CASE WHEN j.tgltrans >= ? AND j.tgltrans <= ? AND j.posisi='KREDIT' THEN j.amount ELSE 0 END), 0) AS mut_kredit
      FROM akun a
      LEFT JOIN jurnal j ON j.idakun = a.idakun AND j.idtenant = a.idtenant AND j.status = 'AKTIF'`;
    const params = [firstDay, firstDay, firstDay, lastDay, firstDay, lastDay];
    if (kodetrans) { sql += ' AND j.kodetrans = ?'; params.push(kodetrans); }
    sql += ' WHERE a.idtenant = ?';
    params.push(ctx.idtenant);
    if (idakun) { sql += ' AND a.idakun IN (?)'; params.push(idakun); }
    sql += ' GROUP BY a.idakun, a.kodeakun, a.namaakun, a.jenisak, a.saldo ORDER BY a.kodeakun';

    const [rows] = await pool.query(sql, params);

    const akun = rows.map(r => {
      const isDebet = r.saldo_normal === 'DEBET';
      const awalDebet = num(r.awal_debet), awalKredit = num(r.awal_kredit);
      const mutDebet = num(r.mut_debet), mutKredit = num(r.mut_kredit);
      const saldo_awal = isDebet ? num(awalDebet - awalKredit) : num(awalKredit - awalDebet);
      const mutasi = isDebet ? num(mutDebet - mutKredit) : num(mutKredit - mutDebet);
      return {
        idakun: r.idakun, kodeakun: r.kodeakun, namaakun: r.namaakun, jenisak: r.jenisak,
        saldo_normal: r.saldo_normal,
        saldo_awal,
        mutasi_debet: mutDebet, mutasi_kredit: mutKredit,
        saldo_akhir: num(saldo_awal + mutasi),
      };
    });

    res.json({ bulan, tahun, periode: { tglawal: firstDay, tglakhir: lastDay }, akun });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};
