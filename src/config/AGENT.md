# AGENT.md — src/config

## Overview

Modul konfigurasi database dan multi-tenancy. Menyediakan koneksi MySQL via connection pool dan sistem isolasi tenant berbasis **Continuation-Local Storage (CLS)**.

## File

```
src/config/
└── db.js    # MySQL pool + tenant namespace CLS + query wrapper
```

## Fungsi yang Diekspor (`db.js`)

| Fungsi / Export        | Tipe     | Keterangan                                                                 |
|-----------------------|----------|----------------------------------------------------------------------------|
| `pool`                | object   | MySQL connection pool (mysql2/promise), limit 10 koneksi                  |
| `initTenantNamespace` | function | Inisialisasi CLS namespace `grfyn_tenant` — dipanggil sekali di startup   |
| `getNamespace`        | function | Mendapatkan CLS namespace aktif (re-export dari cls-hooked)               |
| `getTenantContext`    | function | Membaca `{idtenant, idlokasi, iduser}` dari CLS namespace aktif           |
| `tenantQuery`         | function | SELECT dengan auto-inject `WHERE idtenant = ?`                             |
| `tenantExecute`       | function | INSERT/UPDATE/DELETE dengan validasi wajib ada kolom `idtenant`           |
| `getConnection`       | function | Ambil satu koneksi dari pool (untuk transaksi manual)                     |
| `TENANT_NS`           | string   | Konstanta nama namespace: `'grfyn_tenant'`                                |

## Cara Kerja Multi-Tenancy

### Alur per Request

```
1. src/index.js: ns.run(() => next())     ← Buat konteks CLS baru per request
2. middleware/auth.js: ns.set('idtenant', decoded.idtenant)  ← Set tenant ke CLS
3. controller: tenantQuery(sql, params)    ← Query otomatis filter per tenant
```

### `tenantQuery(sql, params)`

Untuk query SELECT, secara otomatis menambahkan `WHERE idtenant = ?` jika:
- Query adalah `SELECT` (bukan INSERT/UPDATE/DELETE)
- Query belum mengandung kata `idtenant`

Logika injeksi WHERE:
- Jika ada `WHERE` → ubah jadi `WHERE idtenant = ? AND ...`
- Jika ada `GROUP BY`/`ORDER BY`/`LIMIT`/dll tapi tidak ada `WHERE` → sisipkan `WHERE idtenant = ?` sebelum klausa tersebut
- Jika tidak ada klausa apapun → tambahkan `WHERE idtenant = ?` di akhir

```js
// Contoh:
await tenantQuery('SELECT * FROM barang', [])
// Diubah menjadi: SELECT * FROM barang WHERE idtenant = ?
// Dengan params: [idtenant]
```

### `tenantExecute(sql, params)`

Untuk INSERT/UPDATE/DELETE, **memvalidasi** bahwa kolom `idtenant` disertakan dalam query. Melempar error `MISSING_TENANT` jika tidak ada.

```js
// Benar:
await tenantExecute('INSERT INTO barang (idtenant, namabarang) VALUES (?, ?)', [idtenant, nama])

// Salah (akan throw error):
await tenantExecute('INSERT INTO barang (namabarang) VALUES (?)', [nama])
```

### `getConnection()`

Mengembalikan koneksi dari pool untuk digunakan dalam transaksi manual. Wajib di-`release()` di blok `finally`.

```js
const conn = await getConnection();
try {
  await conn.beginTransaction();
  // ... operasi ...
  await conn.commit();
} catch (err) {
  await conn.rollback();
} finally {
  conn.release();
}
```

## Rules & Constraints

1. **`initTenantNamespace()`** harus dipanggil **sebelum** semua middleware di `src/index.js`
2. **Setiap request** harus berjalan dalam `ns.run(() => next())` agar CLS berfungsi
3. **Semua query SELECT** gunakan `tenantQuery()` — jangan `pool.query()` langsung (kecuali query global seperti di auth yang belum ada tenant context)
4. **Semua mutasi data** gunakan `tenantExecute()` — wajib sertakan `idtenant` di query
5. **Transaksi multi-step** gunakan `getConnection()` bukan `tenantQuery/tenantExecute` — koneksi pool tidak menjaga state transaksi antar pemanggilan
6. Jika `idtenant` tidak tersedia di CLS saat `tenantQuery/tenantExecute` dipanggil, akan throw `TENANT_NOT_FOUND`

## Konfigurasi Database (Environment Variables)

```
DB_HOST    — MySQL host (default: localhost)
DB_USER    — MySQL user (default: root)
DB_PASS    — MySQL password (default: kosong)
DB_NAME    — Nama database (default: grfyn_pos)
DB_PORT    — MySQL port (default: 3306)
```

Pool limit: **10 koneksi**, queue unlimited.
