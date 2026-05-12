const { tenantQuery, getConnection, getTenantContext } = require('../config/db');
const { generateKodePayroll } = require('../lib/kodetrans');
const logger = require('../lib/logger');

// GET /payroll
exports.getAll = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { status, periodbulan } = req.query;
    let sql = 'SELECT * FROM payroll WHERE idlokasi = ?';
    const params = [ctx.idlokasi];
    if (status) { sql += ' AND status = ?'; params.push(status); }
    if (periodbulan) { sql += ' AND periodbulan = ?'; params.push(periodbulan); }
    sql += ' ORDER BY periodbulan DESC, idpayroll DESC LIMIT 100';
    const rows = await tenantQuery(sql, params);
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /payroll/:id — Detail payroll + per-karyawan breakdown
exports.getOne = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const rows = await tenantQuery(
      'SELECT * FROM payroll WHERE idpayroll = ? AND idlokasi = ?',
      [req.params.id, ctx.idlokasi]
    );
    if (!rows.length) return res.status(404).json({ message: 'Payroll tidak ditemukan' });

    const details = await tenantQuery(
      `SELECT pd.*, k.namakaryawan, k.kodekaryawan FROM payrolldtl pd
       LEFT JOIN karyawan k ON pd.idkaryawan = k.idkaryawan AND k.idtenant = pd.idtenant
       WHERE pd.idpayroll = ?`,
      [req.params.id]
    );
    res.json({ ...rows[0], details });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// POST /payroll/generate — Hitung payroll untuk periode
exports.generate = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    const { periodbulan, tglawal, tglakhir } = req.body;
    if (!periodbulan) return res.status(400).json({ message: 'periodbulan wajib diisi' });

    // Cek periode sudah ada
    const [[existing]] = await conn.query(
      'SELECT idpayroll FROM payroll WHERE idtenant = ? AND idlokasi = ? AND periodbulan = ?',
      [ctx.idtenant, ctx.idlokasi, periodbulan]
    );
    if (existing) return res.status(400).json({ message: 'Payroll untuk periode ini sudah ada' });

    const tglAwal = tglawal || `${periodbulan}-01`;
    const tglAkhir = tglakhir || `${periodbulan}-31`;

    const kodepayroll = await generateKodePayroll(conn, ctx.idtenant, ctx.idlokasi);

    await conn.beginTransaction();

    const [karyawanList] = await conn.query(
      "SELECT * FROM karyawan WHERE idtenant = ? AND status = 'AKTIF'",
      [ctx.idtenant]
    );

    let totalBruto = 0, totalPotongan = 0, totalNeto = 0;

    const [payrollResult] = await conn.query(
      `INSERT INTO payroll (idtenant, idlokasi, kodepayroll, periodbulan, tglawal, tglakhir, total_bruto, total_potongan, total_neto, status, iduser, userentry, tglentry)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 'DRAFT', ?, ?, NOW())`,
      [ctx.idtenant, ctx.idlokasi, kodepayroll, periodbulan, tglAwal, tglAkhir, ctx.iduser, ctx.iduser]
    );
    const idpayroll = payrollResult.insertId;

    for (const kar of karyawanList) {
      // Komponen gaji
      const [komponen] = await conn.query(
        "SELECT * FROM komponengaji WHERE idkaryawan = ? AND idtenant = ? AND status = 'AKTIF'",
        [kar.idkaryawan, ctx.idtenant]
      );
      let totalTunjangan = 0, totalPotonganKar = 0;
      for (const k of komponen) {
        if (k.jenis === 'TUNJANGAN') totalTunjangan += parseFloat(k.amount);
        else totalPotonganKar += parseFloat(k.amount);
      }

      // Hari hadir dari absensi
      const [[absensiRow]] = await conn.query(
        `SELECT COUNT(*) AS hari_hadir,
          (SELECT COUNT(*) FROM absensi WHERE idkaryawan = ? AND idtenant = ? AND tglabsensi >= ? AND tglabsensi <= ?) AS harikerja
         FROM absensi WHERE idkaryawan = ? AND idtenant = ? AND jenisabsensi = 'HADIR' AND tglabsensi >= ? AND tglabsensi <= ?`,
        [kar.idkaryawan, ctx.idtenant, tglAwal, tglAkhir, kar.idkaryawan, ctx.idtenant, tglAwal, tglAkhir]
      );

      const gajiBersih = parseFloat(kar.gajipoko) + totalTunjangan - totalPotonganKar;
      totalBruto += parseFloat(kar.gajipoko) + totalTunjangan;
      totalPotongan += totalPotonganKar;
      totalNeto += gajiBersih;

      await conn.query(
        `INSERT INTO payrolldtl (idpayroll, idtenant, idkaryawan, gajipoko, total_tunjangan, total_potongan, gaji_bersih, harikerja, hari_hadir)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [idpayroll, ctx.idtenant, kar.idkaryawan, kar.gajipoko, totalTunjangan, totalPotonganKar, gajiBersih, absensiRow.harikerja || 0, absensiRow.hari_hadir || 0]
      );
    }

    await conn.query(
      'UPDATE payroll SET total_bruto = ?, total_potongan = ?, total_neto = ? WHERE idpayroll = ?',
      [totalBruto, totalPotongan, totalNeto, idpayroll]
    );

    await conn.commit();
    await logger.history('PAYROLL_GENERATE', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: kodepayroll, detail: { periodbulan, total_neto: totalNeto }, req });
    res.status(201).json({ message: 'Payroll berhasil digenerate', kodepayroll, idpayroll, total_bruto: totalBruto, total_potongan: totalPotongan, total_neto: totalNeto });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// PUT /payroll/:id/posting — Posting jurnal beban gaji
exports.posting = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();

    const [[payroll]] = await conn.query(
      'SELECT * FROM payroll WHERE idpayroll = ? AND idtenant = ? AND idlokasi = ?',
      [req.params.id, ctx.idtenant, ctx.idlokasi]
    );
    if (!payroll) return res.status(404).json({ message: 'Payroll tidak ditemukan' });
    if (payroll.status !== 'DRAFT') return res.status(400).json({ message: 'Hanya DRAFT yang bisa diposting' });

    const { idakun_beban, idakun_hutang } = req.body;

    // Lookup akun dari request body atau fallback ke kode COA standar
    let akunBeban = null, akunHutang = null;

    if (idakun_beban) {
      const [[a]] = await conn.query('SELECT idakun FROM akun WHERE idakun = ? AND idtenant = ?', [idakun_beban, ctx.idtenant]);
      akunBeban = a;
    }
    if (!akunBeban) {
      const [[a]] = await conn.query("SELECT idakun FROM akun WHERE idtenant = ? AND kodeakun = '5-1003' LIMIT 1", [ctx.idtenant]);
      akunBeban = a;
    }

    if (idakun_hutang) {
      const [[a]] = await conn.query('SELECT idakun FROM akun WHERE idakun = ? AND idtenant = ?', [idakun_hutang, ctx.idtenant]);
      akunHutang = a;
    }
    if (!akunHutang) {
      const [[a]] = await conn.query("SELECT idakun FROM akun WHERE idtenant = ? AND kodeakun = '2-1002' LIMIT 1", [ctx.idtenant]);
      akunHutang = a;
    }

    // tgltrans = last day of period
    const [yyyy, mm] = payroll.periodbulan.split('-');
    const lastDay = new Date(parseInt(yyyy), parseInt(mm), 0).toISOString().slice(0, 10);

    if (akunBeban) {
      await conn.query(
        `INSERT INTO jurnal (idtenant, idlokasi, idtrans, kodetrans, jenis, tgltrans, idakun, posisi, amount, status)
         VALUES (?, ?, ?, ?, 'payroll', ?, ?, 'DEBET', ?, 'AKTIF')`,
        [ctx.idtenant, ctx.idlokasi, payroll.idpayroll, payroll.kodepayroll, lastDay, akunBeban.idakun, payroll.total_bruto]
      );
    }
    if (akunHutang) {
      await conn.query(
        `INSERT INTO jurnal (idtenant, idlokasi, idtrans, kodetrans, jenis, tgltrans, idakun, posisi, amount, status)
         VALUES (?, ?, ?, ?, 'payroll', ?, ?, 'KREDIT', ?, 'AKTIF')`,
        [ctx.idtenant, ctx.idlokasi, payroll.idpayroll, payroll.kodepayroll, lastDay, akunHutang.idakun, payroll.total_neto]
      );
    }

    const idakunBebanUpdate = idakun_beban || (akunBeban ? akunBeban.idakun : null);
    const idakunHutangUpdate = idakun_hutang || (akunHutang ? akunHutang.idakun : null);

    await conn.query(
      "UPDATE payroll SET status = 'POSTED', idakun_beban = ?, idakun_hutang = ? WHERE idpayroll = ? AND idtenant = ?",
      [idakunBebanUpdate, idakunHutangUpdate, req.params.id, ctx.idtenant]
    );

    await conn.commit();
    await logger.history('PAYROLL_POSTING', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: payroll.kodepayroll, req });
    res.json({ message: 'Payroll berhasil diposting' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};
