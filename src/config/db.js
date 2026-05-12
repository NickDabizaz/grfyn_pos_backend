/**
 * Konfigurasi koneksi database MySQL dengan multi-tenant support.
 * Menggunakan mysql2/promise untuk async/await dan AsyncLocalStorage (bawaan Node.js)
 * untuk menyimpan konteks tenant (idtenant, idlokasi, iduser) per request.
 *
 * Fungsi utama:
 *   pool          — connection pool MySQL
 *   tenantStorage — AsyncLocalStorage untuk konteks tenant
 *   tenantQuery   — SELECT dengan auto-inject WHERE idtenant = ?
 *   tenantExecute — INSERT/UPDATE/DELETE dengan validasi kolom idtenant
 *   getConnection — mendapatkan koneksi dari pool (untuk transaksi manual)
 */
const mysql = require('mysql2/promise');
const { AsyncLocalStorage } = require('async_hooks');
require('dotenv').config();

// AsyncLocalStorage menggantikan cls-hooked — aman di Node.js >= 12, tidak ada context loss
const tenantStorage = new AsyncLocalStorage();

// Membaca konteks tenant (idtenant, idlokasi, iduser) dari AsyncLocalStorage
function getTenantContext() {
  return tenantStorage.getStore() || { idtenant: null, idlokasi: null, iduser: null };
}

// Pool koneksi MySQL (config dari environment variable)
const pool = mysql.createPool({
  host              : process.env.DB_HOST || 'localhost',
  user              : process.env.DB_USER || 'root',
  password          : process.env.DB_PASS || '',
  database          : process.env.DB_NAME || 'grfyn_pos',
  port              : parseInt(process.env.DB_PORT) || 3306,
  waitForConnections: true,
  connectionLimit   : 10,
  queueLimit        : 0
});

// Inject WHERE idtenant = ? ke query SELECT jika belum ada klausa idtenant
// Mencari kata kunci SQL (WHERE, GROUP BY, ORDER BY, dll) lalu menyisipkan idtenant sebelum kata kunci pertama
function injectTenantWhere(sql, idtenant) {
  const trimmed = sql.trim();
  if (!/^SELECT/i.test(trimmed)) return { sql, injected: false };
  if (/idtenant/i.test(trimmed)) return { sql, injected: false };

  const keywords = /\b(WHERE|GROUP\s+BY|ORDER\s+BY|LIMIT|HAVING|PROCEDURE|INTO\s+OUTFILE|FOR\s+UPDATE|LOCK\s+IN\s+SHARE\s+MODE)\b/i;

  const match = trimmed.match(keywords);
  if (match) {
    const idx = match.index;
    const before = trimmed.substring(0, idx);
    const after = trimmed.substring(idx);
    if (match[1].toUpperCase() === 'WHERE') {
      return { sql: `${before} WHERE idtenant = ? AND ${after.substring(5).trim()}`, injected: true };
    }
    return { sql: `${before} WHERE idtenant = ? ${after}`, injected: true };
  }

  return { sql: `${trimmed} WHERE idtenant = ?`, injected: true };
}

// tenantQuery: untuk query SELECT, otomatis inject WHERE idtenant = ? jika belum ada
async function tenantQuery(sql, params = []) {
  const ctx = getTenantContext();
  if (!ctx.idtenant) throw new Error('TENANT_NOT_FOUND: idtenant tidak tersedia di context');

  if (/^\s*SELECT/i.test(sql.trim())) {
    const { sql: modSql, injected } = injectTenantWhere(sql, ctx.idtenant);
    if (injected) {
      params = [ctx.idtenant, ...params];
    }
    const [rows] = await pool.query(modSql, params);
    return rows;
  }

  const [rows] = await pool.query(sql, params);
  return rows;
}

// tenantExecute: untuk INSERT/UPDATE/DELETE, validasi bahwa kolom idtenant wajib disertakan dalam query
async function tenantExecute(sql, params = []) {
  const ctx = getTenantContext();
  if (!ctx.idtenant) throw new Error('TENANT_NOT_FOUND: idtenant tidak tersedia di context');

  if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql.trim())) {
    if (!/idtenant/i.test(sql)) {
      throw new Error('MISSING_TENANT: INSERT/UPDATE/DELETE wajib menyertakan kolom idtenant');
    }
  }

  const [result] = await pool.query(sql, params);
  return result;
}

// Mendapatkan satu koneksi dari pool (digunakan untuk transaksi dengan beginTransaction/commit/rollback manual)
async function getConnection() {
  return pool.getConnection();
}

// Stub untuk backward-compatibility — AsyncLocalStorage tidak perlu inisialisasi manual
function initTenantNamespace() {}

module.exports = {
  pool,
  tenantStorage,
  tenantQuery,
  tenantExecute,
  getConnection,
  getTenantContext,
  initTenantNamespace,
};
