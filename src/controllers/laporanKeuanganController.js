const { pool, tenantQuery, getConnection, getTenantContext } = require('../config/db');
const { generateKodeClosing } = require('../lib/kodetrans');
const logger = require('../lib/logger');

// GET /neraca-saldo — Trial Balance per periode
exports.neracaSaldo = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tglwal, tglakhir } = req.query;

    const params = [];
    let sqlFinal = `
      SELECT
        a.idakun, a.kodeakun, a.namaakun, a.jenisak, a.saldo AS saldo_normal,
        COALESCE(SUM(CASE WHEN j.posisi='DEBET' THEN j.amount ELSE 0 END), 0) AS total_debet,
        COALESCE(SUM(CASE WHEN j.posisi='KREDIT' THEN j.amount ELSE 0 END), 0) AS total_kredit
      FROM akun a
      LEFT JOIN jurnal j ON j.idakun = a.idakun AND j.idtenant = a.idtenant AND j.status = 'AKTIF'
    `;
    const jConds = [];
    if (tglwal) { jConds.push('j.tgltrans >= ?'); params.push(tglwal); }
    if (tglakhir) { jConds.push('j.tgltrans <= ?'); params.push(tglakhir); }
    if (jConds.length) sqlFinal += ' AND (' + jConds.join(' AND ') + ')';
    sqlFinal += ' WHERE a.idtenant = ? GROUP BY a.idakun ORDER BY a.kodeakun';
    params.push(ctx.idtenant);

    const rows = await tenantQuery(sqlFinal, params);
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /laba-rugi — Income Statement (P&L)
exports.labaRugi = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tglwal, tglakhir } = req.query;

    const params = [];
    let sqlFinal = `
      SELECT
        a.idakun, a.kodeakun, a.namaakun, a.jenisak, a.saldo AS saldo_normal,
        COALESCE(SUM(CASE WHEN j.posisi='DEBET' THEN j.amount ELSE 0 END), 0) AS total_debet,
        COALESCE(SUM(CASE WHEN j.posisi='KREDIT' THEN j.amount ELSE 0 END), 0) AS total_kredit
      FROM akun a
      LEFT JOIN jurnal j ON j.idakun = a.idakun AND j.idtenant = a.idtenant AND j.status = 'AKTIF'
    `;
    const jConds = [];
    if (tglwal) { jConds.push('j.tgltrans >= ?'); params.push(tglwal); }
    if (tglakhir) { jConds.push('j.tgltrans <= ?'); params.push(tglakhir); }
    if (jConds.length) sqlFinal += ' AND (' + jConds.join(' AND ') + ')';
    sqlFinal += ` WHERE a.idtenant = ? AND a.jenisak IN ('PENDAPATAN','BEBAN')
      GROUP BY a.idakun ORDER BY a.jenisak DESC, a.kodeakun`;
    params.push(ctx.idtenant);

    const rows = await tenantQuery(sqlFinal, params);

    let totalPendapatan = 0;
    let totalBeban = 0;
    const pendapatan = [];
    const beban = [];

    for (const r of rows) {
      const saldo = r.saldo_normal === 'KREDIT'
        ? parseFloat(r.total_kredit) - parseFloat(r.total_debet)
        : parseFloat(r.total_debet) - parseFloat(r.total_kredit);
      r.saldo = saldo;
      if (r.jenisak === 'PENDAPATAN') {
        pendapatan.push(r);
        totalPendapatan += saldo;
      } else {
        beban.push(r);
        totalBeban += saldo;
      }
    }

    res.json({
      pendapatan,
      beban,
      total_pendapatan: totalPendapatan,
      total_beban: totalBeban,
      laba_bersih: totalPendapatan - totalBeban,
    });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /neraca — Balance Sheet
exports.neraca = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tglwal, tglakhir } = req.query;

    const params = [];
    let sqlFinal = `
      SELECT
        a.idakun, a.kodeakun, a.namaakun, a.jenisak, a.saldo AS saldo_normal,
        COALESCE(SUM(CASE WHEN j.posisi='DEBET' THEN j.amount ELSE 0 END), 0) AS total_debet,
        COALESCE(SUM(CASE WHEN j.posisi='KREDIT' THEN j.amount ELSE 0 END), 0) AS total_kredit
      FROM akun a
      LEFT JOIN jurnal j ON j.idakun = a.idakun AND j.idtenant = a.idtenant AND j.status = 'AKTIF'
    `;
    const jConds = [];
    if (tglwal) { jConds.push('j.tgltrans >= ?'); params.push(tglwal); }
    if (tglakhir) { jConds.push('j.tgltrans <= ?'); params.push(tglakhir); }
    if (jConds.length) sqlFinal += ' AND (' + jConds.join(' AND ') + ')';
    sqlFinal += ` WHERE a.idtenant = ? AND a.jenisak IN ('ASET','LIABILITAS','EKUITAS')
      GROUP BY a.idakun ORDER BY a.jenisak, a.kodeakun`;
    params.push(ctx.idtenant);

    const rows = await tenantQuery(sqlFinal, params);

    // Hitung laba bersih periode berjalan untuk dimasukkan ke EKUITAS
    const paramsPL = [];
    let sqlPL = `
      SELECT
        a.jenisak,
        COALESCE(SUM(CASE WHEN j.posisi='DEBET' THEN j.amount ELSE 0 END), 0) AS total_debet,
        COALESCE(SUM(CASE WHEN j.posisi='KREDIT' THEN j.amount ELSE 0 END), 0) AS total_kredit
      FROM akun a
      LEFT JOIN jurnal j ON j.idakun = a.idakun AND j.idtenant = a.idtenant AND j.status = 'AKTIF'
    `;
    const jCondsPL = [];
    if (tglwal) { jCondsPL.push('j.tgltrans >= ?'); paramsPL.push(tglwal); }
    if (tglakhir) { jCondsPL.push('j.tgltrans <= ?'); paramsPL.push(tglakhir); }
    if (jCondsPL.length) sqlPL += ' AND (' + jCondsPL.join(' AND ') + ')';
    sqlPL += ` WHERE a.idtenant = ? AND a.jenisak IN ('PENDAPATAN','BEBAN') GROUP BY a.jenisak`;
    paramsPL.push(ctx.idtenant);

    const plRows = await tenantQuery(sqlPL, paramsPL);
    let totalPendapatan = 0, totalBeban = 0;
    for (const r of plRows) {
      if (r.jenisak === 'PENDAPATAN') totalPendapatan = parseFloat(r.total_kredit) - parseFloat(r.total_debet);
      if (r.jenisak === 'BEBAN') totalBeban = parseFloat(r.total_debet) - parseFloat(r.total_kredit);
    }
    const labaBersih = totalPendapatan - totalBeban;

    const aset = [], liabilitas = [], ekuitas = [];
    let totalAset = 0, totalLiabilitas = 0, totalEkuitas = 0;

    for (const r of rows) {
      const saldo = r.saldo_normal === 'DEBET'
        ? parseFloat(r.total_debet) - parseFloat(r.total_kredit)
        : parseFloat(r.total_kredit) - parseFloat(r.total_debet);
      r.saldo = saldo;
      if (r.jenisak === 'ASET') { aset.push(r); totalAset += saldo; }
      else if (r.jenisak === 'LIABILITAS') { liabilitas.push(r); totalLiabilitas += saldo; }
      else { ekuitas.push(r); totalEkuitas += saldo; }
    }

    res.json({
      aset,
      liabilitas,
      ekuitas,
      laba_bersih_periode: labaBersih,
      total_aset: totalAset,
      total_liabilitas: totalLiabilitas,
      total_ekuitas: totalEkuitas + labaBersih,
      balance_check: totalAset === (totalLiabilitas + totalEkuitas + labaBersih),
    });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /buku-besar — General Ledger untuk satu akun dengan running balance
exports.bukuBesar = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { idakun, tglwal, tglakhir } = req.query;
    if (!idakun) return res.status(400).json({ message: 'idakun wajib diisi' });

    const akunRows = await tenantQuery(
      'SELECT idakun, kodeakun, namaakun, saldo AS saldo_normal FROM akun WHERE idakun = ?',
      [idakun]
    );
    if (!akunRows.length) return res.status(404).json({ message: 'Akun tidak ditemukan' });
    const akun = akunRows[0];

    let sql = `
      SELECT j.idjurnal, j.tgltrans, j.kodetrans, j.jenis,
             CASE WHEN j.posisi='DEBET' THEN j.amount ELSE 0 END AS debet,
             CASE WHEN j.posisi='KREDIT' THEN j.amount ELSE 0 END AS kredit
      FROM jurnal j
      WHERE j.idakun = ? AND j.idtenant = ? AND j.status = 'AKTIF'
    `;
    const params = [idakun, ctx.idtenant];
    if (tglwal) { sql += ' AND j.tgltrans >= ?'; params.push(tglwal); }
    if (tglakhir) { sql += ' AND j.tgltrans <= ?'; params.push(tglakhir); }
    sql += ' ORDER BY j.tgltrans ASC, j.idjurnal ASC';

    const [entries] = await pool.query(sql, params);

    let saldo = 0;
    const result = entries.map(e => {
      const d = parseFloat(e.debet);
      const k = parseFloat(e.kredit);
      if (akun.saldo_normal === 'DEBET') saldo += d - k;
      else saldo += k - d;
      return { ...e, saldo };
    });

    res.json({ akun, entries: result });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// POST /closing — Lakukan closing periode
exports.closingPeriode = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    const { periodbulan, tglakhir, tglawal, catatan } = req.body;
    if (!periodbulan) return res.status(400).json({ message: 'periodbulan wajib diisi' });

    const tglAwal = tglawal || `${periodbulan}-01`;
    const tglAkhir = tglakhir || `${periodbulan}-31`;

    // Cek apakah periode sudah pernah di-closing
    const [[existing]] = await conn.query(
      'SELECT idclosing FROM closing WHERE idtenant = ? AND idlokasi = ? AND periodbulan = ?',
      [ctx.idtenant, ctx.idlokasi, periodbulan]
    );
    if (existing) return res.status(400).json({ message: 'Periode ini sudah pernah di-closing' });

    // Hitung saldo semua akun PENDAPATAN dan BEBAN untuk periode ini
    const [akunPLRows] = await conn.query(`
      SELECT a.idakun, a.kodeakun, a.namaakun, a.jenisak, a.saldo AS saldo_normal,
             COALESCE(SUM(CASE WHEN j.posisi='DEBET' THEN j.amount ELSE 0 END), 0) AS total_debet,
             COALESCE(SUM(CASE WHEN j.posisi='KREDIT' THEN j.amount ELSE 0 END), 0) AS total_kredit
      FROM akun a
      LEFT JOIN jurnal j ON j.idakun = a.idakun AND j.idtenant = a.idtenant
        AND j.status = 'AKTIF' AND j.tgltrans >= ? AND j.tgltrans <= ?
      WHERE a.idtenant = ? AND a.jenisak IN ('PENDAPATAN','BEBAN')
      GROUP BY a.idakun
    `, [tglAwal, tglAkhir, ctx.idtenant]);

    let totalPendapatan = 0, totalBeban = 0;
    for (const r of akunPLRows) {
      if (r.jenisak === 'PENDAPATAN') totalPendapatan += parseFloat(r.total_kredit) - parseFloat(r.total_debet);
      else totalBeban += parseFloat(r.total_debet) - parseFloat(r.total_kredit);
    }
    const labaBersih = totalPendapatan - totalBeban;

    // Cari akun Laba Ditahan
    const [[akunLabaDitahan]] = await conn.query(
      `SELECT idakun FROM akun WHERE idtenant = ? AND (LOWER(namaakun) LIKE '%laba ditahan%' OR kodeakun = '3-1002') LIMIT 1`,
      [ctx.idtenant]
    );

    const kodeclosing = await generateKodeClosing(conn, ctx.idtenant, ctx.idlokasi);

    await conn.beginTransaction();

    const [closingResult] = await conn.query(
      `INSERT INTO closing (idtenant, idlokasi, kodeclosing, periodbulan, tglawal, tglakhir, iduser, laba_rugi, catatan, status, userentry, tglentry)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'AKTIF', ?, NOW())`,
      [ctx.idtenant, ctx.idlokasi, kodeclosing, periodbulan, tglAwal, tglAkhir, ctx.iduser, labaBersih, catatan || null, ctx.iduser]
    );
    const idclosing = closingResult.insertId;

    // Insert detail closing per akun
    for (const r of akunPLRows) {
      const saldo_normal = r.jenisak === 'PENDAPATAN'
        ? parseFloat(r.total_kredit) - parseFloat(r.total_debet)
        : parseFloat(r.total_debet) - parseFloat(r.total_kredit);
      await conn.query(
        `INSERT INTO closingdtl (idclosing, idtenant, idakun, namaakun, jenisak, total_debet, total_kredit, saldo_normal)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [idclosing, ctx.idtenant, r.idakun, r.namaakun, r.jenisak, r.total_debet, r.total_kredit, saldo_normal]
      );
    }

    // Buat jurnal penutup: DEBIT PENDAPATAN, KREDIT BEBAN, selisih ke Laba Ditahan
    for (const r of akunPLRows) {
      if (r.jenisak === 'PENDAPATAN') {
        const saldo = parseFloat(r.total_kredit) - parseFloat(r.total_debet);
        if (saldo > 0) {
          await conn.query(
            `INSERT INTO jurnal (idtenant, idlokasi, idtrans, kodetrans, jenis, tgltrans, idakun, posisi, amount, status)
             VALUES (?, ?, ?, ?, 'closing', ?, ?, 'DEBET', ?, 'AKTIF')`,
            [ctx.idtenant, ctx.idlokasi, idclosing, kodeclosing, tglAkhir, r.idakun, saldo]
          );
        }
      } else {
        const saldo = parseFloat(r.total_debet) - parseFloat(r.total_kredit);
        if (saldo > 0) {
          await conn.query(
            `INSERT INTO jurnal (idtenant, idlokasi, idtrans, kodetrans, jenis, tgltrans, idakun, posisi, amount, status)
             VALUES (?, ?, ?, ?, 'closing', ?, ?, 'KREDIT', ?, 'AKTIF')`,
            [ctx.idtenant, ctx.idlokasi, idclosing, kodeclosing, tglAkhir, r.idakun, saldo]
          );
        }
      }
    }

    // Selisih laba/rugi masuk ke Laba Ditahan
    if (akunLabaDitahan && labaBersih !== 0) {
      const posisi = labaBersih > 0 ? 'KREDIT' : 'DEBET';
      await conn.query(
        `INSERT INTO jurnal (idtenant, idlokasi, idtrans, kodetrans, jenis, tgltrans, idakun, posisi, amount, status)
         VALUES (?, ?, ?, ?, 'closing', ?, ?, ?, ?, 'AKTIF')`,
        [ctx.idtenant, ctx.idlokasi, idclosing, kodeclosing, tglAkhir, akunLabaDitahan.idakun, posisi, Math.abs(labaBersih)]
      );
    }

    await conn.commit();
    await logger.history('CLOSING_CREATE', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: kodeclosing, detail: { periodbulan, laba_rugi: labaBersih }, req });
    res.status(201).json({ message: 'Closing berhasil', kodeclosing, idclosing, laba_rugi: labaBersih });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// GET /closing — Daftar closing
exports.getClosingList = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const rows = await tenantQuery(
      `SELECT c.*, u.namauser FROM closing c
       LEFT JOIN user u ON c.iduser = u.iduser AND u.idtenant = c.idtenant
       WHERE c.idlokasi = ?
       ORDER BY c.periodbulan DESC`,
      [ctx.idlokasi]
    );
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};
