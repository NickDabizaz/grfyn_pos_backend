/**
 * Library untuk generate kode transaksi dengan format: PREFIX.KODELOKASI.TGL.NOMOR
 * Contoh: JL.A01.250510.001 (Jual lokasi A01 tanggal 10 Mei 2025 nomor 001)
 * Menggunakan advisory lock (GET_LOCK) untuk mencegah race condition penomoran.
 *
 * Fungsi yang diekspor: generateKode (umum), generateKodeMaster (kode master data),
 * generateKodeClosing, generateKodeHitungHPP, serta fungsi spesifik per jenis transaksi.
 */

// Menjalankan fn sambil memegang advisory lock MySQL. Berbeda dengan LOCK TABLES,
// GET_LOCK/RELEASE_LOCK tidak memicu implicit commit sehingga transaksi tetap utuh.
async function withKodeLock(conn, lockName, fn) {
  await conn.query('SELECT GET_LOCK(?, 10) AS l', [lockName]);
  try {
    return await fn();
  } finally {
    await conn.query('SELECT RELEASE_LOCK(?) AS r', [lockName]);
  }
}

// Fungsi inti: generate kode transaksi dengan format PREFIX.KODELOKASI.YYMMDD.NNN
async function generateKode(conn, prefix, idtenant, idlokasi, table, column) {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const dateStr = `${yy}${mm}${dd}`;

  // Ambil kode lokasi untuk digabung ke kode transaksi
  let sql = 'SELECT kodelokasi FROM lokasi WHERE idtenant = ? AND idlokasi = ?';
  const [[lokasi]] = await conn.query(sql,
    [idtenant, idlokasi]
  );
  const kdlok = lokasi.kodelokasi;

  table = table.toLowerCase(); // Nama tabel case-sensitive di sebagian OS
  const kodepattern = `${prefix}.${kdlok}.${dateStr}.%`;

  // Advisory lock per tenant+tabel — cegah duplikasi nomor tanpa memutus transaksi
  return withKodeLock(conn, `kodegen:${idtenant}:${table}`, async () => {
    // Cari nomor terakhir untuk prefix+kodelokasi+tanggal yang sama
    let sql3 = `SELECT MAX(${column}) as maxKode FROM ${table}
       WHERE idtenant = ? AND idlokasi = ? AND ${column} LIKE ?`;
    const [[{ maxKode }]] = await conn.query(sql3,
      [idtenant, idlokasi, kodepattern]
    );

    let num = 1;
    if (maxKode) {
      const parts = maxKode.split('.');
      num = parseInt(parts[parts.length - 1]) + 1;
    }

    return `${prefix}.${kdlok}.${dateStr}.${String(num).padStart(3, '0')}`;
  });
}

// Generate kode penjualan: format JL.KODELOKASI.YYMMDD.NNN
async function generateKodeJual(conn, idtenant, idlokasi) {
  return generateKode(conn, 'JL', idtenant, idlokasi, 'jual', 'kodejual');
}

// Generate kode pembelian: format BL.KODELOKASI.YYMMDD.NNN
async function generateKodeBeli(conn, idtenant, idlokasi) {
  return generateKode(conn, 'BL', idtenant, idlokasi, 'beli', 'kodebeli');
}

// Generate kode penyesuaian stok: format PS.KODELOKASI.YYMMDD.NNN
async function generateKodePenyesuaian(conn, idtenant, idlokasi) {
  return generateKode(conn, 'PS', idtenant, idlokasi, 'penyesuaianstok', 'kodepenyesuaianstok');
}

// Generate kode kas masuk/keluar: format KS.KODELOKASI.YYMMDD.NNN
async function generateKodeKas(conn, idtenant, idlokasi) {
  return generateKode(conn, 'KS', idtenant, idlokasi, 'kas', 'kodekas');
}

// Generate kode saldo stok: format SS.KODELOKASI.YYMMDD.NNN
async function generateKodeSaldoStok(conn, idtenant, idlokasi) {
  return generateKode(conn, 'SS', idtenant, idlokasi, 'saldostok', 'kodesaldostok');
}

// Generate kode closing: format CL.KODELOKASI.YYMM.NNN (hanya bulan-tahun, tanpa tanggal)
async function generateKodeClosing(conn, idtenant, idlokasi) {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dateStr = `${yy}${mm}`; // Format YYMM (tanpa tanggal)

  let sql = 'SELECT kodelokasi FROM lokasi WHERE idtenant = ? AND idlokasi = ?';
  const [[lokasi]] = await conn.query(sql,
    [idtenant, idlokasi]
  );
  const kdlok = lokasi.kodelokasi;

  const kodepattern = `CL.${kdlok}.${dateStr}.%`;

  return withKodeLock(conn, `kodegen:${idtenant}:closing`, async () => {
    let sql3 = `SELECT MAX(kodeclosing) as maxKode FROM closing
       WHERE idtenant = ? AND idlokasi = ? AND kodeclosing LIKE ?`;
    const [[{ maxKode }]] = await conn.query(sql3,
      [idtenant, idlokasi, kodepattern]
    );

    let num = 1;
    if (maxKode) {
      const parts = maxKode.split('.');
      num = parseInt(parts[parts.length - 1]) + 1;
    }

    return `CL.${kdlok}.${dateStr}.${String(num).padStart(3, '0')}`;
  });
}

// Generate kode master data (barang, customer, supplier, dll): format PREFIXNNNN (tanpa lokasi dan tanggal)
async function generateKodeMaster(conn, prefix, idtenant, table, column, pad = 4) {
  const sql = `SELECT ${column} AS kode FROM ${table} WHERE idtenant = ? AND ${column} LIKE ?`;
  const [rows] = await conn.query(sql, [idtenant, `${prefix}%`]);
  const pattern = new RegExp(`^${prefix}(\\d+)$`);
  const maxNum = rows.reduce((max, row) => {
    const match = String(row.kode || '').match(pattern);
    if (!match) return max;
    const number = parseInt(match[1], 10);
    return Number.isFinite(number) ? Math.max(max, number) : max;
  }, 0);

  return `${prefix}${String(maxNum + 1).padStart(pad, '0')}`; // Contoh: BRG0001
}

// Generate kode perhitungan HPP: format HPP.KODELOKASI.YYYYMM.NNN
async function generateKodeHitungHPP(conn, idtenant, idlokasi, periodbulan) {
  const [yyyy, mm] = periodbulan.split('-');
  const dateStr = `${yyyy}${mm}`;

  let sql = 'SELECT kodelokasi FROM lokasi WHERE idtenant = ? AND idlokasi = ?';
  const [[lokasi]] = await conn.query(sql,
    [idtenant, idlokasi]
  );
  const kdlok = lokasi.kodelokasi;
  const pattern = `HPP.${kdlok}.${dateStr}.%`;

  return withKodeLock(conn, `kodegen:${idtenant}:hitunghpp`, async () => {
    let sql3 = `SELECT MAX(kodehitunghpp) as maxKode FROM hitunghpp
       WHERE idtenant = ? AND idlokasi = ? AND kodehitunghpp LIKE ?`;
    const [[{ maxKode }]] = await conn.query(sql3,
      [idtenant, idlokasi, pattern]
    );
    let num = 1;
    if (maxKode) {
      const parts = maxKode.split('.');
      num = parseInt(parts[parts.length - 1]) + 1;
    }
    return `HPP.${kdlok}.${dateStr}.${String(num).padStart(3, '0')}`;
  });
}

// Generate kode retur penjualan: format RJ.KODELOKASI.YYMMDD.NNN
async function generateKodeReturJual(conn, idtenant, idlokasi) {
  return generateKode(conn, 'RJ', idtenant, idlokasi, 'returjual', 'kodereturjual');
}

// Generate kode retur pembelian: format RB.KODELOKASI.YYMMDD.NNN
async function generateKodeReturBeli(conn, idtenant, idlokasi) {
  return generateKode(conn, 'RB', idtenant, idlokasi, 'returbeli', 'kodereturbeli');
}

// Generate kode tukar barang: format TB.KODELOKASI.YYMMDD.NNN
async function generateKodeTukarBarang(conn, idtenant, idlokasi) {
  return generateKode(conn, 'TB', idtenant, idlokasi, 'tukarbarang', 'kodetukarbarang');
}

// Generate kode pelunasan piutang: format PP.KODELOKASI.YYMMDD.NNN
async function generateKodePelunasanPiutang(conn, idtenant, idlokasi) {
  return generateKode(conn, 'PP', idtenant, idlokasi, 'pelunasanpiutang', 'kodepelunasan');
}

// Generate kode pelunasan hutang: format PH.KODELOKASI.YYMMDD.NNN
async function generateKodePelunasanHutang(conn, idtenant, idlokasi) {
  return generateKode(conn, 'PH', idtenant, idlokasi, 'pelunasanhutang', 'kodepelunasan');
}

// Generate kode produksi: format PRD.KODELOKASI.YYMMDD.NNN
async function generateKodeProduksi(conn, idtenant, idlokasi) {
  return generateKode(conn, 'PRD', idtenant, idlokasi, 'produksi', 'kodeproduksi');
}

// Generate kode transfer stok: format TS.KODELOKASI.YYMMDD.NNN
async function generateKodeTransferStok(conn, idtenant, idlokasi) {
  return generateKode(conn, 'TS', idtenant, idlokasi, 'transferstok', 'kodetransferstok');
}

// Generate kode shift kasir: format SH.KODELOKASI.YYMMDD.NNN
async function generateKodeShift(conn, idtenant, idlokasi) {
  return generateKode(conn, 'SH', idtenant, idlokasi, 'shift', 'kodeshift');
}

// Generate kode purchase order: format PO.KODELOKASI.YYMMDD.NNN
async function generateKodePO(conn, idtenant, idlokasi) {
  return generateKode(conn, 'PO', idtenant, idlokasi, 'purchaseorder', 'kodepo');
}

// Generate kode BPB: format BPB.KODELOKASI.YYMMDD.NNN
async function generateKodeBPB(conn, idtenant, idlokasi) {
  return generateKode(conn, 'BPB', idtenant, idlokasi, 'bpb', 'kodebpb');
}

// Generate kode stock opname: format SOP.KODELOKASI.YYMMDD.NNN
async function generateKodeStockOpname(conn, idtenant, idlokasi) {
  return generateKode(conn, 'SOP', idtenant, idlokasi, 'stockopname', 'kodestockopname');
}

// Generate kode sales order: format SO.KODELOKASI.YYMMDD.NNN
async function generateKodeSO(conn, idtenant, idlokasi) {
  return generateKode(conn, 'SO', idtenant, idlokasi, 'salesorder', 'kodeso');
}

// Generate kode BPK: format BPK.KODELOKASI.YYMMDD.NNN
async function generateKodeBPK(conn, idtenant, idlokasi) {
  return generateKode(conn, 'BPK', idtenant, idlokasi, 'bpk', 'kodebpk');
}

// Generate kode payroll: format PAY.KODELOKASI.YYMM.NNN (monthly)
async function generateKodePayroll(conn, idtenant, idlokasi) {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dateStr = `${yy}${mm}`;

  const [[lokasi]] = await conn.query('SELECT kodelokasi FROM lokasi WHERE idtenant = ? AND idlokasi = ?', [idtenant, idlokasi]);
  const kdlok = lokasi.kodelokasi;
  const pattern = `PAY.${kdlok}.${dateStr}.%`;

  return withKodeLock(conn, `kodegen:${idtenant}:payroll`, async () => {
    const [[{ maxKode }]] = await conn.query(
      `SELECT MAX(kodepayroll) as maxKode FROM payroll WHERE idtenant = ? AND idlokasi = ? AND kodepayroll LIKE ?`,
      [idtenant, idlokasi, pattern]
    );
    let num = 1;
    if (maxKode) num = parseInt(maxKode.split('.').pop()) + 1;
    return `PAY.${kdlok}.${dateStr}.${String(num).padStart(3, '0')}`;
  });
}

module.exports = {
  generateKode,
  generateKodeJual,
  generateKodeBeli,
  generateKodePenyesuaian,
  generateKodeKas,
  generateKodeSaldoStok,
  generateKodeClosing,
  generateKodeMaster,
  generateKodeHitungHPP,
  generateKodeReturJual,
  generateKodeReturBeli,
  generateKodeTukarBarang,
  generateKodePelunasanPiutang,
  generateKodePelunasanHutang,
  generateKodeProduksi,
  generateKodeTransferStok,
  generateKodeShift,
  generateKodePO,
  generateKodeBPB,
  generateKodeStockOpname,
  generateKodePayroll,
  generateKodeSO,
  generateKodeBPK,
};
