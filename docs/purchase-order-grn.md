# Purchase Order & GRN

## Flow PO → GRN → Faktur Beli

```
PO (DRAFT) → PO (APPROVED) → GRN (penerimaan barang) → Faktur Beli (otomatis)
                                                         ↓
                                                    Kartu Hutang
                                                    Kartu Stok (M)
                                                    Jurnal: DEBET Persediaan / KREDIT Hutang Usaha
```

## Purchase Order

### Status PO

| Status | Deskripsi |
|--------|-----------|
| DRAFT | Baru dibuat, belum diapprove |
| APPROVED | Sudah diapprove, siap dikirim ke supplier |
| PARTIAL | Sebagian barang sudah diterima (via GRN) |
| COMPLETE | Semua barang sudah diterima |
| CANCELLED | Dibatalkan |

### Endpoints PO

```
GET  /api/purchase-order              # daftar (filter: tglwal, tglakhir, status, idsupplier)
GET  /api/purchase-order/:id          # detail + items + status GRN
POST /api/purchase-order              # buat DRAFT
PUT  /api/purchase-order/:id/approve  # approve
PUT  /api/purchase-order/:id/batal    # batalkan (hanya dari DRAFT)
```

## GRN (Goods Received Note)

GRN adalah dokumen penerimaan barang. Bisa dengan atau tanpa PO.

### Efek saat membuat GRN

1. Stok bertambah di lokasi (kartustok jenis M, jenisref='grn')
2. Faktur beli otomatis dibuat (tabel `beli` dan `belidtl`)
3. Kartu hutang dicatat ke supplier
4. Jurnal akuntansi:
   - DEBET: Persediaan Barang (kodeakun `1-1004`)
   - KREDIT: Hutang Usaha (kodeakun `2-1001`)
   - *Jika akun tidak ditemukan, jurnal dilewati tapi GRN tetap diproses*
5. Jika ada PO: update `jml_diterima` di `purchaseorderdtl` dan update status PO (PARTIAL/COMPLETE)

### Endpoints GRN

```
GET  /api/grn       # daftar
GET  /api/grn/:id   # detail
POST /api/grn       # buat GRN (proses penerimaan)
```

### Body POST /api/grn

```json
{
  "idsupplier": 1,
  "idpo": 5,          // opsional, null = GRN tanpa PO
  "tgltrans": "2025-05-10",
  "catatan": "...",
  "items": [
    {
      "idbarang": 1,
      "jml": 10,
      "satuan": "PCS",
      "harga": 50000,
      "idpodtl": 3    // opsional, link ke PO detail
    }
  ]
}
```

## Kode Transaksi

- PO: `PO.KODELOKASI.YYMMDD.NNN`
- GRN: `GRN.KODELOKASI.YYMMDD.NNN`
