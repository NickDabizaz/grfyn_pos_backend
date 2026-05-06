const { tenantQuery, tenantExecute, getConnection, getTenantContext } = require('../config/db');

exports.getAll = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const rows = await tenantQuery(
      "SELECT * FROM lokasi WHERE idtenant = ? AND status = 'AKTIF' ORDER BY isdefault DESC, idlokasi ASC",
      [ctx.idtenant]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.create = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { kodelokasi, namalokasi, alamat, hp } = req.body;

    await tenantExecute(
      "INSERT INTO lokasi (idtenant, kodelokasi, namalokasi, alamat, hp, isdefault, status, userentry) VALUES (?, ?, ?, ?, ?, 0, 'AKTIF', ?)",
      [ctx.idtenant, kodelokasi, namalokasi, alamat || null, hp || null, ctx.iduser]
    );

    res.status(201).json({ message: 'Lokasi berhasil ditambah' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Kode lokasi sudah digunakan' });
    }
    res.status(500).json({ message: err.message });
  }
};

exports.update = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { namalokasi, alamat, hp, status } = req.body;
    await tenantExecute(
      'UPDATE lokasi SET namalokasi = ?, alamat = ?, hp = ?, status = ? WHERE idlokasi = ? AND idtenant = ?',
      [namalokasi, alamat, hp, status, req.params.id, ctx.idtenant]
    );
    res.json({ message: 'Lokasi berhasil diupdate' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
