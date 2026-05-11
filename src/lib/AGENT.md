# AGENT.md — src/lib

## Overview

Modul library utilities yang digunakan bersama oleh semua controller. Berisi tiga library utama: generator kode transaksi, logging/audit trail, dan helper kalkulasi stok.

## File

```
src/lib/
├── kodetrans.js    # Generator kode transaksi otomatis
├── logger.js       # Error logging (file) + audit trail (database)
└── stokhelper.js   # Helper kalkulasi stok per barang per lokasi
```

---

## `kodetrans.js` — Generator Kode Transaksi

### Format Kode

| Jenis          | Format                      | Contoh               |
|---------------|-----------------------------|----------------------|
| Transaksi      | `PREFIX.KODELOKASI.YYMMDD.NNN` | `JL.A01.250510.001` |
| Master Data    | `PREFIXNNNN`                 | `BRG0001`            |
| Closing        | `CL.KODELOKASI.YYMM.NNN`   | `CL.A01.2505.001`   |
| HPP            | `HPP.KODELOKASI.YYYYMM.NNN` | `HPP.A01.202505.001` |

### Prefix per Jenis Transaksi

| Prefix | Jenis Transaksi          | Tabel            | Kolom              |
|--------|--------------------------|------------------|--------------------|
| `JL`   | Penjualan                | `jual`           | `kodejual`         |
| `BL`   | Pembelian                | `beli`           | `kodebeli`         |
| `RJ`   | Retur Jual               | `returjual`      | `kodereturjual`    |
| `TB`   | Tukar Barang             | `tukarbarang`    | `kodetukarbarang`  |
| `PS`   | Penyesuaian Stok         | `penyesuaianstok`| `kodepenyesuaianstok` |
| `KS`   | Kas Masuk/Keluar         | `kas`            | `kodekas`          |
| `SS`   | Saldo Stok               | `saldostok`      | `kodesaldostok`    |
| `CL`   | Closing                  | `closing`        | `kodeclosing`      |
| `HPP`  | Hitung HPP               | `hitunghpp`      | `kodehitunghpp`    |
| `PP`   | Pelunasan Piutang        | `pelunasanpiutang`| `kodepelunasan`  |
| `PH`   | Pelunasan Hutang         | `pelunasanhutang`| `kodepelunasan`   |
| `BRG`  | Barang (master)          | `barang`         | `kodebarang`       |

### Fungsi yang Diekspor

```js
generateKode(conn, prefix, idtenant, idlokasi, table, column)  // Generic
generateKodeMaster(conn, prefix, idtenant, table, column, pad) // Master data (tanpa lokasi/tgl)
generateKodeJual(conn, idtenant, idlokasi)
generateKodeBeli(conn, idtenant, idlokasi)
generateKodeReturJual(conn, idtenant, idlokasi)
generateKodeTukarBarang(conn, idtenant, idlokasi)
generateKodePenyesuaian(conn, idtenant, idlokasi)
generateKodeKas(conn, idtenant, idlokasi)
generateKodeSaldoStok(conn, idtenant, idlokasi)
generateKodeClosing(conn, idtenant, idlokasi)
generateKodeHitungHPP(conn, idtenant, idlokasi, periodbulan)  // periodbulan: 'YYYY-MM'
generateKodePelunasanPiutang(conn, idtenant, idlokasi)
generateKodePelunasanHutang(conn, idtenant, idlokasi)
```

### Rules Penggunaan

1. Semua fungsi menerima `conn` (koneksi individual dari `getConnection()`) bukan `pool`
2. Fungsi ini menggunakan `LOCK TABLES ... WRITE` + `UNLOCK TABLES` untuk mencegah race condition — wajib dipanggil di dalam transaksi aktif dengan koneksi yang sama
3. Jangan panggil dari luar blok `conn.beginTransaction()` — urutan lock/unlock harus terjaga
4. Nomor di-reset per hari (YYMMDD) — setiap hari mulai dari `.001` lagi
5. Penomoran bersifat **per tenant per lokasi per hari** — bukan global

### Contoh Penggunaan

```js
const { generateKodeJual } = require('../lib/kodetrans');

const conn = await getConnection();
try {
  await conn.beginTransaction();
  const kodejual = await generateKodeJual(conn, ctx.idtenant, ctx.idlokasi);
  // kodejual: "JL.A01.250510.001"
  await conn.commit();
} finally {
  conn.release();
}
```

---

## `logger.js` — Error Logging & Audit Trail

### Fungsi yang Diekspor

```js
logger.error(err, context)            // Log error ke file JSON harian
logger.history(action, context)       // Catat aktivitas user ke DB
logger.cleanOldLogs(retentionDays)    // Hapus log lama (default: 30 hari)
```

### `logger.error(err, { req, idtenant, iduser, path, method })`

Menulis entry JSON ke file `logs/error-YYYY-MM-DD.json`:

```json
{
  "ts": "2025-05-10T10:30:00.000Z",
  "level": "error",
  "message": "Error message",
  "stack": "Error: ...\n    at ...",
  "idtenant": 1,
  "iduser": 5,
  "path": "/api/jual",
  "method": "POST"
}
```

Jika `req` disertakan, `path` dan `method` diambil otomatis dari `req.originalUrl` dan `req.method`.

### `logger.history(action, { idtenant, idlokasi, iduser, ref, detail, req })`

Insert ke tabel `historyprogram`:

| Parameter  | Keterangan                                  |
|-----------|---------------------------------------------|
| `action`  | Jenis aksi: `LOGIN`, `REGISTER`, `USER_CREATE`, dll |
| `ref`     | Referensi (contoh: username, kode transaksi) |
| `detail`  | Object detail — disimpan sebagai JSON string |
| `req`     | Request object — dipakai untuk ambil IP dan user-agent |

### `logger.cleanOldLogs(retentionDays = 30)`

Dipanggil sekali saat server startup di `src/index.js`. Menghapus file log yang lebih tua dari 30 hari.

### Rules Penggunaan

1. Setiap `catch` block di controller **wajib** memanggil `logger.error(err, { req })`
2. `logger.history()` dipanggil untuk aksi penting: login, register, perubahan password, reset password
3. `cleanOldLogs()` dipanggil hanya di startup — tidak perlu dipanggil per request

---

## `stokhelper.js` — Helper Kalkulasi Stok

### Fungsi

```js
getStok(idbarang, idlokasi, tgl)
// Returns: number (jumlah stok), 0 jika tidak ada data
```

### Logika Kalkulasi

Stok dihitung sebagai:

```
stok = saldo_stok_terakhir_sebelum_tgl + SUM(mutasi_kartustok_setelah_saldo_s.d._tgl)
```

Menggunakan dua tabel:
- `saldostok` / `saldostokdtl` — snapshot stok pada tanggal tertentu (checkpoint)
- `kartustok` — semua mutasi stok (masuk/keluar) per transaksi

Jika belum ada `saldostok`, mutasi dihitung dari tanggal `1900-01-01`.

### Tabel Sumber Data Stok

| Tabel          | Isi                                         | Jenis `jml` |
|---------------|---------------------------------------------|-------------|
| `saldostokdtl` | Saldo awal/checkpoint per barang per lokasi | Positif     |
| `kartustok`    | Mutasi: masuk (`M`) atau keluar (`K`)       | Positif (M) / Negatif (K) |

### Rules

1. `tgl` harus format `YYYY-MM-DD`
2. Fungsi ini membaca data **tanpa filter tenant** — query menggunakan `idlokasi` dan `idbarang` sebagai kunci. Pastikan `idlokasi` dan `idbarang` sudah tervalidasi ke tenant yang benar sebelum memanggil fungsi ini
3. Nilai stok negatif **bisa terjadi** jika data tidak konsisten — handle di caller
