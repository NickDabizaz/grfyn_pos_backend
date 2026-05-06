const { pool, getTenantContext } = require('../config/db');

exports.myMenu = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const iduser = ctx.iduser;

    const [menus] = await pool.query(
      `SELECT m.* FROM menu m
       JOIN usermenu um ON m.idmenu = um.idmenu AND um.iduser = ?
       WHERE um.status = 'AKTIF' AND m.status = 'AKTIF'
       ORDER BY m.urutan ASC`,
      [iduser]
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
    res.status(500).json({ message: err.message });
  }
};
