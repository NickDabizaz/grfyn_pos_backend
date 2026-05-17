// Controller untuk manajemen data user dan template menu.
// Menangani CRUD user, reset password, manajemen menu/lokasi user, dan template menu.

const bcrypt = require('bcryptjs');
const { pool, tenantQuery, tenantExecute, getConnection, getTenantContext } = require('../../config/db');
const logger = require('../../lib/logger');
const { ACCESS_FIELDS, fullAccess, normalizeAccess, hasAnyAccess } = require('../../lib/access');

function normalizeMenuPayload(menu) {
  if (typeof menu === 'number' || typeof menu === 'string') {
    return { idmenu: Number(menu), ...fullAccess() };
  }
  const access = normalizeAccess(menu);
  if (Number(menu?.hakakses || 0) === 1) return { idmenu: Number(menu.idmenu), ...fullAccess() };
  return { idmenu: Number(menu?.idmenu), ...access, hakakses: hasAnyAccess(access) ? 1 : 0 };
}

async function insertUserMenu(conn, iduser, menu, userentry) {
  const normalized = normalizeMenuPayload(menu);
  if (!normalized.idmenu || !hasAnyAccess(normalized)) return;
  await conn.query(
    `INSERT INTO usermenu (iduser, idmenu, hakakses, tambah, ubah, approve, batalapprove, bataltransaksi, cetak, status, userentry)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'AKTIF', ?)`,
    [iduser, normalized.idmenu, ...ACCESS_FIELDS.map((key) => normalized[key] || 0), userentry]
  );
}

// GET /user — Menampilkan semua user dalam tenant beserta jumlah lokasi dan menu yang di-assign
exports.getAll = async (req, res) => {
  try {
    const ctx = getTenantContext();
    let sql = `SELECT u.iduser, u.username, u.namauser, u.email, u.hp, u.isowner, u.status,
        u.tglentry,
        (SELECT COUNT(*) FROM userlokasi ul WHERE ul.iduser = u.iduser AND ul.status = 'AKTIF') as jml_lokasi,
        (SELECT COUNT(*) FROM usermenu um WHERE um.iduser = u.iduser AND um.status = 'AKTIF') as jml_menu
       FROM user u WHERE u.idtenant = ? ORDER BY u.iduser ASC`;
    const rows = await tenantQuery(
      sql,
      [ctx.idtenant]
    );
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /user/:id — Menampilkan detail satu user
exports.getOne = async (req, res) => {
  try {
    const ctx = getTenantContext();
    let sql = 'SELECT u.iduser, u.username, u.namauser, u.email, u.hp, u.isowner, u.status FROM user u WHERE u.iduser = ?';
    const rows = await tenantQuery(
      sql,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'User tidak ditemukan' });
    res.json(rows[0]);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// POST /user — Membuat user baru; dapat mengassign menu (via template atau manual) dan lokasi
exports.create = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    const { username, pass, namauser, email, hp, menus, lokasis, idtemplate } = req.body;

    // Validasi: field wajib
    if (!username || !pass || !namauser) {
      return res.status(400).json({ message: 'Username, password, dan nama wajib diisi' });
    }

    // Validasi: cek username unik dalam tenant ini
    let sqlCheckUser = 'SELECT COUNT(*) as cnt FROM user WHERE username = ? AND idtenant = ?';
    const [[existing]] = await conn.query(
      sqlCheckUser,
      [username.toUpperCase(), ctx.idtenant]
    );
    if (existing.cnt > 0) {
      return res.status(400).json({ message: 'Username sudah digunakan' });
    }

    await conn.beginTransaction();

    // Password di-hash dengan bcrypt 10 salt rounds
    const hash = await bcrypt.hash(pass, 10);
    let sqlInsertUser = 'INSERT INTO user (idtenant, username, pass, namauser, email, hp, isowner, tokenversion, status, userentry) VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?)';
    const [result] = await conn.query(
      sqlInsertUser,
      [ctx.idtenant, username.toUpperCase(), hash, namauser, email || null, hp || null, 'AKTIF', ctx.iduser]
    );
    const iduser = result.insertId;

    // Update userentry ke self
    let sqlUpdateEntry = 'UPDATE user SET userentry = ? WHERE iduser = ?';
    await conn.query(sqlUpdateEntry, [iduser, iduser]);

    // Assign menu dari template jika dipilih
    if (idtemplate) {
      let sqlTemplateDtl = 'SELECT idmenu FROM menutemplatedtl WHERE idmenutemplate = ? AND status = ?';
      const [templateDtl] = await conn.query(
        sqlTemplateDtl,
        [idtemplate, 'AKTIF']
      );
      for (const d of templateDtl) {
        await insertUserMenu(conn, iduser, d.idmenu, ctx.iduser);
      }
    }

    // Assign menu kustom (jika tidak pakai template atau tambahan)
    if (menus && menus.length > 0) {
      for (const idmenu of menus) {
        try {
          await insertUserMenu(conn, iduser, idmenu, ctx.iduser);
        } catch (e) {
          // Abaikan error duplicate entry (menu sudah ada dari template)
          if (e.code !== 'ER_DUP_ENTRY') throw e;
        }
      }
    }

    // Assign lokasi ke user
    if (lokasis && lokasis.length > 0) {
      for (const idlokasi of lokasis) {
        try {
          let sqlInsLokasi = "INSERT INTO userlokasi (iduser, idlokasi, status, userentry) VALUES (?, ?, 'AKTIF', ?)";
          await conn.query(
            sqlInsLokasi,
            [iduser, idlokasi, ctx.iduser]
          );
        } catch (e) {
          // Abaikan error duplicate entry
          if (e.code !== 'ER_DUP_ENTRY') throw e;
        }
      }
    }

    await conn.commit();
    await logger.history('USER_CREATE', { idtenant: ctx.idtenant, iduser: ctx.iduser, ref: username, req });
    res.status(201).json({ message: 'User berhasil ditambah', iduser });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Username sudah digunakan' });
    }
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// PUT /user/:id — Memperbarui data user, menu akses, dan lokasi; owner tidak bisa dinonaktifkan
exports.update = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    const { id } = req.params;
    const { namauser, email, hp, status, menus, lokasis } = req.body;

    // Validasi: cek user ada
    let sqlSelectUser = 'SELECT * FROM user WHERE iduser = ? AND idtenant = ?';
    const [users] = await conn.query(sqlSelectUser, [id, ctx.idtenant]);
    if (users.length === 0) return res.status(404).json({ message: 'User tidak ditemukan' });

    const target = users[0];

    // Validasi: owner tidak bisa dinonaktifkan
    if (target.isowner && status === 'NONAKTIF') {
      return res.status(400).json({ message: 'Owner tidak dapat dinonaktifkan' });
    }

    await conn.beginTransaction();

    // Update data user — tokenversion di-increment agar token lama tidak valid
    const newStatus = status || target.status;
    let sqlUpdateUser = 'UPDATE user SET namauser = ?, email = ?, hp = ?, status = ?, tokenversion = tokenversion + 1 WHERE iduser = ? AND idtenant = ?';
    await conn.query(
      sqlUpdateUser,
      [namauser || target.namauser, email ?? target.email, hp ?? target.hp, newStatus, id, ctx.idtenant]
    );

    // Update daftar menu akses: hapus semua lalu insert ulang
    if (menus !== undefined) {
      let sqlDelMenu = 'DELETE FROM usermenu WHERE iduser = ?';
      await conn.query(sqlDelMenu, [id]);
      for (const menu of (menus || [])) {
        await insertUserMenu(conn, id, menu, ctx.iduser);
      }
    }

    // Update daftar lokasi akses: hapus semua lalu insert ulang
    if (lokasis !== undefined) {
      let sqlDelLokasi = 'DELETE FROM userlokasi WHERE iduser = ?';
      await conn.query(sqlDelLokasi, [id]);
      for (const idlokasi of (lokasis || [])) {
        let sqlInsLokasiUpd = "INSERT INTO userlokasi (iduser, idlokasi, status, userentry) VALUES (?, ?, 'AKTIF', ?)";
        await conn.query(
          sqlInsLokasiUpd,
          [id, idlokasi, ctx.iduser]
        );
      }
    }

    await conn.commit();
    await logger.history('USER_UPDATE', { idtenant: ctx.idtenant, iduser: ctx.iduser, ref: String(id), req });
    res.json({ message: 'User berhasil diupdate' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// PUT /user/:id/reset-password — Mereset password user oleh admin; tokenversion di-increment
exports.resetPassword = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { id } = req.params;
    const { newPass } = req.body;

    // Validasi: panjang password minimal 6 karakter
    if (!newPass || newPass.length < 6) {
      return res.status(400).json({ message: 'Password minimal 6 karakter' });
    }

    // Validasi: cek user target ada
    let sqlSelectReset = 'SELECT * FROM user WHERE iduser = ? AND idtenant = ?';
    const [users] = await require('../../config/db').pool.query(
      sqlSelectReset, [id, ctx.idtenant]
    );
    if (users.length === 0) return res.status(404).json({ message: 'User tidak ditemukan' });

    // Hash password baru dan increment tokenversion untuk invalidasi semua sesi user target
    const hash = await bcrypt.hash(newPass, 10);
    let sqlUpdatePass = 'UPDATE user SET pass = ?, tokenversion = tokenversion + 1 WHERE iduser = ?';
    await tenantExecute(
      sqlUpdatePass,
      [hash, id]
    );

    await logger.history('USER_RESET_PASSWORD', { idtenant: ctx.idtenant, iduser: ctx.iduser, ref: String(id), req });
    res.json({ message: 'Password berhasil direset' });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /user/:id/menus — Menampilkan daftar menu yang di-assign ke user
exports.getMenus = async (req, res) => {
  try {
    const ctx = getTenantContext();
    let sqlMenus = `SELECT m.*, um.hakakses, um.tambah, um.ubah, um.approve, um.batalapprove, um.bataltransaksi, um.cetak
       FROM usermenu um
       JOIN user u ON u.iduser = um.iduser
       JOIN menu m ON m.idmenu = um.idmenu
       WHERE um.iduser = ? AND u.idtenant = ? AND um.status = 'AKTIF'
       ORDER BY m.urutan ASC`;
    const [rows] = await pool.query(
      sqlMenus,
      [req.params.id, ctx.idtenant]
    );
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /user/:id/lokasis — Menampilkan daftar lokasi yang di-assign ke user
exports.getLokasis = async (req, res) => {
  try {
    const ctx = getTenantContext();
    let sqlLokasis = `SELECT l.* FROM lokasi l
       JOIN userlokasi ul ON l.idlokasi = ul.idlokasi AND ul.iduser = ?
       WHERE ul.status = 'AKTIF' AND l.idtenant = ?`;
    const [rows] = await pool.query(
      sqlLokasis,
      [req.params.id, ctx.idtenant]
    );
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// ─── TEMPLATE MENU ────────────────────────────────────────────────

// GET /user/templates — Menampilkan semua template menu dalam tenant
exports.getAllTemplates = async (req, res) => {
  try {
    const ctx = getTenantContext();
    let sqlTemplates = 'SELECT * FROM menutemplate WHERE idtenant = ? ORDER BY namatemplate ASC';
    const rows = await tenantQuery(
      sqlTemplates,
      [ctx.idtenant]
    );
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /user/templates/:id — Menampilkan detail menu dalam satu template
exports.getTemplateDetail = async (req, res) => {
  try {
    let sqlTplDetail = `SELECT m.* FROM menu m
       JOIN menutemplatedtl mt ON m.idmenu = mt.idmenu AND mt.idmenutemplate = ?
       WHERE mt.status = 'AKTIF'`;
    const rows = await tenantQuery(
      sqlTplDetail,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// POST /user/templates — Membuat template menu baru
exports.createTemplate = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    const { namatemplate, menus } = req.body;

    await conn.beginTransaction();

    // Insert header template
    let sqlInsTpl = 'INSERT INTO menutemplate (idtenant, namatemplate, status, userentry) VALUES (?, ?, ?, ?)';
    const [result] = await conn.query(
      sqlInsTpl,
      [ctx.idtenant, namatemplate, 'AKTIF', ctx.iduser]
    );
    const idmenutemplate = result.insertId;

    // Insert detail menu template
    for (const idmenu of (menus || [])) {
      let sqlInsTplDtl = "INSERT INTO menutemplatedtl (idmenutemplate, idmenu, status) VALUES (?, ?, 'AKTIF')";
      await conn.query(
        sqlInsTplDtl,
        [idmenutemplate, idmenu]
      );
    }

    await conn.commit();
    res.status(201).json({ message: 'Template berhasil ditambah', idmenutemplate });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// PUT /user/templates/:id — Memperbarui template menu
exports.updateTemplate = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    const { id } = req.params;
    const { namatemplate, menus } = req.body;

    // Validasi: cek template ada
    let sqlSelTpl = 'SELECT * FROM menutemplate WHERE idmenutemplate = ? AND idtenant = ?';
    const [templates] = await conn.query(sqlSelTpl, [id, ctx.idtenant]);
    if (templates.length === 0) return res.status(404).json({ message: 'Template tidak ditemukan' });

    await conn.beginTransaction();

    // Update nama template
    let sqlUpdTpl = 'UPDATE menutemplate SET namatemplate = ? WHERE idmenutemplate = ?';
    await conn.query(sqlUpdTpl, [namatemplate || templates[0].namatemplate, id]);

    // Update daftar menu template: hapus semua lalu insert ulang
    if (menus !== undefined) {
      let sqlDelTplDtl = 'DELETE FROM menutemplatedtl WHERE idmenutemplate = ?';
      await conn.query(sqlDelTplDtl, [id]);
      for (const idmenu of (menus || [])) {
        let sqlInsTplDtlUpd = "INSERT INTO menutemplatedtl (idmenutemplate, idmenu, status) VALUES (?, ?, 'AKTIF')";
        await conn.query(
          sqlInsTplDtlUpd,
          [id, idmenu]
        );
      }
    }

    await conn.commit();
    res.json({ message: 'Template berhasil diupdate' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// DELETE /user/templates/:id — Menghapus template menu
exports.deleteTemplate = async (req, res) => {
  try {
    const ctx = getTenantContext();
    let sqlDelTpl = 'DELETE FROM menutemplate WHERE idmenutemplate = ? AND idtenant = ?';
    await tenantExecute(
      sqlDelTpl,
      [req.params.id, ctx.idtenant]
    );
    res.json({ message: 'Template berhasil dihapus' });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};
