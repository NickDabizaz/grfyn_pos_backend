/**
 * Middleware autentikasi JWT.
 * Memvalidasi token dari header Authorization atau query string,
 * memeriksa status user dan token version, lalu menyimpan konteks tenant
 * ke AsyncLocalStorage sehingga dapat diakses di seluruh call-chain request ini.
 */
const jwt = require('jsonwebtoken');
const { pool, tenantStorage } = require('../config/db');
require('dotenv').config();

const auth = async (req, res, next) => {
  let token = null;

  // Ambil token dari header Authorization (Bearer) atau query string (?token=...)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }
  if (!token && req.query.token) {
    token = req.query.token;
  }
  if (!token) {
    return res.status(401).json({ message: 'Token tidak ditemukan' });
  }

  try {
    // Verifikasi token JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Validasi user masih aktif dan token version cocok (mencegah token lama setelah logout)
    let sql = 'SELECT tokenversion, status FROM user WHERE iduser = ? AND idtenant = ?';
    const [[user]] = await pool.query(sql, [decoded.iduser, decoded.idtenant]);
    if (!user || user.status !== 'AKTIF') {
      return res.status(401).json({ message: 'Akun tidak aktif' });
    }
    if (user.tokenversion !== decoded.tokenversion) {
      return res.status(401).json({ message: 'Sesi tidak valid. Silakan login ulang.' });
    }

    req.user = decoded;

    // Simpan konteks tenant ke AsyncLocalStorage agar tersedia di seluruh request chain
    tenantStorage.run(
      { idtenant: decoded.idtenant, idlokasi: decoded.idlokasi, iduser: decoded.iduser },
      () => next()
    );
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token tidak valid atau kadaluarsa' });
    }
    return res.status(401).json({ message: err.message });
  }
};

module.exports = auth;
