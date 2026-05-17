const { pool, getTenantContext } = require('../config/db');

const ACCESS_FIELDS = ['hakakses', 'tambah', 'ubah', 'approve', 'batalapprove', 'bataltransaksi', 'cetak'];

const fullAccess = () => ACCESS_FIELDS.reduce((acc, key) => ({ ...acc, [key]: 1 }), {});

function normalizeAccess(row = {}) {
  return ACCESS_FIELDS.reduce((acc, key) => {
    acc[key] = Number(row[key] || 0) === 1 ? 1 : 0;
    return acc;
  }, {});
}

function hasAnyAccess(access) {
  return ACCESS_FIELDS.some((key) => Number(access[key] || 0) === 1);
}

async function getMenuAccess(kodemenu, ctx = getTenantContext()) {
  if (!ctx.iduser || !ctx.idtenant || !kodemenu) return { allowed: false, ...normalizeAccess() };

  const [[user]] = await pool.query(
    'SELECT isowner FROM user WHERE iduser = ? AND idtenant = ? AND status = ?',
    [ctx.iduser, ctx.idtenant, 'AKTIF']
  );
  if (!user) return { allowed: false, ...normalizeAccess() };
  if (Number(user.isowner) === 1) return { allowed: true, ...fullAccess() };

  const [[row]] = await pool.query(
    `SELECT um.hakakses, um.tambah, um.ubah, um.approve, um.batalapprove, um.bataltransaksi, um.cetak
     FROM usermenu um
     JOIN menu m ON m.idmenu = um.idmenu
     WHERE um.iduser = ? AND m.kodemenu = ? AND um.status = 'AKTIF'
     LIMIT 1`,
    [ctx.iduser, kodemenu]
  );

  const access = normalizeAccess(row);
  return { allowed: hasAnyAccess(access), ...access };
}

function requireAccess(kodemenu, field = 'hakakses') {
  return async (req, res, next) => {
    try {
      const access = await getMenuAccess(kodemenu);
      const granted = field === 'hakakses' ? access.allowed : Number(access[field] || 0) === 1;
      if (!granted) {
        return res.status(403).json({ message: 'Tidak memiliki hak akses' });
      }
      req.menuAccess = access;
      next();
    } catch (err) {
      next(err);
    }
  };
}

function requireApproveWhenRequested(kodemenu) {
  return async (req, res, next) => {
    try {
      const wantsApprove = req.body?.approve === true || req.body?.status === 'APPROVED';
      if (!wantsApprove) return next();
      const access = await getMenuAccess(kodemenu);
      if (!access.allowed || Number(access.approve || 0) !== 1) {
        return res.status(403).json({ message: 'Tidak memiliki hak akses approve' });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = {
  ACCESS_FIELDS,
  fullAccess,
  normalizeAccess,
  hasAnyAccess,
  getMenuAccess,
  requireAccess,
  requireApproveWhenRequested,
};
