// Controller untuk manajemen data akun (Chart of Accounts).
// Menangani CRUD akun dengan pengecekan referensi jurnal sebelum penghapusan.

const { tenantQuery, tenantExecute, getConnection, getTenantContext } = require('../../config/db');
const { generateKodeMaster } = require('../../lib/kodetrans');
const { setConfigValue } = require('../../lib/confighelper');
const logger = require('../../lib/logger');
const { seedDefaultCOA, seedDefaultJurnalSettings } = require('../../migrate');

// Pemetaan field request (snake_case) -> nama config jurnal pada tabel `config`
const JURNAL_SETTING_FIELDS = {
  akun_piutang     : 'AKUN_PIUTANG',
  akun_penjualan   : 'AKUN_PENJUALAN',
  akun_ppn_keluaran: 'AKUN_PPN_KELUARAN',
  akun_hutang      : 'AKUN_HUTANG',
  akun_pembelian   : 'AKUN_PEMBELIAN',
  akun_ppn_masukan : 'AKUN_PPN_MASUKAN',
  akun_kas         : 'AKUN_KAS',
  akun_bank        : 'AKUN_BANK',
};

// GET /akun — Menampilkan semua akun dengan filter pencarian opsional
exports.getAll = async (req, res) => {
  try {
    const { search } = req.query;
    let sql = 'SELECT * FROM akun WHERE 1=1';
    const params = [];
    // Filter opsional: pencarian berdasarkan nama/kode akun
    if (search) { sql += ' AND (namaakun LIKE ? OR kodeakun LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    sql += ' ORDER BY idakun DESC';
    const rows = await tenantQuery(sql, params);
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /akun/:id — Menampilkan detail satu akun berdasarkan ID
exports.getOne = async (req, res) => {
  try {
    let sql = 'SELECT * FROM akun WHERE idakun = ?';
    const rows = await tenantQuery(sql, [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Akun tidak ditemukan' });
    res.json(rows[0]);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// POST /akun — Membuat akun baru; kode akun selalu auto-generate
exports.create = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const { namaakun, saldo } = req.body;

    // Kode akun selalu auto-generate (tidak bisa kustom)
    const kodeakun = await generateKodeMaster(conn, 'AKN', ctx.idtenant, 'akun', 'kodeakun', 4);

    // saldo default 'DEBET' jika tidak diisi (posisi normal akun)
    let sql = 'INSERT INTO akun (idtenant, kodeakun, namaakun, saldo, status, userentry) VALUES (?, ?, ?, ?, ?, ?)';
    await conn.query(sql,
      [ctx.idtenant, kodeakun, namaakun, saldo || 'DEBET', 'AKTIF', ctx.iduser]
    );

    await conn.commit();
    res.status(201).json({ message: 'Akun berhasil ditambah', kodeakun });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// PUT /akun/:id — Memperbarui data akun (nama, saldo, status)
exports.update = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const { namaakun, saldo, status } = req.body;
    const { id } = req.params;

    // Validasi: cek akun ada
    let sql = 'SELECT * FROM akun WHERE idakun = ? AND idtenant = ?';
    const [rows] = await conn.query(sql, [id, ctx.idtenant]);
    if (rows.length === 0) return res.status(404).json({ message: 'Akun tidak ditemukan' });

    // Update akun — gunakan nilai lama jika field tidak dikirim
    let sql2 = 'UPDATE akun SET namaakun = ?, saldo = ?, status = ? WHERE idakun = ? AND idtenant = ?';
    await conn.query(sql2,
      [namaakun || rows[0].namaakun, saldo ?? rows[0].saldo, status ?? rows[0].status, id, ctx.idtenant]
    );

    await conn.commit();
    res.json({ message: 'Akun berhasil diupdate' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// DELETE /akun/:id — Menghapus akun; dicegah jika sudah dipakai di jurnal
exports.remove = async (req, res) => {
  try {
    const ctx         = getTenantContext();
    const conn        = await getConnection();
    // Validasi: cek apakah akun sudah digunakan di tabel jurnal
    let sql = 'SELECT COUNT(*) as cnt FROM jurnal WHERE idakun = ? AND idtenant = ?';
    const [[{ cnt }]] = await conn.query(sql, [req.params.id, ctx.idtenant]);
    conn.release();
    if (cnt > 0) {
      return res.status(400).json({ message: 'Akun sudah digunakan di jurnal. Nonaktifkan saja.' });
    }
    let sql2 = 'DELETE FROM akun WHERE idakun = ? AND idtenant = ?';
    await tenantExecute(sql2, [req.params.id, ctx.idtenant]);
    res.json({ message: 'Akun berhasil dihapus' });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /akun/setting-jurnal — Menampilkan setting akun default jurnal (pop-up di Master Akun)
exports.getSettingJurnal = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const conn = await getConnection();
    try {
      await seedDefaultCOA(conn, ctx.idtenant, ctx.iduser);
      await seedDefaultJurnalSettings(conn, ctx.idtenant);
    } finally {
      conn.release();
    }
    const rows = await tenantQuery(
      `SELECT c.config, c.value AS idakun, a.kodeakun, a.namaakun, a.status AS akunstatus
       FROM config c
       LEFT JOIN akun a ON a.idakun = c.value AND a.idtenant = c.idtenant
       WHERE c.idtenant = ? AND c.modul = 'JURNAL'`,
      [ctx.idtenant]
    );
    const byConfig = {};
    for (const r of rows) byConfig[r.config] = r;

    const result = {};
    for (const [field, configName] of Object.entries(JURNAL_SETTING_FIELDS)) {
      const r = byConfig[configName];
      result[field] = r && r.idakun
        ? { idakun: Number(r.idakun), kodeakun: r.kodeakun, namaakun: r.namaakun, status: r.akunstatus }
        : null;
    }
    res.json(result);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// PUT /akun/setting-jurnal — Menyimpan setting akun default jurnal
exports.saveSettingJurnal = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const fields = Object.keys(JURNAL_SETTING_FIELDS);

    // Validasi: semua field wajib diisi dengan idakun yang valid
    const ids = {};
    for (const field of fields) {
      const id = parseInt(req.body[field], 10);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ message: `Akun untuk "${field}" wajib dipilih` });
      }
      ids[field] = id;
    }

    // Validasi: semua akun ada, milik tenant ini, dan berstatus AKTIF
    const uniqueIds = [...new Set(Object.values(ids))];
    const akunRows = await tenantQuery(
      'SELECT idakun, status FROM akun WHERE idtenant = ? AND idakun IN (?)',
      [ctx.idtenant, uniqueIds]
    );
    const akunStatus = new Map(akunRows.map(a => [a.idakun, a.status]));
    for (const field of fields) {
      const status = akunStatus.get(ids[field]);
      if (!status) return res.status(400).json({ message: `Akun untuk "${field}" tidak ditemukan` });
      if (status !== 'AKTIF') return res.status(400).json({ message: `Akun untuk "${field}" tidak aktif` });
    }

    const conn = await getConnection();
    try {
      await conn.beginTransaction();
      for (const field of fields) {
        await setConfigValue(conn, ctx.idtenant, 'JURNAL', JURNAL_SETTING_FIELDS[field], String(ids[field]), 1);
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    res.json({ message: 'Setting akun default jurnal berhasil disimpan' });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};
