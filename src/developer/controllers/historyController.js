const fs = require('fs');
const { pool } = require('../../config/db');
const logger = require('../../lib/logger');

const HISTORY_FILTER = `(
  h.aksi IN ('SIMPAN', 'EDIT', 'HAPUS', 'BATAL', 'APPROVE', 'BATAL APPROVE')
  OR h.jenistransaksi = 'REGISTER'
  OR h.jenistransaksi = 'IMPORT'
  OR h.jenistransaksi LIKE 'IMPORT\\_%'
  OR h.jenistransaksi = 'SUBSCRIPTION'
  OR h.jenistransaksi LIKE 'SUBSCRIPTION\\_%'
  OR h.jenistransaksi LIKE '%SUBSCRIPTION%'
  OR h.jenistransaksi = 'BT'
  OR h.jenistransaksi LIKE 'BT\\_%'
)`;

exports.historyLog = async (req, res) => {
  try {
    const { tglwal, tglakhir, jenistransaksi, aksi, userentry, search, page = 1 } = req.query;
    const perPage = 50;
    const currentPage = Math.max(1, parseInt(page, 10) || 1);
    const offset = (currentPage - 1) * perPage;

    let whereClause = `WHERE ${HISTORY_FILTER}`;
    const params = [];

    if (tglwal) { whereClause += ' AND DATE(h.tglentry) >= ?'; params.push(tglwal); }
    if (tglakhir) { whereClause += ' AND DATE(h.tglentry) <= ?'; params.push(tglakhir); }
    if (jenistransaksi) { whereClause += ' AND h.jenistransaksi = ?'; params.push(jenistransaksi); }
    if (aksi) { whereClause += ' AND h.aksi = ?'; params.push(aksi); }
    if (userentry) { whereClause += ' AND h.userentry LIKE ?'; params.push(`%${userentry}%`); }
    if (search) {
      whereClause += ' AND (h.kodetrans LIKE ? OR h.jenistransaksi LIKE ? OR h.aksi LIKE ? OR h.namafile LIKE ? OR h.userentry LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    const [[{ cnt }]] = await pool.query(
      `SELECT COUNT(*) as cnt FROM historyprogram h ${whereClause}`,
      params
    );

    const [rows] = await pool.query(
      `SELECT h.*, u.username AS username_userentry
       FROM historyprogram h
       LEFT JOIN user u
         ON u.username = h.userentry
         OR (CAST(u.iduser AS CHAR) = h.userentry AND u.idtenant = (
           SELECT CAST(SUBSTRING_INDEX(h.namafile, '/', 1) AS UNSIGNED)
         ))
       ${whereClause}
       ORDER BY h.tglentry DESC LIMIT ${perPage} OFFSET ${offset}`,
      params
    );

    for (const row of rows) {
      row.display_userentry = row.username_userentry || row.userentry || '-';
      if (row.username_userentry || !row.namafile) continue;
      try {
        const filePath = logger.getCaptureFilePath(row.namafile);
        if (!filePath || !fs.existsSync(filePath)) continue;
        const capture = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const idtenant = capture.idtenant || capture.data?.idtenant || null;
        const iduser = capture.data?.iduser || capture.request?.body?.iduser || null;
        if (!idtenant || !iduser) continue;
        const [[user]] = await pool.query(
          'SELECT username FROM user WHERE idtenant = ? AND iduser = ? LIMIT 1',
          [idtenant, iduser]
        );
        if (user?.username) row.display_userentry = String(user.username).toUpperCase();
      } catch (_) {}
    }

    const totalPages = Math.ceil(cnt / perPage);

    const [jenisRows] = await pool.query(
      `SELECT DISTINCT jenistransaksi FROM historyprogram
       WHERE ${HISTORY_FILTER.replaceAll('h.', '')}
       ORDER BY jenistransaksi`
    );
    const [aksiRows] = await pool.query(
      `SELECT DISTINCT aksi FROM historyprogram
       WHERE ${HISTORY_FILTER.replaceAll('h.', '')}
       ORDER BY aksi`
    );

    res.render('layout', {
      view: 'log-history',
      title: 'Log History Program',
      active: 'logs-history',
      rows,
      currentPage,
      totalPages,
      totalRows: cnt,
      jenisList: jenisRows.map(row => row.jenistransaksi),
      aksiList: aksiRows.map(row => row.aksi),
      filters: {
        tglwal: tglwal || '',
        tglakhir: tglakhir || '',
        jenistransaksi: jenistransaksi || '',
        aksi: aksi || '',
        userentry: userentry || '',
        search: search || '',
      },
    });
  } catch (err) {
    res.render('layout', {
      view: 'log-history',
      title: 'Log History Program',
      active: 'logs-history',
      rows: [],
      currentPage: 1,
      totalPages: 0,
      totalRows: 0,
      jenisList: [],
      aksiList: [],
      filters: { tglwal: '', tglakhir: '', jenistransaksi: '', aksi: '', userentry: '', search: '' },
      error: err.message,
    });
  }
};

exports.viewCapture = async (req, res) => {
  try {
    const filePath = logger.getCaptureFilePath(req.query.file);
    if (!filePath || !fs.existsSync(filePath)) return res.status(404).send('File not found');
    let json = null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    try {
      json = JSON.parse(raw);
    } catch (_) {
      json = { raw };
    }
    res.render('layout', {
      view: 'log-history-detail',
      title: 'Detail Log History',
      active: 'logs-history',
      fileName: req.query.file,
      jsonText: JSON.stringify(json, null, 2),
    });
  } catch (err) {
    res.status(500).send(err.message);
  }
};
