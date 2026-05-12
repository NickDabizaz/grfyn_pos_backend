# Shift Kasir

## Konsep

Shift kasir mencatat sesi kerja kasir di satu lokasi, termasuk modal awal, total penjualan, dan kas akhir. Rekonsiliasi selisih dilakukan saat tutup shift.

## Flow Shift

```
BUKA → TUTUP
```

Hanya boleh ada satu shift BUKA per lokasi dalam satu waktu.

## Endpoints

```
GET  /api/shift              # daftar shift (filter: tglwal, tglakhir, status, iduser)
GET  /api/shift/aktif        # shift BUKA untuk user+lokasi saat ini
GET  /api/shift/:id          # detail + summary penjualan
POST /api/shift/buka         # buka shift baru
PUT  /api/shift/:id/tutup    # tutup shift
```

## Buka Shift

Body: `{ modal_awal: 500000, catatan: "..." }`

Validasi: Tidak boleh ada shift BUKA lain di lokasi yang sama.

## Tutup Shift

Body: `{ kas_akhir: 1500000, catatan: "..." }`

Kalkulasi otomatis:
- `total_sales` = SUM(grandtotal) dari transaksi jual pada tanggal shift & lokasi (bukan VOID)
- `selisih` = `kas_akhir - (modal_awal + total_sales)`
  - Positif = kelebihan kas
  - Negatif = kekurangan kas

## Rekonsiliasi Kas

Selisih ideal = 0. Selisih negatif menandakan kemungkinan kehilangan uang atau penjualan yang tidak tercatat.

## Kode Transaksi

Format: `SH.KODELOKASI.YYMMDD.NNN`
