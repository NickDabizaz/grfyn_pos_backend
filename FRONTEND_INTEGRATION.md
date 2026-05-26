# Frontend Integration Guide — Fitur Baru

Dokumen ini menjelaskan semua endpoint baru yang perlu diintegrasikan oleh frontend.  
Base URL: `{{API_BASE}}/api`  
Auth: semua endpoint (kecuali yang disebut) butuh header `Authorization: Bearer <token>`

---

## Daftar Fitur

1. [Diskon & Promo](#1-diskon--promo)
2. [Multi-Level Harga Jual](#2-multi-level-harga-jual)
3. [Loyalty Points (Poin Member)](#3-loyalty-points-poin-member)
4. [Alert Stok Minimum](#4-alert-stok-minimum)
5. [Upload Foto Barang](#5-upload-foto-barang)
6. [Aset Tetap](#6-aset-tetap)
7. [Anggaran (Budgeting)](#7-anggaran-budgeting)
8. [HR: Cuti Karyawan](#8-hr-cuti-karyawan)
9. [HR: Lembur Karyawan](#9-hr-lembur-karyawan)
10. [Batch/Lot Tracking](#10-batchlot-tracking)
11. [Export Laporan (Excel / PDF)](#11-export-laporan-excel--pdf)
12. [Webhook Outbound](#12-webhook-outbound)
13. [Refresh Token Rotation](#13-refresh-token-rotation)

---

## 1. Diskon & Promo

**Base path:** `/api/diskon`  
**Menu permission:** `penjualan.diskon`

### Halaman yang perlu dibuat
- List diskon dengan filter (nama, status, jenis)
- Form buat/edit diskon
- Penerapan diskon saat transaksi penjualan

### Endpoints

| Method | Path | Keterangan |
|--------|------|-----------|
| GET | `/api/diskon` | List semua diskon |
| GET | `/api/diskon/aktif` | Diskon aktif hari ini (untuk POS) |
| GET | `/api/diskon/:id` | Detail diskon + daftar barang |
| POST | `/api/diskon` | Buat diskon baru |
| PUT | `/api/diskon/:id` | Update diskon |
| DELETE | `/api/diskon/:id` | Hapus diskon |

### Request body — POST/PUT
```json
{
  "namadiskon": "Promo Lebaran",
  "jenis": "PERSEN",
  "nilai": 10,
  "min_pembelian": 100000,
  "max_diskon": 50000,
  "tglawal": "2025-03-01",
  "tglakhir": "2025-04-10",
  "berlaku_semua_barang": false,
  "items": [
    { "idbarang": 1 },
    { "idbarang": 2 }
  ]
}
```

**Jenis diskon yang tersedia:**
- `PERSEN` — diskon persen dari grand total (bisa ada `max_diskon`)
- `NOMINAL` — diskon nominal tetap
- `BELI_X_GRATIS_Y` — isi `nilai_x` (beli X) dan `nilai_y` (gratis Y), berlaku per barang

### Response GET /aktif
```json
[
  {
    "idiskon": 1,
    "kodediskon": "DSK001",
    "namadiskon": "Promo Lebaran",
    "jenis": "PERSEN",
    "nilai": 10,
    "max_diskon": 50000,
    "tglawal": "2025-03-01",
    "tglakhir": "2025-04-10",
    "berlaku_semua_barang": 0,
    "items": [...]
  }
]
```

### Integrasi di form penjualan
1. Saat user memilih barang & total sudah terhitung, panggil `GET /api/diskon/aktif`
2. Tampilkan dropdown pilih diskon
3. Hitung nilai diskon di frontend:
   - `PERSEN`: `Math.min(total * nilai/100, max_diskon || Infinity)`
   - `NOMINAL`: `Math.min(nilai, total)`
4. Kirim `iddiskon` dan `nilai_diskon` ke body saat POST `/api/jual`

---

## 2. Multi-Level Harga Jual

**Base path:** `/api/harga-level`  
**Menu permission:** `master.hargalevel`

### Halaman yang perlu dibuat
- Manajemen level harga (CRUD)
- Assign level ke customer

### Endpoints

| Method | Path | Keterangan |
|--------|------|-----------|
| GET | `/api/harga-level` | List semua level harga |
| GET | `/api/harga-level/:id` | Detail level + semua harga barang |
| GET | `/api/harga-level/barang/:idbarang` | Semua level harga untuk 1 barang |
| POST | `/api/harga-level` | Buat level baru |
| PUT | `/api/harga-level/:id` | Update level |
| DELETE | `/api/harga-level/:id` | Hapus level |
| POST | `/api/harga-level/apply-customer` | Assign level ke customer |

### Request body — POST `/api/harga-level`
```json
{
  "namalevel": "Harga Grosir",
  "deskripsi": "Khusus pembeli grosir min 1 lusin",
  "urutan": 1,
  "items": [
    { "idbarang": 1, "satuan": "PCS", "hargajual": 45000 },
    { "idbarang": 2, "satuan": "PCS", "hargajual": 28000 }
  ]
}
```

### Request body — POST `/api/harga-level/apply-customer`
```json
{
  "idcustomer": 5,
  "idhargajuallevel": 1
}
```
> Kirim `"idhargajuallevel": null` untuk hapus assignment level dari customer.

### Integrasi di form penjualan
1. Saat memilih customer, cek field `idhargajuallevel` dari data customer
2. Jika ada, panggil `GET /api/harga-level/:idhargajuallevel`
3. Gunakan harga dari level tersebut sebagai harga default per barang yang dipilih

---

## 3. Loyalty Points (Poin Member)

**Base path:** `/api/poin`  
**Menu permission:** `master.poin`

### Halaman yang perlu dibuat
- Setting poin (nominal per poin, nilai tukar)
- Daftar customer + saldo poin
- Detail histori poin per customer
- Form tukar poin saat transaksi

### Endpoints

| Method | Path | Keterangan |
|--------|------|-----------|
| GET | `/api/poin/setting` | Ambil konfigurasi poin |
| POST | `/api/poin/setting` | Simpan konfigurasi poin |
| GET | `/api/poin/customer` | Semua customer + saldo poin (`?search=`) |
| GET | `/api/poin/customer/:idcustomer` | Saldo + histori poin customer |
| POST | `/api/poin/tambah` | Tambah/kurangi poin manual |
| POST | `/api/poin/tukar` | Hitung nilai tukar poin (validasi saja) |

### Request body — POST `/api/poin/setting`
```json
{
  "nominal_per_poin": 10000,
  "nilai_tukar_poin": 1000,
  "min_poin_tukar": 10,
  "max_poin_per_transaksi": 50
}
```
> `nominal_per_poin`: setiap belanja Rp 10.000 dapat 1 poin  
> `nilai_tukar_poin`: 1 poin = Rp 1.000 diskon  
> `max_poin_per_transaksi`: maks poin yang bisa ditukar dalam 1 transaksi (null = tidak terbatas)

### Request body — POST `/api/poin/tambah`
```json
{
  "idcustomer": 3,
  "poin": 20,
  "jenis": "KELUAR",
  "keterangan": "Penukaran poin transaksi JL.001",
  "koderef": "JL.A01.250510.001",
  "jenisref": "JUAL"
}
```

### Request body — POST `/api/poin/tukar`
```json
{ "idcustomer": 3, "poin": 20 }
```
Response:
```json
{
  "poin": 20,
  "nilai_tukar": 20000,
  "nilai_tukar_poin": 1000
}
```

### Integrasi di form penjualan / POS
1. Setelah memilih customer, tampilkan saldo poin dari `GET /api/poin/customer/:id`
2. Jika customer mau tukar poin, panggil `POST /api/poin/tukar` untuk hitung nilai diskon
3. Setelah transaksi approve, panggil `POST /api/poin/tambah` (jenis: MASUK) untuk berikan poin dari pembelian
4. Jika poin ditukar, panggil `POST /api/poin/tambah` (jenis: KELUAR)

---

## 4. Alert Stok Minimum

**Endpoint:** `GET /api/stok/alert-stok-min`  
**Menu permission:** `stok.saldoawal` (hakakses)

### Response
```json
[
  {
    "idbarang": 5,
    "kodebarang": "BRG005",
    "namabarang": "Kopi Arabika",
    "satuankecil": "GR",
    "stokmin": 500,
    "stok_sekarang": 120
  }
]
```

### Integrasi di frontend
- Tampilkan badge/notifikasi di sidebar atau dashboard: "X barang stok kritis"
- Buat halaman khusus daftar stok kritis
- Bisa di-poll tiap 5 menit atau saat buka halaman stok

---

## 5. Upload Foto Barang

**Endpoint:** `POST /api/barang/:id/foto`  
**Content-Type:** `multipart/form-data`  
**Field name:** `foto`  
**Max size:** 5 MB  
**Format yang diterima:** jpg, png, webp, gif

### Cara kirim (contoh fetch)
```js
const form = new FormData();
form.append('foto', fileInput.files[0]);

await fetch(`/api/barang/${idbarang}/foto`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
  body: form,
});
```

### Response
```json
{
  "message": "Foto berhasil diupload",
  "foto": "barang-5-1720000000000.jpg",
  "url": "/uploads/barang/barang-5-1720000000000.jpg"
}
```

### Integrasi di form barang
- Field baru `foto` ada di tabel `barang`, nilainya nama file
- Tampilkan foto di form edit barang via `{{API_BASE}}/uploads/barang/{foto}`
- Tombol upload foto di halaman detail/edit barang

---

## 6. Aset Tetap

**Base path:** `/api/aset`  
**Menu permission:** `aset.tetap`

### Halaman yang perlu dibuat
- List aset dengan filter kategori & status
- Form buat/edit aset
- Detail aset + histori penyusutan
- Tombol "Hitung Penyusutan" per aset / bulk

### Endpoints

| Method | Path | Keterangan |
|--------|------|-----------|
| GET | `/api/aset/kategori` | Daftar kategori distinct |
| POST | `/api/aset/hitung-penyusutan-bulk` | Hitung penyusutan semua aset untuk periode |
| GET | `/api/aset` | List aset (`?kategori=&status=`) |
| GET | `/api/aset/:id` | Detail aset + histori penyusutan |
| POST | `/api/aset` | Buat aset baru |
| PUT | `/api/aset/:id` | Update aset |
| DELETE | `/api/aset/:id` | Hapus aset (hanya jika belum ada penyusutan) |
| POST | `/api/aset/:id/hitung-penyusutan` | Hitung penyusutan 1 aset |

### Request body — POST `/api/aset`
```json
{
  "namaaset": "Laptop Operasional",
  "kategori": "PERALATAN",
  "tglbeli": "2024-01-15",
  "nilai_beli": 15000000,
  "umur_ekonomis": 36,
  "metode_penyusutan": "GARIS_LURUS",
  "nilai_sisa": 0,
  "idakun_aset": 12,
  "idakun_penyusutan": 25,
  "idakun_akumulasi": 14
}
```

### Request body — POST `/api/aset/:id/hitung-penyusutan`
```json
{ "periode": "2025-01" }
```

### Request body — POST `/api/aset/hitung-penyusutan-bulk`
```json
{ "periode": "2025-01" }
```
Response:
```json
{ "processed": 5, "skipped": 2, "errors": 0 }
```

---

## 7. Anggaran (Budgeting)

**Base path:** `/api/anggaran`  
**Menu permission:** `keuangan.anggaran`

### Halaman yang perlu dibuat
- List anggaran per tahun
- Form buat anggaran (dengan input per akun per bulan)
- Laporan realisasi vs anggaran

### Endpoints

| Method | Path | Keterangan |
|--------|------|-----------|
| GET | `/api/anggaran` | List anggaran (`?status=&periode=`) |
| GET | `/api/anggaran/:id` | Detail + semua item per bulan |
| GET | `/api/anggaran/:id/realisasi` | Perbandingan anggaran vs realisasi |
| POST | `/api/anggaran/:id/sync-realisasi` | Update nilai realisasi dari jurnal |
| PUT | `/api/anggaran/:id/approve` | Approve anggaran |
| POST | `/api/anggaran` | Buat anggaran |
| PUT | `/api/anggaran/:id` | Update (hanya status DRAFT) |
| DELETE | `/api/anggaran/:id` | Hapus (hanya status DRAFT) |

### Request body — POST `/api/anggaran`
```json
{
  "namaanggaran": "Anggaran Operasional 2025",
  "periode": "2025",
  "tglawal": "2025-01-01",
  "tglakhir": "2025-12-31",
  "items": [
    { "idakun": 45, "bulan": 1, "nilai_anggaran": 5000000 },
    { "idakun": 45, "bulan": 2, "nilai_anggaran": 5000000 },
    { "idakun": 46, "bulan": 1, "nilai_anggaran": 2000000 }
  ]
}
```

### Response GET `/api/anggaran/:id/realisasi`
```json
[
  {
    "idakun": 45,
    "namaakun": "Beban Gaji",
    "bulan": 1,
    "nilai_anggaran": 5000000,
    "nilai_realisasi": 4800000,
    "variance": 200000,
    "persentase": 96
  }
]
```

---

## 8. HR: Cuti Karyawan

**Base path:** `/api/cuti`  
**Menu permission:** `sdm.cuti`

### Halaman yang perlu dibuat
- List pengajuan cuti
- Form ajukan cuti
- Halaman approve/reject
- Saldo cuti per karyawan

### Endpoints

| Method | Path | Keterangan |
|--------|------|-----------|
| GET | `/api/cuti/saldo/:idkaryawan` | Saldo cuti per jenis (tahun berjalan) |
| GET | `/api/cuti` | List cuti (`?idkaryawan=&jeniscuti=&status=&bulan=`) |
| GET | `/api/cuti/:id` | Detail cuti |
| POST | `/api/cuti` | Ajukan cuti |
| PUT | `/api/cuti/:id/approve` | Approve (otomatis insert absensi) |
| PUT | `/api/cuti/:id/reject` | Reject |
| DELETE | `/api/cuti/:id` | Hapus (hanya DRAFT) |

### Request body — POST `/api/cuti`
```json
{
  "idkaryawan": 3,
  "jeniscuti": "TAHUNAN",
  "tglawal": "2025-06-02",
  "tglakhir": "2025-06-04",
  "keterangan": "Keperluan keluarga"
}
```

**Jenis cuti:** `TAHUNAN` | `SAKIT` | `IZIN` | `MELAHIRKAN` | `LAINNYA`

### Response GET `/api/cuti/saldo/:idkaryawan`
```json
{
  "TAHUNAN": 5,
  "SAKIT": 2,
  "IZIN": 1,
  "MELAHIRKAN": 0,
  "LAINNYA": 0
}
```

> Saat approve cuti, sistem **otomatis insert absensi** untuk setiap hari dalam range cuti.

---

## 9. HR: Lembur Karyawan

**Base path:** `/api/lembur`  
**Menu permission:** `sdm.lembur`

### Halaman yang perlu dibuat
- Input lembur harian
- Approve lembur
- Rekap lembur per bulan

### Endpoints

| Method | Path | Keterangan |
|--------|------|-----------|
| GET | `/api/lembur/rekap` | Rekap per karyawan (`?bulan=YYYY-MM`) |
| GET | `/api/lembur` | List lembur (`?idkaryawan=&status=&bulan=`) |
| GET | `/api/lembur/:id` | Detail |
| POST | `/api/lembur` | Input lembur |
| PUT | `/api/lembur/:id/approve` | Approve |
| DELETE | `/api/lembur/:id` | Hapus (hanya DRAFT) |

### Request body — POST `/api/lembur`
```json
{
  "idkaryawan": 3,
  "tgllembur": "2025-06-01",
  "jam_mulai": "17:00",
  "jam_selesai": "20:00",
  "tarif_per_jam": 50000,
  "keterangan": "Lembur closing bulan"
}
```

> `tarif_per_jam` bisa dikosongkan — sistem akan hitung otomatis dari `gajipoko / 173 * 1.5`

### Response GET `/api/lembur/rekap`
```json
[
  {
    "idkaryawan": 3,
    "namakaryawan": "Budi Santoso",
    "total_jam": 12.5,
    "total_bayar": 625000,
    "jumlah_lembur": 4
  }
]
```

---

## 10. Batch/Lot Tracking

**Base path:** `/api/batch-lot`  
**Menu permission:** `stok.batchlot`

### Halaman yang perlu dibuat
- Daftar batch/lot dengan filter produk
- Alert batch hampir kadaluarsa
- Detail batch per produk (FIFO)

### Endpoints

| Method | Path | Keterangan |
|--------|------|-----------|
| GET | `/api/batch-lot/expiring` | Batch hampir kadaluarsa (`?days=30`) |
| GET | `/api/batch-lot/barang/:idbarang` | Semua batch untuk 1 produk (FIFO) |
| GET | `/api/batch-lot` | List semua batch (`?idbarang=&show_expired=true`) |
| GET | `/api/batch-lot/:id` | Detail batch |
| POST | `/api/batch-lot` | Buat batch baru |
| PUT | `/api/batch-lot/:id` | Update qty / tanggal kadaluarsa |

### Request body — POST `/api/batch-lot`
```json
{
  "idbarang": 5,
  "nomorbatch": "BATCH-2025-001",
  "tglproduksi": "2025-01-10",
  "tglkadaluarsa": "2026-01-10",
  "qty_masuk": 100,
  "satuan": "PCS",
  "koderef": "BL.A01.250110.001",
  "jenisref": "BELI"
}
```

### Response GET `/api/batch-lot/expiring`
```json
[
  {
    "idbatch": 3,
    "nomorbatch": "BATCH-2025-001",
    "namabarang": "Susu UHT",
    "qty_sisa": 50,
    "tglkadaluarsa": "2025-07-01",
    "days_to_expire": 5
  }
]
```

---

## 11. Export Laporan (Excel / PDF)

**Base path:** `/api/laporan/export`

Semua endpoint export menerima query param `format=excel` (default) atau `format=pdf`.  
Response adalah file download — gunakan `window.open(url)` atau `<a href="..." download>`.

### Endpoints

| Method | Path | Filter yang tersedia |
|--------|------|---------------------|
| GET | `/api/laporan/export/sales-transaksi` | `tglawal`, `tglakhir`, `idcustomer`, `search`, `format` |
| GET | `/api/laporan/export/sales-per-barang` | `tglawal`, `tglakhir`, `format` |
| GET | `/api/laporan/export/pembelian` | `tglawal`, `tglakhir`, `format` |
| GET | `/api/laporan/export/stok` | `format` |
| GET | `/api/laporan/export/kartu-stok` | `tglawal`, `tglakhir`, `idbarang`, `format` |

### Cara implementasi di frontend
```js
// Excel
window.open(`/api/laporan/export/stok?format=excel`, '_blank');

// PDF
window.open(`/api/laporan/export/sales-transaksi?tglawal=2025-01-01&tglakhir=2025-01-31&format=pdf`, '_blank');
```

Atau via link langsung:
```html
<a href="/api/laporan/export/stok?format=excel" download>Download Excel</a>
```

> Jangan lupa sertakan header `Authorization` jika menggunakan fetch. Gunakan `responseType: 'blob'` jika pakai axios.

### Contoh dengan axios (jika perlu custom header)
```js
const response = await axios.get('/api/laporan/export/stok', {
  params: { format: 'excel' },
  responseType: 'blob',
  headers: { Authorization: `Bearer ${token}` },
});
const url = URL.createObjectURL(response.data);
const link = document.createElement('a');
link.href = url;
link.download = 'laporan-stok.xlsx';
link.click();
```

---

## 12. Webhook Outbound

**Base path:** `/api/webhook`  
**Menu permission:** `setting.webhook`

### Halaman yang perlu dibuat
- Pengaturan webhook (di menu Setting)
- Daftar webhook + tombol test
- Log pengiriman webhook

### Endpoints

| Method | Path | Keterangan |
|--------|------|-----------|
| GET | `/api/webhook` | List webhook |
| GET | `/api/webhook/:id/logs` | Log pengiriman (100 terakhir) |
| POST | `/api/webhook/:id/test` | Kirim test payload |
| POST | `/api/webhook` | Buat webhook |
| PUT | `/api/webhook/:id` | Update webhook |
| DELETE | `/api/webhook/:id` | Hapus webhook + logs |

### Request body — POST `/api/webhook`
```json
{
  "namawebhook": "Notif ke Sistem Gudang",
  "url": "https://gudang.example.com/webhook",
  "events": ["JUAL_APPROVED", "STOK_KRITIS"],
  "secret": "rahasia123"
}
```

### Event yang tersedia
| Event | Kapan dipicu |
|-------|-------------|
| `JUAL_APPROVED` | Invoice penjualan di-approve |
| `JUAL_CANCELLED` | Invoice penjualan dibatalkan |
| `BELI_APPROVED` | Invoice pembelian di-approve |
| `BELI_CANCELLED` | Invoice pembelian dibatalkan |
| `STOK_KRITIS` | Stok barang di bawah minimum |
| `POIN_DITAMBAH` | Poin customer bertambah |
| `PAYROLL_APPROVED` | Payroll di-approve |

---

## 13. Refresh Token Rotation

**Endpoints baru (tidak butuh auth header):**

| Method | Path | Keterangan |
|--------|------|-----------|
| POST | `/api/auth/token/refresh` | Tukar refresh token → access token baru |
| POST | `/api/auth/token/revoke` | Cabut refresh token (logout) |

> Endpoint `/api/auth/refresh` lama masih tersedia dan tetap berfungsi.

### Flow yang direkomendasikan

**1. Saat login — simpan refresh token**
```
POST /api/auth/login
→ simpan `token` (access token, 2 jam)
→ simpan `refreshToken` (30 hari) di localStorage / httpOnly cookie
```

Untuk mendapatkan refresh token setelah login, panggil:
```
POST /api/auth/token/issue   ← belum ada di frontend; bisa ditambah saat login
```
> Atau: implementasi sederhana tetap gunakan `/api/auth/refresh` yang lama (tidak ada rotasi, tapi masih aman).

**2. Saat access token expired (401)**
```js
const res = await fetch('/api/auth/token/refresh', {
  method: 'POST',
  body: JSON.stringify({ refreshToken: savedRefreshToken }),
  headers: { 'Content-Type': 'application/json' },
});
const { token, refreshToken } = await res.json();
// simpan token & refreshToken baru, ulangi request asli
```

**3. Saat logout**
```js
await fetch('/api/auth/token/revoke', {
  method: 'POST',
  body: JSON.stringify({ refreshToken: savedRefreshToken }),
  headers: { 'Content-Type': 'application/json' },
});
// hapus token dari storage
```

---

## Menu Baru yang Perlu Ditambahkan di Frontend

Tambahkan item menu berikut (sesuaikan dengan struktur menu yang ada):

| Parent | Menu Code | Label | Path |
|--------|-----------|-------|------|
| Penjualan | `penjualan.diskon` | Diskon & Promo | `/penjualan/diskon` |
| Master | `master.hargalevel` | Level Harga | `/master/harga-level` |
| Master | `master.poin` | Poin Member | `/master/poin` |
| Keuangan | `keuangan.anggaran` | Anggaran | `/keuangan/anggaran` |
| HR (SDM) | `sdm.cuti` | Cuti | `/sdm/cuti` |
| HR (SDM) | `sdm.lembur` | Lembur | `/sdm/lembur` |
| Stok | `stok.batchlot` | Batch / Lot | `/stok/batch-lot` |
| Setting | `setting.webhook` | Webhook | `/setting/webhook` |
| *(top-level baru)* | `aset.tetap` | Aset Tetap | `/aset` |

---

## Catatan Umum

- **Error format** selalu `{ "message": "..." }` dengan HTTP status code yang sesuai
- **400** — validasi gagal
- **401** — token tidak valid / expired
- **403** — tidak punya permission
- **404** — data tidak ditemukan
- **500** — server error

- **Pagination** — endpoint list belum menggunakan pagination; gunakan filter (`search`, `status`, date range) untuk membatasi hasil
- **Soft delete** — beberapa modul baru (diskon, aset, batch-lot) menggunakan `status = 'DIHAPUS'` bukan hard delete; data tetap ada di DB tapi tidak muncul di list
- **Foto barang** — path akses: `{{API_BASE}}/uploads/barang/{filename}`
