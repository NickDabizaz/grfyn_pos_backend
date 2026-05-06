const bcrypt = require('bcryptjs');
const { tenantQuery, tenantExecute, getConnection, getTenantContext } = require('../config/db');

exports.getAll = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const rows = await tenantQuery(
      `SELECT u.iduser, u.username, u.namauser, u.email, u.hp, u.isowner, u.status,
        u.tglentry,
        (SELECT COUNT(*) FROM userlokasi ul WHERE ul.iduser = u.iduser AND ul.status = 'AKTIF') as jml_lokasi,
        (SELECT COUNT(*) FROM usermenu um WHERE um.iduser = u.iduser AND um.status = 'AKTIF') as jml_menu
       FROM user u WHERE u.idtenant = ? ORDER BY u.iduser ASC`,
      [ctx.idtenant]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getOne = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const rows = await tenantQuery(
      'SELECT u.iduser, u.username, u.namauser, u.email, u.hp, u.isowner, u.status FROM user u WHERE u.iduser = ?',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'User tidak ditemukan' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.create = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    const { username, pass, namauser, email, hp, menus, lokasis, idtemplate } = req.body;

    if (!username || !pass || !namauser) {
      return res.status(400).json({ message: 'Username, password, dan nama wajib diisi' });
    }

    // Cek username unik di tenant ini
    const [[existing]] = await conn.query(
      'SELECT COUNT(*) as cnt FROM user WHERE username = ? AND idtenant = ?',
      [username.toUpperCase(), ctx.idtenant]
    );
    if (existing.cnt > 0) {
      return res.status(400).json({ message: 'Username sudah digunakan' });
    }

    await conn.beginTransaction();

    const hash = await bcrypt.hash(pass, 10);
    const [result] = await conn.query(
      'INSERT INTO user (idtenant, username, pass, namauser, email, hp, isowner, tokenversion, status, userentry) VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?)',
      [ctx.idtenant, username.toUpperCase(), hash, namauser, email || null, hp || null, 'AKTIF', ctx.iduser]
    );
    const iduser = result.insertId;

    // Update userentry ke self
    await conn.query('UPDATE user SET userentry = ? WHERE iduser = ?', [iduser, iduser]);

    // Apply template if selected
    if (idtemplate) {
      const [templateDtl] = await conn.query(
        'SELECT idmenu FROM menutemplatedtl WHERE idmenutemplate = ? AND status = ?',
        [idtemplate, 'AKTIF']
      );
      for (const d of templateDtl) {
        await conn.query(
          "INSERT INTO usermenu (iduser, idmenu, status, userentry) VALUES (?, ?, 'AKTIF', ?)",
          [iduser, d.idmenu, ctx.iduser]
        );
      }
    }

    // Custom menus
    if (menus && menus.length > 0) {
      for (const idmenu of menus) {
        try {
          await conn.query(
            "INSERT INTO usermenu (iduser, idmenu, status, userentry) VALUES (?, ?, 'AKTIF', ?)",
            [iduser, idmenu, ctx.iduser]
          );
        } catch (e) {
          if (e.code !== 'ER_DUP_ENTRY') throw e;
        }
      }
    }

    // Lokasi
    if (lokasis && lokasis.length > 0) {
      for (const idlokasi of lokasis) {
        try {
          await conn.query(
            "INSERT INTO userlokasi (iduser, idlokasi, status, userentry) VALUES (?, ?, 'AKTIF', ?)",
            [iduser, idlokasi, ctx.iduser]
          );
        } catch (e) {
          if (e.code !== 'ER_DUP_ENTRY') throw e;
        }
      }
    }

    await conn.commit();
    res.status(201).json({ message: 'User berhasil ditambah', iduser });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Username sudah digunakan' });
    }
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.update = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    const { id } = req.params;
    const { namauser, email, hp, status, menus, lokasis } = req.body;

    const [users] = await conn.query('SELECT * FROM user WHERE iduser = ? AND idtenant = ?', [id, ctx.idtenant]);
    if (users.length === 0) return res.status(404).json({ message: 'User tidak ditemukan' });

    const target = users[0];

    // Owner tidak bisa di-nonaktifkan
    if (target.isowner && status === 'NONAKTIF') {
      return res.status(400).json({ message: 'Owner tidak dapat dinonaktifkan' });
    }

    await conn.beginTransaction();

    // Update user
    const newStatus = status || target.status;
    await conn.query(
      'UPDATE user SET namauser = ?, email = ?, hp = ?, status = ?, tokenversion = tokenversion + 1 WHERE iduser = ? AND idtenant = ?',
      [namauser || target.namauser, email ?? target.email, hp ?? target.hp, newStatus, id, ctx.idtenant]
    );

    // Update menus
    if (menus !== undefined) {
      await conn.query('DELETE FROM usermenu WHERE iduser = ?', [id]);
      for (const idmenu of (menus || [])) {
        await conn.query(
          "INSERT INTO usermenu (iduser, idmenu, status, userentry) VALUES (?, ?, 'AKTIF', ?)",
          [id, idmenu, ctx.iduser]
        );
      }
    }

    // Update lokasis
    if (lokasis !== undefined) {
      await conn.query('DELETE FROM userlokasi WHERE iduser = ?', [id]);
      for (const idlokasi of (lokasis || [])) {
        await conn.query(
          "INSERT INTO userlokasi (iduser, idlokasi, status, userentry) VALUES (?, ?, 'AKTIF', ?)",
          [id, idlokasi, ctx.iduser]
        );
      }
    }

    await conn.commit();
    res.json({ message: 'User berhasil diupdate' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { id } = req.params;
    const { newPass } = req.body;

    if (!newPass || newPass.length < 6) {
      return res.status(400).json({ message: 'Password minimal 6 karakter' });
    }

    const [users] = await require('../config/db').pool.query(
      'SELECT * FROM user WHERE iduser = ? AND idtenant = ?', [id, ctx.idtenant]
    );
    if (users.length === 0) return res.status(404).json({ message: 'User tidak ditemukan' });

    const hash = await bcrypt.hash(newPass, 10);
    await tenantExecute(
      'UPDATE user SET pass = ?, tokenversion = tokenversion + 1 WHERE iduser = ?',
      [hash, id]
    );

    res.json({ message: 'Password berhasil direset' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getMenus = async (req, res) => {
  try {
    const rows = await tenantQuery(
      `SELECT m.* FROM menu m
       JOIN usermenu um ON m.idmenu = um.idmenu AND um.iduser = ?
       WHERE um.status = 'AKTIF'`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getLokasis = async (req, res) => {
  try {
    const rows = await tenantQuery(
      `SELECT l.* FROM lokasi l
       JOIN userlokasi ul ON l.idlokasi = ul.idlokasi AND ul.iduser = ?
       WHERE ul.status = 'AKTIF'`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// === TEMPLATE ===

exports.getAllTemplates = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const rows = await tenantQuery(
      'SELECT * FROM menutemplate WHERE idtenant = ? ORDER BY namatemplate ASC',
      [ctx.idtenant]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getTemplateDetail = async (req, res) => {
  try {
    const rows = await tenantQuery(
      `SELECT m.* FROM menu m
       JOIN menutemplatedtl mt ON m.idmenu = mt.idmenu AND mt.idmenutemplate = ?
       WHERE mt.status = 'AKTIF'`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.createTemplate = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    const { namatemplate, menus } = req.body;

    await conn.beginTransaction();

    const [result] = await conn.query(
      'INSERT INTO menutemplate (idtenant, namatemplate, status, userentry) VALUES (?, ?, ?, ?)',
      [ctx.idtenant, namatemplate, 'AKTIF', ctx.iduser]
    );
    const idmenutemplate = result.insertId;

    for (const idmenu of (menus || [])) {
      await conn.query(
        "INSERT INTO menutemplatedtl (idmenutemplate, idmenu, status) VALUES (?, ?, 'AKTIF')",
        [idmenutemplate, idmenu]
      );
    }

    await conn.commit();
    res.status(201).json({ message: 'Template berhasil ditambah', idmenutemplate });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.updateTemplate = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    const { id } = req.params;
    const { namatemplate, menus } = req.body;

    const [templates] = await conn.query('SELECT * FROM menutemplate WHERE idmenutemplate = ? AND idtenant = ?', [id, ctx.idtenant]);
    if (templates.length === 0) return res.status(404).json({ message: 'Template tidak ditemukan' });

    await conn.beginTransaction();

    await conn.query('UPDATE menutemplate SET namatemplate = ? WHERE idmenutemplate = ?', [namatemplate || templates[0].namatemplate, id]);

    if (menus !== undefined) {
      await conn.query('DELETE FROM menutemplatedtl WHERE idmenutemplate = ?', [id]);
      for (const idmenu of (menus || [])) {
        await conn.query(
          "INSERT INTO menutemplatedtl (idmenutemplate, idmenu, status) VALUES (?, ?, 'AKTIF')",
          [id, idmenu]
        );
      }
    }

    await conn.commit();
    res.json({ message: 'Template berhasil diupdate' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.deleteTemplate = async (req, res) => {
  try {
    const ctx = getTenantContext();
    await tenantExecute(
      'DELETE FROM menutemplate WHERE idmenutemplate = ? AND idtenant = ?',
      [req.params.id, ctx.idtenant]
    );
    res.json({ message: 'Template berhasil dihapus' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
