/**
 * Controller untuk menu navigasi berdasarkan hak akses user.
 * Endpoint: GET /api/menu/my
 */
const { pool, getTenantContext } = require('../../config/db');
const logger = require('../../lib/logger');
const { hasAnyAccess, normalizeAccess } = require('../../lib/access');

// GET /api/menu/all — Mengambil semua menu (untuk user management)
exports.getAll = async (req, res) => {
  try {
    const [menus] = await pool.query(
      "SELECT * FROM menu WHERE kodemenu <> 'pos.shift' ORDER BY urutan ASC"
    );
    function buildTree(items, parentId = null) {
      return items
        .filter(item => item.idparent === parentId)
        .map(item => ({
          ...item,
          children: buildTree(items, item.idmenu),
        }));
    }
    const tree = buildTree(menus);
    res.json(tree);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /api/menu/my — Mengambil menu dalam bentuk tree sesuai user yang sedang login
exports.myMenu = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const iduser = ctx.iduser;

    const [[user]] = await pool.query(
      'SELECT isowner FROM user WHERE iduser = ? AND idtenant = ?',
      [iduser, ctx.idtenant]
    );

    const [allMenus] = await pool.query("SELECT * FROM menu WHERE kodemenu <> 'pos.shift' ORDER BY urutan ASC");
    let menus = allMenus;
    if (!user || Number(user.isowner) !== 1) {
      const [accessRows] = await pool.query(
        `SELECT m.idmenu, m.idparent, um.hakakses, um.tambah, um.ubah, um.approve, um.batalapprove, um.bataltransaksi, um.cetak
         FROM menu m
         JOIN usermenu um ON m.idmenu = um.idmenu AND um.iduser = ?
         WHERE um.status = 'AKTIF'`,
        [iduser]
      );
      const allowedIds = new Set();
      const byId = new Map(allMenus.map((m) => [m.idmenu, m]));
      for (const row of accessRows) {
        if (!hasAnyAccess(normalizeAccess(row))) continue;
        let current = row;
        while (current) {
          allowedIds.add(current.idmenu);
          current = current.idparent ? byId.get(current.idparent) : null;
        }
      }
      menus = allMenus.filter((m) => allowedIds.has(m.idmenu));
    }

    // Fungsi rekursif membangun struktur tree menu (parent-child)
    function buildTree(items, parentId = null) {
      return items
        .filter(item => item.idparent === parentId)
        .map(item => ({
          ...item,
          children: buildTree(items, item.idmenu),
        }));
    }

    const tree = buildTree(menus);
    res.json(tree);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};
