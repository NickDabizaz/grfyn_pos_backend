# Laporan Keuangan

## Konsep Akun & jenisak

Setiap akun di tabel `akun` memiliki kolom `jenisak` yang menentukan posisinya di laporan keuangan:

| jenisak | Laporan | Saldo Normal |
|---------|---------|--------------|
| ASET | Neraca | DEBET |
| LIABILITAS | Neraca | KREDIT |
| EKUITAS | Neraca | KREDIT |
| PENDAPATAN | Laba Rugi | KREDIT |
| BEBAN | Laba Rugi | DEBET |

Default COA yang diseed saat register tenant:
- `1-1001` Kas Tunai (ASET)
- `1-1002` Bank (ASET)
- `1-1003` Piutang Usaha (ASET)
- `1-1004` Persediaan Barang (ASET)
- `2-1001` Hutang Usaha (LIABILITAS)
- `2-1002` Hutang Gaji (LIABILITAS)
- `3-1001` Modal (EKUITAS)
- `3-1002` Laba Ditahan (EKUITAS)
- `4-1001` Pendapatan Penjualan (PENDAPATAN)
- `5-1001` Harga Pokok Penjualan (BEBAN)
- `5-1002` Beban Operasional (BEBAN)
- `5-1003` Beban Gaji (BEBAN)

## Endpoints

### GET /api/laporan-keuangan/neraca-saldo
Trial Balance — semua akun dengan total debet, total kredit, dan saldo normal.

Query params: `tglwal`, `tglakhir` (filter jurnal.tgltrans)

### GET /api/laporan-keuangan/laba-rugi
Income Statement. Hanya akun PENDAPATAN dan BEBAN.

Response berisi: `pendapatan[]`, `beban[]`, `total_pendapatan`, `total_beban`, `laba_bersih`

### GET /api/laporan-keuangan/neraca
Balance Sheet. Akun ASET, LIABILITAS, EKUITAS.

Response berisi: `aset[]`, `liabilitas[]`, `ekuitas[]`, `laba_bersih_periode`, `total_aset`, `total_liabilitas`, `total_ekuitas`, `balance_check`

Validasi: `total_aset = total_liabilitas + total_ekuitas + laba_bersih_periode`

### GET /api/laporan-keuangan/buku-besar
General Ledger untuk satu akun dengan running balance.

Query params: `idakun` (required), `tglwal`, `tglakhir`

### POST /api/laporan-keuangan/closing
Period Closing — tutup akun P&L, transfer ke Laba Ditahan.

Body: `{ periodbulan: "2025-05", tglakhir: "2025-05-31", tglawal: "2025-05-01", catatan }`

Proses:
1. Cek belum pernah di-closing
2. Hitung saldo PENDAPATAN dan BEBAN periode tersebut
3. Buat jurnal penutup (DEBIT semua PENDAPATAN, KREDIT semua BEBAN)
4. Selisih laba/rugi → akun Laba Ditahan (kodeakun `3-1002`)
5. Insert ke tabel `closing` dan `closingdtl`

### GET /api/laporan-keuangan/closing
Daftar closing yang sudah dilakukan.

## Kolom tgltrans di Jurnal

Jurnal yang lama (sebelum implementasi ini) tidak punya `tgltrans`. Jalankan `npm run alter-financial` untuk:
1. Menambah kolom `jenisak` ke tabel `akun`
2. Menambah kolom `tgltrans` ke tabel `jurnal`
3. Backfill `tgltrans` dari tabel transaksi terkait
4. Membuat tabel `closing` dan `closingdtl`
