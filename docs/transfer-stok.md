# Transfer Stok Antar Lokasi

## Flow Transfer

```
DRAFT → DIKIRIM → DITERIMA
  |
  └→ DIBATALKAN (dari DRAFT atau DIKIRIM)
```

## Status Lifecycle

| Status | Deskripsi | Stok |
|--------|-----------|------|
| DRAFT | Transfer dibuat, belum ada pergerakan stok | Tidak berubah |
| DIKIRIM | Dikirim dari lokasi asal | Stok lokasi ASAL berkurang (K) |
| DITERIMA | Diterima di lokasi tujuan | Stok lokasi TUJUAN bertambah (M) |
| DIBATALKAN | Dibatalkan; jika dari DIKIRIM maka stok dikembalikan | Reverse jika perlu |

## Endpoints

```
GET    /api/transfer-stok          # daftar (filter: tglwal, tglakhir, status)
GET    /api/transfer-stok/:id      # detail + items
POST   /api/transfer-stok          # buat DRAFT
PUT    /api/transfer-stok/:id/kirim   # kirim (stok asal berkurang)
PUT    /api/transfer-stok/:id/terima  # terima (stok tujuan bertambah)
PUT    /api/transfer-stok/:id/batal   # batalkan
```

## Validasi

- `idlokasitujuan` tidak boleh sama dengan `idlokasi` (lokasi asal)
- Hanya DRAFT yang bisa dikirim
- Hanya DIKIRIM yang bisa diterima
- Transfer yang sudah DITERIMA tidak bisa dibatalkan

## Kode Transaksi

Format: `TS.KODELOKASI.YYMMDD.NNN`
