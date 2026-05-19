const { tenantQuery, getConnection, getTenantContext } = require('../../config/db');
const { generateKodeJual, generateKodePelunasanPiutang } = require('../../lib/kodetrans');
const jurnalhelper = require('../../lib/jurnalhelper');
const logger = require('../../lib/logger');

function toKecilJml(jml, satuan, barang) {
  const k1 = Math.max(parseInt(barang.konversi1) || 1, 1);
  const k2 = Math.max(parseInt(barang.konversi2) || 1, 1);
  if (satuan && barang.satuanbesar  && satuan === barang.satuanbesar)  return jml * k1 * k2;
  if (satuan && barang.satuansedang && satuan === barang.satuansedang) return jml * k2;
  return jml;
}

async function assertBpkCanBeUsed(conn, { idbpk, idtenant, currentIdjual = null }) {
  if (!idbpk) return;

  const [[bpk]] = await conn.query(
    'SELECT idbpk, kodebpk, status FROM bpk WHERE idbpk = ? AND idtenant = ?',
    [idbpk, idtenant]
  );
  if (!bpk) {
    const err = new Error('BPK tidak ditemukan');
    err.statusCode = 404;
    throw err;
  }

  const isCurrentConfirmed = currentIdjual && bpk.status === 'CONFIRMED';
  if (bpk.status !== 'APPROVED' && !isCurrentConfirmed) {
    const err = new Error('Penjualan hanya bisa dibuat dari BPK APPROVED');
    err.statusCode = 400;
    throw err;
  }

  const [[used]] = await conn.query(
    `SELECT idjual FROM jual
     WHERE idbpk = ? AND idtenant = ? AND status != 'CANCELLED' AND (? IS NULL OR idjual <> ?)
     LIMIT 1`,
    [idbpk, idtenant, currentIdjual, currentIdjual]
  );
  if (used) {
    const err = new Error('BPK sudah digunakan di Penjualan lain');
    err.statusCode = 400;
    throw err;
  }
}

function isAutoLunasJual(jual) {
  return jual.is_lunaslangsung === 1
    || jual.is_lunaslangsung === true
    || ['JUAL LUNAS', 'PENJUALAN LUNAS', 'PENJUALAN LANGSUNG LUNAS', 'PENJUALAN PESANAN LUNAS'].includes(jual.jenistransaksi);
}

async function deletePostedJual(conn, { idtenant, jual }) {
  // Hapus jurnal penjualan + jurnal pelunasan otomatis yang terkait
  const [pels] = await conn.query(
    `SELECT pp.kodepelunasan
     FROM pelunasanpiutang pp
     JOIN pelunasanpiutangdtl ppdtl ON pp.idpelunasan = ppdtl.idpelunasan
     WHERE ppdtl.kodetrans = ? AND pp.idtenant = ?`,
    [jual.kodejual, idtenant]
  );
  await jurnalhelper.hapusJurnal(conn, idtenant, [jual.kodejual, ...pels.map(p => p.kodepelunasan)]);

  if (isAutoLunasJual(jual)) {
    await conn.query(
      `DELETE pp, ppdtl
       FROM pelunasanpiutang pp
       JOIN pelunasanpiutangdtl ppdtl ON pp.idpelunasan = ppdtl.idpelunasan
       WHERE ppdtl.kodetrans = ? AND pp.idtenant = ?`,
      [jual.kodejual, idtenant]
    );
  }

  await conn.query('DELETE FROM kartupiutang WHERE kodetrans = ? AND idtenant = ?', [jual.kodejual, idtenant]);
  await conn.query(
    "DELETE FROM kartustok WHERE idtrans = ? AND jenistransaksi = 'JUAL' AND idtenant = ?",
    [jual.idjual, idtenant]
  );
  await conn.query(
    "UPDATE hargajual SET status = 'CANCELLED' WHERE idref = ? AND koderef = ? AND jenisref = 'JUAL' AND idtenant = ?",
    [jual.idjual, jual.kodejual, idtenant]
  );
}

exports.create = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await jurnalhelper.ensureJurnalSchema(conn);
    const akun = await jurnalhelper.getDefaultAkunJurnal(conn, ctx.idtenant);
    await conn.beginTransaction();

    const items          = req.body.items;
    const customKodejual = req.body.kodejual;
    const customIdlokasi = req.body.idlokasi;

    if (!items || !items.length) {
      await conn.rollback();
      return res.status(400).json({ message: 'Items tidak boleh kosong' });
    }

    const idcustomer     = req.body.idcustomer || null;
    const langsungLunas  = req.body.langsung_lunas === true;
    const idlokasi       = (customIdlokasi && parseInt(customIdlokasi)) ? parseInt(customIdlokasi) : null;
    const tgltrans       = req.body.tgltrans || new Date().toISOString().slice(0, 10);
    const kodejual       = (customKodejual && customKodejual.trim()) ? customKodejual.trim() : await generateKodeJual(conn, ctx.idtenant, idlokasi);
    const approve        = req.body.approve === true || req.body.status === 'APPROVED';
    const idbpk          = req.body.idbpk || null;
    const kodebpk        = req.body.kodebpk || null;
    const jalurpenjualan = idbpk ? 'PESANAN' : (req.body.jalurpenjualan || 'LANGSUNG');
    const jenistransaksi = `${jalurpenjualan === 'PESANAN' ? 'PENJUALAN PESANAN' : 'PENJUALAN LANGSUNG'}${langsungLunas ? ' LUNAS' : ''}`;
    const statusJual     = approve ? 'APPROVED' : 'DRAFT';

    if (!idlokasi) {
      await conn.rollback();
      return res.status(400).json({ message: 'Lokasi wajib dipilih' });
    }
    await assertBpkCanBeUsed(conn, { idbpk, idtenant: ctx.idtenant });

    const [[tenant]]  = await conn.query('SELECT ppn FROM tenant WHERE idtenant = ?', [ctx.idtenant]);
    const ppnPercent  = tenant ? parseFloat(tenant.ppn) : 11;
    let   grandTotal  = 0;

    const [headerResult] = await conn.query(
      `INSERT INTO jual (idtenant, idlokasi, kodejual, tgltrans, idcustomer, iduser, grandtotal, bayar, jenistransaksi, idbpk, kodebpk, jalurpenjualan, is_lunaslangsung, status, userentry)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?)`,
      [ctx.idtenant, idlokasi, kodejual, tgltrans, idcustomer, ctx.iduser, jenistransaksi, idbpk, kodebpk, jalurpenjualan, langsungLunas ? 1 : 0, statusJual, ctx.iduser]
    );
    const idjual = headerResult.insertId;

    for (const item of items) {
      const harga   = parseFloat(item.harga);
      const jml     = parseFloat(item.jml) || 1;
      const diskon  = parseFloat(item.diskon) || 0;

      const ppnMode = item.ppn_mode || 'INCLUDE';
      const ppnRp   = ppnMode === 'INCLUDE' ? (harga * jml * ppnPercent) / 100 : 0;
      const disknRp = (harga * jml * diskon) / 100;
      const subTtl  = (harga * jml) + ppnRp - disknRp;

      grandTotal += subTtl;

      await conn.query(
        'INSERT INTO jualdtl (idjual, idtenant, idbarang, jml, harga, ppn, diskon, subtotal, satuan) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [idjual, ctx.idtenant, item.idbarang, jml, harga, ppnRp, diskon, subTtl, item.satuan || null]
      );

      if (approve) {
        const [[barangInfo]] = await conn.query('SELECT satuanbesar, satuansedang, satuankecil, konversi1, konversi2 FROM barang WHERE idbarang = ? AND idtenant = ?', [item.idbarang, ctx.idtenant]);
        const jmlStokKecil   = barangInfo ? toKecilJml(jml, item.satuan, barangInfo) : jml;

        await conn.query(
          'INSERT INTO kartustok (idtenant, idlokasi, kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idtrans, jenistransaksi) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [ctx.idtenant, idlokasi, kodejual, item.idbarang, jmlStokKecil, 'K', tgltrans, `Penjualan ${kodejual}`, idjual, 'JUAL']
        );

        const [[latestHarga]] = await conn.query("SELECT hargajual FROM hargajual WHERE idbarang = ? AND idtenant = ? AND status = 'AKTIF' ORDER BY tgltrans DESC, idhargajual DESC LIMIT 1", [item.idbarang, ctx.idtenant]);
        if (!latestHarga || parseFloat(latestHarga.hargajual) !== harga) {
          await conn.query('INSERT INTO hargajual (idtenant, idbarang, hargajual, tgltrans, idref, koderef, jenisref, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [ctx.idtenant, item.idbarang, harga, tgltrans, idjual, kodejual, 'JUAL', 'AKTIF']);
        }
      }
    }

    const bayarFinal = approve && langsungLunas ? grandTotal : 0;
    await conn.query('UPDATE jual SET grandtotal = ?, bayar = ? WHERE idjual = ?', [grandTotal, bayarFinal, idjual]);

    if (approve) {
      await conn.query(
        'INSERT INTO kartupiutang (idtenant, idlokasi, idcustomer, kodetrans, jenis, amount, terbayar, sisa, tgltrans, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [ctx.idtenant, idlokasi, idcustomer, kodejual, 'JUAL', grandTotal, langsungLunas ? grandTotal : 0, langsungLunas ? 0 : grandTotal, tgltrans, langsungLunas ? 'LUNAS' : 'OPEN']
      );

      // Jurnal penjualan: DEBET Piutang; KREDIT Penjualan + PPN Keluaran
      const [[ppnRow]] = await conn.query('SELECT COALESCE(SUM(ppn),0) AS totalppn FROM jualdtl WHERE idjual = ? AND idtenant = ?', [idjual, ctx.idtenant]);
      await jurnalhelper.postJurnalPenjualan(conn, {
        akun, idtenant: ctx.idtenant, idlokasi, idjual, kodejual, jenis: 'jual',
        tgltrans, grandtotal: grandTotal, totalppn: parseFloat(ppnRow.totalppn || 0),
      });

      if (langsungLunas && grandTotal > 0) {
        const kodepelunasan = await generateKodePelunasanPiutang(conn, ctx.idtenant, idlokasi);
        const metodbayar    = req.body.metodbayar || 'TUNAI';
        const [pelResult] = await conn.query(
          'INSERT INTO pelunasanpiutang (idtenant, idlokasi, idcustomer, kodepelunasan, tgltrans, total_amount, metodbayar, catatan, userentry) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [ctx.idtenant, idlokasi, idcustomer, kodepelunasan, tgltrans, grandTotal, metodbayar, `Pelunasan Langsung Jual ${kodejual}`, ctx.iduser]
        );
        await conn.query('INSERT INTO pelunasanpiutangdtl (idpelunasan, kodetrans, amount) VALUES (?, ?, ?)', [pelResult.insertId, kodejual, grandTotal]);

        // Jurnal pelunasan piutang otomatis (akun pembayaran dari setting default)
        const idakunBayar = jurnalhelper.resolveAkunBayar(akun, metodbayar);
        await conn.query('INSERT INTO pelunasanpiutangbayar (idpelunasan, idtenant, idakun, amount) VALUES (?, ?, ?, ?)', [pelResult.insertId, ctx.idtenant, idakunBayar, grandTotal]);
        await jurnalhelper.postJurnalPelunasanPiutang(conn, {
          akun, idtenant: ctx.idtenant, idlokasi, idpelunasan: pelResult.insertId,
          kodepelunasan, tgltrans, payments: [{ idakun: idakunBayar, amount: grandTotal }],
        });
      }
    }

    if (idbpk) {
      await conn.query("UPDATE bpk SET status = 'CONFIRMED' WHERE idbpk = ? AND idtenant = ?", [idbpk, ctx.idtenant]);
    }
    await conn.commit();

    await logger.history('JUAL_CREATE', { idtenant: ctx.idtenant, idlokasi, iduser: ctx.iduser, ref: kodejual, detail: { grandtotal: grandTotal, status: statusJual }, req });
    res.status(201).json({ message: 'Penjualan berhasil', kodejual, idjual, grandtotal: grandTotal });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.getAll = async (req, res) => {
  let conn;
  try {
    conn = await getConnection();
    const ctx = getTenantContext();
    const { tglwal, tglakhir, idcustomer, idlokasi, search, available } = req.query;

    let sql = `
      SELECT j.*,
             DATE_FORMAT(j.tgltrans, '%Y-%m-%d') AS tgltrans,
             c.namacustomer, l.namalokasi, COALESCE(kp.status, 'BELUMLUNAS') as statuslunas
      FROM jual j
      LEFT JOIN customer c ON j.idcustomer = c.idcustomer AND c.idtenant = j.idtenant
      LEFT JOIN lokasi l ON j.idlokasi = l.idlokasi AND l.idtenant = j.idtenant
      LEFT JOIN kartupiutang kp ON kp.kodetrans = j.kodejual AND kp.status = 'LUNAS' AND kp.idtenant = j.idtenant
      WHERE j.idtenant = ?
    `;
    const params = [ctx.idtenant];

    if (available === '1' || available == 1) {
      sql += ` AND j.status = 'APPROVED' AND NOT EXISTS (
        SELECT 1 FROM returjual rj WHERE rj.idjual = j.idjual AND rj.status != 'CANCELLED' AND rj.idtenant = j.idtenant
      )`;
    }
    if (idlokasi)   { sql += ' AND j.idlokasi = ?';    params.push(idlokasi); }
    if (tglwal)     { sql += ' AND j.tgltrans >= ?';   params.push(tglwal); }
    if (tglakhir)   { sql += ' AND j.tgltrans <= ?';   params.push(tglakhir); }
    if (idcustomer) { sql += ' AND j.idcustomer = ?';  params.push(idcustomer); }
    if (search)     { sql += ' AND j.kodejual LIKE ?'; params.push(`%${search}%`); }

    sql += ' ORDER BY j.tgltrans DESC, j.idjual DESC LIMIT 200';

    const rows = await tenantQuery(sql, params);
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message });
  } finally {
    if (conn) conn.release();
  }
};

exports.getOne = async (req, res) => {
  let conn;
  try {
    conn = await getConnection();
    const ctx = getTenantContext();
    const { id } = req.params;

    const rows = await tenantQuery(
      `SELECT j.*, DATE_FORMAT(j.tgltrans, '%Y-%m-%d') AS tgltrans,
              c.namacustomer, c.kodecustomer, c.alamat AS calamat, c.hp AS chp,
              l.namalokasi, l.kodelokasi, COALESCE(kp.status, 'BELUMLUNAS') as statuslunas
       FROM jual j
       LEFT JOIN customer c ON j.idcustomer = c.idcustomer AND c.idtenant = j.idtenant
       LEFT JOIN lokasi l ON j.idlokasi = l.idlokasi AND l.idtenant = j.idtenant
       LEFT JOIN kartupiutang kp ON kp.kodetrans = j.kodejual AND kp.status = 'LUNAS' AND kp.idtenant = j.idtenant
       WHERE j.idjual = ? AND j.idtenant = ?`,
      [id, ctx.idtenant]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Penjualan tidak ditemukan' });

    const items = await tenantQuery(
      `SELECT jd.*, b.namabarang, b.kodebarang, b.satuanbesar, b.satuansedang, b.satuankecil, b.konversi1, b.konversi2,
              COALESCE(SUM(CASE WHEN ks.jenis = 'M' THEN ks.jml ELSE -ks.jml END), 0) AS stok
       FROM jualdtl jd
       LEFT JOIN barang b ON jd.idbarang = b.idbarang AND b.idtenant = jd.idtenant
       LEFT JOIN kartustok ks ON ks.idbarang = jd.idbarang AND ks.idtenant = jd.idtenant AND ks.idlokasi = ?
       WHERE jd.idjual = ? AND jd.idtenant = ?
       GROUP BY jd.idjualdtl, jd.idjual, jd.idtenant, jd.idbarang, jd.jml, jd.harga, jd.ppn, jd.diskon, jd.subtotal, jd.satuan,
                b.namabarang, b.kodebarang, b.satuanbesar, b.satuansedang, b.satuankecil, b.konversi1, b.konversi2`,
      [rows[0].idlokasi, id, ctx.idtenant]
    );

    const mappedItems = items.map(item => ({
      ...item,
      ppn_mode: parseFloat(item.ppn || 0) > 0 ? 'INCLUDE' : 'TIDAK_PAKAI',
    }));

    res.json({ ...rows[0], items: mappedItems });
  } catch (err) {
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message });
  } finally {
    if (conn) conn.release();
  }
};

exports.update = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await jurnalhelper.ensureJurnalSchema(conn);
    const akun = await jurnalhelper.getDefaultAkunJurnal(conn, ctx.idtenant);
    await conn.beginTransaction();

    const { id }         = req.params;
    const items          = req.body.items;
    const newIdlokasi    = req.body.idlokasi;
    const newIdcustomer  = req.body.idcustomer || null;
    const newTgltrans    = req.body.tgltrans;
    const langsungLunas  = req.body.langsung_lunas === true;
    const approve        = req.body.approve === true || req.body.status === 'APPROVED';
    const newIdbpk       = req.body.idbpk || null;
    const newKodebpk     = req.body.kodebpk || null;
    const jalurpenjualan = newIdbpk ? 'PESANAN' : (req.body.jalurpenjualan || 'LANGSUNG');

    if (!items || !items.length) {
      await conn.rollback();
      return res.status(400).json({ message: 'Items tidak boleh kosong' });
    }

    const [[jual]] = await conn.query('SELECT * FROM jual WHERE idjual = ? AND idtenant = ?', [id, ctx.idtenant]);
    if (!jual) {
      await conn.rollback();
      return res.status(404).json({ message: 'Penjualan tidak ditemukan' });
    }
    if (jual.status === 'CANCELLED') {
      await conn.rollback();
      return res.status(400).json({ message: 'Penjualan sudah dibatalkan' });
    }
    if (jual.status !== 'DRAFT') {
      await conn.rollback();
      return res.status(400).json({ message: 'Hanya Penjualan DRAFT yang bisa diedit' });
    }

    const kodejual       = jual.kodejual;
    const idlokasi       = (newIdlokasi && parseInt(newIdlokasi)) ? parseInt(newIdlokasi) : null;
    const tgltrans       = newTgltrans || String(jual.tgltrans).slice(0, 10);
    const jenistransaksi = `${jalurpenjualan === 'PESANAN' ? 'PENJUALAN PESANAN' : 'PENJUALAN LANGSUNG'}${langsungLunas ? ' LUNAS' : ''}`;
    const statusJual     = approve ? 'APPROVED' : 'DRAFT';

    if (!idlokasi) {
      await conn.rollback();
      return res.status(400).json({ message: 'Lokasi wajib dipilih' });
    }
    await assertBpkCanBeUsed(conn, { idbpk: newIdbpk, idtenant: ctx.idtenant, currentIdjual: id });

    // Hapus jurnal lama (penjualan + pelunasan otomatis) sebelum dibangun ulang
    const [oldPels] = await conn.query(
      `SELECT pp.kodepelunasan FROM pelunasanpiutang pp
       JOIN pelunasanpiutangdtl ppdtl ON pp.idpelunasan = ppdtl.idpelunasan
       WHERE ppdtl.kodetrans = ? AND pp.idtenant = ?`,
      [kodejual, ctx.idtenant]
    );
    await jurnalhelper.hapusJurnal(conn, ctx.idtenant, [kodejual, ...oldPels.map(p => p.kodepelunasan)]);
    await conn.query(
      `DELETE pp, ppdtl FROM pelunasanpiutang pp
       JOIN pelunasanpiutangdtl ppdtl ON pp.idpelunasan = ppdtl.idpelunasan
       WHERE ppdtl.kodetrans = ?`,
      [kodejual]
    );
    await conn.query('DELETE FROM kartupiutang WHERE kodetrans = ? AND idtenant = ?', [kodejual, ctx.idtenant]);
    await conn.query("DELETE FROM kartustok WHERE idtrans = ? AND jenistransaksi = 'JUAL' AND idtenant = ?", [id, ctx.idtenant]);
    await conn.query('DELETE FROM jualdtl WHERE idjual = ? AND idtenant = ?', [id, ctx.idtenant]);

    await conn.query(
      'UPDATE jual SET tgltrans = ?, idlokasi = ?, idcustomer = ?, jenistransaksi = ?, idbpk = ?, kodebpk = ?, jalurpenjualan = ?, is_lunaslangsung = ?, status = ? WHERE idjual = ? AND idtenant = ?',
      [tgltrans, idlokasi, newIdcustomer, jenistransaksi, newIdbpk, newKodebpk, jalurpenjualan, langsungLunas ? 1 : 0, statusJual, id, ctx.idtenant]
    );

    const [[tenant]] = await conn.query('SELECT ppn FROM tenant WHERE idtenant = ?', [ctx.idtenant]);
    const ppnPercent = tenant ? parseFloat(tenant.ppn) : 11;
    let grandTotal   = 0;

    for (const item of items) {
      const harga   = parseFloat(item.harga);
      const jml     = parseFloat(item.jml) || 1;
      const diskon  = parseFloat(item.diskon) || 0;

      const ppnMode = item.ppn_mode || 'INCLUDE';
      const ppnRp   = ppnMode === 'INCLUDE' ? (harga * jml * ppnPercent) / 100 : 0;
      const disknRp = (harga * jml * diskon) / 100;
      const subTtl  = (harga * jml) + ppnRp - disknRp;

      grandTotal += subTtl;

      await conn.query(
        'INSERT INTO jualdtl (idjual, idtenant, idbarang, jml, harga, ppn, diskon, subtotal, satuan) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, ctx.idtenant, item.idbarang, jml, harga, ppnRp, diskon, subTtl, item.satuan || null]
      );

      if (approve) {
        const [[barangInfo]] = await conn.query('SELECT satuanbesar, satuansedang, satuankecil, konversi1, konversi2 FROM barang WHERE idbarang = ? AND idtenant = ?', [item.idbarang, ctx.idtenant]);
        const jmlStokKecil   = barangInfo ? toKecilJml(jml, item.satuan, barangInfo) : jml;

        await conn.query(
          'INSERT INTO kartustok (idtenant, idlokasi, kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idtrans, jenistransaksi) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [ctx.idtenant, idlokasi, kodejual, item.idbarang, jmlStokKecil, 'K', tgltrans, `Penjualan ${kodejual}`, id, 'JUAL']
        );

        const [[latestHarga]] = await conn.query("SELECT hargajual FROM hargajual WHERE idbarang = ? AND idtenant = ? AND status = 'AKTIF' ORDER BY tgltrans DESC, idhargajual DESC LIMIT 1", [item.idbarang, ctx.idtenant]);
        if (!latestHarga || parseFloat(latestHarga.hargajual) !== harga) {
          await conn.query('INSERT INTO hargajual (idtenant, idbarang, hargajual, tgltrans, idref, koderef, jenisref, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [ctx.idtenant, item.idbarang, harga, tgltrans, id, kodejual, 'JUAL', 'AKTIF']);
        }
      }
    }

    const bayarFinal = approve && langsungLunas ? grandTotal : 0;
    await conn.query('UPDATE jual SET grandtotal = ?, bayar = ? WHERE idjual = ? AND idtenant = ?', [grandTotal, bayarFinal, id, ctx.idtenant]);

    if (approve) {
      await conn.query(
        'INSERT INTO kartupiutang (idtenant, idlokasi, idcustomer, kodetrans, jenis, amount, terbayar, sisa, tgltrans, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [ctx.idtenant, idlokasi, newIdcustomer, kodejual, 'JUAL', grandTotal, langsungLunas ? grandTotal : 0, langsungLunas ? 0 : grandTotal, tgltrans, langsungLunas ? 'LUNAS' : 'OPEN']
      );

      // Jurnal penjualan: DEBET Piutang; KREDIT Penjualan + PPN Keluaran
      const [[ppnRow]] = await conn.query('SELECT COALESCE(SUM(ppn),0) AS totalppn FROM jualdtl WHERE idjual = ? AND idtenant = ?', [id, ctx.idtenant]);
      await jurnalhelper.postJurnalPenjualan(conn, {
        akun, idtenant: ctx.idtenant, idlokasi, idjual: id, kodejual, jenis: 'jual',
        tgltrans, grandtotal: grandTotal, totalppn: parseFloat(ppnRow.totalppn || 0),
      });

      if (langsungLunas && grandTotal > 0) {
        const kodepelunasan = await generateKodePelunasanPiutang(conn, ctx.idtenant, idlokasi);
        const metodbayar    = req.body.metodbayar || 'TUNAI';
        const [pelResult] = await conn.query(
          'INSERT INTO pelunasanpiutang (idtenant, idlokasi, idcustomer, kodepelunasan, tgltrans, total_amount, metodbayar, catatan, userentry) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [ctx.idtenant, idlokasi, newIdcustomer, kodepelunasan, tgltrans, grandTotal, metodbayar, `Pelunasan Langsung Edit Jual ${kodejual}`, ctx.iduser]
        );
        await conn.query('INSERT INTO pelunasanpiutangdtl (idpelunasan, kodetrans, amount) VALUES (?, ?, ?)', [pelResult.insertId, kodejual, grandTotal]);

        // Jurnal pelunasan piutang otomatis (akun pembayaran dari setting default)
        const idakunBayar = jurnalhelper.resolveAkunBayar(akun, metodbayar);
        await conn.query('INSERT INTO pelunasanpiutangbayar (idpelunasan, idtenant, idakun, amount) VALUES (?, ?, ?, ?)', [pelResult.insertId, ctx.idtenant, idakunBayar, grandTotal]);
        await jurnalhelper.postJurnalPelunasanPiutang(conn, {
          akun, idtenant: ctx.idtenant, idlokasi, idpelunasan: pelResult.insertId,
          kodepelunasan, tgltrans, payments: [{ idakun: idakunBayar, amount: grandTotal }],
        });
      }
    }

    if (newIdbpk) {
      await conn.query("UPDATE bpk SET status = 'CONFIRMED' WHERE idbpk = ? AND idtenant = ?", [newIdbpk, ctx.idtenant]);
    }
    await conn.commit();

    await logger.history('JUAL_UPDATE', { idtenant: ctx.idtenant, idlokasi, iduser: ctx.iduser, ref: kodejual, detail: { status: statusJual }, req });
    res.json({ message: 'Penjualan berhasil diupdate', grandtotal: grandTotal });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.checkEdit = async (req, res) => {
  try {
    const ctx  = getTenantContext();
    const { id } = req.params;

    const rows = await tenantQuery(
      `SELECT kp.status, j.jenistransaksi, j.is_lunaslangsung
       FROM jual j
       LEFT JOIN kartupiutang kp ON kp.kodetrans = j.kodejual AND kp.jenis = 'JUAL' AND kp.idtenant = j.idtenant
       WHERE j.idjual = ? AND j.idtenant = ?`,
      [id, ctx.idtenant]
    );

    if (rows && rows.length > 0 && rows[0].status === 'LUNAS' && !isAutoLunasJual(rows[0])) {
      return res.status(400).json({
        canEdit: false,
        reason: 'PIUTANG_LUNAS',
        message: 'Hapus pelunasan piutang terlebih dahulu sebelum melakukan edit/batal'
      });
    }

    res.json({ canEdit: true });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

exports.cancel = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const { id } = req.params;

    const [[jual]] = await conn.query('SELECT * FROM jual WHERE idjual = ? AND idtenant = ?', [id, ctx.idtenant]);
    if (!jual) {
      await conn.rollback();
      return res.status(404).json({ message: 'Penjualan tidak ditemukan' });
    }
    if (jual.status === 'CANCELLED') {
      await conn.rollback();
      return res.status(400).json({ message: 'Penjualan sudah dibatalkan' });
    }
    if (jual.status !== 'DRAFT') {
      await conn.rollback();
      return res.status(400).json({ message: 'Penjualan APPROVED harus batal approve dulu sebelum dihapus' });
    }

    await conn.query("UPDATE jual SET status = 'CANCELLED' WHERE idjual = ? AND idtenant = ?", [id, ctx.idtenant]);
    if (jual.idbpk) {
      await conn.query("UPDATE bpk SET status = 'APPROVED' WHERE idbpk = ? AND idtenant = ?", [jual.idbpk, ctx.idtenant]);
    }

    await conn.commit();
    await logger.history('JUAL_CANCEL', { idtenant: ctx.idtenant, idlokasi: jual.idlokasi, iduser: ctx.iduser, ref: jual.kodejual, req });
    res.json({ message: 'Penjualan berhasil dibatalkan' });
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
    await jurnalhelper.ensureJurnalSchema(conn);
    const akun = await jurnalhelper.getDefaultAkunJurnal(conn, ctx.idtenant);
    await conn.beginTransaction();
    const { id } = req.params;

    const [[jual]] = await conn.query('SELECT * FROM jual WHERE idjual = ? AND idtenant = ?', [id, ctx.idtenant]);
    if (!jual) {
      await conn.rollback();
      return res.status(404).json({ message: 'Penjualan tidak ditemukan' });
    }
    if (jual.status !== 'DRAFT') {
      await conn.rollback();
      return res.status(400).json({ message: 'Hanya Penjualan DRAFT yang bisa di-approve' });
    }

    await assertBpkCanBeUsed(conn, { idbpk: jual.idbpk, idtenant: ctx.idtenant, currentIdjual: id });
    const [items] = await conn.query('SELECT * FROM jualdtl WHERE idjual = ? AND idtenant = ?', [id, ctx.idtenant]);
    if (!items.length) {
      await conn.rollback();
      return res.status(400).json({ message: 'Detail penjualan kosong' });
    }

    await conn.query("DELETE FROM kartustok WHERE idtrans = ? AND jenistransaksi = 'JUAL' AND idtenant = ?", [id, ctx.idtenant]);

    for (const item of items) {
      const [[barangInfo]] = await conn.query('SELECT satuanbesar, satuansedang, satuankecil, konversi1, konversi2 FROM barang WHERE idbarang = ? AND idtenant = ?', [item.idbarang, ctx.idtenant]);
      const jmlStokKecil = barangInfo ? toKecilJml(parseFloat(item.jml), item.satuan, barangInfo) : parseFloat(item.jml);
      await conn.query(
        'INSERT INTO kartustok (idtenant, idlokasi, kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idtrans, jenistransaksi) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [ctx.idtenant, jual.idlokasi, jual.kodejual, item.idbarang, jmlStokKecil, 'K', jual.tgltrans, `Penjualan ${jual.kodejual}`, id, 'JUAL']
      );

      const harga = parseFloat(item.harga);
      const [[latestHarga]] = await conn.query("SELECT hargajual FROM hargajual WHERE idbarang = ? AND idtenant = ? AND status = 'AKTIF' ORDER BY tgltrans DESC, idhargajual DESC LIMIT 1", [item.idbarang, ctx.idtenant]);
      if (!latestHarga || parseFloat(latestHarga.hargajual) !== harga) {
        await conn.query('INSERT INTO hargajual (idtenant, idbarang, hargajual, tgltrans, idref, koderef, jenisref, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [ctx.idtenant, item.idbarang, harga, jual.tgltrans, id, jual.kodejual, 'JUAL', 'AKTIF']);
      }
    }

    const bayarFinal = isAutoLunasJual(jual) ? parseFloat(jual.grandtotal || 0) : 0;
    await conn.query("UPDATE jual SET status = 'APPROVED', bayar = ? WHERE idjual = ? AND idtenant = ?", [bayarFinal, id, ctx.idtenant]);

    await conn.query(
      'INSERT INTO kartupiutang (idtenant, idlokasi, idcustomer, kodetrans, jenis, amount, terbayar, sisa, tgltrans, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [ctx.idtenant, jual.idlokasi, jual.idcustomer, jual.kodejual, 'JUAL', jual.grandtotal, bayarFinal, Math.max(parseFloat(jual.grandtotal || 0) - bayarFinal, 0), jual.tgltrans, bayarFinal > 0 ? 'LUNAS' : 'OPEN']
    );

    // Jurnal penjualan: DEBET Piutang; KREDIT Penjualan + PPN Keluaran
    const totalPpnJual = items.reduce((s, it) => s + parseFloat(it.ppn || 0), 0);
    await jurnalhelper.postJurnalPenjualan(conn, {
      akun, idtenant: ctx.idtenant, idlokasi: jual.idlokasi, idjual: id, kodejual: jual.kodejual,
      jenis: 'jual', tgltrans: jual.tgltrans, grandtotal: parseFloat(jual.grandtotal || 0), totalppn: totalPpnJual,
    });

    if (isAutoLunasJual(jual) && parseFloat(jual.grandtotal || 0) > 0) {
      const kodepelunasan = await generateKodePelunasanPiutang(conn, ctx.idtenant, jual.idlokasi);
      const [pelResult] = await conn.query(
        'INSERT INTO pelunasanpiutang (idtenant, idlokasi, idcustomer, kodepelunasan, tgltrans, total_amount, metodbayar, catatan, userentry) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [ctx.idtenant, jual.idlokasi, jual.idcustomer, kodepelunasan, jual.tgltrans, jual.grandtotal, 'TUNAI', `Pelunasan Langsung Jual ${jual.kodejual}`, ctx.iduser]
      );
      await conn.query('INSERT INTO pelunasanpiutangdtl (idpelunasan, kodetrans, amount) VALUES (?, ?, ?)', [pelResult.insertId, jual.kodejual, jual.grandtotal]);

      // Jurnal pelunasan piutang otomatis (akun pembayaran dari setting default)
      const idakunBayar = jurnalhelper.resolveAkunBayar(akun, 'TUNAI');
      await conn.query('INSERT INTO pelunasanpiutangbayar (idpelunasan, idtenant, idakun, amount) VALUES (?, ?, ?, ?)', [pelResult.insertId, ctx.idtenant, idakunBayar, jual.grandtotal]);
      await jurnalhelper.postJurnalPelunasanPiutang(conn, {
        akun, idtenant: ctx.idtenant, idlokasi: jual.idlokasi, idpelunasan: pelResult.insertId,
        kodepelunasan, tgltrans: jual.tgltrans, payments: [{ idakun: idakunBayar, amount: parseFloat(jual.grandtotal || 0) }],
      });
    }

    if (jual.idbpk) {
      await conn.query("UPDATE bpk SET status = 'CONFIRMED' WHERE idbpk = ? AND idtenant = ?", [jual.idbpk, ctx.idtenant]);
    }

    await conn.commit();
    await logger.history('JUAL_APPROVE', { idtenant: ctx.idtenant, idlokasi: jual.idlokasi, iduser: ctx.iduser, ref: jual.kodejual, req });
    res.json({ message: 'Penjualan berhasil di-approve' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.unapprove = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const { id } = req.params;

    const [[jual]] = await conn.query('SELECT * FROM jual WHERE idjual = ? AND idtenant = ?', [id, ctx.idtenant]);
    if (!jual) {
      await conn.rollback();
      return res.status(404).json({ message: 'Penjualan tidak ditemukan' });
    }
    if (jual.status !== 'APPROVED') {
      await conn.rollback();
      return res.status(400).json({ message: 'Hanya Penjualan APPROVED yang bisa batal approve' });
    }

    const [[piutangLunas]] = await conn.query(
      "SELECT idkartupiutang FROM kartupiutang WHERE kodetrans = ? AND jenis = 'JUAL' AND status = 'LUNAS' AND idtenant = ?",
      [jual.kodejual, ctx.idtenant]
    );
    if (piutangLunas && !isAutoLunasJual(jual)) {
      await conn.rollback();
      return res.status(400).json({ message: 'Hapus pelunasan piutang terlebih dahulu sebelum batal approve' });
    }

    const [returs] = await conn.query(
      "SELECT kodereturjual FROM returjual WHERE idjual = ? AND idtenant = ? AND status != 'CANCELLED'",
      [jual.idjual, ctx.idtenant]
    );
    if (returs.length > 0) {
      await conn.rollback();
      return res.status(400).json({
        message: 'Penjualan sudah diretur, batalkan retur aktif terlebih dahulu',
        returs: returs.map(r => r.kodereturjual),
      });
    }

    await deletePostedJual(conn, { idtenant: ctx.idtenant, jual });
    await conn.query("UPDATE jual SET status = 'DRAFT', bayar = 0 WHERE idjual = ? AND idtenant = ?", [id, ctx.idtenant]);

    await conn.commit();
    await logger.history('JUAL_UNAPPROVE', { idtenant: ctx.idtenant, idlokasi: jual.idlokasi, iduser: ctx.iduser, ref: jual.kodejual, req });
    res.json({ message: 'Approve Penjualan dibatalkan' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message });
  } finally {
    conn.release();
  }
};
