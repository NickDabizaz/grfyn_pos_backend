# AGENT.md — src/middleware

## Overview

Modul middleware aplikasi. Berisi middleware autentikasi JWT yang digunakan oleh hampir semua route API.

## File

```
src/middleware/
└── auth.js    # JWT authentication + tenant context injection
```

## `auth.js` — JWT Authentication Middleware

### Fungsi

Middleware Express yang:
1. Membaca JWT token dari request
2. Memvalidasi token
3. Mengecek status user dan token version di database
4. Menyimpan konteks tenant ke CLS namespace
5. Menyimpan data user ke `req.user`

### Cara Penggunaan

```js
const auth = require('../middleware/auth');

// Di file route:
router.get('/', auth, ctrl.getAll);
router.post('/', auth, ctrl.create);
```

### Sumber Token

Token dibaca dari dua sumber (prioritas dari atas):
1. **Header `Authorization`**: format `Bearer <token>`
2. **Query string**: `?token=<token>` (digunakan untuk akses laporan/PDF di browser)

### Validasi yang Dilakukan

| Langkah | Validasi | Response jika gagal |
|---------|----------|---------------------|
| 1 | Token ditemukan | `401 Token tidak ditemukan` |
| 2 | JWT valid (signature + expiry) | `401 Token tidak valid atau kadaluarsa` |
| 3 | User ditemukan di DB (`iduser` + `idtenant` match) | `401 Akun tidak aktif` |
| 4 | `user.status === 'AKTIF'` | `401 Akun tidak aktif` |
| 5 | `user.tokenversion === decoded.tokenversion` | `401 Sesi tidak valid. Silakan login ulang.` |

### Token Version Check

`tokenversion` di database diincrement ketika:
- User mengganti password (`PUT /auth/password`)
- Admin reset password user (`PUT /user/:id/reset-password`)

Mekanisme ini memastikan semua sesi aktif di perangkat lain **langsung tidak valid** setelah password diubah.

### Data yang Tersedia Setelah Auth

Setelah middleware berjalan, controller bisa mengakses:

```js
req.user = {
  iduser      : number,
  idtenant    : number,
  idlokasi    : number,
  kodelokasi  : string,
  namalokasi  : string,
  tokenversion: number,
}
```

Dan lewat `getTenantContext()` dari `config/db.js`:

```js
const ctx = getTenantContext();
ctx.idtenant  // number
ctx.idlokasi  // number
ctx.iduser    // number
```

### JWT Payload Structure

```json
{
  "iduser": 1,
  "idtenant": 1,
  "idlokasi": 2,
  "kodelokasi": "A01",
  "namalokasi": "Toko Pusat",
  "tokenversion": 3,
  "iat": 1715000000,
  "exp": 1715007200
}
```

Token berlaku **2 jam** (`expiresIn: '2h'`).

### Routes yang TIDAK Menggunakan Auth

```
POST /api/auth/login          ← Login publik
POST /api/auth/register       ← Registrasi tenant baru
POST /api/auth/select-location ← Pilih lokasi setelah login
```

Semua endpoint lain **wajib** melalui middleware `auth`.

## Rules

1. Middleware `auth` harus ditempatkan sebagai argumen kedua di setiap route yang butuh autentikasi
2. Jangan gunakan `pool.query()` di dalam auth middleware untuk query lain selain validasi user — gunakan raw pool karena CLS belum penuh terisi
3. Middleware ini **tidak** memvalidasi akses menu/permission — validasi menu dilakukan di controller masing-masing jika diperlukan
4. Token disimpan di frontend (localStorage/sessionStorage) dan dikirim setiap request
