/**
 * Controller untuk kartu hutang (utang ke supplier).
 * Endpoint: GET /api/kartuhutang, GET .../summary/:idsupplier, GET .../open/:idsupplier, GET .../open-invoices/:idsupplier
 */
const { tenantQuery, getConnection, getTenantContext } = require('../config/db');
const logger = require('../lib/logger');

// GET /api/kartuhutang — Menampilkan semua riwayat hutang dengan filter opsional
exports.getAll = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { idsupplier, status, tglwal, tglakhir } = req.query;
    let sql = `SELECT kh.*, s.namasupplier FROM kartuhutang kh LEFT JOIN supplier s ON kh.idsupplier = s.idsupplier AND s.idtenant = kh.idtenant WHERE 1=1`;
    const params = [];
    sql += ' AND kh.idtenant = ?'; params.push(ctx.idtenant);
    sql += ' AND kh.idlokasi = ?'; params.push(ctx.idlokasi);
    if (idsupplier) { sql += ' AND kh.idsupplier = ?'; params.push(idsupplier); }
    if (status) { sql += ' AND kh.status = ?'; params.push(status); }
    if (tglwal) { sql += ' AND kh.tgltrans >= ?'; params.push(tglwal); }
    if (tglakhir) { sql += ' AND kh.tgltrans <= ?'; params.push(tglakhir); }
    sql += ' ORDER BY kh.tgltrans DESC, kh.idkartuhutang DESC';
    const rows = await tenantQuery(sql, params);
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /api/kartuhutang/summary/:idsupplier — Ringkasan total hutang, retur, bayar, dan sisa per supplier
exports.getSummary = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { idsupplier } = req.params;
    let sql = `SELECT
        COALESCE(SUM(CASE WHEN jenis = 'BELI' THEN amount ELSE 0 END), 0) as total_hutang,
        COALESCE(SUM(CASE WHEN jenis = 'RETUR' THEN ABS(amount) ELSE 0 END), 0) as total_retur,
        COALESCE(SUM(terbayar), 0) as total_terbayar,
        COALESCE(SUM(sisa), 0) as sisa
      FROM kartuhutang WHERE idsupplier = ? AND idlokasi = ? AND jenis = 'BELI'`;
    const [rows] = await tenantQuery(sql, [idsupplier, ctx.idlokasi]);
    const summary = rows[0] || { total_hutang: 0, total_retur: 0, total_terbayar: 0, sisa: 0 };
    res.json(summary);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /api/kartuhutang/open/:idsupplier — Menampilkan invoice pembelian yang masih OPEN (belum lunas)
exports.getOpen = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { idsupplier } = req.params;
    let sql2 = `SELECT kh.*, s.namasupplier FROM kartuhutang kh LEFT JOIN supplier s ON kh.idsupplier = s.idsupplier AND s.idtenant = kh.idtenant WHERE kh.idsupplier = ? AND kh.status = 'OPEN' AND kh.jenis = 'BELI' AND kh.idlokasi = ? ORDER BY kh.tgltrans ASC`;
    const rows = await tenantQuery(sql2, [idsupplier, ctx.idlokasi]);
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /api/kartuhutang/open-invoices/:idsupplier — Mendapatkan semua invoice pembelian yang belum lunas untuk pelunasan hutang
exports.getOpenInvoices = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { idsupplier } = req.params;
    let sql = `SELECT
                kh.kodetrans,
                kh.tgltrans,
                kh.idsupplier,
                s.namasupplier,
                kh.amount as original_amount,
                kh.terbayar,
                kh.sisa,
                kh.status
              FROM kartuhutang kh
              LEFT JOIN supplier s ON kh.idsupplier = s.idsupplier AND s.idtenant = kh.idtenant
              WHERE kh.idsupplier = ? AND kh.idtenant = ? AND kh.idlokasi = ?
                AND kh.jenis = 'BELI'
                AND kh.status = 'OPEN'
                AND kh.sisa > 0
              ORDER BY kh.tgltrans ASC`;
    const rows = await tenantQuery(sql, [idsupplier, ctx.idtenant, ctx.idlokasi]);
    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};