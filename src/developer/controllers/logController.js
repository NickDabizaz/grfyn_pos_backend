const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', '..', '..', 'logs');

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

    if (selectedFile && fs.existsSync(path.join(LOG_DIR, selectedFile))) {
      const content = fs.readFileSync(path.join(LOG_DIR, selectedFile), 'utf-8');
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
    const filePath = path.join(LOG_DIR, `${file}.json`);
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
    if (!safe.startsWith('error-') || !safe.endsWith('.json')) {
      return res.redirect('/developer/logs/error?error=File+tidak+valid');
    }
    const filePath = path.join(LOG_DIR, safe);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.redirect('/developer/logs/error?deleted=1');
  } catch (err) {
    res.redirect('/developer/logs/error?error=' + encodeURIComponent(err.message));
  }
};
