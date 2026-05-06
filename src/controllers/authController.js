const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool, getConnection, tenantQuery, tenantExecute, getTenantContext } = require('../config/db');
require('dotenv').config();

exports.login = async (req, res) => {
  try {
    const { username, pass } = req.body;
    const [rows] = await pool.query(
      'SELECT u.*, t.namatenant, t.logo as tenant_logo, t.ppn FROM user u JOIN tenant t ON u.idtenant = t.idtenant WHERE u.username = ?',
      [username]
    );
    if (rows.length === 0) return res.status(401).json({ message: 'Username tidak ditemukan' });

    const user = rows[0];
    const valid = await bcrypt.compare(pass, user.pass);
    if (!valid) return res.status(401).json({ message: 'Password salah' });

    if (user.status !== 'AKTIF') return res.status(401).json({ message: 'Akun tidak aktif' });

    const [lokasi] = await pool.query(
      `SELECT l.* FROM lokasi l
       JOIN userlokasi ul ON l.idlokasi = ul.idlokasi AND ul.iduser = ?
       WHERE l.idtenant = ? AND l.status = 'AKTIF' AND ul.status = 'AKTIF'`,
      [user.iduser, user.idtenant]
    );

    if (lokasi.length === 0) return res.status(401).json({ message: 'Tidak ada lokasi yang di-assign' });

    if (lokasi.length === 1) {
      const loc = lokasi[0];
      const token = jwt.sign(
        {
          iduser      : user.iduser,
          idtenant    : user.idtenant,
          idlokasi    : loc.idlokasi,
          kodelokasi  : loc.kodelokasi,
          namalokasi  : loc.namalokasi,
          tokenversion: user.tokenversion,
        },
        process.env.JWT_SECRET,
        { expiresIn: '2h' }
      );

      return res.json({
        token,
        user: {
          iduser    : user.iduser,
          idtenant  : user.idtenant,
          username  : user.username,
          namauser  : user.namauser,
          email     : user.email,
          isowner   : user.isowner,
          namatenant: user.namatenant,
          logo      : user.tenant_logo,
          ppn       : user.ppn,
        },
        lokasi: {
          idlokasi  : loc.idlokasi,
          kodelokasi: loc.kodelokasi,
          namalokasi: loc.namalokasi,
        },
        needSelectLocation: false,
      });
    }

    return res.json({
      needSelectLocation: true,
      username          : user.username,
      user              : {
        iduser    : user.iduser,
        idtenant  : user.idtenant,
        username  : user.username,
        namauser  : user.namauser,
        email     : user.email,
        isowner   : user.isowner,
        namatenant: user.namatenant,
        logo      : user.tenant_logo,
      },
      locations: lokasi.map(l => ({
        idlokasi  : l.idlokasi,
        kodelokasi: l.kodelokasi,
        namalokasi: l.namalokasi,
        alamat    : l.alamat,
      })),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.selectLocation = async (req, res) => {
  try {
    const { username, idlokasi } = req.body;

    const [users] = await pool.query(
      'SELECT u.*, t.namatenant, t.logo as tenant_logo, t.ppn FROM user u JOIN tenant t ON u.idtenant = t.idtenant WHERE u.username = ?',
      [username]
    );
    if (users.length === 0) return res.status(401).json({ message: 'Username tidak ditemukan' });

    const user = users[0];
    if (user.status !== 'AKTIF') return res.status(401).json({ message: 'Akun tidak aktif' });

    const [lokasiAccess] = await pool.query(
      `SELECT 1 FROM userlokasi WHERE iduser = ? AND idlokasi = ? AND status = 'AKTIF'`,
      [user.iduser, idlokasi]
    );
    if (lokasiAccess.length === 0) return res.status(403).json({ message: 'Tidak memiliki akses ke lokasi ini' });

    const [[lokasi]] = await pool.query(
      `SELECT * FROM lokasi WHERE idlokasi = ? AND idtenant = ? AND status = 'AKTIF'`,
      [idlokasi, user.idtenant]
    );
    if (!lokasi) return res.status(404).json({ message: 'Lokasi tidak ditemukan' });

    const token = jwt.sign(
      {
        iduser      : user.iduser,
        idtenant    : user.idtenant,
        idlokasi    : lokasi.idlokasi,
        kodelokasi  : lokasi.kodelokasi,
        namalokasi  : lokasi.namalokasi,
        tokenversion: user.tokenversion,
      },
      process.env.JWT_SECRET,
      { expiresIn: '2h' }
    );

    return res.json({
      token,
      user: {
        iduser    : user.iduser,
        idtenant  : user.idtenant,
        username  : user.username,
        namauser  : user.namauser,
        email     : user.email,
        isowner   : user.isowner,
        namatenant: user.namatenant,
        logo      : user.tenant_logo,
        ppn       : user.ppn,
      },
      lokasi: {
        idlokasi  : lokasi.idlokasi,
        kodelokasi: lokasi.kodelokasi,
        namalokasi: lokasi.namalokasi,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.register = async (req, res) => {
  const conn = await getConnection();
  try {
    const { tenant: t, lokasi: l, user: u } = req.body;

    await conn.beginTransaction();

    const [tenantResult] = await conn.query(
      `INSERT INTO tenant (namatenant, alamat, hp, email, npwp, ppn, idcurrency, status, userentry)
       VALUES (?, ?, ?, ?, ?, ?, IFNULL(?, 1), 'AKTIF', 0)`,
      [t.namatenant, t.alamat || null, t.hp || null, t.email || null, t.npwp || null, t.ppn || 0, t.idcurrency || 1]
    );
    const idtenant = tenantResult.insertId;

    const [lokasiResult] = await conn.query(
      `INSERT INTO lokasi (idtenant, kodelokasi, namalokasi, alamat, hp, isdefault, status, userentry)
       VALUES (?, ?, ?, ?, ?, 1, 'AKTIF', 0)`,
      [idtenant, l.kodelokasi, l.namalokasi, l.alamat || null, l.hp || null]
    );
    const idlokasi = lokasiResult.insertId;

    const hash = await bcrypt.hash(u.pass, 10);
    const [userResult] = await conn.query(
      `INSERT INTO user (idtenant, username, pass, namauser, email, hp, isowner, tokenversion, status, userentry)
       VALUES (?, ?, ?, ?, ?, ?, 1, 1, 'AKTIF', 0)`,
      [idtenant, u.username, hash, u.namauser, u.email || null, u.hp || null]
    );
    const iduser = userResult.insertId;

    await conn.query('UPDATE tenant SET userentry = ? WHERE idtenant = ?', [iduser, idtenant]);
    await conn.query('UPDATE lokasi SET userentry = ? WHERE idlokasi = ?', [iduser, idlokasi]);
    await conn.query('UPDATE user SET userentry = ? WHERE iduser = ?', [iduser, iduser]);

    const [allMenus] = await conn.query('SELECT idmenu FROM menu');
    for (const m of allMenus) {
      await conn.query(
        `INSERT INTO usermenu (iduser, idmenu, status, userentry) VALUES (?, ?, 'AKTIF', ?)`,
        [iduser, m.idmenu, iduser]
      );
    }

    await conn.query(
      `INSERT INTO userlokasi (iduser, idlokasi, status, userentry) VALUES (?, ?, 'AKTIF', ?)`,
      [iduser, idlokasi, iduser]
    );

    await conn.commit();

    const token = jwt.sign(
      {
        iduser,
        idtenant,
        idlokasi,
        kodelokasi: l.kodelokasi,
        namalokasi: l.namalokasi,
        tokenversion: 1,
      },
      process.env.JWT_SECRET,
      { expiresIn: '2h' }
    );

    res.status(201).json({
      message: 'Pendaftaran berhasil',
      token,
      user: {
        iduser,
        idtenant,
        username  : u.username,
        namauser  : u.namauser,
        email     : u.email,
        isowner   : 1,
        namatenant: t.namatenant,
      },
      lokasi: {
        idlokasi,
        kodelokasi: l.kodelokasi,
        namalokasi: l.namalokasi,
      },
    });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Username atau kodelokasi sudah digunakan' });
    }
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.me = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const [rows] = await pool.query(
      `SELECT u.iduser, u.username, u.email, u.namauser, u.hp, u.isowner,
              t.namatenant, t.alamat as tenant_alamat, t.hp as tenant_hp, t.logo, t.ppn,
              l.kodelokasi, l.namalokasi, l.alamat as lokasi_alamat
       FROM user u
       JOIN tenant t ON u.idtenant = t.idtenant
       JOIN lokasi l ON l.idlokasi = ? AND l.idtenant = u.idtenant
       WHERE u.iduser = ? AND u.idtenant = ?`,
      [ctx.idlokasi, ctx.iduser, ctx.idtenant]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'User tidak ditemukan' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { oldPass, newPass } = req.body;

    const [rows] = await pool.query(
      'SELECT pass FROM user WHERE iduser = ? AND idtenant = ?',
      [ctx.iduser, ctx.idtenant]
    );
    const valid = await bcrypt.compare(oldPass, rows[0].pass);
    if (!valid) return res.status(400).json({ message: 'Password lama salah' });

    const hash = await bcrypt.hash(newPass, 10);
    await pool.query(
      'UPDATE user SET pass = ?, tokenversion = tokenversion + 1 WHERE iduser = ? AND idtenant = ?',
      [hash, ctx.iduser, ctx.idtenant]
    );

    res.json({ message: 'Password berhasil diubah. Silakan login ulang.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
