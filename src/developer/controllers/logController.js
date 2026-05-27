const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', '..', '..', 'logs');

function getErrorLogPath(fileName) {
  const safe = path.basename(String(fileName || ''));
  if (!/^error-\d{4}-\d{2}-\d{2}\.json$/.test(safe)) return null;
  const resolved = path.resolve(LOG_DIR, safe);
  const base = path.resolve(LOG_DIR);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;
  return resolved;
}

exports.errorLog = async (req, res) => {
  try {
    const { date, search, page = 1 } = req.query;
    const perPage = 100;
    const currentPage = Math.max(1, parseInt(page));

    let files = [];
    if (fs.existsSync(LOG_DIR)) {
      files = fs.readdirSync(LOG_DIR)
        .filter(f => f.startsWith('error-') && f.endsWith('.json'))
        .sort()
        .reverse();
    }

    let selectedFile = null;
    let lines = [];
    let totalLines = 0;

    if (date) {
      selectedFile = `error-${date}.json`;
    } else if (files.length > 0) {
      selectedFile = files[0];
    }

    const selectedPath = selectedFile ? getErrorLogPath(selectedFile) : null;
    if (selectedPath && fs.existsSync(selectedPath)) {
      const content = fs.readFileSync(selectedPath, 'utf-8');
      lines = content.trim().split('\n').filter(l => l.trim())
        .map(l => {
          try { return JSON.parse(l); } catch (_) { return { raw: l, level: 'unknown', ts: null, message: l }; }
        })
        .reverse();

      if (search) {
        const q = search.toLowerCase();
        lines = lines.filter(l => JSON.stringify(l).toLowerCase().includes(q));
      }

      totalLines = lines.length;
      const start = (currentPage - 1) * perPage;
      lines = lines.slice(start, start + perPage);
    }

    const totalPages = Math.ceil(totalLines / perPage);

    const selectedDate = selectedFile ? selectedFile.replace(/^error-/, '').replace('.json', '') : null;

    res.render('layout', { view: 'log-error',
      title: 'Log Error',
      active: 'logs-error',
      files,
      selectedFile,
      selectedDate,
      lines,
      currentPage,
      totalPages,
      totalLines,
      search: search || '',
      date: date || selectedDate || '',
      deleted: req.query.deleted || null,
      error: req.query.error || null
    });
  } catch (err) {
    res.render('layout', { view: 'log-error',
      title: 'Log Error',
      active: 'logs-error',
      files: [],
      selectedFile: null,
      selectedDate: null,
      lines: [],
      currentPage: 1,
      totalPages: 0,
      totalLines: 0,
      search: '',
      date: '',
      deleted: null,
      error: err.message
    });
  }
};

exports.downloadLog = async (req, res) => {
  try {
    const { file } = req.query;
    const filePath = getErrorLogPath(`error-${file}.json`);
    if (!filePath) return res.status(400).send('File tidak valid');
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('File not found');
    }
    res.download(filePath);
  } catch (err) {
    res.status(500).send(err.message);
  }
};

exports.deleteLog = (req, res) => {
  try {
    const { file } = req.body;
    if (!file) return res.redirect('/developer/logs/error?error=File+tidak+ditentukan');
    const safe = path.basename(file);
    const filePath = getErrorLogPath(safe);
    if (!filePath) {
      return res.redirect('/developer/logs/error?error=File+tidak+valid');
    }
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.redirect('/developer/logs/error?deleted=1');
  } catch (err) {
    res.redirect('/developer/logs/error?error=' + encodeURIComponent(err.message));
  }
};
