# Stock Opname

## Konsep

Stock opname adalah proses penghitungan fisik stok di gudang/toko dan membandingkannya dengan stok sistem. Selisih yang ditemukan akan dibuatkan penyesuaian stok otomatis.

## Flow Opname

```
Buat Opname (DRAFT) → Input Stok Fisik → Finalize
       ↓                                     ↓
Auto-load stok sistem               Penyesuaian stok otomatis
untuk semua barang                  untuk item yang selisih != 0
```

## Endpoints

```
GET  /api/stock-opname              # daftar
POST /api/stock-opname              # buat opname baru DRAFT
GET  /api/stock-opname/:id          # detail + daftar barang
PUT  /api/stock-opname/:id/fisik    # update stok fisik
PUT  /api/stock-opname/:id/finalize # finalisasi opname
```

## Buat Opname Baru

Saat POST, sistem otomatis memuat semua barang aktif di tenant beserta stok sistem saat ini dari kartustok.

## Update Stok Fisik

Body: `{ "items": [{ "idbarang": 1, "stok_fisik": 45 }] }`

Sistem menghitung `selisih = stok_fisik - stok_sistem`.

## Finalisasi Opname

Saat finalize:
1. Status opname → FINALIZED
2. Untuk setiap barang dengan `selisih != 0`:
   - Buat penyesuaianstok (kode: `PS.KODELOKASI.YYMMDD.NNN`)
   - Buat penyesuaianstokdtl
   - INSERT kartustok:
     - `selisih > 0` → jenis M (stok masuk/koreksi positif)
     - `selisih < 0` → jenis K (stok keluar/koreksi negatif)

## Kode Transaksi

Format: `SO.KODELOKASI.YYMMDD.NNN`
