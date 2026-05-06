const jwt = require('jsonwebtoken');
const { pool, getNamespace, TENANT_NS } = require('../config/db');
require('dotenv').config();

const auth = async (req, res, next) => {
  let token = null;

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
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const [[user]] = await pool.query(
      'SELECT tokenversion, status FROM user WHERE iduser = ? AND idtenant = ?',
      [decoded.iduser, decoded.idtenant]
    );
    if (!user || user.status !== 'AKTIF') {
      return res.status(401).json({ message: 'Akun tidak aktif' });
    }
    if (user.tokenversion !== decoded.tokenversion) {
      return res.status(401).json({ message: 'Sesi tidak valid. Silakan login ulang.' });
    }

    const ns = getNamespace(TENANT_NS);
    if (ns) {
      ns.set('idtenant', decoded.idtenant);
      ns.set('idlokasi', decoded.idlokasi);
      ns.set('iduser', decoded.iduser);
    }

    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token tidak valid atau kadaluarsa' });
    }
    return res.status(401).json({ message: err.message });
  }
};

module.exports = auth;
