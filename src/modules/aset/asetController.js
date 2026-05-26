const { tenantQuery, tenantExecute, getConnection, getTenantContext } = require('../../config/db');
const logger = require('../../lib/logger');

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function isValidPeriode(periode) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(periode);
}

exports.getKategori = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const rows = await tenantQuery(
      'SELECT DISTINCT kategori FROM aset WHERE idlokasi = ? AND kategori IS NOT NULL ORDER BY kategori',
      [ctx.idlokasi]
    );
    res.json(rows.map(r => r.kategori));
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

exports.getAll = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { kategori, status } = req.query;
    let sql = `SELECT a.*,
      aa.kodeakun AS kodeakun_aset, aa.namaakun AS namaakun_aset,
      ap.kodeakun AS kodeakun_penyusutan, ap.namaakun AS namaakun_penyusutan,
      ak.kodeakun AS kodeakun_akumulasi, ak.namaakun AS namaakun_akumulasi
      FROM aset a
      LEFT JOIN akun aa ON a.idakun_aset = aa.idakun AND aa.idtenant = a.idtenant
      LEFT JOIN akun ap ON a.idakun_penyusutan = ap.idakun AND ap.idtenant = a.idtenant
      LEFT JOIN akun ak ON a.idakun_akumulasi = ak.idakun AND ak.idtenant = a.idtenant
      WHERE a.idlokasi = ?`;
    const params = [ctx.idlokasi];
    if (kategori) { sql += ' AND a.kategori = ?'; params.push(kategori); }
    if (status) { sql += ' AND a.status = ?'; params.push(status); }
    sql += ' ORDER BY a.idaset DESC';
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
      `SELECT a.*,
        aa.kodeakun AS kodeakun_aset, aa.namaakun AS namaakun_aset,
        ap.kodeakun AS kodeakun_penyusutan, ap.namaakun AS namaakun_penyusutan,
        ak.kodeakun AS kodeakun_akumulasi, ak.namaakun AS namaakun_akumulasi
        FROM aset a
        LEFT JOIN akun aa ON a.idakun_aset = aa.idakun AND aa.idtenant = a.idtenant
        LEFT JOIN akun ap ON a.idakun_penyusutan = ap.idakun AND ap.idtenant = a.idtenant
        LEFT JOIN akun ak ON a.idakun_akumulasi = ak.idakun AND ak.idtenant = a.idtenant
        WHERE a.idaset = ? AND a.idlokasi = ?`,
      [req.params.id, ctx.idlokasi]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Aset tidak ditemukan' });

    const history = await tenantQuery(
      'SELECT * FROM penyusutan_aset WHERE idaset = ? ORDER BY periode ASC',
      [req.params.id]
    );
    res.json({ ...rows[0], history });
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
      namaaset, kategori, tglbeli, nilai_beli, umur_ekonomis,
      metode_penyusutan, nilai_sisa, idakun_aset, idakun_penyusutan, idakun_akumulasi,
      status,
    } = req.body;

    const nilBeli = parseFloat(nilai_beli) || 0;
    const umur = parseInt(umur_ekonomis, 10) || 0;
    const nilSisa = parseFloat(nilai_sisa) || 0;

    if (nilBeli <= 0) {
      await conn.rollback();
      return res.status(400).json({ message: 'nilai_beli harus lebih dari 0' });
    }
    if (umur <= 0) {
      await conn.rollback();
      return res.status(400).json({ message: 'umur_ekonomis harus lebih dari 0' });
    }

    const suffix = String(Math.floor(1000 + Math.random() * 9000));
    const kodeaset = `ASET-${suffix}`;
    const nilai_buku = round2(nilBeli - nilSisa);

    const [result] = await conn.query(
      `INSERT INTO aset
        (idtenant, idlokasi, kodeaset, namaaset, kategori, tglbeli, nilai_beli, umur_ekonomis,
         metode_penyusutan, nilai_sisa, akumulasi_penyusutan, nilai_buku,
         idakun_aset, idakun_penyusutan, idakun_akumulasi, status, userentry)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
      [
        ctx.idtenant, ctx.idlokasi, kodeaset, namaaset,
        kategori || 'PERALATAN', tglbeli, nilBeli, umur,
        metode_penyusutan || 'GARIS_LURUS', nilSisa, nilai_buku,
        idakun_aset || null, idakun_penyusutan || null, idakun_akumulasi || null,
        status || 'AKTIF', ctx.iduser,
      ]
    );

    await conn.commit();
    await logger.history('ASET_CREATE', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: kodeaset, req });
    res.status(201).json({ message: 'Aset berhasil ditambah', idaset: result.insertId, kodeaset });
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

    const [[aset]] = await conn.query(
      'SELECT * FROM aset WHERE idaset = ? AND idtenant = ? AND idlokasi = ?',
      [req.params.id, ctx.idtenant, ctx.idlokasi]
    );
    if (!aset) {
      await conn.rollback();
      return res.status(404).json({ message: 'Aset tidak ditemukan' });
    }

    const hasDepreciation = parseFloat(aset.akumulasi_penyusutan) > 0;
    if (hasDepreciation && (req.body.nilai_beli !== undefined || req.body.tglbeli !== undefined)) {
      await conn.rollback();
      return res.status(400).json({ message: 'nilai_beli dan tglbeli tidak dapat diubah setelah ada penyusutan' });
    }

    const {
      namaaset, kategori, idakun_aset, idakun_penyusutan, idakun_akumulasi, status,
      umur_ekonomis, metode_penyusutan, nilai_sisa,
    } = req.body;

    await conn.query(
      `UPDATE aset SET
        namaaset = COALESCE(?, namaaset),
        kategori = COALESCE(?, kategori),
        idakun_aset = COALESCE(?, idakun_aset),
        idakun_penyusutan = COALESCE(?, idakun_penyusutan),
        idakun_akumulasi = COALESCE(?, idakun_akumulasi),
        status = COALESCE(?, status),
        umur_ekonomis = COALESCE(?, umur_ekonomis),
        metode_penyusutan = COALESCE(?, metode_penyusutan),
        nilai_sisa = COALESCE(?, nilai_sisa)
       WHERE idaset = ? AND idtenant = ?`,
      [
        namaaset || null, kategori || null,
        idakun_aset || null, idakun_penyusutan || null, idakun_akumulasi || null,
        status || null, umur_ekonomis || null, metode_penyusutan || null,
        nilai_sisa != null ? parseFloat(nilai_sisa) : null,
        req.params.id, ctx.idtenant,
      ]
    );

    await conn.commit();
    await logger.history('ASET_UPDATE', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: aset.kodeaset, req });
    res.json({ message: 'Aset berhasil diupdate' });
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
    const [[aset]] = await conn.query(
      'SELECT kodeaset, akumulasi_penyusutan FROM aset WHERE idaset = ? AND idtenant = ? AND idlokasi = ?',
      [req.params.id, ctx.idtenant, ctx.idlokasi]
    );
    if (!aset) return res.status(404).json({ message: 'Aset tidak ditemukan' });
    if (parseFloat(aset.akumulasi_penyusutan) > 0) {
      return res.status(400).json({ message: 'Aset tidak dapat dihapus karena sudah ada penyusutan' });
    }
    await conn.query('DELETE FROM aset WHERE idaset = ? AND idtenant = ? AND idlokasi = ?', [req.params.id, ctx.idtenant, ctx.idlokasi]);
    await logger.history('ASET_DELETE', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: aset.kodeaset, req });
    res.json({ message: 'Aset berhasil dihapus' });
  } catch (err) {
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

async function prosesHitungPenyusutan(conn, ctx, aset, periode) {
  const nilBeli = parseFloat(aset.nilai_beli);
  const nilSisa = parseFloat(aset.nilai_sisa);
  const nilBuku = parseFloat(aset.nilai_buku);
  const umur = parseInt(aset.umur_ekonomis, 10);

  if (nilBuku <= nilSisa) {
    return { skipped: true, reason: 'Aset sudah habis disusutkan' };
  }

  const [[existing]] = await conn.query(
    'SELECT idpenyusutan FROM penyusutan_aset WHERE idaset = ? AND idtenant = ? AND periode = ?',
    [aset.idaset, ctx.idtenant, periode]
  );
  if (existing) {
    return { skipped: true, reason: `Periode ${periode} sudah diproses` };
  }

  let nilPenyusutan;
  if (aset.metode_penyusutan === 'SALDO_MENURUN') {
    nilPenyusutan = round2(nilBuku * (1 / umur) * 2);
  } else {
    nilPenyusutan = round2((nilBeli - nilSisa) / umur);
  }

  const nilBukuBaru = round2(nilBuku - nilPenyusutan);
  if (nilBukuBaru < nilSisa) {
    nilPenyusutan = round2(nilBuku - nilSisa);
  }

  const akumulasiBaru = round2(parseFloat(aset.akumulasi_penyusutan) + nilPenyusutan);
  const nilBukuFinal = round2(nilBeli - akumulasiBaru);

  const periodeDate = `${periode}-01`;

  await conn.query(
    `INSERT INTO penyusutan_aset (idaset, idtenant, idlokasi, periode, nilai_penyusutan, akumulasi, nilai_buku)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [aset.idaset, ctx.idtenant, ctx.idlokasi, periode, nilPenyusutan, akumulasiBaru, nilBukuFinal]
  );

  await conn.query(
    'UPDATE aset SET akumulasi_penyusutan = ?, nilai_buku = ? WHERE idaset = ? AND idtenant = ?',
    [akumulasiBaru, nilBukuFinal, aset.idaset, ctx.idtenant]
  );

  if (aset.idakun_penyusutan && aset.idakun_akumulasi) {
    await conn.query(
      `INSERT INTO jurnal (idtenant, idlokasi, idtrans, kodetrans, jenis, tgltrans, idakun, posisi, amount, status)
       VALUES (?, ?, ?, ?, 'PENYUSUTAN', ?, ?, 'DEBET', ?, 'AKTIF')`,
      [ctx.idtenant, ctx.idlokasi, aset.idaset, aset.kodeaset, periodeDate, aset.idakun_penyusutan, nilPenyusutan]
    );
    await conn.query(
      `INSERT INTO jurnal (idtenant, idlokasi, idtrans, kodetrans, jenis, tgltrans, idakun, posisi, amount, status)
       VALUES (?, ?, ?, ?, 'PENYUSUTAN', ?, ?, 'KREDIT', ?, 'AKTIF')`,
      [ctx.idtenant, ctx.idlokasi, aset.idaset, aset.kodeaset, periodeDate, aset.idakun_akumulasi, nilPenyusutan]
    );
  }

  return { skipped: false, nilPenyusutan, akumulasiBaru, nilBukuFinal };
}

exports.hitungPenyusutan = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    const { id } = req.params;
    const { periode } = req.body;

    if (!periode || !isValidPeriode(periode)) {
      return res.status(400).json({ message: 'Format periode tidak valid (YYYY-MM)' });
    }

    await conn.beginTransaction();

    const [[aset]] = await conn.query(
      'SELECT * FROM aset WHERE idaset = ? AND idtenant = ? AND idlokasi = ?',
      [id, ctx.idtenant, ctx.idlokasi]
    );
    if (!aset) {
      await conn.rollback();
      return res.status(404).json({ message: 'Aset tidak ditemukan' });
    }
    if (aset.status !== 'AKTIF') {
      await conn.rollback();
      return res.status(400).json({ message: 'Hanya aset AKTIF yang dapat disusutkan' });
    }

    const result = await prosesHitungPenyusutan(conn, ctx, aset, periode);

    if (result.skipped) {
      await conn.rollback();
      return res.status(400).json({ message: result.reason });
    }

    await conn.commit();
    await logger.history('ASET_PENYUSUTAN', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: aset.kodeaset, detail: { periode }, req });
    res.json({
      message: 'Penyusutan berhasil diproses',
      idaset: aset.idaset,
      periode,
      nilai_penyusutan: result.nilPenyusutan,
      akumulasi_penyusutan: result.akumulasiBaru,
      nilai_buku: result.nilBukuFinal,
    });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.bulkHitungPenyusutan = async (req, res) => {
  const { periode } = req.body;

  if (!periode || !isValidPeriode(periode)) {
    return res.status(400).json({ message: 'Format periode tidak valid (YYYY-MM)' });
  }

  const ctx = getTenantContext();
  let processed = 0;
  let skipped = 0;
  const errors = [];

  let asetList;
  try {
    asetList = await tenantQuery(
      "SELECT * FROM aset WHERE idlokasi = ? AND status = 'AKTIF'",
      [ctx.idlokasi]
    );
  } catch (err) {
    logger.error(err, { req });
    return res.status(500).json({ message: err.message });
  }

  for (const aset of asetList) {
    const conn = await getConnection();
    try {
      await conn.beginTransaction();
      const result = await prosesHitungPenyusutan(conn, ctx, aset, periode);
      if (result.skipped) {
        skipped++;
      } else {
        processed++;
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      errors.push({ idaset: aset.idaset, kodeaset: aset.kodeaset, error: err.message });
    } finally {
      conn.release();
    }
  }

  await logger.history('ASET_PENYUSUTAN_BULK', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, detail: { periode, processed, skipped, errors: errors.length }, req });
  res.json({ message: 'Bulk penyusutan selesai', periode, processed, skipped, errors });
};
