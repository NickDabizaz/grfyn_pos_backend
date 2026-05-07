# Konsep Modul Penjualan

## 1. Penjualan (Jual)

Penjualan adalah transaksi ketika barang keluar dari stok ke customer. Stok langsung berkurang saat transaksi dibuat, terlepas dari status pembayaran.

### Pembayaran Langsung (Lunas)

Customer bayar penuh saat transaksi. `bayar >= grandtotal`, status transaksi menjadi **LUNAS**.

```
Customer beli → stok -qty → bayar lunas → selesai
```

### Pembayaran Tidak Langsung (Piutang)

Customer belum bayar atau bayar sebagian. Selisih `grandtotal - bayar` menjadi **piutang**. Status transaksi **AKTIF** selama belum lunas.

```
Customer beli → stok -qty → bayar sebagian → sisa = piutang
                                    ↓
                          bayar belakangan (cicil/lunas) → status LUNAS
```

Tidak ada tabel piutang terpisah. Piutang dihitung dari: `grandtotal - bayar` pada transaksi yang masih berstatus AKTIF.

### Status Transaksi Penjualan

| Status | Keterangan |
|---|---|
| `AKTIF` | Transaksi aktif, bisa jadi ada piutang |
| `LUNAS` | Sudah dibayar penuh |
| `VOID` | Dibatalkan, stok dikembalikan |

### Konsinyasi

Konsinyasi (titip jual ke toko lain) **tidak perlu menu sendiri**. Cukup pakai penjualan biasa:

1. Kirim 10 barang ke toko → buat **Penjualan** dengan bayar=0 (belum lunas)
   - Stok keluar 10 dari gudang
2. Toko kembalikan 3 barang → buat **Retur Penjualan** (link ke nota tadi, opsional)
   - Stok masuk 3 kembali
3. Toko bayar untuk 7 yang terjual → update pembayaran di nota penjualan tadi
   - Status berubah LUNAS

---

## 2. Retur Penjualan

Retur adalah transaksi ketika customer mengembalikan barang. Setiap retur punya header + detail per barang.

### Referensi Nota Asal

Retur **boleh tanpa referensi** ke nota penjualan asal. Jika nota asal sudah tidak ada atau tidak diketahui, retur tetap bisa diproses. Field `kodejual` di header retur bersifat opsional.

### Tindaklanjut Barang Retur

Setiap item yang diretur harus ditentukan tindaklanjutnya:

| `tindaklanjut` | Stok | Keterangan |
|---|---|---|
| `MASUK_STOK` | +qty ke barang asal | Barang kondisi normal, kembali ke inventory biasa |
| `MASUK_STOK_2ND` | +qty ke produk 2nd | Barang rusak ringan, masuk sebagai barang 2nd (harga lebih murah). User perlu buat produk 2nd terlebih dahulu di master barang |
| `HANGUS` | tidak ada pergerakan | Barang rusak berat / kadaluarsa, langsung dihapus, tidak masuk stok |

### Contoh Alur

```
Retur 5 barang dari customer:
  - 2 pcs kondisi baik        → MASUK_STOK
  - 2 pcs rusak ringan        → MASUK_STOK_2ND (ke "Nama Barang (2nd)")
  - 1 pcs rusak parah/hangus  → HANGUS

Hasil:
  stok "Nama Barang"      +2
  stok "Nama Barang (2nd)" +2
  1 barang dimusnahkan, tidak ada jejak stok
```

### Pembatalan Retur (VOID)

Jika retur dibatalkan, semua pergerakan stok yang dibuat saat retur dibalik (stok dikurangi kembali).

---

## 3. Tukar Barang

Tukar barang adalah transaksi di mana customer mengembalikan barang lama dan mendapatkan barang baru sebagai pengganti. **Net payment = 0** (nilai barang lama = nilai barang baru, tidak ada uang keluar/masuk).

### Komponen Transaksi

```
Tukar Barang
├── Barang Kembali (dari customer)
│   → stok masuk, dengan pilihan tindaklanjut per item
│   └── MASUK_STOK | MASUK_STOK_2ND | HANGUS
│
└── Barang Baru (ke customer)
    → stok keluar otomatis
```

### Contoh Alur

```
Customer kembalikan 9 pcs "Produk A" (rusak ringan)
Customer mendapat 9 pcs "Produk A" baru

Hasil:
  stok "Produk A"      +9 (kembali, tindaklanjut: MASUK_STOK_2ND → ke Produk A 2nd)
  stok "Produk A 2nd"  +9
  stok "Produk A"      -9 (keluar sebagai pengganti)
  Net bayar = 0
```

### Pembatalan Tukar Barang (VOID)

Semua pergerakan stok dibalik: barang yang tadinya masuk dikurangi, barang yang tadinya keluar ditambah kembali.

---

## 4. Laporan Rekap Sales

Laporan ini merangkum penjualan dalam periode tertentu dan membedakan antara penjualan tunai (sudah diterima) dan non-tunai (piutang).

### Informasi yang Ditampilkan

| Kolom | Keterangan |
|---|---|
| Total Transaksi | Jumlah nota penjualan dalam periode |
| Total Penjualan | Nilai grand total semua penjualan |
| Total Tunai | Nilai penjualan yang dibayar cash di tempat (metodbayar = TUNAI) |
| Total Non-Tunai / Kredit | Nilai penjualan yang belum/tidak langsung dibayar |
| Total Sudah Dibayar | Akumulasi `bayar` dari semua transaksi |
| Total Piutang Tersisa | Akumulasi `grandtotal - bayar` dari transaksi yang belum lunas |

### Filter

- Rentang tanggal (`tglwal` - `tglakhir`)
- Per customer (opsional)

---

## 5. Ringkasan Alur Stok

| Transaksi | Stok |
|---|---|
| Penjualan baru | -qty (keluar) |
| Penjualan VOID | +qty (masuk kembali) |
| Retur, tindaklanjut MASUK_STOK | +qty ke barang asal |
| Retur, tindaklanjut MASUK_STOK_2ND | +qty ke barang 2nd |
| Retur, tindaklanjut HANGUS | tidak ada pergerakan |
| Retur VOID | balik semua yang masuk saat retur |
| Tukar barang: barang kembali | +qty (sesuai tindaklanjut) |
| Tukar barang: barang baru | -qty (keluar) |
| Tukar barang VOID | semua dibalik |
