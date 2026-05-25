const { tenantQuery, getConnection, getTenantContext } = require('../../config/db');
const { generateKodePayroll } = require('../../lib/kodetrans');
const logger = require('../../lib/logger');

// Tambah kolom baru jika belum ada (one-time migration)
async function ensurePayrollSchema(conn) {
  const adds = [
    "ALTER TABLE payrolldtl ADD COLUMN IF NOT EXISTS hari_dibayar INT NOT NULL DEFAULT 0",
    "ALTER TABLE payrolldtl ADD COLUMN IF NOT EXISTS gajipoko_efektif DECIMAL(15,2) NOT NULL DEFAULT 0",
    "ALTER TABLE payroll ADD COLUMN IF NOT EXISTS idakun_potongan INT NULL",
  ];
  for (const sql of adds) {
    await conn.query(sql).catch(() => {});
  }
}

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

    const tglAwal = tglawal || `${periodbulan}-01`;
    const tglAkhir = tglakhir || `${periodbulan}-31`;

    const [[existing]] = await conn.query(
      'SELECT idpayroll FROM payroll WHERE idtenant = ? AND idlokasi = ? AND periodbulan = ?',
      [ctx.idtenant, ctx.idlokasi, periodbulan]
    );
    if (existing) return res.status(400).json({ message: 'Payroll untuk periode ini sudah ada' });

    await ensurePayrollSchema(conn);
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
      const [komponen] = await conn.query(
        "SELECT * FROM komponengaji WHERE idkaryawan = ? AND idtenant = ? AND status = 'AKTIF'",
        [kar.idkaryawan, ctx.idtenant]
      );
      let totalTunjangan = 0, totalPotonganKar = 0;
      for (const k of komponen) {
        if (k.jenis === 'TUNJANGAN') totalTunjangan += parseFloat(k.amount);
        else totalPotonganKar += parseFloat(k.amount);
      }

      // Query absensi: hitung harikerja, hari_hadir, dan hari_dibayar (HADIR+IZIN+SAKIT+CUTI)
      const [[absensiRow]] = await conn.query(
        `SELECT
           COUNT(*) AS harikerja,
           SUM(CASE WHEN jenisabsensi = 'HADIR' THEN 1 ELSE 0 END) AS hari_hadir,
           SUM(CASE WHEN jenisabsensi IN ('HADIR','IZIN','SAKIT','CUTI') THEN 1 ELSE 0 END) AS hari_dibayar
         FROM absensi
         WHERE idkaryawan = ? AND idtenant = ? AND tglabsensi >= ? AND tglabsensi <= ?`,
        [kar.idkaryawan, ctx.idtenant, tglAwal, tglAkhir]
      );

      const hariKerja = Number(absensiRow.harikerja || 0);
      const hariHadir = Number(absensiRow.hari_hadir || 0);
      const hariDibayar = Number(absensiRow.hari_dibayar || 0);

      // Prorate gajipoko: potong hanya hari ALPHA (tidak hadir tanpa keterangan)
      // Jika tidak ada absensi sama sekali, bayar penuh (karyawan baru / absensi belum diinput)
      const prorationRatio = hariKerja > 0 ? hariDibayar / hariKerja : 1;
      const gajiPokoEfektif = Math.round(parseFloat(kar.gajipoko) * prorationRatio);

      const gajiBrutoKar = gajiPokoEfektif + totalTunjangan;
      const gajiBersih = gajiPokoEfektif + totalTunjangan - totalPotonganKar;

      totalBruto += gajiBrutoKar;
      totalPotongan += totalPotonganKar;
      totalNeto += gajiBersih;

      await conn.query(
        `INSERT INTO payrolldtl
           (idpayroll, idtenant, idkaryawan, gajipoko, total_tunjangan, total_potongan, gaji_bersih,
            harikerja, hari_hadir, hari_dibayar, gajipoko_efektif)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [idpayroll, ctx.idtenant, kar.idkaryawan, kar.gajipoko, totalTunjangan, totalPotonganKar, gajiBersih,
         hariKerja, hariHadir, hariDibayar, gajiPokoEfektif]
      );
    }

    await conn.query(
      'UPDATE payroll SET total_bruto = ?, total_potongan = ?, total_neto = ? WHERE idpayroll = ?',
      [totalBruto, totalPotongan, totalNeto, idpayroll]
    );

    await conn.commit();
    await logger.history('PAYROLL_GENERATE', {
      idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser,
      ref: kodepayroll, detail: { periodbulan, total_neto: totalNeto }, req
    });
    res.status(201).json({
      message: 'Payroll berhasil digenerate',
      kodepayroll, idpayroll,
      total_bruto: totalBruto, total_potongan: totalPotongan, total_neto: totalNeto,
    });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// PUT /payroll/:id/posting — Posting jurnal beban gaji (jurnal balanced)
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

    const { idakun_beban, idakun_hutang, idakun_potongan } = req.body;

    // Cari akun beban gaji (COA 5-1003)
    let akunBeban = null;
    if (idakun_beban) {
      const [[a]] = await conn.query('SELECT idakun FROM akun WHERE idakun = ? AND idtenant = ?', [idakun_beban, ctx.idtenant]);
      akunBeban = a;
    }
    if (!akunBeban) {
      const [[a]] = await conn.query("SELECT idakun FROM akun WHERE idtenant = ? AND kodeakun = '5-1003' LIMIT 1", [ctx.idtenant]);
      akunBeban = a;
    }

    // Cari akun hutang gaji (COA 2-1002)
    let akunHutang = null;
    if (idakun_hutang) {
      const [[a]] = await conn.query('SELECT idakun FROM akun WHERE idakun = ? AND idtenant = ?', [idakun_hutang, ctx.idtenant]);
      akunHutang = a;
    }
    if (!akunHutang) {
      const [[a]] = await conn.query("SELECT idakun FROM akun WHERE idtenant = ? AND kodeakun = '2-1002' LIMIT 1", [ctx.idtenant]);
      akunHutang = a;
    }

    // Cari akun hutang potongan (COA 2-1003) — opsional untuk pisahkan potongan
    let akunPotongan = null;
    if (idakun_potongan) {
      const [[a]] = await conn.query('SELECT idakun FROM akun WHERE idakun = ? AND idtenant = ?', [idakun_potongan, ctx.idtenant]);
      akunPotongan = a;
    }
    if (!akunPotongan && Number(payroll.total_potongan) > 0) {
      // Coba temukan akun khusus potongan
      const [[a]] = await conn.query(
        "SELECT idakun FROM akun WHERE idtenant = ? AND (kodeakun = '2-1003' OR namaakun LIKE '%Potongan Gaji%') LIMIT 1",
        [ctx.idtenant]
      );
      akunPotongan = a || null;
    }

    const [yyyy, mm] = payroll.periodbulan.split('-');
    const lastDay = new Date(parseInt(yyyy), parseInt(mm), 0).toISOString().slice(0, 10);

    const totalBruto = Number(payroll.total_bruto);
    const totalNeto  = Number(payroll.total_neto);
    const totalPotongan = Number(payroll.total_potongan);

    // DEBET: Beban Gaji = total_bruto
    if (akunBeban) {
      await conn.query(
        `INSERT INTO jurnal (idtenant, idlokasi, idtrans, kodetrans, jenis, tgltrans, idakun, posisi, amount, status)
         VALUES (?, ?, ?, ?, 'payroll', ?, ?, 'DEBET', ?, 'AKTIF')`,
        [ctx.idtenant, ctx.idlokasi, payroll.idpayroll, payroll.kodepayroll, lastDay, akunBeban.idakun, totalBruto]
      );
    }

    if (akunHutang) {
      if (akunPotongan && totalPotongan > 0) {
        // Journal balanced dengan 3 entri:
        // KREDIT Hutang Gaji = total_neto (yang diterima karyawan)
        await conn.query(
          `INSERT INTO jurnal (idtenant, idlokasi, idtrans, kodetrans, jenis, tgltrans, idakun, posisi, amount, status)
           VALUES (?, ?, ?, ?, 'payroll', ?, ?, 'KREDIT', ?, 'AKTIF')`,
          [ctx.idtenant, ctx.idlokasi, payroll.idpayroll, payroll.kodepayroll, lastDay, akunHutang.idakun, totalNeto]
        );
        // KREDIT Hutang Potongan = total_potongan (BPJS, pajak, dll)
        await conn.query(
          `INSERT INTO jurnal (idtenant, idlokasi, idtrans, kodetrans, jenis, tgltrans, idakun, posisi, amount, status)
           VALUES (?, ?, ?, ?, 'payroll', ?, ?, 'KREDIT', ?, 'AKTIF')`,
          [ctx.idtenant, ctx.idlokasi, payroll.idpayroll, payroll.kodepayroll, lastDay, akunPotongan.idakun, totalPotongan]
        );
      } else {
        // Tidak ada akun potongan terpisah: kredit penuh ke hutang gaji agar balanced
        await conn.query(
          `INSERT INTO jurnal (idtenant, idlokasi, idtrans, kodetrans, jenis, tgltrans, idakun, posisi, amount, status)
           VALUES (?, ?, ?, ?, 'payroll', ?, ?, 'KREDIT', ?, 'AKTIF')`,
          [ctx.idtenant, ctx.idlokasi, payroll.idpayroll, payroll.kodepayroll, lastDay, akunHutang.idakun, totalBruto]
        );
      }
    }

    await conn.query(
      "UPDATE payroll SET status = 'POSTED', idakun_beban = ?, idakun_hutang = ?, idakun_potongan = ? WHERE idpayroll = ? AND idtenant = ?",
      [idakun_beban || (akunBeban?.idakun ?? null),
       idakun_hutang || (akunHutang?.idakun ?? null),
       akunPotongan?.idakun ?? null,
       req.params.id, ctx.idtenant]
    );

    await conn.commit();
    await logger.history('PAYROLL_POSTING', {
      idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser,
      ref: payroll.kodepayroll, req
    });
    res.json({ message: 'Payroll berhasil diposting' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// DELETE /payroll/:id — Cancel payroll DRAFT
exports.cancel = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();

    const [[payroll]] = await conn.query(
      'SELECT * FROM payroll WHERE idpayroll = ? AND idtenant = ? AND idlokasi = ?',
      [req.params.id, ctx.idtenant, ctx.idlokasi]
    );
    if (!payroll) return res.status(404).json({ message: 'Payroll tidak ditemukan' });
    if (payroll.status !== 'DRAFT') {
      return res.status(400).json({ message: 'Hanya payroll berstatus DRAFT yang bisa dihapus. Gunakan unpost untuk POSTED.' });
    }

    await conn.query('DELETE FROM payrolldtl WHERE idpayroll = ? AND idtenant = ?', [req.params.id, ctx.idtenant]);
    await conn.query('DELETE FROM payroll WHERE idpayroll = ? AND idtenant = ?', [req.params.id, ctx.idtenant]);

    await conn.commit();
    await logger.history('PAYROLL_CANCEL', {
      idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser,
      ref: payroll.kodepayroll, req
    });
    res.json({ message: 'Payroll DRAFT berhasil dihapus' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// PUT /payroll/:id/unpost — Batalkan posting (POSTED → DRAFT), hapus jurnal
exports.unpost = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();

    const [[payroll]] = await conn.query(
      'SELECT * FROM payroll WHERE idpayroll = ? AND idtenant = ? AND idlokasi = ?',
      [req.params.id, ctx.idtenant, ctx.idlokasi]
    );
    if (!payroll) return res.status(404).json({ message: 'Payroll tidak ditemukan' });
    if (payroll.status !== 'POSTED') {
      return res.status(400).json({ message: 'Hanya payroll berstatus POSTED yang bisa di-unpost' });
    }

    // Hapus semua jurnal terkait payroll ini
    await conn.query(
      "DELETE FROM jurnal WHERE jenis = 'payroll' AND idtrans = ? AND idtenant = ? AND idlokasi = ?",
      [req.params.id, ctx.idtenant, ctx.idlokasi]
    );

    await conn.query(
      "UPDATE payroll SET status = 'DRAFT', idakun_beban = NULL, idakun_hutang = NULL, idakun_potongan = NULL WHERE idpayroll = ? AND idtenant = ?",
      [req.params.id, ctx.idtenant]
    );

    await conn.commit();
    await logger.history('PAYROLL_UNPOST', {
      idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser,
      ref: payroll.kodepayroll, req
    });
    res.json({ message: 'Payroll berhasil di-unpost kembali ke DRAFT' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};
