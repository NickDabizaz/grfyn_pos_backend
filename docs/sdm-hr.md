# SDM / Human Resources

## Modul

1. **Karyawan** — Master data karyawan dengan komponen gaji
2. **Absensi** — Pencatatan kehadiran harian
3. **Payroll** — Penggajian bulanan dengan jurnal akuntansi

## Karyawan

### Endpoints

```
GET    /api/karyawan              # daftar (filter: status, search)
GET    /api/karyawan/:id          # detail
POST   /api/karyawan              # tambah karyawan
PUT    /api/karyawan/:id          # update karyawan
DELETE /api/karyawan/:id          # nonaktifkan karyawan
GET    /api/karyawan/:id/komponen # list komponen gaji
POST   /api/karyawan/:id/komponen # set/replace komponen gaji
```

### Komponen Gaji

Body untuk set komponen:
```json
{
  "items": [
    { "namakomponan": "Tunjangan Transport", "jenis": "TUNJANGAN", "amount": 200000 },
    { "namakomponan": "Potongan BPJS", "jenis": "POTONGAN", "amount": 50000 }
  ]
}
```

Nilai `jenis`: `TUNJANGAN` atau `POTONGAN`

## Absensi

### Endpoints

```
GET  /api/absensi               # daftar (filter: idkaryawan, bulan, tglwal, tglakhir)
POST /api/absensi               # catat absensi
PUT  /api/absensi/:id           # update absensi
GET  /api/absensi/rekap         # rekap bulanan per karyawan
```

### Jenis Absensi

`HADIR`, `IZIN`, `SAKIT`, `CUTI`, `ALPHA`

Unique constraint: satu karyawan hanya boleh punya satu record per hari (`uq_absensi`).

## Payroll

### Flow Payroll

```
Generate (DRAFT) → Posting (POSTED)
```

### Endpoints

```
GET  /api/payroll                  # daftar
GET  /api/payroll/:id              # detail + per-karyawan
POST /api/payroll/generate         # hitung payroll periode
PUT  /api/payroll/:id/posting      # posting jurnal
```

### Generate Payroll

Body: `{ "periodbulan": "2025-05", "tglawal": "2025-05-01", "tglakhir": "2025-05-31" }`

Untuk setiap karyawan AKTIF:
1. Ambil `gajipoko` dari master karyawan
2. Hitung `total_tunjangan` dari `komponengaji` jenis TUNJANGAN
3. Hitung `total_potongan` dari `komponengaji` jenis POTONGAN
4. Hitung `hari_hadir` dari absensi jenis HADIR dalam periode
5. `gaji_bersih = gajipoko + total_tunjangan - total_potongan`

### Posting Payroll

Body: `{ "idakun_beban": 10, "idakun_hutang": 11 }` (opsional)

Jika tidak diisi, sistem akan mencari akun berdasarkan kode COA standar:
- Beban Gaji: kodeakun `5-1003`
- Hutang Gaji: kodeakun `2-1002`

Jurnal yang dibuat:
- DEBET: Akun Beban Gaji (sebesar `total_bruto`)
- KREDIT: Akun Hutang Gaji (sebesar `total_neto`)
- `tgltrans` = hari terakhir periode (last day of month)

### Kode Transaksi Payroll

Format: `PAY.KODELOKASI.YYMM.NNN` (monthly, tanpa tanggal)
