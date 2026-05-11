# AGENT.md — Grfyn POS Backend (Root)

## Overview

Grfyn POS Backend adalah REST API untuk sistem Point-of-Sale (POS) multi-tenant berbasis **Node.js + Express + MySQL**. Sistem ini dirancang untuk bisnis retail yang memerlukan manajemen inventori, penjualan, pembelian, dan keuangan dengan dukungan multi-cabang (multi-lokasi) per tenant.

## Tech Stack

| Komponen       | Teknologi                        |
|---------------|----------------------------------|
| Runtime       | Node.js (Express 4.x)            |
| Database      | MySQL (mysql2/promise)           |
| Auth          | JWT (jsonwebtoken)               |
| Multi-tenancy | cls-hooked (CLS Namespace)       |
| Password      | bcryptjs (10 salt rounds)        |
| File Upload   | multer                           |
| Templating    | EJS (laporan & developer portal) |
| Rate Limiting | express-rate-limit               |

## Struktur Direktori

```
grfyn_pos_backend/
├── src/
│   ├── index.js                # Entry point server
│   ├── config/
│   │   └── db.js               # MySQL pool + multi-tenant CLS
│   ├── middleware/
│   │   └── auth.js             # JWT authentication middleware
│   ├── lib/
│   │   ├── kodetrans.js        # Generator kode transaksi otomatis
│   │   ├── logger.js           # Error logging + audit trail
│   │   └── stokhelper.js       # Helper kalkulasi stok
│   ├── controllers/            # 23 controller (business logic)
│   ├── routes/                 # 23 route module (API endpoints)
│   └── developer/              # Developer portal (web UI admin)
│       ├── index.js            # Developer router
│       ├── middleware/
│       │   └── devAuth.js      # Session auth dev portal
│       ├── controllers/        # 8 dev controllers
│       └── views/              # EJS templates dev portal
├── reports/                    # EJS templates laporan cetak
├── uploads/                    # File upload user (logo, dll)
├── logs/                       # Error logs JSON harian
├── docs/                       # Dokumentasi konsep bisnis
├── migrate.js                  # Script migrasi database (create/reset schema)
└── package.json
```

## Arsitektur Multi-Tenant

Setiap request dijalankan dalam konteks tenant yang terisolasi:

```
Request → CLS Namespace → JWT Middleware → Controller → tenantQuery/tenantExecute
```

1. **CLS Namespace** dibuat di `src/index.js` via `ns.run()` setiap request
2. **Auth Middleware** (`middleware/auth.js`) membaca JWT, menyimpan `idtenant`, `idlokasi`, `iduser` ke CLS namespace
3. **tenantQuery** otomatis inject `WHERE idtenant = ?` pada semua SELECT
4. **tenantExecute** wajib ada kolom `idtenant` pada INSERT/UPDATE/DELETE

## Entry Point (`src/index.js`)

- Inisialisasi CLS namespace sebelum semua middleware
- Register semua 23 route module di prefix `/api/`
- Setup EJS view engine untuk render laporan HTML
- Static file serving: `/reports` dan `/uploads`
- Health check: `GET /api/health`
- Developer Portal: `GET /developer` (aktif jika `DEVELOPER_PORTAL_ENABLED !== 'false'`)
- Global error handler memanggil `logger.error()`

## Environment Variables (`.env`)

| Variable                   | Default            | Keterangan                         |
|---------------------------|--------------------|------------------------------------|
| `PORT`                     | `5000`             | Port server                        |
| `DB_HOST`                  | `localhost`        | MySQL host                         |
| `DB_USER`                  | `root`             | MySQL user                         |
| `DB_PASS`                  | (kosong)           | MySQL password                     |
| `DB_NAME`                  | `grfyn_pos`        | Nama database                      |
| `DB_PORT`                  | `3306`             | MySQL port                         |
| `JWT_SECRET`               | (wajib diisi)      | Secret key JWT                     |
| `DEVELOPER_PORTAL_ENABLED` | `true`             | Aktifkan developer portal          |
| `DEV_PORTAL_SECRET`        | (default hardcode) | Secret session developer portal    |
| `DEV_PORTAL_PASSWORD`      | (wajib diisi)      | Password login developer portal    |

## NPM Scripts

```bash
npm start           # Jalankan server produksi
npm run dev         # Jalankan dengan nodemon (auto-reload)
npm run migrate     # Buat/reset schema database
```

## Konvensi Kode

- Semua fungsi controller menggunakan `async/await`
- Transaksi database multi-step wajib menggunakan `getConnection()` + `beginTransaction()` / `commit()` / `rollback()` + `conn.release()`
- Semua error di catch block dikirim ke `logger.error(err, { req })`
- Response error menggunakan status code HTTP yang tepat (400, 401, 403, 404, 409, 500)
- Semua endpoint API (kecuali `/auth/login`, `/auth/register`) dilindungi oleh middleware `auth`

## Modul-Modul Utama

| Modul                 | Path                          | Keterangan                              |
|----------------------|-------------------------------|-----------------------------------------|
| Config DB            | `src/config/`                 | Koneksi MySQL + multi-tenant CLS        |
| Middleware Auth      | `src/middleware/`             | JWT validation + tenant context inject  |
| Library Utilities    | `src/lib/`                    | Kode transaksi, logging, stok helper    |
| Controllers          | `src/controllers/`            | Business logic semua fitur              |
| Routes               | `src/routes/`                 | Definisi endpoint API                   |
| Developer Portal     | `src/developer/`              | Web UI admin untuk monitoring & debug   |

Lihat `AGENT.md` di masing-masing subdirektori untuk dokumentasi detail per modul.
