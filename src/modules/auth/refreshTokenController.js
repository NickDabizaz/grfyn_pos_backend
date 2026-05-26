const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { pool } = require('../../config/db');
const logger = require('../../lib/logger');

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateRefreshToken() {
  return crypto.randomBytes(40).toString('hex');
}

exports.issueRefreshToken = async (iduser, idtenant, conn) => {
  const token = generateRefreshToken();
  const hash = hashToken(token);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const db = conn || pool;
  await db.query(
    'INSERT INTO refresh_token (iduser, idtenant, token_hash, expires_at) VALUES (?, ?, ?, ?)',
    [iduser, idtenant, hash, expiresAt]
  );
  return token;
};

exports.refresh = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ message: 'refreshToken diperlukan' });

    const hash = hashToken(refreshToken);
    const [[rt]] = await pool.query(
      'SELECT * FROM refresh_token WHERE token_hash = ? AND used = 0 AND expires_at > NOW() LIMIT 1',
      [hash]
    );
    if (!rt) return res.status(401).json({ message: 'Refresh token tidak valid atau sudah expired' });

    await pool.query('UPDATE refresh_token SET used = 1 WHERE idrefreshtoken = ?', [rt.idrefreshtoken]);

    const [[user]] = await pool.query(
      'SELECT u.*, t.namatenant, t.logo as tenant_logo, t.ppn FROM user u JOIN tenant t ON u.idtenant = t.idtenant WHERE u.iduser = ? AND u.idtenant = ?',
      [rt.iduser, rt.idtenant]
    );
    if (!user || user.status !== 'AKTIF') return res.status(401).json({ message: 'User tidak aktif' });

    const [[defaultLokasi]] = await pool.query(
      'SELECT idlokasi, kodelokasi, namalokasi FROM lokasi WHERE idtenant = ? ORDER BY isdefault DESC LIMIT 1',
      [rt.idtenant]
    );
    if (!defaultLokasi) return res.status(400).json({ message: 'Lokasi tidak ditemukan' });

    const newToken = jwt.sign(
      {
        iduser: user.iduser,
        idtenant: user.idtenant,
        idlokasi: defaultLokasi.idlokasi,
        kodelokasi: defaultLokasi.kodelokasi,
        namalokasi: String(defaultLokasi.namalokasi).toUpperCase(),
        tokenversion: user.tokenversion,
      },
      process.env.JWT_SECRET,
      { expiresIn: '2h' }
    );

    const newRefreshToken = await exports.issueRefreshToken(user.iduser, user.idtenant, null);

    await pool.query(
      'DELETE FROM refresh_token WHERE iduser = ? AND used = 1 AND idrefreshtoken NOT IN (SELECT idrefreshtoken FROM (SELECT idrefreshtoken FROM refresh_token WHERE iduser = ? ORDER BY tglentry DESC LIMIT 5) t)',
      [rt.iduser, rt.iduser]
    ).catch(() => {});

    res.json({ token: newToken, refreshToken: newRefreshToken });
  } catch (err) {
    logger.error(err, { req });
    res.status(401).json({ message: 'Token tidak valid' });
  }
};

exports.revoke = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ message: 'refreshToken diperlukan' });
    const hash = hashToken(refreshToken);
    await pool.query('UPDATE refresh_token SET used = 1 WHERE token_hash = ?', [hash]);
    res.json({ message: 'Token dicabut' });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};
