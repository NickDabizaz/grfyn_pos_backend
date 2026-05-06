const { tenantQuery, tenantExecute, getConnection, getTenantContext } = require('../config/db');
const { generateKodePenyesuaian, generateKodeSaldoStok } = require('../lib/kodetrans');

exports.getKartuStok = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { idbarang, tglwal, tglakhir, jenis, search } = req.query;
    let sql = `SELECT ks.*, b.namabarang, b.satuankecil FROM kartustok ks LEFT JOIN barang b ON ks.idbarang = b.idbarang AND b.idtenant = ks.idtenant WHERE 1=1`;
    const params = [];
    sql += ' AND ks.idlokasi = ?'; params.push(ctx.idlokasi);
    if (idbarang) { sql += ' AND ks.idbarang = ?'; params.push(idbarang); }
    if (tglwal) { sql += ' AND ks.tgltrans >= ?'; params.push(tglwal); }
    if (tglakhir) { sql += ' AND ks.tgltrans <= ?'; params.push(tglakhir); }
    if (jenis) { sql += ' AND ks.jenis = ?'; params.push(jenis); }
    if (search) { sql += ' AND ks.kodetrans LIKE ?'; params.push(`%${search}%`); }
    sql += ' ORDER BY ks.tgltrans DESC, ks.idkartustok DESC LIMIT 500';
    const rows = await tenantQuery(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getPenyesuaian = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { search } = req.query;
    let sql = 'SELECT ps.* FROM penyesuaianstok ps WHERE 1=1';
    const params = [];
    sql += ' AND ps.idlokasi = ?'; params.push(ctx.idlokasi);
    if (search) { sql += ' AND ps.kodepenyesuaianstok LIKE ?'; params.push(`%${search}%`); }
    sql += ' ORDER BY ps.tgltrans DESC, ps.idpenyesuaianstok DESC';
    const rows = await tenantQuery(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getPenyesuaianDetail = async (req, res) => {
  try {
    const rows = await tenantQuery(`SELECT psd.*, b.namabarang, b.satuankecil
      FROM penyesuaianstokdtl psd LEFT JOIN barang b ON psd.idbarang = b.idbarang AND b.idtenant = psd.idtenant
      WHERE psd.idpenyesuaianstok = ?`, [req.params.id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.createPenyesuaian = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const { keterangan, items, tgltrans: tglInput } = req.body;

    if (!items || !items.length) return res.status(400).json({ message: 'Items tidak boleh kosong' });

    const tgltrans = tglInput || new Date().toISOString().slice(0, 10);
    const kode = await generateKodePenyesuaian(conn, ctx.idtenant, ctx.idlokasi);

    await conn.query(
      'INSERT INTO penyesuaianstok (idtenant, idlokasi, kodepenyesuaianstok, tgltrans, iduser, keterangan, status, userentry) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [ctx.idtenant, ctx.idlokasi, kode, tgltrans, ctx.iduser, keterangan || '', 'AKTIF', ctx.iduser]
    );
    const [[header]] = await conn.query(
      'SELECT idpenyesuaianstok FROM penyesuaianstok WHERE kodepenyesuaianstok = ? AND idtenant = ? AND idlokasi = ?',
      [kode, ctx.idtenant, ctx.idlokasi]
    );

    for (const item of items) {
      const [[masuk]] = await conn.query('SELECT COALESCE(SUM(jml), 0) as total FROM kartustok WHERE idbarang = ? AND jenis = ? AND idtenant = ? AND idlokasi = ?', [item.idbarang, 'M', ctx.idtenant, ctx.idlokasi]);
      const [[keluar]] = await conn.query('SELECT COALESCE(SUM(jml), 0) as total FROM kartustok WHERE idbarang = ? AND jenis = ? AND idtenant = ? AND idlokasi = ?', [item.idbarang, 'K', ctx.idtenant, ctx.idlokasi]);
      const stokProgram = masuk.total - keluar.total;
      const selisih = stokProgram - item.jml;

      await conn.query(
        'INSERT INTO penyesuaianstokdtl (idpenyesuaianstok, idtenant, idbarang, jml, selisih, keterangan) VALUES (?, ?, ?, ?, ?, ?)',
        [header.idpenyesuaianstok, ctx.idtenant, item.idbarang, item.jml, selisih, item.keterangan || '']
      );

      if (selisih !== 0) {
        const jenis = selisih > 0 ? 'K' : 'M';
        const jmlAbs = Math.abs(selisih);
        await conn.query(
          'INSERT INTO kartustok (idtenant, idlokasi, kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idref, jenisref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [ctx.idtenant, ctx.idlokasi, kode, item.idbarang, jmlAbs, jenis, tgltrans, `Penyesuaian ${kode}`, header.idpenyesuaianstok, 'penyesuaianstok']
        );
      }
    }

    await conn.commit();
    res.status(201).json({ message: 'Penyesuaian stok berhasil', kode });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.getSaldoStok = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tgl } = req.query;
    const targetDate = tgl || new Date().toISOString().slice(0, 10);

    const [[saldoExists]] = await require('../config/db').pool.query(
      'SELECT COUNT(*) as cnt FROM saldostok WHERE idtenant = ? AND idlokasi = ?',
      [ctx.idtenant, ctx.idlokasi]
    );

    if (saldoExists.cnt === 0) {
      const rows = await tenantQuery(
        `SELECT b.idbarang, b.kodebarang, b.namabarang, b.satuankecil, b.stokmin,
          COALESCE(m.total, 0) - COALESCE(k.total, 0) as stok
        FROM barang b
        LEFT JOIN (SELECT idbarang, SUM(jml) as total FROM kartustok WHERE jenis='M' AND idtenant = ? AND idlokasi = ? GROUP BY idbarang) m ON b.idbarang = m.idbarang
        LEFT JOIN (SELECT idbarang, SUM(jml) as total FROM kartustok WHERE jenis='K' AND idtenant = ? AND idlokasi = ? GROUP BY idbarang) k ON b.idbarang = k.idbarang
        WHERE b.status = 'AKTIF' ORDER BY b.namabarang`,
        [ctx.idtenant, ctx.idlokasi, ctx.idtenant, ctx.idlokasi]
      );
      return res.json(rows);
    }

    const rows = await tenantQuery(
      `SELECT b.idbarang, b.kodebarang, b.namabarang, b.satuankecil, b.stokmin,
        COALESCE(sd.jml, 0) + COALESCE(km.masuk, 0) - COALESCE(km.keluar, 0) as stok
      FROM barang b
      LEFT JOIN (
        SELECT ssd.idbarang, ssd.jml FROM saldostokdtl ssd
        JOIN saldostok ss ON ss.idsaldostok = ssd.idsaldostok
        WHERE ss.idtenant = ? AND ss.idlokasi = ? AND ss.tgltrans = (SELECT MAX(tgltrans) FROM saldostok WHERE idtenant = ? AND idlokasi = ? AND tgltrans <= ?)
      ) sd ON sd.idbarang = b.idbarang
      LEFT JOIN (
        SELECT idbarang,
          COALESCE(SUM(CASE WHEN jenis='M' THEN jml ELSE 0 END), 0) as masuk,
          COALESCE(SUM(CASE WHEN jenis='K' THEN jml ELSE 0 END), 0) as keluar
        FROM kartustok WHERE idtenant = ? AND idlokasi = ? AND tgltrans > (SELECT COALESCE(MAX(tgltrans), '1970-01-01') FROM saldostok WHERE idtenant = ? AND idlokasi = ? AND tgltrans <= ?)
        GROUP BY idbarang
      ) km ON km.idbarang = b.idbarang
      WHERE b.status = 'AKTIF' ORDER BY b.namabarang`,
      [ctx.idtenant, ctx.idlokasi, ctx.idtenant, ctx.idlokasi, targetDate,
       ctx.idtenant, ctx.idlokasi, ctx.idtenant, ctx.idlokasi, targetDate]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getSaldoStokList = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const rows = await tenantQuery('SELECT * FROM saldostok WHERE idlokasi = ? ORDER BY tgltrans DESC, idsaldostok DESC LIMIT 50', [ctx.idlokasi]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getSaldoStokDetail = async (req, res) => {
  try {
    const rows = await tenantQuery(
      `SELECT ssd.*, b.namabarang, b.satuankecil, b.kodebarang
       FROM saldostokdtl ssd
       LEFT JOIN barang b ON ssd.idbarang = b.idbarang AND b.idtenant = ssd.idtenant
       WHERE ssd.idsaldostok = ?`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.createClosing = async (req, res) => {
  res.status(501).json({ message: 'Closing akan diimplementasikan di fase berikutnya' });
};

exports.cancelClosing = async (req, res) => {
  res.status(501).json({ message: 'Closing akan diimplementasikan di fase berikutnya' });
};

exports.getClosingDetail = async (req, res) => {
  res.status(501).json({ message: 'Closing akan diimplementasikan di fase berikutnya' });
};

exports.getClosing = async (req, res) => {
  res.status(501).json({ message: 'Closing akan diimplementasikan di fase berikutnya' });
};

exports.createSaldoAwal = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const { keterangan, items, tgltrans: tglInput } = req.body;

    if (!items || !items.length) return res.status(400).json({ message: 'Items tidak boleh kosong' });

    const tgltrans = tglInput || new Date().toISOString().slice(0, 10);
    const kodeSaldo = await generateKodeSaldoStok(conn, ctx.idtenant, ctx.idlokasi);

    await conn.query(
      'INSERT INTO saldostok (idtenant, idlokasi, kodesaldostok, tgltrans, iduser, catatan, status, userentry) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [ctx.idtenant, ctx.idlokasi, kodeSaldo, tgltrans, ctx.iduser, keterangan || '', 'AKTIF', ctx.iduser]
    );
    const [[header]] = await conn.query(
      'SELECT idsaldostok FROM saldostok WHERE kodesaldostok = ? AND idtenant = ? AND idlokasi = ?',
      [kodeSaldo, ctx.idtenant, ctx.idlokasi]
    );

    for (const item of items) {
      await conn.query(
        'INSERT INTO saldostokdtl (idsaldostok, idtenant, idbarang, qty) VALUES (?, ?, ?, ?)',
        [header.idsaldostok, ctx.idtenant, item.idbarang, item.jml]
      );

      if (item.jml > 0) {
        await conn.query(
          'INSERT INTO kartustok (idtenant, idlokasi, kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idref, jenisref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [ctx.idtenant, ctx.idlokasi, kodeSaldo, item.idbarang, item.jml, 'M', tgltrans, `Saldo Awal ${kodeSaldo}`, header.idsaldostok, 'saldostok']
        );
      }
    }

    await conn.commit();
    res.status(201).json({ message: 'Saldo awal stok berhasil', kode: kodeSaldo });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.getStok = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { idbarang } = req.params;
    const targetDate = req.query.tgl || new Date().toISOString().slice(0, 10);

    const [[latestSaldo]] = await require('../config/db').pool.query(
      `SELECT ss.idsaldostok, ss.tgltrans FROM saldostok ss
       WHERE ss.idtenant = ? AND ss.idlokasi = ? AND ss.tgltrans <= ? ORDER BY ss.tgltrans DESC LIMIT 1`,
      [ctx.idtenant, ctx.idlokasi, targetDate]
    );

    let stok = 0;
    let fromDate = null;

    if (latestSaldo) {
      const [[snap]] = await require('../config/db').pool.query(
        `SELECT COALESCE(qty, 0) as qty FROM saldostokdtl
         WHERE idsaldostok = ? AND idtenant = ? AND idbarang = ?`,
        [latestSaldo.idsaldostok, ctx.idtenant, idbarang]
      );
      stok = snap ? snap.qty : 0;
      fromDate = latestSaldo.tgltrans;
    }

    const params = [ctx.idtenant, ctx.idlokasi, idbarang];
    let dateCond = 'AND tgltrans <= ?';
    params.push(targetDate);
    if (fromDate) {
      dateCond += ' AND tgltrans > ?';
      params.push(fromDate);
    }

    const [[masuk]] = await require('../config/db').pool.query(
      `SELECT COALESCE(SUM(jml), 0) as total FROM kartustok
       WHERE idtenant = ? AND idlokasi = ? AND idbarang = ? AND jenis = 'M' ${dateCond}`,
      params
    );
    const [[keluar]] = await require('../config/db').pool.query(
      `SELECT COALESCE(SUM(jml), 0) as total FROM kartustok
       WHERE idtenant = ? AND idlokasi = ? AND idbarang = ? AND jenis = 'K' ${dateCond}`,
      params
    );

    stok += masuk.total - keluar.total;

    res.json({ idbarang: parseInt(idbarang), stok, tgl: targetDate });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
