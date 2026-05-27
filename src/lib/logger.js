// Library untuk pencatatan error, history aktivitas, dan capture log transaksi/master.
// Error disimpan sebagai JSON Lines harian. Capture log disimpan sebagai file JSON
// per tenant/per tanggal dan direferensikan di tabel historyprogram.

const fs = require('fs');
const path = require('path');
const { pool, getTenantContext } = require('../config/db');

const LOG_DIR = path.join(__dirname, '..', '..', 'logs');
const CAPTURE_DIR = path.join(LOG_DIR, 'capture');
const HISTORY_ACTIONS = new Set(['SIMPAN', 'EDIT', 'HAPUS', 'BATAL', 'APPROVE', 'BATAL APPROVE']);
const HISTORY_TYPES = new Set(['REGISTER']);
const HISTORY_TYPE_PREFIXES = ['IMPORT_', 'SUBSCRIPTION_', 'BT_'];

function shouldCaptureHistory(jenistransaksi, aksi) {
  const jenis = String(jenistransaksi || '').toUpperCase();
  if (HISTORY_ACTIONS.has(aksi)) return true;
  if (HISTORY_TYPES.has(jenis)) return true;
  if (jenis === 'IMPORT' || jenis === 'SUBSCRIPTION' || jenis === 'BT') return true;
  if (jenis.includes('SUBSCRIPTION')) return true;
  return HISTORY_TYPE_PREFIXES.some((prefix) => jenis.startsWith(prefix));
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatDate(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function getLogFilePath(date) {
  return path.join(LOG_DIR, `error-${formatDate(date)}.json`);
}

function sanitizeFilePart(value, fallback = 'NA') {
  const text = String(value || fallback).trim() || fallback;
  return text
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .substring(0, 50);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function uniqueFilePath(dir, baseName) {
  let fileName = `${baseName}.json`;
  let filePath = path.join(dir, fileName);
  let counter = 1;
  while (fs.existsSync(filePath)) {
    fileName = `${baseName}_${counter}.json`;
    filePath = path.join(dir, fileName);
    counter += 1;
  }
  return { filePath, fileName };
}

function redact(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);
  const hiddenKeys = new Set(['password', 'pass', 'newpassword', 'oldpassword', 'token', 'authorization']);
  return Object.fromEntries(Object.entries(value).map(([key, val]) => {
    if (hiddenKeys.has(String(key).toLowerCase())) return [key, '[REDACTED]'];
    return [key, redact(val)];
  }));
}

function pickFirstObject(...values) {
  for (const value of values) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  }
  return {};
}

function extractKodetrans(data = {}, context = {}) {
  const source = pickFirstObject(context, data, data.header, data.master, data.transaksi);
  const keys = [
    'kodetrans', 'kode', 'ref',
    'kodejual', 'kodebeli', 'kodepo', 'kodebpb', 'kodebpk', 'kodeso',
    'kodereturjual', 'kodereturbeli', 'kodekas', 'kodepelunasan',
    'kodetransferstok', 'kodesaldostok', 'kodestockopname', 'kodeproduksi',
    'kodebarang', 'kodecustomer', 'kodesupplier', 'kodeakun', 'kodelokasi',
    'kodeuser', 'username', 'kodediskon', 'kodehargalevel', 'kodeaset',
    'kodekaryawan', 'kodeanggaran', 'kodeclosing',
  ];
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== '') return String(source[key]);
  }
  if (context.req?.params?.id) return String(context.req.params.id);
  return '-';
}

function extractIdtrans(data = {}, context = {}) {
  const source = pickFirstObject(context, data, data.header, data.master, data.transaksi);
  const keys = [
    'idtrans', 'id', 'idjual', 'idbeli', 'idpo', 'idbpb', 'idbpk', 'idso',
    'idreturjual', 'idreturbeli', 'idkas', 'idpelunasan', 'idtransferstok',
    'idsaldoawal', 'idstockopname', 'idproduksi', 'idbarang', 'idcustomer',
    'idsupplier', 'idakun', 'idlokasi', 'iduser', 'idiskon', 'idhargalevel',
    'idaset', 'idkaryawan', 'idanggaran',
  ];
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== '') return source[key];
  }
  if (context.req?.params?.id) return context.req.params.id;
  return null;
}

function normalizeAction(action) {
  const raw = String(action || '').toUpperCase();
  if (raw.includes('UNAPPROVE') || raw.includes('BATAL_APPROVE')) return 'BATAL APPROVE';
  if (raw.includes('APPROVE') || raw.includes('FINALIZE') || raw.includes('POSTING')) return 'APPROVE';
  if (raw.includes('CANCEL') || raw.includes('BATAL') || raw.includes('DELETE') || raw.includes('REMOVE')) return raw.includes('DELETE') || raw.includes('REMOVE') ? 'HAPUS' : 'BATAL';
  if (raw.includes('UPDATE') || raw.includes('EDIT') || raw.includes('UBAH')) return 'EDIT';
  if (raw.includes('CREATE') || raw.includes('INSERT') || raw.includes('SAVE') || raw.includes('SIMPAN') || raw.includes('GENERATE')) return 'SIMPAN';
  return raw || 'AKSI';
}

function normalizeJenisTransaksi(action, context = {}) {
  if (context.jenistransaksi) return String(context.jenistransaksi).toUpperCase();
  const raw = String(action || '').toUpperCase();
  const suffixes = [
    '_BATAL_APPROVE', '_UNAPPROVE', '_APPROVE', '_FINALIZE', '_POSTING', '_UNPOST',
    '_CREATE', '_UPDATE', '_DELETE', '_REMOVE', '_CANCEL', '_BATAL', '_GENERATE',
    '_SYNC_REALISASI', '_RESET_PASSWORD',
  ];
  let result = raw;
  for (const suffix of suffixes) {
    if (result.endsWith(suffix)) {
      result = result.slice(0, -suffix.length);
      break;
    }
  }
  return result || 'UMUM';
}

function getRouteConfig(req) {
  const routePath = (req.originalUrl || req.url || '').split('?')[0];
  const clean = routePath.replace(/\/+$/, '');
  const method = String(req.method || '').toUpperCase();
  const segments = clean.split('/').filter(Boolean);
  const apiName = segments[1] || '';
  const last = segments[segments.length - 1] || '';

  const masterMap = {
    user: 'USER',
    lokasi: 'LOKASI',
    barang: 'BARANG',
    customer: 'CUSTOMER',
    supplier: 'SUPPLIER',
    akun: 'AKUN',
    poin: 'POIN',
    diskon: 'PROMO',
    'harga-level': 'HARGA_LEVEL',
    menu: 'MENU',
  };

  const transactionMap = {
    jual: 'JUAL',
    returjual: 'RETURJUAL',
    'sales-order': 'SO',
    'bpk-jual': 'BPK',
    beli: 'BELI',
    returbeli: 'RETURBELI',
    'purchase-order': 'PO',
    bpb: 'BPB',
    kas: 'KAS',
    pelunasanpiutang: 'PELUNASAN_PIUTANG',
    pelunasanhutang: 'PELUNASAN_HUTANG',
    pos: 'POS',
    stok: 'STOK',
    'transfer-stok': 'TRANSFERSTOK',
    'stock-opname': 'STOCKOPNAME',
    produksi: 'PRODUKSI',
    'hitunghpp': 'HPP',
    anggaran: 'ANGGARAN',
  };

  let jenistransaksi = masterMap[apiName] || transactionMap[apiName];
  if (!jenistransaksi) return null;

  let aksi = null;
  if (last === 'approve' || last === 'finalize' || last === 'posting') aksi = 'APPROVE';
  else if (last === 'unapprove' || last === 'unpost') aksi = 'BATAL APPROVE';
  else if (last === 'cancel' || last === 'batal') aksi = 'BATAL';
  else if (method === 'DELETE') aksi = masterMap[apiName] ? 'HAPUS' : 'BATAL';
  else if (method === 'POST') aksi = 'SIMPAN';
  else if (method === 'PUT' || method === 'PATCH') aksi = 'EDIT';

  if (!aksi) return null;

  if (apiName === 'pos' && segments[2] === 'transaksi') jenistransaksi = 'POS';
  if (apiName === 'stok' && segments[2] === 'saldoawal') jenistransaksi = 'SALDOAWAL';
  if (apiName === 'stok' && segments[2] === 'penyesuaian') jenistransaksi = 'PENYESUAIANSTOK';
  if (apiName === 'user' && segments[2] === 'template') jenistransaksi = 'MENU_TEMPLATE';
  if (apiName === 'akun' && segments[2] === 'setting-jurnal') jenistransaksi = 'SETTING_JURNAL';

  return { jenistransaksi, aksi };
}

async function resolveUsername(context = {}) {
  const req = context.req;
  if (context.userentry) return String(context.userentry).toUpperCase();
  if (req?.user?.username) return String(req.user.username).toUpperCase();
  if (req?.body?.userentry) return String(req.body.userentry).toUpperCase();
  if (context.detail?.username) return String(context.detail.username).toUpperCase();

  const idtenant = context.idtenant || getTenantContext()?.idtenant || req?.user?.idtenant || null;
  const iduser = context.iduser || getTenantContext()?.iduser || req?.user?.iduser || null;
  if (!idtenant || !iduser) return iduser ? String(iduser) : 'SYSTEM';

  try {
    const [[user]] = await pool.query(
      'SELECT username FROM user WHERE idtenant = ? AND iduser = ? LIMIT 1',
      [idtenant, iduser]
    );
    return user?.username ? String(user.username).toUpperCase() : String(iduser);
  } catch (_) {
    return String(iduser);
  }
}

function relativeCaptureName(idtenant, dateText, fileName) {
  return path.join(String(idtenant || 'global'), dateText, fileName).replace(/\\/g, '/');
}

async function captureLog(kodetrans, data, jenistransaksi, aksi, context = {}) {
  const req = context.req;
  const tenantCtx = getTenantContext();
  const now = new Date();
  const dateText = formatDate(now);
  const idtenant = context.idtenant || tenantCtx?.idtenant || req?.user?.idtenant || data?.idtenant || 'global';
  const normalizedJenis = String(jenistransaksi || normalizeJenisTransaksi(aksi, context)).toUpperCase();
  const normalizedAksi = normalizeAction(aksi);
  if (!shouldCaptureHistory(normalizedJenis, normalizedAksi)) return null;
  const userentry = await resolveUsername(context);
  const kode = kodetrans || extractKodetrans(data, context);
  const idtrans = context.idtrans || extractIdtrans(data, context);

  const dir = path.join(CAPTURE_DIR, String(idtenant || 'global'), dateText);
  ensureDir(dir);

  const baseName = [
    sanitizeFilePart(normalizedJenis),
    sanitizeFilePart(normalizedAksi),
    sanitizeFilePart(userentry),
    sanitizeFilePart(kode),
  ].join('_');
  const { filePath, fileName } = uniqueFilePath(dir, baseName);
  const namafile = relativeCaptureName(idtenant, dateText, fileName);

  const entry = {
    idtenant,
    idtrans,
    kodetrans: kode,
    jenistransaksi: normalizedJenis,
    aksi: normalizedAksi,
    namafile,
    userentry,
    tglentry: now.toISOString(),
    request: req ? {
      method: req.method,
      path: req.originalUrl || req.url || null,
      params: redact(req.params || {}),
      query: redact(req.query || {}),
      body: redact(req.body || {}),
      ip: req.ip || req.socket?.remoteAddress || null,
      useragent: req.headers?.['user-agent'] || null,
    } : null,
    data: redact(data || {}),
  };

  try {
    fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf-8');
  } catch (writeErr) {
    console.error('[logger] Failed to write capture log:', writeErr.message);
  }

  try {
    await pool.query(
      `INSERT INTO historyprogram (idtrans, kodetrans, jenistransaksi, aksi, namafile, userentry, tglentry)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [idtrans || null, kode || null, normalizedJenis, normalizedAksi, namafile, userentry, now]
    );
    if (req) req._captureLogWritten = true;
  } catch (dbErr) {
    console.error('[logger] Failed to write history:', dbErr.message);
  }

  return entry;
}

function captureLogMiddleware() {
  return (req, res, next) => {
    const routeConfig = getRouteConfig(req);
    if (!routeConfig) return next();

    const originalJson = res.json.bind(res);
    res.json = (body) => {
      req._captureLogResponse = body;
      return originalJson(body);
    };

    res.on('finish', () => {
      if (req._captureLogWritten || res.statusCode >= 400) return;
      const pending = req._captureLogHistory || {};
      const responseData = pickFirstObject(req._captureLogResponse);
      const data = {
        ...responseData,
        ...pickFirstObject(req.body),
        ...pickFirstObject(pending.data),
        idtrans: extractIdtrans(responseData, {}) || req.params?.id || pending.context?.idtrans || null,
        kodetrans: extractKodetrans(req.body || {}, { req }),
        params: req.params || {},
        body: req.body || {},
        response: req._captureLogResponse || null,
      };
      const captureContext = {
        ...(pending.context || {}),
        req,
        idtrans: data.idtrans,
      };
      captureLog(
        pending.kodetrans || data.kodetrans,
        data,
        pending.jenistransaksi || routeConfig.jenistransaksi,
        pending.aksi || routeConfig.aksi,
        captureContext
      ).catch((err) => console.error('[logger] Failed to capture route log:', err.message));
    });

    next();
  };
}

function cleanOldLogs(retentionDays = 30) {
  if (!fs.existsSync(LOG_DIR)) return;
  const files = fs.readdirSync(LOG_DIR);
  const now = new Date();
  let deleted = 0;
  for (const f of files) {
    const match = f.match(/^error-(\d{4})-(\d{2})-(\d{2})\.json$/);
    if (!match) continue;
    const fileDate = new Date(`${match[1]}-${match[2]}-${match[3]}`);
    const diffDays = Math.floor((now - fileDate) / (1000 * 60 * 60 * 24));
    if (diffDays > retentionDays) {
      try {
        fs.unlinkSync(path.join(LOG_DIR, f));
        deleted++;
      } catch (_) {}
    }
  }
  if (deleted > 0) console.log(`[logger] Cleaned ${deleted} old log files`);
}

async function error(err, context = {}) {
  const { req, idtenant, iduser, path: reqPath, method } = context;
  const tenantCtx = getTenantContext();

  const entry = {
    ts: new Date().toISOString(),
    level: 'error',
    name: err?.name || null,
    message: err?.message || String(err),
    stack: err?.stack || null,
    code: err?.code || null,
    errno: err?.errno || null,
    sqlState: err?.sqlState || null,
    sqlMessage: err?.sqlMessage || null,
    statusCode: err?.statusCode || err?.status || null,
    idtenant: idtenant || tenantCtx?.idtenant || req?.user?.idtenant || null,
    idlokasi: context.idlokasi || tenantCtx?.idlokasi || req?.user?.idlokasi || null,
    iduser: iduser || tenantCtx?.iduser || req?.user?.iduser || null,
    path: reqPath || req?.originalUrl || req?.url || null,
    method: method || req?.method || null,
    request: req ? {
      params: redact(req.params || {}),
      query: redact(req.query || {}),
      body: redact(req.body || {}),
      ip: req.ip || req.socket?.remoteAddress || null,
      useragent: req.headers?.['user-agent'] || null,
    } : null,
  };

  try {
    ensureDir(LOG_DIR);
    fs.appendFileSync(getLogFilePath(), JSON.stringify(entry) + '\n', 'utf-8');
  } catch (writeErr) {
    console.error('[logger] Failed to write error log:', writeErr.message);
  }
}

async function history(action, context = {}) {
  const data = {
    action,
    ref: context.ref || null,
    detail: context.detail || null,
    idtenant: context.idtenant || null,
    idlokasi: context.idlokasi || null,
    iduser: context.iduser || null,
  };
  const jenistransaksi = normalizeJenisTransaksi(action, context);
  const aksi = normalizeAction(action);
  if (!shouldCaptureHistory(jenistransaksi, aksi)) return null;
  if (context.req && getRouteConfig(context.req)) {
    context.req._captureLogHistory = {
      kodetrans: context.ref || null,
      data,
      jenistransaksi,
      aksi,
      context,
    };
    return null;
  }
  return captureLog(context.ref, data, jenistransaksi, aksi, context);
}

function getCaptureFilePath(namafile) {
  const safeRelative = String(namafile || '').replace(/^[/\\]+/, '');
  const resolved = path.resolve(CAPTURE_DIR, safeRelative);
  const base = path.resolve(CAPTURE_DIR);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;
  return resolved;
}

module.exports = {
  error,
  history,
  captureLog,
  captureLogMiddleware,
  cleanOldLogs,
  getCaptureFilePath,
};
