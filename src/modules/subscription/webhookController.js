const https = require('https');
const http = require('http');
const { URL } = require('url');
const { tenantQuery, tenantExecute, getConnection, getTenantContext, pool } = require('../../config/db');
const logger = require('../../lib/logger');

const VALID_EVENTS = [
  'JUAL_APPROVED', 'BELI_APPROVED', 'JUAL_CANCELLED', 'BELI_CANCELLED',
  'STOK_KRITIS', 'POIN_DITAMBAH', 'PAYROLL_APPROVED',
];

exports.getAll = async (req, res) => {
  try {
    const rows = await tenantQuery('SELECT * FROM webhook_config ORDER BY tglentry DESC');
    res.json(rows.map(r => ({ ...r, events: JSON.parse(r.events || '[]') })));
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

exports.create = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    const { namawebhook, url, events, secret } = req.body;
    if (!namawebhook || !url || !events) return res.status(400).json({ message: 'namawebhook, url, events wajib diisi' });
    try { new URL(url); } catch { return res.status(400).json({ message: 'URL tidak valid' }); }
    if (!Array.isArray(events) || events.length === 0) return res.status(400).json({ message: 'events harus berupa array' });
    const invalidEvents = events.filter(e => !VALID_EVENTS.includes(e));
    if (invalidEvents.length) return res.status(400).json({ message: `Event tidak valid: ${invalidEvents.join(', ')}. Valid: ${VALID_EVENTS.join(', ')}` });

    await conn.beginTransaction();
    const [result] = await conn.query(
      'INSERT INTO webhook_config (idtenant, namawebhook, url, events, secret, status, userentry) VALUES (?, ?, ?, ?, ?, "AKTIF", ?)',
      [ctx.idtenant, namawebhook, url, JSON.stringify(events), secret || null, ctx.iduser]
    );
    await conn.commit();
    res.status(201).json({ message: 'Webhook berhasil disimpan', idwebhook: result.insertId });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.update = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    const { namawebhook, url, events, secret, status } = req.body;
    const [[row]] = await conn.query('SELECT * FROM webhook_config WHERE idwebhook = ? AND idtenant = ?', [req.params.id, ctx.idtenant]);
    if (!row) return res.status(404).json({ message: 'Webhook tidak ditemukan' });
    if (url) { try { new URL(url); } catch { return res.status(400).json({ message: 'URL tidak valid' }); } }
    if (events) {
      const invalidEvents = events.filter(e => !VALID_EVENTS.includes(e));
      if (invalidEvents.length) return res.status(400).json({ message: `Event tidak valid: ${invalidEvents.join(', ')}` });
    }
    await conn.query(
      'UPDATE webhook_config SET namawebhook = ?, url = ?, events = ?, secret = ?, status = ? WHERE idwebhook = ?',
      [namawebhook || row.namawebhook, url || row.url, events ? JSON.stringify(events) : row.events,
       secret !== undefined ? secret : row.secret, status || row.status, req.params.id]
    );
    res.json({ message: 'Webhook diperbarui' });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.remove = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    const [[row]] = await conn.query('SELECT idwebhook FROM webhook_config WHERE idwebhook = ? AND idtenant = ?', [req.params.id, ctx.idtenant]);
    if (!row) return res.status(404).json({ message: 'Webhook tidak ditemukan' });
    await conn.query('DELETE FROM webhook_log WHERE idwebhook = ?', [req.params.id]);
    await conn.query('DELETE FROM webhook_config WHERE idwebhook = ?', [req.params.id]);
    res.json({ message: 'Webhook dihapus' });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.getLogs = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const [[webhook]] = await pool.query('SELECT idwebhook FROM webhook_config WHERE idwebhook = ? AND idtenant = ?', [req.params.id, ctx.idtenant]);
    if (!webhook) return res.status(404).json({ message: 'Webhook tidak ditemukan' });
    const [logs] = await pool.query(
      'SELECT * FROM webhook_log WHERE idwebhook = ? ORDER BY tglentry DESC LIMIT 100',
      [req.params.id]
    );
    res.json(logs);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

exports.test = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const [[webhook]] = await pool.query('SELECT * FROM webhook_config WHERE idwebhook = ? AND idtenant = ?', [req.params.id, ctx.idtenant]);
    if (!webhook) return res.status(404).json({ message: 'Webhook tidak ditemukan' });
    const testPayload = { event: 'TEST', idtenant: ctx.idtenant, timestamp: new Date().toISOString(), message: 'Test webhook dari Grfyn POS' };
    await dispatchToUrl(webhook, 'TEST', testPayload);
    res.json({ message: 'Test payload terkirim', url: webhook.url });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

function dispatchToUrl(webhook, event, payload) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    let parsedUrl;
    try { parsedUrl = new URL(webhook.url); } catch { return resolve({ error: 'Invalid URL' }); }

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-Webhook-Event': event,
        'X-Webhook-Secret': webhook.secret || '',
      },
    };

    const requester = parsedUrl.protocol === 'https:' ? https : http;
    const startTime = Date.now();

    const reqHttp = requester.request(options, (httpRes) => {
      let responseBody = '';
      httpRes.on('data', chunk => { responseBody += chunk; });
      httpRes.on('end', () => {
        pool.query(
          'INSERT INTO webhook_log (idwebhook, idtenant, event, payload, status_code, response) VALUES (?, ?, ?, ?, ?, ?)',
          [webhook.idwebhook, webhook.idtenant, event, body, httpRes.statusCode, responseBody.slice(0, 1000)]
        ).catch(() => {});
        resolve({ status_code: httpRes.statusCode });
      });
    });

    reqHttp.setTimeout(5000, () => {
      reqHttp.destroy();
      pool.query(
        'INSERT INTO webhook_log (idwebhook, idtenant, event, payload, error_message) VALUES (?, ?, ?, ?, ?)',
        [webhook.idwebhook, webhook.idtenant, event, body, 'Timeout setelah 5 detik']
      ).catch(() => {});
      resolve({ error: 'timeout' });
    });

    reqHttp.on('error', (err) => {
      pool.query(
        'INSERT INTO webhook_log (idwebhook, idtenant, event, payload, error_message) VALUES (?, ?, ?, ?, ?)',
        [webhook.idwebhook, webhook.idtenant, event, body, err.message]
      ).catch(() => {});
      resolve({ error: err.message });
    });

    reqHttp.write(body);
    reqHttp.end();
  });
}

async function dispatch(event, payload, idtenant) {
  try {
    const [webhooks] = await pool.query(
      "SELECT * FROM webhook_config WHERE idtenant = ? AND status = 'AKTIF' AND events LIKE ?",
      [idtenant, `%${event}%`]
    );
    for (const webhook of webhooks) {
      dispatchToUrl(webhook, event, { event, idtenant, timestamp: new Date().toISOString(), data: payload }).catch(() => {});
    }
  } catch (err) {
    logger.error(err, { context: 'webhook.dispatch' });
  }
}

module.exports = { ...exports, dispatch };
