# AGENT.md — src/developer

## Overview

Developer Portal adalah web interface berbasis **EJS + session** yang terpisah dari API utama. Digunakan oleh developer/admin sistem untuk monitoring, debugging, manajemen log, dan inspeksi database. Berjalan di path `/developer`.

## Struktur

```
src/developer/
├── index.js              # Router utama developer portal
├── middleware/
│   └── devAuth.js        # Session-based authentication (terpisah dari JWT API)
├── controllers/
│   ├── authController.js      # Login/logout developer portal
│   ├── dashboardController.js # Halaman dashboard sistem
│   ├── logController.js       # Viewer log error
│   ├── historyController.js   # Viewer audit trail
│   ├── dbHealthController.js  # Status database
│   ├── systemController.js    # Info sistem & daftar API
│   ├── tenantController.js    # Manajemen tenant
│   ├── dbConsoleController.js # SQL query executor
│   └── maintenanceController.js # Maintenance tasks
└── views/
    ├── layout.ejs         # Template layout utama (wrap semua halaman)
    ├── login.ejs          # Halaman login
    ├── dashboard.ejs      # Dashboard utama
    ├── log-error.ejs      # Viewer log error
    ├── log-history.ejs    # Viewer audit trail
    ├── db-health.ejs      # Status database
    ├── db-console.ejs     # SQL query executor UI
    ├── system.ejs         # Info sistem
    ├── maintenance.ejs    # Halaman maintenance
    └── tenants.ejs        # Daftar tenant
```

## Aktivasi

Developer portal aktif secara default. Untuk menonaktifkan:

```env
DEVELOPER_PORTAL_ENABLED=false
```

## Autentikasi

Developer portal menggunakan **session-based authentication** yang **terpisah** dari JWT API:

- Session secret: env `DEV_PORTAL_SECRET` (default: `'grfyn_dev_portal_secret'`)
- Session berlaku **1 jam** (`maxAge: 60 * 60 * 1000`)
- Login password: env `DEV_PORTAL_PASSWORD`
- Rate limiting login: **5 percobaan per 15 menit**

### Middleware `devAuth.js`

Memeriksa `req.session.authenticated`. Jika tidak ada, redirect ke `/developer/login`.
Diterapkan ke semua route kecuali `/login` dan `/logout`.

## Routes & Halaman

| Route | Method | Handler | Keterangan |
|-------|--------|---------|------------|
| `/developer/login` | GET | `authController.loginPage` | Halaman form login |
| `/developer/login` | POST | `authController.login` | Proses login + rate limit |
| `/developer/logout` | GET | `authController.logout` | Destroy session |
| `/developer/` | GET | `dashboardController.index` | Dashboard ringkasan sistem |
| `/developer/logs/error` | GET | `logController.errorLog` | Viewer log error harian |
| `/developer/logs/error/download` | GET | `logController.downloadLog` | Download file log |
| `/developer/logs/error/delete` | POST | `logController.deleteLog` | Hapus file log |
| `/developer/logs/history` | GET | `historyController.historyLog` | Audit trail dari DB |
| `/developer/database` | GET | `dbHealthController.index` | Status pool & koneksi DB |
| `/developer/database/processlist` | GET | `dbHealthController.processList` | MySQL SHOW PROCESSLIST |
| `/developer/system` | GET | `systemController.index` | Info sistem (Node, env, uptime) |
| `/developer/system/api` | GET | `systemController.api` | Daftar semua API endpoint |
| `/developer/tenants` | GET | `tenantController.index` | Daftar semua tenant |
| `/developer/db-console` | GET | `dbConsoleController.index` | UI SQL console |
| `/developer/db-console` | POST | `dbConsoleController.execute` | Eksekusi query SQL |
| `/developer/maintenance` | GET | `maintenanceController.index` | Halaman maintenance |
| `/developer/maintenance/clear-logs` | POST | `maintenanceController.clearOldLogs` | Hapus log lama |

## Penjelasan Controller

### `authController.js`
- `loginPage` — Render form login
- `login` — Validasi password via `DEV_PORTAL_PASSWORD`, set `req.session.authenticated = true`
- `logout` — Destroy session, redirect ke `/developer/login`

### `dashboardController.js`
- `index` — Tampilkan ringkasan: jumlah tenant, koneksi DB aktif, uptime, versi Node.js

### `logController.js`
- `errorLog` — Baca file `logs/error-YYYY-MM-DD.json`, tampilkan per baris (JSON Lines)
- `downloadLog` — Download file log sebagai attachment
- `deleteLog` — Hapus file log yang dipilih

### `historyController.js`
- `historyLog` — Query tabel `historyprogram` dengan filter opsional (tenant, action, tanggal)

### `dbHealthController.js`
- `index` — Status pool MySQL (total koneksi, active, idle)
- `processList` — Eksekusi `SHOW PROCESSLIST` untuk melihat query aktif

### `systemController.js`
- `index` — Tampilkan info sistem: versi Node.js, platform, uptime, env vars non-sensitif
- `api` — List semua registered route dari aplikasi Express

### `tenantController.js`
- `index` — Query tabel `tenant`, tampilkan semua tenant yang terdaftar

### `dbConsoleController.js`
- `index` — Render halaman SQL console
- `execute` — Eksekusi query SQL bebas terhadap database

> ⚠️ **PERINGATAN KEAMANAN**: `dbConsoleController` dapat mengeksekusi query SQL apapun. Pastikan developer portal hanya dapat diakses di environment development atau di-protect dengan network-level access control di production.

### `maintenanceController.js`
- `index` — Tampilkan status log (berapa file, total ukuran)
- `clearOldLogs` — Panggil `logger.cleanOldLogs()` secara manual

## View Engine

Developer portal menggunakan **EJS** sebagai template engine. Semua view wrapping menggunakan `layout.ejs` via EJS include.

View path didaftarkan di `src/index.js`:
```js
app.set('views', [
  path.join(__dirname, '..', 'reports'),         // Untuk laporan API
  path.join(__dirname, 'developer', 'views')     // Untuk developer portal
]);
```

## Rules & Keamanan

1. Developer portal **HARUS dinonaktifkan** di production publik (`DEVELOPER_PORTAL_ENABLED=false`) atau di-protect via reverse proxy (basic auth, IP whitelist)
2. Password developer portal **WAJIB** diset via env `DEV_PORTAL_PASSWORD` yang kuat
3. `DEV_PORTAL_SECRET` session secret **WAJIB** diganti dari nilai default
4. `dbConsoleController` dapat mengeksekusi query destruktif (DROP, DELETE) — akses ke halaman ini harus sangat terbatas
5. Developer portal menggunakan session terpisah dari API — perubahan password JWT tidak mempengaruhi session developer portal
6. Jangan tambahkan route developer portal yang mengekspos data tenant ke luar tanpa autentikasi tambahan
