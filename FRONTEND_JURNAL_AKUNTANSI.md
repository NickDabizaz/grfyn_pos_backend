# Frontend — Jurnal Akuntansi

Dokumen ini merangkum perubahan frontend yang perlu dibuat untuk fitur Jurnal
Akuntansi. Seluruh endpoint backend sudah tersedia. Base URL: `/api`.

Header wajib untuk semua request: `Authorization: Bearer <token>` dan
`x-lokasi-id: <idlokasi>` (sesuai pola yang sudah ada).

---

## 1. Master Akun — Pop-up "Setting Default Jurnal"

Tambahkan menu/tombol baru **"Setting Default Jurnal"** di dalam grid action
menu halaman Master Akun (`/master/akun`). Tombol membuka pop-up berisi 8
dropdown akun (sumber opsi: `GET /api/akun`).

| Field form          | Label                       |
|---------------------|-----------------------------|
| `akun_piutang`      | Akun Piutang Dagang         |
| `akun_penjualan`    | Akun Penjualan              |
| `akun_ppn_keluaran` | Akun PPN Penjualan          |
| `akun_hutang`       | Akun Hutang Dagang          |
| `akun_pembelian`    | Akun Pembelian              |
| `akun_ppn_masukan`  | Akun PPN Pembelian          |
| `akun_kas`          | Akun Kas (default TUNAI)    |
| `akun_bank`         | Akun Bank (default non-TUNAI)|

**Endpoint**

- `GET /api/akun/setting-jurnal` → mengisi nilai dropdown saat pop-up dibuka.
  Respons: objek per field, masing-masing `null` atau
  `{ idakun, kodeakun, namaakun, status }`.
- `PUT /api/akun/setting-jurnal` → simpan. Body: 8 field di atas, masing-masing
  berisi `idakun` (number). Semua wajib diisi; jika tidak valid backend
  mengembalikan `400`.

Setting ini wajib diisi — jika belum, transaksi Penjualan/Pembelian/Pelunasan/
Retur akan gagal saat approve dengan pesan
**"Harap Setting Akun Default di Master Akun"**.

---

## 2. Form Pelunasan Piutang & Pelunasan Hutang — bagian "Detail Jurnal"

Pada form Pelunasan Piutang (`/keuangan/pelunasanpiutang`) dan Pelunasan Hutang
(`/keuangan/pelunasanhutang`), tambahkan section **"Detail Jurnal (Pembayaran)"**:
tabel baris-baris `{ akun, nominal }` (dropdown akun + input nominal). Contoh —
melunasi nota total 100.000.000 dibayar Kas 70.000.000 + Bank 30.000.000.

Aturan:
- Total seluruh baris pembayaran **harus sama** dengan total pelunasan
  (`total_amount`). Validasi di sisi klien sebelum submit.
- Bagian ini boleh dikosongkan; jika kosong backend memakai akun Kas/Bank
  default (berdasarkan `metodbayar`).

**Payload** (tambahan pada body `POST`/`PUT` yang sudah ada):

```json
{
  "idcustomer": 1,
  "tgltrans": "2026-05-19",
  "total_amount": 100000000,
  "metodbayar": "TUNAI",
  "details": [{ "kodetrans": "JL.A01.260519.001", "amount": 100000000 }],
  "pembayaran": [
    { "idakun": 12, "amount": 70000000 },
    { "idakun": 13, "amount": 30000000 }
  ]
}
```

(Untuk Pelunasan Hutang gunakan `idsupplier`, sisanya sama.)

`GET /api/pelunasanpiutang/:id` dan `/api/pelunasanhutang/:id` kini juga
mengembalikan array `pembayaran` (`{ idbayar, idakun, kodeakun, namaakun, amount }`)
untuk ditampilkan saat membuka kembali transaksi.

---

## 3. Laporan — Sub-menu baru "Akuntansi"

Tambahkan grup menu **Laporan > Akuntansi** dengan 3 laporan. Base URL
`/api/laporan-akuntansi`.

### 3a. Jurnal Transaksi — `GET /jurnal`
Filter: `tglwal`, `tglakhir` (wajib/utama), `kodetrans` (opsional, default semua),
`idakun` (opsional, default semua; boleh beberapa id dipisah koma).
Respons: array transaksi, dikelompokkan per kode transaksi:

```json
[{
  "kodetrans": "JL.A01.260519.001", "jenis": "jual", "tgltrans": "2026-05-19",
  "lines": [
    { "idakun": 3, "kodeakun": "1-1003", "namaakun": "Piutang Usaha", "posisi": "DEBET",  "debet": 111000, "kredit": 0 },
    { "idakun": 9, "kodeakun": "4-1001", "namaakun": "Pendapatan Penjualan", "posisi": "KREDIT", "debet": 0, "kredit": 100000 },
    { "idakun": 7, "kodeakun": "2-1003", "namaakun": "PPN Keluaran", "posisi": "KREDIT", "debet": 0, "kredit": 11000 }
  ],
  "total_debet": 111000, "total_kredit": 111000
}]
```

### 3b. Buku Besar — `GET /buku-besar`
Filter: sama seperti Jurnal (`tglwal`, `tglakhir`, `kodetrans`, `idakun`).
Respons: array per akun, dengan saldo awal, daftar entri, saldo berjalan, saldo akhir:

```json
[{
  "idakun": 3, "kodeakun": "1-1003", "namaakun": "Piutang Usaha",
  "jenisak": "ASET", "saldo_normal": "DEBET", "saldo_awal": 0,
  "entries": [
    { "tgltrans": "2026-05-19", "kodetrans": "JL.A01.260519.001", "jenis": "jual", "debet": 111000, "kredit": 0, "saldo": 111000 }
  ],
  "saldo_akhir": 111000
}]
```

### 3c. Neraca — `GET /neraca`
Filter: `bulan` (1-12) dan `tahun` (mengganti rentang tanggal), `kodetrans`
(opsional), `idakun` (opsional). Respons: saldo awal bulan, mutasi, saldo akhir
per akun:

```json
{
  "bulan": 5, "tahun": 2026,
  "periode": { "tglawal": "2026-05-01", "tglakhir": "2026-05-31" },
  "akun": [
    { "idakun": 3, "kodeakun": "1-1003", "namaakun": "Piutang Usaha", "jenisak": "ASET",
      "saldo_normal": "DEBET", "saldo_awal": 0, "mutasi_debet": 111000, "mutasi_kredit": 0,
      "saldo_akhir": 111000 }
  ]
}
```

Komponen filter UI: Jurnal & Buku Besar = Tanggal Awal, Tanggal Akhir, Kode
Transaksi, Akun. Neraca = Bulan, Tahun, Kode Transaksi, Akun. Dropdown Akun
mengambil opsi dari `GET /api/akun`.

---

## 4. Form Kas

Jurnal kas kini divalidasi **balance**: total nilai sisi DEBET harus sama
dengan sisi KREDIT. Konvensi input baris `details`: nominal positif = DEBET,
nominal negatif = KREDIT. Jika tidak balance, `POST/PUT /api/kas` mengembalikan
`400` dengan pesan "Jurnal ... tidak balance". Pastikan form Kas mengirim baris
akun lengkap (termasuk baris kas/bank lawannya) sehingga seimbang.

---

## 5. Penanganan error

Tampilkan pesan dari field `message` pada respons `400`. Yang penting:
- `"Harap Setting Akun Default di Master Akun"` — muncul saat approve
  Penjualan/Pembelian/POS/Pelunasan/Retur bila setting akun default belum
  lengkap. Arahkan user ke pop-up Setting Default Jurnal di Master Akun.
- `"Total pembayaran (Detail Jurnal) tidak sesuai dengan total pelunasan"` —
  baris pembayaran tidak balance dengan total pelunasan.
- `"Jurnal ... tidak balance ..."` — input Kas tidak seimbang.
