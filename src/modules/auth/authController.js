// Controller untuk otentikasi dan otorisasi.
// Menangani login, pemilihan lokasi, registrasi tenant, profil user, dan perubahan password.

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool, getConnection, tenantQuery, tenantExecute, getTenantContext } = require('../../config/db');
require('dotenv').config();
const logger = require('../../lib/logger');
const { setConfigValue, getConfigValue } = require('../../lib/confighelper');

const DEFAULT_COA = [
  ['1-1001', 'Kas Tunai',               'ASET',        'DEBET'],
  ['1-1002', 'Bank',                    'ASET',        'DEBET'],
  ['1-1003', 'Piutang Usaha',           'ASET',        'DEBET'],
  ['1-1004', 'Persediaan Barang',       'ASET',        'DEBET'],
  ['2-1001', 'Hutang Usaha',            'LIABILITAS',  'KREDIT'],
  ['2-1002', 'Hutang Gaji',             'LIABILITAS',  'KREDIT'],
  ['3-1001', 'Modal',                   'EKUITAS',     'KREDIT'],
  ['3-1002', 'Laba Ditahan',            'EKUITAS',     'KREDIT'],
  ['4-1001', 'Pendapatan Penjualan',    'PENDAPATAN',  'KREDIT'],
  ['5-1001', 'Harga Pokok Penjualan',   'BEBAN',       'DEBET'],
  ['5-1002', 'Beban Operasional',       'BEBAN',       'DEBET'],
  ['5-1003', 'Beban Gaji',              'BEBAN',       'DEBET'],
];

function signLoginToken(user, loc) {
  return jwt.sign(
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
}

async function buildLoginResponse(user, loc, token) {
  const pakaiPPN = await getConfigValue(pool, user.idtenant, 'GLOBAL', 'PAKAIPPN');
  return {
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
      pakaiPPN  : String(pakaiPPN || 'YA').toUpperCase(),
    },
    lokasi: {
      idlokasi  : loc.idlokasi,
      kodelokasi: loc.kodelokasi,
      namalokasi: loc.namalokasi,
    },
    needSelectLocation: false,
  };
}

// POST /auth/login — Login user; jika hanya 1 lokasi langsung dapat token, jika banyak pilih lokasi dulu
exports.login = async (req, res) => {
  try {
    const { username, password, pass } = req.body;
    const loginPassword = password || pass;

    if (!username || !loginPassword) {
      return res.status(400).json({ message: 'Username dan password wajib diisi' });
    }

    let sql = 'SELECT u.*, t.namatenant, t.logo as tenant_logo, t.ppn FROM user u JOIN tenant t ON u.idtenant = t.idtenant WHERE u.username = ?';
    const [rows] = await pool.query(sql, [username]);
    // Validasi: cek username ada
    if (rows.length === 0) return res.status(401).json({ message: 'Username tidak ditemukan' });

    let user = null;
    for (const row of rows) {
      const valid = await bcrypt.compare(loginPassword, row.pass);
      if (valid) {
        if (user) {
          return res.status(409).json({
            message: 'Username ditemukan di lebih dari satu tenant. Hubungi admin untuk membuat username unik.',
          });
        }
        user = row;
      }
    }

    if (!user) return res.status(401).json({ message: 'Password salah' });

    // Validasi: cek status user aktif
    if (user.status !== 'AKTIF') return res.status(401).json({ message: 'Akun tidak aktif' });

    // Ambil daftar lokasi yang di-assign ke user
    let sql2 = `SELECT l.* FROM lokasi l
       JOIN userlokasi ul ON l.idlokasi = ul.idlokasi AND ul.iduser = ?
       WHERE l.idtenant = ? AND l.status = 'AKTIF' AND ul.status = 'AKTIF'`;
    const [lokasi] = await pool.query(sql2, [user.iduser, user.idtenant]);

    // Validasi: user harus punya minimal 1 lokasi
    if (lokasi.length === 0) return res.status(401).json({ message: 'Tidak ada lokasi yang di-assign' });

    const loc = lokasi.find(l => Number(l.isdefault) === 1) || lokasi[0];
    const token = signLoginToken(user, loc);

    await logger.history('LOGIN', { idtenant: user.idtenant, idlokasi: loc.idlokasi, iduser: user.iduser, ref: username, req });
    return res.json(await buildLoginResponse(user, loc, token));
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// POST /auth/select-location — Memilih lokasi setelah login (jika user punya banyak lokasi)
exports.selectLocation = async (req, res) => {
  try {
    const { username, idlokasi } = req.body;

    // Validasi: cek user
    let sql = 'SELECT u.*, t.namatenant, t.logo as tenant_logo, t.ppn FROM user u JOIN tenant t ON u.idtenant = t.idtenant WHERE u.username = ?';
    const [users] = await pool.query(sql, [username]);
    if (users.length === 0) return res.status(401).json({ message: 'Username tidak ditemukan' });

    const user = users[0];
    // Validasi: cek status user
    if (user.status !== 'AKTIF') return res.status(401).json({ message: 'Akun tidak aktif' });

    // Validasi: cek user punya akses ke lokasi yang dipilih
    let sql2 = `SELECT 1 FROM userlokasi WHERE iduser = ? AND idlokasi = ? AND status = 'AKTIF'`;
    const [lokasiAccess] = await pool.query(sql2, [user.iduser, idlokasi]);
    if (lokasiAccess.length === 0) return res.status(403).json({ message: 'Tidak memiliki akses ke lokasi ini' });

    // Validasi: cek lokasi valid dan aktif
    let sql3 = `SELECT * FROM lokasi WHERE idlokasi = ? AND idtenant = ? AND status = 'AKTIF'`;
    const [[lokasi]] = await pool.query(sql3, [idlokasi, user.idtenant]);
    if (!lokasi) return res.status(404).json({ message: 'Lokasi tidak ditemukan' });

    const token = signLoginToken(user, lokasi);

    return res.json(await buildLoginResponse(user, lokasi, token));
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// POST /auth/register — Registrasi tenant baru: membuat tenant, lokasi default, user owner, dan assign semua menu + lokasi
exports.register = async (req, res) => {
  const conn = await getConnection();
  try {
    const { tenant: t, lokasi: l, user: u } = req.body;

    await conn.beginTransaction();

    // 1. Insert tenant
    let sql = `INSERT INTO tenant (namatenant, alamat, hp, email, npwp, ppn, idcurrency, status, userentry)
       VALUES (?, ?, ?, ?, ?, ?, IFNULL(?, 1), 'AKTIF', 0)`;
    const [tenantResult] = await conn.query(sql, [t.namatenant, t.alamat || null, t.hp || null, t.email || null, t.npwp || null, t.ppn || 0, t.idcurrency || 1]);
    const idtenant = tenantResult.insertId;

    // 2. Insert lokasi default (isdefault=1)
    let sql2 = `INSERT INTO lokasi (idtenant, kodelokasi, namalokasi, alamat, hp, isdefault, status, userentry)
       VALUES (?, ?, ?, ?, ?, 1, 'AKTIF', 0)`;
    const [lokasiResult] = await conn.query(sql2, [idtenant, l.kodelokasi, l.namalokasi, l.alamat || null, l.hp || null]);
    const idlokasi = lokasiResult.insertId;

    // 3. Insert user owner (isowner=1) — password di-hash dengan bcrypt 10 salt rounds
    const hash = await bcrypt.hash(u.pass, 10);
    let sql3 = `INSERT INTO user (idtenant, username, pass, namauser, email, hp, isowner, tokenversion, status, userentry)
       VALUES (?, ?, ?, ?, ?, ?, 1, 1, 'AKTIF', 0)`;
    const [userResult] = await conn.query(sql3, [idtenant, u.username, hash, u.namauser, u.email || null, u.hp || null]);
    const iduser = userResult.insertId;

    // 4. Update userentry di semua record ke iduser owner
    let sql4 = 'UPDATE tenant SET userentry = ? WHERE idtenant = ?';
    await conn.query(sql4, [iduser, idtenant]);
    let sql5 = 'UPDATE lokasi SET userentry = ? WHERE idlokasi = ?';
    await conn.query(sql5, [iduser, idlokasi]);
    let sql6 = 'UPDATE user SET userentry = ? WHERE iduser = ?';
    await conn.query(sql6, [iduser, iduser]);

    // 5. Assign semua menu ke user owner
    let sql7 = 'SELECT idmenu FROM menu';
    const [allMenus] = await conn.query(sql7);
    for (const m of allMenus) {
      let sql8 = `INSERT INTO usermenu (iduser, idmenu, status, userentry) VALUES (?, ?, 'AKTIF', ?)`;
      await conn.query(sql8, [iduser, m.idmenu, iduser]);
    }

    // 6. Assign lokasi default ke user owner
    let sql9 = `INSERT INTO userlokasi (iduser, idlokasi, status, userentry) VALUES (?, ?, 'AKTIF', ?)`;
    await conn.query(sql9, [iduser, idlokasi, iduser]);

    // 7. Seed default Chart of Accounts agar jurnaling berfungsi sejak awal
    for (const [kode, nama, jenis, saldo] of DEFAULT_COA) {
      await conn.query(
        'INSERT IGNORE INTO akun (idtenant, kodeakun, namaakun, jenisak, saldo, status, userentry) VALUES (?,?,?,?,?,?,?)',
        [idtenant, kode, nama, jenis, saldo, 'AKTIF', 0]
      );
    }

    await setConfigValue(conn, idtenant, 'GLOBAL', 'CEKMINUS', 'TIDAK', 1);
    await setConfigValue(conn, idtenant, 'BARANG', 'PAKAIBAHANBAKU', 'YA', 1);
    await setConfigValue(conn, idtenant, 'GLOBAL', 'PAKAIPPN', 'YA', 1);

    await conn.commit();

    // Generate JWT langsung setelah registrasi (auto-login)
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

    await logger.history('REGISTER', { idtenant, iduser, ref: u.username, req });
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
    // Validasi: username atau kodelokasi duplikat
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Username atau kodelokasi sudah digunakan' });
    }
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// GET /auth/me — Menampilkan profil user yang sedang login (dari token JWT)
exports.me = async (req, res) => {
  try {
    const ctx = getTenantContext();
    let sql = `SELECT u.iduser, u.username, u.email, u.namauser, u.hp, u.isowner,
              t.namatenant, t.alamat as tenant_alamat, t.hp as tenant_hp, t.logo, t.ppn,
              l.kodelokasi, l.namalokasi, l.alamat as lokasi_alamat
       FROM user u
       JOIN tenant t ON u.idtenant = t.idtenant
       JOIN lokasi l ON l.idlokasi = ? AND l.idtenant = u.idtenant
       WHERE u.iduser = ? AND u.idtenant = ?`;
    const [rows] = await pool.query(sql, [ctx.idlokasi, ctx.iduser, ctx.idtenant]);
    if (rows.length === 0) return res.status(404).json({ message: 'User tidak ditemukan' });
    res.json(rows[0]);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// PUT /auth/change-password — Mengubah password user yang sedang login; tokenversion di-increment untuk invalidasi token lama
exports.changePassword = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { oldPass, newPass } = req.body;

    // Validasi: verifikasi password lama
    let sql = 'SELECT pass FROM user WHERE iduser = ? AND idtenant = ?';
    const [rows] = await pool.query(sql, [ctx.iduser, ctx.idtenant]);
    const valid = await bcrypt.compare(oldPass, rows[0].pass);
    if (!valid) return res.status(400).json({ message: 'Password lama salah' });

    // Hash password baru dan increment tokenversion untuk logout semua sesi
    const hash = await bcrypt.hash(newPass, 10);
    let sql2 = 'UPDATE user SET pass = ?, tokenversion = tokenversion + 1 WHERE iduser = ? AND idtenant = ?';
    await pool.query(sql2, [hash, ctx.iduser, ctx.idtenant]);

    res.json({ message: 'Password berhasil diubah. Silakan login ulang.' });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// POST /auth/refresh — Menerbitkan token JWT baru tanpa perlu login ulang; untuk auto-refresh saat token mendekati expire
exports.refresh = async (req, res) => {
  try {
    const ctx = getTenantContext();

    // Validasi: cek user masih aktif (tokenversion sudah diverifikasi oleh auth middleware)
    let sql = 'SELECT u.*, t.namatenant, t.ppn FROM user u JOIN tenant t ON u.idtenant = t.idtenant WHERE u.iduser = ? AND u.idtenant = ?';
    const [rows] = await pool.query(sql, [ctx.iduser, ctx.idtenant]);
    if (rows.length === 0 || rows[0].status !== 'AKTIF') {
      return res.status(401).json({ message: 'Akun tidak aktif atau tidak ditemukan' });
    }

    const user = rows[0];
    const token = jwt.sign(
      {
        iduser      : user.iduser,
        idtenant    : user.idtenant,
        tokenversion: user.tokenversion,
      },
      process.env.JWT_SECRET,
      { expiresIn: '2h' }
    );

    const pakaiPPN = await getConfigValue(pool, user.idtenant, 'GLOBAL', 'PAKAIPPN');
    res.json({
      token,
      user: {
        iduser    : user.iduser,
        idtenant  : user.idtenant,
        username  : user.username,
        namauser  : user.namauser,
        email     : user.email,
        isowner   : user.isowner,
        namatenant: user.namatenant,
        ppn       : user.ppn,
        pakaiPPN  : String(pakaiPPN || 'YA').toUpperCase(),
      },
    });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};
