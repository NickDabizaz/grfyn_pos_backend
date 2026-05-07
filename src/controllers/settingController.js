const { tenantQuery, tenantExecute, getTenantContext } = require('../config/db');
const logger = require('../lib/logger');

exports.updateToko = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { namatenant, alamat, hp, email, ppn } = req.body;
    await tenantExecute('UPDATE tenant SET namatenant = ?, alamat = ?, hp = ?, email = ?, ppn = ? WHERE idtenant = ?',
      [namatenant, alamat, hp, email, (ppn !== undefined && ppn !== null) ? ppn : 11, ctx.idtenant]);
    res.json({ message: 'Setting berhasil diupdate' });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

exports.updateLogo = async (req, res) => {
  try {
    const ctx = getTenantContext();
    if (!req.file) return res.status(400).json({ message: 'File tidak ditemukan' });
    const logoPath = `/uploads/${req.file.filename}`;
    await tenantExecute('UPDATE tenant SET logo = ? WHERE idtenant = ?', [logoPath, ctx.idtenant]);
    res.json({ message: 'Logo berhasil diupdate', logo: logoPath });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};
