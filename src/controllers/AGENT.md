# AGENT.md — src/controllers

## Overview

Direktori berisi 23 file controller yang mengimplementasikan seluruh business logic aplikasi. Setiap controller berkorespondensi 1:1 dengan file route di `src/routes/`.

## Konvensi Umum Semua Controller

### Pattern Standar

```js
exports.methodName = async (req, res) => {
  const conn = await getConnection();   // Untuk transaksi multi-step
  try {
    const ctx = getTenantContext();     // Ambil {idtenant, idlokasi, iduser}
    await conn.beginTransaction();
    // ... logika bisnis ...
    await conn.commit();
    res.json({ ... });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};
```

Untuk operasi read-only (GET), cukup gunakan `tenantQuery()` tanpa `getConnection()`.

### Rules Wajib

1. Setiap `catch` block **wajib** memanggil `logger.error(err, { req })`
2. Transaksi multi-tabel **wajib** menggunakan `beginTransaction/commit/rollback`
3. `grandtotal` dan kalkulasi keuangan **selalu dihitung ulang di server** — jangan percaya nilai dari client
4. Semua INSERT/UPDATE/DELETE **wajib** menyertakan `idtenant` (divalidasi oleh `tenantExecute`)
5. Error duplikat MySQL (`ER_DUP_ENTRY`) harus ditangkap dan dikembalikan sebagai HTTP 409

---

## Daftar Controller

### 1. `authController.js` — Autentikasi

**Route**: `POST /api/auth/...`

| Method          | Endpoint                  | Keterangan |
|----------------|---------------------------|------------|
| `login`         | `POST /auth/login`        | Login user, return JWT. Jika multi-lokasi: kembalikan daftar lokasi |
| `selectLocation`| `POST /auth/select-location` | Pilih lokasi setelah login multi-lokasi, return JWT baru |
| `register`      | `POST /auth/register`     | Daftar tenant baru (tenant + lokasi default + user owner) — auto-login |
| `me`            | `GET /auth/me`            | Profil user yang sedang login |
| `changePassword`| `PUT /auth/password`      | Ganti password — increment `tokenversion` untuk logout semua sesi |

**Rules khusus**:
- `register` berjalan dalam 1 transaksi: insert tenant → lokasi → user → assign semua menu → assign lokasi
- `tokenversion` di-increment pada `changePassword` dan `resetPassword` (user controller)
- Password di-hash dengan `bcrypt`, 10 salt rounds
- JWT berlaku 2 jam (`expiresIn: '2h'`)

---

### 2. `userController.js` — Manajemen User

**Route**: `GET/POST/PUT /api/user/...`

| Method           | Endpoint                        | Keterangan |
|-----------------|---------------------------------|------------|
| `getAll`         | `GET /user`                     | List semua user dalam tenant |
| `getOne`         | `GET /user/:id`                 | Detail user |
| `create`         | `POST /user`                    | Buat user baru |
| `update`         | `PUT /user/:id`                 | Update user (nama, email, status, menu, lokasi) |
| `resetPassword`  | `PUT /user/:id/reset-password`  | Reset password + increment tokenversion |
| `getMenus`       | `GET /user/:id/menu`            | List menu/akses user |
| `getLokasis`     | `GET /user/:id/lokasi`          | List lokasi yang di-assign ke user |
| `getAllTemplates` | `GET /user/template/list`       | List template hak akses |
| `getTemplateDetail` | `GET /user/template/:id`     | Detail template |
| `createTemplate` | `POST /user/template`           | Buat template hak akses |
| `updateTemplate` | `PUT /user/template/:id`        | Update template |
| `deleteTemplate` | `DELETE /user/template/:id`     | Hapus template |

---

### 3. `barangController.js` — Master Data Barang

**Route**: `GET/POST/PUT/DELETE /api/barang/...`

| Method         | Endpoint                   | Keterangan |
|---------------|----------------------------|------------|
| `getAll`       | `GET /barang`              | List produk (dengan filter search, kategori) |
| `getOne`       | `GET /barang/:id`          | Detail produk + variasi |
| `browseBarang` | `GET /barang/browse-barang`| Cari produk untuk POS (dengan harga jual terakhir) |
| `checkPrice`   | `GET /barang/check-price`  | Cek harga jual barang |
| `create`       | `POST /barang`             | Buat produk baru (kode auto-generate: `BRG0001`) |
| `update`       | `PUT /barang/:id`          | Update produk |
| `remove`       | `DELETE /barang/:id`       | Hapus produk |
| `getHargaBeli` | `GET /barang/:id/hargabeli`| History harga beli |
| `getHargaJual` | `GET /barang/:id/hargajual`| History harga jual |

---

### 4. `customerController.js` — Master Data Customer

**Route**: `GET/POST/PUT/DELETE /api/customer/...`

| Method   | Endpoint           | Keterangan |
|---------|--------------------|------------|
| `getAll` | `GET /customer`    | List customer |
| `create` | `POST /customer`   | Tambah customer |
| `update` | `PUT /customer/:id`| Update customer |
| `remove` | `DELETE /customer/:id` | Hapus customer |

---

### 5. `supplierController.js` — Master Data Supplier

**Route**: `GET/POST/PUT/DELETE /api/supplier/...`

| Method   | Endpoint            | Keterangan |
|---------|---------------------|------------|
| `getAll` | `GET /supplier`     | List supplier |
| `create` | `POST /supplier`    | Tambah supplier |
| `update` | `PUT /supplier/:id` | Update supplier |
| `remove` | `DELETE /supplier/:id` | Hapus supplier |

---

### 6. `lokasiController.js` — Manajemen Lokasi/Cabang

**Route**: `GET/POST/PUT /api/lokasi/...`

| Method   | Endpoint          | Keterangan |
|---------|-------------------|------------|
| `getAll` | `GET /lokasi`     | List lokasi tenant |
| `create` | `POST /lokasi`    | Tambah lokasi/cabang baru |
| `update` | `PUT /lokasi/:id` | Update lokasi |

---

### 7. `jualController.js` — Transaksi Penjualan ⭐

**Route**: `GET/POST/PUT /api/jual/...`

| Method       | Endpoint               | Keterangan |
|-------------|------------------------|------------|
| `getAll`     | `GET /jual`            | List transaksi penjualan (filter tanggal, status, customer) |
| `getOne`     | `GET /jual/:id`        | Detail penjualan + items |
| `checkEdit`  | `GET /jual/:id/check-edit` | Cek apakah transaksi boleh diedit |
| `create`     | `POST /jual`           | Buat transaksi penjualan baru |
| `update`     | `PUT /jual/:id`        | Update transaksi yang belum LUNAS |
| `updateBayar`| `PUT /jual/:id/bayar`  | Tambah pembayaran (cicilan) |
| `cancel`     | `PUT /jual/:id/cancel` | Batalkan penjualan (void stok) |

**Alur `create`**:
1. Validasi items tidak kosong
2. Ambil PPN dari tenant
3. Generate `kodejual` (dengan LOCK TABLES)
4. Insert header `jual` dengan status `AKTIF`
5. Per item: insert `jualdtl`, insert `kartustok` (jenis `K`/keluar), catat `hargajual` jika beda
6. Hitung `grandtotal`, `kembali` — update header
7. Jika `bayar >= grandtotal` → status `LUNAS`, buat entry `kartupiutang`
8. Insert `jurnal` DEBET KAS, KREDIT PENJUALAN (jika akun tersedia)

**Status transaksi**:
- `AKTIF` — belum lunas (ada sisa piutang)
- `LUNAS` — sudah lunas penuh
- `VOID` — dibatalkan

**Jenis transaksi** (`jenis`):
- `POS` — transaksi kasir langsung
- `INVOICE` — penjualan dengan faktur

---

### 8. `returjualController.js` — Retur Penjualan

**Route**: `GET/POST/PUT /api/returjual/...`

| Method   | Endpoint                | Keterangan |
|---------|-------------------------|------------|
| `getAll` | `GET /returjual`        | List retur penjualan |
| `getOne` | `GET /returjual/:id`    | Detail retur |
| `create` | `POST /returjual`       | Buat retur penjualan |
| `cancel` | `PUT /returjual/:id/cancel` | Batalkan retur |

**Disposisi per item retur** (`jenisdisposisi`):
- `MASUK_STOK` — barang retur masuk kembali ke stok (kondisi baik)
- `MASUK_STOK_2ND` — masuk ke stok barang second/bekas
- `HANGUS` — barang tidak kembali ke stok (rusak/hilang)

**Rules**:
- Retur boleh tanpa referensi penjualan asli (`idjual` optional)
- Setiap item bisa punya disposisi berbeda
- Jika ada piutang dari penjualan asli, retur dapat mengurangi piutang

---

### 9. `tukarbarangController.js` — Tukar Barang

**Route**: `GET/POST/PUT /api/tukarbarang/...`

| Method   | Endpoint                    | Keterangan |
|---------|------------------------------|------------|
| `getAll` | `GET /tukarbarang`          | List transaksi tukar |
| `getOne` | `GET /tukarbarang/:id`      | Detail tukar barang |
| `create` | `POST /tukarbarang`         | Buat transaksi tukar |
| `cancel` | `PUT /tukarbarang/:id/cancel` | Batalkan tukar |

**Konsep**: Customer mengembalikan barang lama dan mengambil barang baru. Net payment = nilai baru - nilai lama. Stok barang lama masuk, stok barang baru keluar.

---

### 10. `beliController.js` — Transaksi Pembelian

**Route**: `GET/POST/PUT /api/beli/...`

| Method      | Endpoint               | Keterangan |
|------------|------------------------|------------|
| `getAll`    | `GET /beli`            | List pembelian |
| `getOne`    | `GET /beli/:id`        | Detail pembelian + items |
| `checkEdit` | `GET /beli/:id/check-edit` | Cek boleh edit |
| `create`    | `POST /beli`           | Buat purchase order + terima barang |
| `update`    | `PUT /beli/:id`        | Update pembelian |
| `cancel`    | `PUT /beli/:id/cancel` | Batalkan pembelian (void stok) |

---

### 11. `stokController.js` — Manajemen Stok

**Route**: `GET/POST /api/stok/...`

| Method               | Endpoint                     | Keterangan |
|---------------------|------------------------------|------------|
| `getPenyesuaian`     | `GET /stok/penyesuaian`      | List penyesuaian stok |
| `getPenyesuaianDetail` | `GET /stok/penyesuaian/:id` | Detail penyesuaian |
| `createPenyesuaian`  | `POST /stok/penyesuaian`     | Buat penyesuaian stok (opname) |
| `createSaldoAwal`    | `POST /stok/saldoawal`       | Input saldo awal stok |
| `getStok`            | `GET /stok/getstok/:idbarang`| Cek stok barang saat ini |

---

### 12. `laporanController.js` — Laporan ⭐

**Route**: `GET /api/laporan/...`

| Method              | Endpoint                          | Keterangan |
|--------------------|-----------------------------------|------------|
| `salesTransaksi`    | `GET /laporan/sales-transaksi`    | Daftar transaksi penjualan |
| `salesPerCustomer`  | `GET /laporan/sales-per-customer` | Rekap penjualan per customer |
| `salesPerBarang`    | `GET /laporan/sales-per-barang`   | Rekap penjualan per produk |
| `salesPerLokasi`    | `GET /laporan/sales-per-lokasi`   | Rekap penjualan per cabang |
| `pembelian`         | `GET /laporan/pembelian`          | Daftar pembelian |
| `pembelianPerSupplier` | `GET /laporan/pembelian-per-supplier` | Rekap beli per supplier |
| `pembelianPerLokasi`| `GET /laporan/pembelian-per-lokasi` | Rekap beli per lokasi |
| `pembelianPerBarang`| `GET /laporan/pembelian-per-barang` | Rekap beli per produk |
| `pembelianRekap`    | `GET /laporan/pembelian-rekap`    | Ringkasan pembelian |
| `stok`              | `GET /laporan/stok`               | Laporan posisi stok |
| `kartuStok`         | `GET /laporan/kartu-stok`         | Kartu stok per barang |
| `rekapSales`        | `GET /laporan/rekap-sales`        | Rekap omset + tunai vs piutang |
| `struk`             | `GET /laporan/struk/:id`          | Render struk penjualan (EJS → HTML) |
| `faktur`            | `GET /laporan/faktur/:id`         | Render faktur pembelian (EJS → HTML) |

---

### 13. `hitunghppController.js` — Hitung HPP

**Route**: `GET/POST/PUT /api/hitunghpp/...`

| Method        | Endpoint                    | Keterangan |
|-------------|-----------------------------|------------|
| `getAll`     | `GET /hitunghpp`            | List perhitungan HPP |
| `checkPeriod`| `GET /hitunghpp/check/:periodbulan` | Cek apakah periode sudah di-HPP |
| `getOne`     | `GET /hitunghpp/:id`        | Detail HPP |
| `create`     | `POST /hitunghpp`           | Hitung HPP batch untuk satu periode |
| `cancel`     | `PUT /hitunghpp/:id/cancel` | Batalkan HPP |

**Konsep**: Menghitung Harga Pokok Penjualan (HPP) secara batch per periode bulan menggunakan metode rata-rata tertimbang (weighted average).

---

### 14. `kasController.js` — Kas Masuk/Keluar

**Route**: `GET/POST/PUT/DELETE /api/kas/...`

| Method   | Endpoint      | Keterangan |
|---------|---------------|------------|
| `getAll` | `GET /kas`    | List transaksi kas |
| `getOne` | `GET /kas/:id`| Detail kas |
| `create` | `POST /kas`   | Buat transaksi kas (masuk/keluar) |
| `update` | `PUT /kas/:id`| Update kas |
| `remove` | `DELETE /kas/:id` | Hapus kas |

---

### 15. `akunController.js` — Chart of Accounts

**Route**: `GET/POST/PUT/DELETE /api/akun/...`

| Method   | Endpoint       | Keterangan |
|---------|----------------|------------|
| `getAll` | `GET /akun`    | List akun buku besar |
| `getOne` | `GET /akun/:id`| Detail akun |
| `create` | `POST /akun`   | Tambah akun |
| `update` | `PUT /akun/:id`| Update akun |
| `remove` | `DELETE /akun/:id` | Hapus akun |

---

### 16. `menuController.js` — Manajemen Menu/Akses

**Route**: `GET /api/menu/...`

| Method   | Endpoint     | Keterangan |
|---------|--------------|------------|
| `myMenu` | `GET /menu/my` | List menu/hak akses user yang login |

---

### 17. `kartupiutangController.js` — Piutang Customer

**Route**: `GET /api/kartupiutang/...`

| Method         | Endpoint                              | Keterangan |
|---------------|---------------------------------------|------------|
| `getAll`       | `GET /kartupiutang`                   | List semua piutang |
| `getSummary`   | `GET /kartupiutang/summary/:idcustomer` | Total piutang per customer |
| `getOpen`      | `GET /kartupiutang/open/:idcustomer`  | Piutang yang belum lunas |
| `getOpenInvoices` | `GET /kartupiutang/open-invoices/:idcustomer` | Invoice dengan sisa piutang |

---

### 18. `pelunasanpiutangController.js` — Pelunasan Piutang

**Route**: `GET/POST/DELETE /api/pelunasanpiutang/...`

| Method   | Endpoint                  | Keterangan |
|---------|---------------------------|------------|
| `getAll` | `GET /pelunasanpiutang`   | List pembayaran piutang |
| `getOne` | `GET /pelunasanpiutang/:id` | Detail |
| `create` | `POST /pelunasanpiutang`  | Catat pembayaran customer |
| `remove` | `DELETE /pelunasanpiutang/:id` | Hapus/batalkan pembayaran |

---

### 19. `kartuhutangController.js` — Hutang Supplier

**Route**: `GET /api/kartuhutang/...`

| Method         | Endpoint                               | Keterangan |
|---------------|----------------------------------------|------------|
| `getAll`       | `GET /kartuhutang`                     | List hutang ke supplier |
| `getSummary`   | `GET /kartuhutang/summary/:idsupplier` | Total hutang per supplier |
| `getOpen`      | `GET /kartuhutang/open/:idsupplier`    | Hutang yang belum lunas |
| `getOpenInvoices` | `GET /kartuhutang/open-invoices/:idsupplier` | Invoice dengan sisa hutang |

---

### 20. `pelunasanhutangController.js` — Pelunasan Hutang

**Route**: `GET/POST/DELETE /api/pelunasanhutang/...`

| Method   | Endpoint                   | Keterangan |
|---------|----------------------------|------------|
| `getAll` | `GET /pelunasanhutang`     | List pembayaran hutang |
| `getOne` | `GET /pelunasanhutang/:id` | Detail |
| `create` | `POST /pelunasanhutang`    | Catat pembayaran ke supplier |
| `remove` | `DELETE /pelunasanhutang/:id` | Hapus/batalkan pembayaran |

---

### 21. `dashboardController.js` — Dashboard

**Route**: `GET /api/dashboard/...`

| Method     | Endpoint               | Keterangan |
|-----------|------------------------|------------|
| `summary`  | `GET /dashboard/summary` | Total penjualan, pembelian, piutang hari ini |
| `chart`    | `GET /dashboard/chart` | Data grafik penjualan harian/bulanan |
| `lowStock` | `GET /dashboard/low-stock` | Produk stok di bawah minimum |

---

### 22. `settingController.js` — Pengaturan Toko

**Route**: `PUT /api/setting/...`

| Method       | Endpoint         | Keterangan |
|-------------|------------------|------------|
| `updateToko` | `PUT /setting/toko` | Update info toko (nama, alamat, HP, PPN, dll) |
| `updateLogo` | `PUT /setting/logo` | Upload & update logo toko (via multer) |

---

### 23. `imporController.js` — Import/Export Data

**Route**: `GET/POST /api/impor/...`

| Endpoint | Keterangan |
|----------|------------|
| `GET /impor/barang/template` | Download template CSV barang |
| `POST /impor/barang/import` | Import barang dari CSV |
| `GET /impor/barang/export` | Export data barang ke CSV |
| `GET /impor/customer/template` | Download template CSV customer |
| `POST /impor/customer/import` | Import customer dari CSV |
| `GET /impor/customer/export` | Export customer ke CSV |
| `GET /impor/supplier/template` | Download template CSV supplier |
| `POST /impor/supplier/import` | Import supplier dari CSV |
| `GET /impor/beli/template` | Download template CSV pembelian |
| `POST /impor/beli/import` | Import pembelian dari CSV |
| `GET /impor/jual/export` | Export penjualan ke CSV |
| `POST /impor/jual/import` | Import penjualan dari CSV |

File diproses oleh multer ke direktori `uploads/`, lalu dibaca per baris.
