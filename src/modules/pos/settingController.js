/**
 * Controller untuk pengaturan toko (nama, alamat, kontak, PPN) dan logo.
 * Endpoint: PUT /api/setting/toko, PUT /api/setting/logo
 */
const { pool, tenantExecute, getTenantContext } = require('../../config/db');
const { getConfigValue, setConfigValue } = require('../../lib/confighelper');
const logger = require('../../lib/logger');
const { getTenantUploadUrl, removeUploadFile } = require('../../lib/uploadPaths');

function upperOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  return String(value).toUpperCase();
}

// GET /api/setting/toko - Membaca data toko dan konfigurasi global tenant
exports.getToko = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const [[tenant]] = await pool.query(
      'SELECT namatenant, alamat, hp, email, ppn, logo FROM tenant WHERE idtenant = ?',
      [ctx.idtenant]
    );

    if (!tenant) return res.status(404).json({ message: 'Tenant tidak ditemukan' });

    const cekminus = await getConfigValue(pool, ctx.idtenant, 'GLOBAL', 'CEKMINUS');
    const pakaibahanbaku = await getConfigValue(pool, ctx.idtenant, 'BARANG', 'PAKAIBAHANBAKU');
    const pakaiPPN = await getConfigValue(pool, ctx.idtenant, 'GLOBAL', 'PAKAIPPN');
    res.json({
      ...tenant,
      namatenant: upperOrNull(tenant.namatenant) || '',
      alamat: upperOrNull(tenant.alamat),
      cekminus: String(cekminus || 'TIDAK').toUpperCase(),
      pakaibahanbaku: String(pakaibahanbaku || 'YA').toUpperCase(),
      pakaiPPN: String(pakaiPPN || 'YA').toUpperCase(),
    });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// PUT /api/setting/toko — Memperbarui data toko (nama, alamat, HP, email, PPN)
exports.updateToko = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { namatenant, alamat, hp, email, ppn, cekminus, pakaibahanbaku, pakaiPPN } = req.body;
    let sql = 'UPDATE tenant SET namatenant = ?, alamat = ?, hp = ?, email = ?, ppn = ? WHERE idtenant = ?';
    // PPN default 11 jika tidak dikirim
    await tenantExecute(sql, [
      upperOrNull(namatenant) || '',
      upperOrNull(alamat),
      hp,
      email,
      (ppn !== undefined && ppn !== null) ? ppn : 11,
      ctx.idtenant,
    ]);
    await setConfigValue(pool, ctx.idtenant, 'GLOBAL', 'CEKMINUS', cekminus === true || cekminus === 'YA' ? 'YA' : 'TIDAK', 1);
    await setConfigValue(pool, ctx.idtenant, 'BARANG', 'PAKAIBAHANBAKU', pakaibahanbaku === false || pakaibahanbaku === 'TIDAK' ? 'TIDAK' : 'YA', 1);
    await setConfigValue(pool, ctx.idtenant, 'GLOBAL', 'PAKAIPPN', pakaiPPN === false || pakaiPPN === 'TIDAK' ? 'TIDAK' : 'YA', 1);
    res.json({ message: 'Setting berhasil diupdate' });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// PUT /api/setting/logo — Mengunggah dan memperbarui logo toko
exports.updateLogo = async (req, res) => {
  try {
    const ctx = getTenantContext();
    if (!req.file) return res.status(400).json({ message: 'File tidak ditemukan' });
    const [[tenant]] = await pool.query(
      'SELECT logo FROM tenant WHERE idtenant = ?',
      [ctx.idtenant]
    );
    const logoPath = getTenantUploadUrl(ctx.idtenant, 'logo', req.file.filename);
    let sql = 'UPDATE tenant SET logo = ? WHERE idtenant = ?';
    await tenantExecute(sql, [logoPath, ctx.idtenant]);
    if (tenant?.logo && tenant.logo !== logoPath) removeUploadFile(tenant.logo);
    res.json({ message: 'Logo berhasil diupdate', logo: logoPath });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};
