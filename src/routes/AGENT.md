# AGENT.md — src/routes

## Overview

Direktori berisi 23 file route yang mendefinisikan semua endpoint API. Setiap file route mendelegasikan logika ke controller yang bersesuaian dan menerapkan middleware `auth` pada semua endpoint yang memerlukan autentikasi.

## Konvensi

- Semua route module diekspor sebagai Express Router
- Semua endpoint (kecuali `auth/login`, `auth/register`, `auth/select-location`) dilindungi middleware `auth`
- File route tidak berisi logika bisnis — hanya mapping HTTP method + path ke controller function
- Semua route diregistrasi di `src/index.js` dengan prefix `/api/`

## Peta Endpoint Lengkap

### `/api/auth` — `auth.js`

```
POST   /api/auth/register          (publik) Daftar tenant baru
POST   /api/auth/login             (publik) Login user
POST   /api/auth/select-location   (publik) Pilih lokasi setelah login
GET    /api/auth/me                [auth]   Profil user aktif
PUT    /api/auth/password          [auth]   Ganti password
```

### `/api/user` — `user.js`

```
GET    /api/user                   [auth]   List semua user
GET    /api/user/template/list     [auth]   List template hak akses
GET    /api/user/template/:id      [auth]   Detail template
POST   /api/user/template          [auth]   Buat template
PUT    /api/user/template/:id      [auth]   Update template
DELETE /api/user/template/:id      [auth]   Hapus template
GET    /api/user/:id               [auth]   Detail user
POST   /api/user                   [auth]   Buat user baru
PUT    /api/user/:id               [auth]   Update user
PUT    /api/user/:id/reset-password [auth]  Reset password user
GET    /api/user/:id/menu          [auth]   List menu user
GET    /api/user/:id/lokasi        [auth]   List lokasi user
```

> **Catatan**: Route `/template/list` dan `/template` harus didefinisikan **sebelum** `/:id` agar tidak di-match sebagai `:id = "template"`

### `/api/lokasi` — `lokasi.js`

```
GET    /api/lokasi                 [auth]   List lokasi tenant
POST   /api/lokasi                 [auth]   Tambah lokasi
PUT    /api/lokasi/:id             [auth]   Update lokasi
```

### `/api/menu` — `menu.js`

```
GET    /api/menu/my                [auth]   Menu/akses user aktif
```

### `/api/barang` — `barang.js`

```
GET    /api/barang                 [auth]   List produk
GET    /api/barang/browse-barang   [auth]   Cari produk untuk POS
GET    /api/barang/check-price     [auth]   Cek harga jual
GET    /api/barang/:id             [auth]   Detail produk
POST   /api/barang                 [auth]   Tambah produk
PUT    /api/barang/:id             [auth]   Update produk
DELETE /api/barang/:id             [auth]   Hapus produk
GET    /api/barang/:id/hargabeli   [auth]   History harga beli
GET    /api/barang/:id/hargajual   [auth]   History harga jual
```

### `/api/customer` — `customer.js`

```
GET    /api/customer               [auth]   List customer
POST   /api/customer               [auth]   Tambah customer
PUT    /api/customer/:id           [auth]   Update customer
DELETE /api/customer/:id           [auth]   Hapus customer
```

### `/api/supplier` — `supplier.js`

```
GET    /api/supplier               [auth]   List supplier
POST   /api/supplier               [auth]   Tambah supplier
PUT    /api/supplier/:id           [auth]   Update supplier
DELETE /api/supplier/:id           [auth]   Hapus supplier
```

### `/api/jual` — `jual.js`

```
GET    /api/jual                   [auth]   List penjualan
GET    /api/jual/:id/check-edit    [auth]   Cek boleh edit
GET    /api/jual/:id               [auth]   Detail penjualan
POST   /api/jual                   [auth]   Buat penjualan
PUT    /api/jual/:id/bayar         [auth]   Tambah pembayaran
PUT    /api/jual/:id/cancel        [auth]   Batalkan penjualan
PUT    /api/jual/:id               [auth]   Update penjualan
```

### `/api/returjual` — `returjual.js`

```
GET    /api/returjual              [auth]   List retur penjualan
GET    /api/returjual/:id          [auth]   Detail retur
POST   /api/returjual              [auth]   Buat retur
PUT    /api/returjual/:id/cancel   [auth]   Batalkan retur
```

### `/api/tukarbarang` — `tukarbarang.js`

```
GET    /api/tukarbarang            [auth]   List tukar barang
GET    /api/tukarbarang/:id        [auth]   Detail tukar
POST   /api/tukarbarang            [auth]   Buat transaksi tukar
PUT    /api/tukarbarang/:id/cancel [auth]   Batalkan tukar
```

### `/api/beli` — `beli.js`

```
GET    /api/beli                   [auth]   List pembelian
GET    /api/beli/:id/check-edit    [auth]   Cek boleh edit
GET    /api/beli/:id               [auth]   Detail pembelian
POST   /api/beli                   [auth]   Buat pembelian
PUT    /api/beli/:id/cancel        [auth]   Batalkan pembelian
PUT    /api/beli/:id               [auth]   Update pembelian
```

### `/api/stok` — `stok.js`

```
GET    /api/stok/penyesuaian       [auth]   List penyesuaian stok
GET    /api/stok/penyesuaian/:id   [auth]   Detail penyesuaian
POST   /api/stok/penyesuaian       [auth]   Buat penyesuaian
POST   /api/stok/saldoawal         [auth]   Input saldo awal
GET    /api/stok/getstok/:idbarang [auth]   Cek stok barang
```

### `/api/laporan` — `laporan.js`

```
GET    /api/laporan/sales-transaksi          [auth]   Daftar penjualan
GET    /api/laporan/sales-per-customer       [auth]   Rekap per customer
GET    /api/laporan/sales-per-barang         [auth]   Rekap per produk
GET    /api/laporan/sales-per-lokasi         [auth]   Rekap per lokasi
GET    /api/laporan/pembelian                [auth]   Daftar pembelian
GET    /api/laporan/pembelian-per-supplier   [auth]   Rekap per supplier
GET    /api/laporan/pembelian-per-lokasi     [auth]   Rekap per lokasi
GET    /api/laporan/pembelian-per-barang     [auth]   Rekap per produk
GET    /api/laporan/pembelian-rekap          [auth]   Ringkasan pembelian
GET    /api/laporan/stok                     [auth]   Posisi stok
GET    /api/laporan/kartu-stok               [auth]   Kartu stok per barang
GET    /api/laporan/rekap-sales              [auth]   Rekap omset & piutang
GET    /api/laporan/struk/:id                [auth]   Cetak struk (HTML)
GET    /api/laporan/faktur/:id               [auth]   Cetak faktur (HTML)
```

### `/api/hitunghpp` — `hitunghpp.js`

```
GET    /api/hitunghpp                        [auth]   List hitung HPP
GET    /api/hitunghpp/check/:periodbulan     [auth]   Cek periode
GET    /api/hitunghpp/:id                    [auth]   Detail HPP
POST   /api/hitunghpp                        [auth]   Hitung HPP
PUT    /api/hitunghpp/:id/cancel             [auth]   Batalkan HPP
```

### `/api/kas` — `kas.js`

```
GET    /api/kas                    [auth]   List transaksi kas
GET    /api/kas/:id                [auth]   Detail kas
POST   /api/kas                    [auth]   Tambah kas
PUT    /api/kas/:id                [auth]   Update kas
DELETE /api/kas/:id                [auth]   Hapus kas
```

### `/api/akun` — `akun.js`

```
GET    /api/akun                   [auth]   List akun
GET    /api/akun/:id               [auth]   Detail akun
POST   /api/akun                   [auth]   Tambah akun
PUT    /api/akun/:id               [auth]   Update akun
DELETE /api/akun/:id               [auth]   Hapus akun
```

### `/api/impor` — `impor.js`

```
GET    /api/impor/barang/export      [auth]   Export barang CSV
POST   /api/impor/barang/import      [auth]   Import barang CSV
GET    /api/impor/barang/template    [auth]   Download template barang
GET    /api/impor/customer/export    [auth]   Export customer CSV
POST   /api/impor/customer/import    [auth]   Import customer CSV
GET    /api/impor/customer/template  [auth]   Download template customer
GET    /api/impor/supplier/export    [auth]   Export supplier CSV
POST   /api/impor/supplier/import    [auth]   Import supplier CSV
GET    /api/impor/supplier/template  [auth]   Download template supplier
GET    /api/impor/beli/export        [auth]   Export pembelian CSV
POST   /api/impor/beli/import        [auth]   Import pembelian CSV
GET    /api/impor/beli/template      [auth]   Download template pembelian
GET    /api/impor/jual/export        [auth]   Export penjualan CSV
POST   /api/impor/jual/import        [auth]   Import penjualan CSV
```

### `/api/kartupiutang` — `kartupiutang.js`

```
GET    /api/kartupiutang                              [auth]   List piutang
GET    /api/kartupiutang/summary/:idcustomer          [auth]   Total piutang customer
GET    /api/kartupiutang/open/:idcustomer             [auth]   Piutang belum lunas
GET    /api/kartupiutang/open-invoices/:idcustomer    [auth]   Invoice dengan sisa piutang
```

### `/api/pelunasanpiutang` — `pelunasanpiutang.js`

```
GET    /api/pelunasanpiutang           [auth]   List pelunasan piutang
GET    /api/pelunasanpiutang/:id       [auth]   Detail
POST   /api/pelunasanpiutang           [auth]   Catat pembayaran customer
DELETE /api/pelunasanpiutang/:id       [auth]   Hapus/batalkan
```

### `/api/kartuhutang` — `kartuhutang.js`

```
GET    /api/kartuhutang                             [auth]   List hutang
GET    /api/kartuhutang/summary/:idsupplier         [auth]   Total hutang supplier
GET    /api/kartuhutang/open/:idsupplier            [auth]   Hutang belum lunas
GET    /api/kartuhutang/open-invoices/:idsupplier   [auth]   Invoice dengan sisa hutang
```

### `/api/pelunasanhutang` — `pelunasanhutang.js`

```
GET    /api/pelunasanhutang            [auth]   List pelunasan hutang
GET    /api/pelunasanhutang/:id        [auth]   Detail
POST   /api/pelunasanhutang            [auth]   Catat pembayaran ke supplier
DELETE /api/pelunasanhutang/:id        [auth]   Hapus/batalkan
```

### `/api/dashboard` — `dashboard.js`

```
GET    /api/dashboard/summary          [auth]   Ringkasan hari ini
GET    /api/dashboard/chart            [auth]   Data grafik
GET    /api/dashboard/low-stock        [auth]   Stok kritis
```

### `/api/setting` — `setting.js`

```
PUT    /api/setting/toko               [auth]   Update info toko
PUT    /api/setting/logo               [auth]   Upload logo (multipart/form-data)
```

## Rules

1. Urutan definisi route penting: route statis (`/template/list`) harus **di atas** route dinamis (`/:id`)
2. File route hanya boleh berisi mapping HTTP method → controller function
3. Middleware `auth` selalu ditempatkan sebagai argumen kedua: `router.get('/', auth, ctrl.method)`
4. Untuk upload file, middleware `multer` ditambahkan di route tersebut (lihat `setting.js` dan `impor.js`)
5. Semua route terdaftar di `src/index.js` — tambah route baru di sana juga
