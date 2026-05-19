// Helper terpusat untuk posting & penghapusan jurnal akuntansi.
// Dipakai oleh penjualan, pembelian, POS, pelunasan piutang/hutang, retur, dan kas.

const { getConfigValue } = require('./confighelper');

const MODUL = 'JURNAL';

// Pemetaan key internal -> nama config pada tabel `config` (modul JURNAL)
const AKUN_CONFIG = {
  akunPiutang    : 'AKUN_PIUTANG',
  akunPenjualan  : 'AKUN_PENJUALAN',
  akunPpnKeluaran: 'AKUN_PPN_KELUARAN',
  akunHutang     : 'AKUN_HUTANG',
  akunPembelian  : 'AKUN_PEMBELIAN',
  akunPpnMasukan : 'AKUN_PPN_MASUKAN',
  akunKas        : 'AKUN_KAS',
  akunBank       : 'AKUN_BANK',
};

let schemaReady = false;

// Membuat tabel rincian pembayaran pelunasan bila belum ada (idempoten).
// Harus dipanggil SEBELUM beginTransaction agar DDL tidak meng-commit transaksi.
async function ensureJurnalSchema(conn) {
  if (schemaReady) return;
  await conn.query(`
    CREATE TABLE IF NOT EXISTS pelunasanpiutangbayar (
      idbayar     INT AUTO_INCREMENT PRIMARY KEY,
      idpelunasan INT NOT NULL,
      idtenant    INT NOT NULL,
      idakun      INT NOT NULL,
      amount      DECIMAL(15,2) NOT NULL,
      INDEX idx_ppb_pelunasan (idpelunasan),
      FOREIGN KEY (idpelunasan) REFERENCES pelunasanpiutang(idpelunasan) ON DELETE CASCADE,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idakun) REFERENCES akun(idakun)
    ) ENGINE=InnoDB
  `);
  await conn.query(`
    CREATE TABLE IF NOT EXISTS pelunasanhutangbayar (
      idbayar     INT AUTO_INCREMENT PRIMARY KEY,
      idpelunasan INT NOT NULL,
      idtenant    INT NOT NULL,
      idakun      INT NOT NULL,
      amount      DECIMAL(15,2) NOT NULL,
      INDEX idx_phb_pelunasan (idpelunasan),
      FOREIGN KEY (idpelunasan) REFERENCES pelunasanhutang(idpelunasan) ON DELETE CASCADE,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idakun) REFERENCES akun(idakun)
    ) ENGINE=InnoDB
  `);
  schemaReady = true;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

// Membaca 8 akun default jurnal dari tabel config (modul JURNAL).
// Mengembalikan map { akunPiutang, akunPenjualan, ... } berisi idakun (int) atau null.
async function getDefaultAkunJurnal(conn, idtenant) {
  const map = {};
  for (const [key, configName] of Object.entries(AKUN_CONFIG)) {
    const value = await getConfigValue(conn, idtenant, MODUL, configName);
    const id = parseInt(value, 10);
    map[key] = Number.isInteger(id) && id > 0 ? id : null;
  }
  return map;
}

// Memastikan akun default yang dibutuhkan sudah di-set; jika belum lempar error 400.
function assertAkun(akunMap, requiredKeys) {
  const missing = requiredKeys.filter(k => !akunMap[k]);
  if (missing.length) {
    throw badRequest('Harap Setting Akun Default di Master Akun');
  }
}

// Memilih akun pembayaran default berdasarkan metode bayar (TUNAI -> Kas, lainnya -> Bank).
function resolveAkunBayar(akunMap, metodbayar) {
  const key = String(metodbayar || 'TUNAI').toUpperCase() === 'TUNAI' ? 'akunKas' : 'akunBank';
  assertAkun(akunMap, [key]);
  return akunMap[key];
}

// Posting baris jurnal; memvalidasi total DEBET == total KREDIT sebelum insert.
// lines: [{ idakun, posisi: 'DEBET'|'KREDIT', amount }]
async function postJurnal(conn, { idtenant, idlokasi, idtrans, kodetrans, jenis, tgltrans, lines }) {
  const clean = (lines || [])
    .map(l => ({ idakun: l.idakun, posisi: l.posisi, amount: round2(l.amount) }))
    .filter(l => l.idakun && l.amount > 0);
  if (!clean.length) return;

  let debet = 0, kredit = 0;
  for (const l of clean) {
    if (l.posisi === 'DEBET') debet += l.amount;
    else kredit += l.amount;
  }
  if (Math.abs(round2(debet) - round2(kredit)) > 0.01) {
    throw badRequest(`Jurnal ${kodetrans || ''} tidak balance (DEBET ${round2(debet)} vs KREDIT ${round2(kredit)})`);
  }

  for (const l of clean) {
    await conn.query(
      `INSERT INTO jurnal (idtenant, idlokasi, idtrans, kodetrans, jenis, tgltrans, idakun, posisi, amount, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'AKTIF')`,
      [idtenant, idlokasi, idtrans || null, kodetrans, jenis, tgltrans, l.idakun, l.posisi, l.amount]
    );
  }
}

// Menghapus jurnal berdasarkan satu atau beberapa kodetrans.
async function hapusJurnal(conn, idtenant, kodetrans) {
  const list = (Array.isArray(kodetrans) ? kodetrans : [kodetrans]).filter(Boolean);
  if (!list.length) return;
  await conn.query('DELETE FROM jurnal WHERE idtenant = ? AND kodetrans IN (?)', [idtenant, list]);
}

// Jurnal penjualan: DEBET Piutang; KREDIT Penjualan + PPN Keluaran.
async function postJurnalPenjualan(conn, { akun, idtenant, idlokasi, idjual, kodejual, jenis = 'jual', tgltrans, grandtotal, totalppn }) {
  const gt  = round2(grandtotal);
  const ppn = round2(totalppn);
  const dpp = round2(gt - ppn);
  const required = ['akunPiutang', 'akunPenjualan'];
  if (ppn > 0) required.push('akunPpnKeluaran');
  assertAkun(akun, required);
  await postJurnal(conn, {
    idtenant, idlokasi, idtrans: idjual, kodetrans: kodejual, jenis, tgltrans,
    lines: [
      { idakun: akun.akunPiutang,     posisi: 'DEBET',  amount: gt },
      { idakun: akun.akunPenjualan,   posisi: 'KREDIT', amount: dpp },
      { idakun: akun.akunPpnKeluaran, posisi: 'KREDIT', amount: ppn },
    ],
  });
}

// Jurnal pembelian: DEBET Pembelian + PPN Masukan; KREDIT Hutang.
async function postJurnalPembelian(conn, { akun, idtenant, idlokasi, idbeli, kodebeli, tgltrans, grandtotal, totalppn }) {
  const gt  = round2(grandtotal);
  const ppn = round2(totalppn);
  const dpp = round2(gt - ppn);
  const required = ['akunHutang', 'akunPembelian'];
  if (ppn > 0) required.push('akunPpnMasukan');
  assertAkun(akun, required);
  await postJurnal(conn, {
    idtenant, idlokasi, idtrans: idbeli, kodetrans: kodebeli, jenis: 'beli', tgltrans,
    lines: [
      { idakun: akun.akunPembelian,  posisi: 'DEBET',  amount: dpp },
      { idakun: akun.akunPpnMasukan, posisi: 'DEBET',  amount: ppn },
      { idakun: akun.akunHutang,     posisi: 'KREDIT', amount: gt },
    ],
  });
}

// Jurnal pelunasan piutang: DEBET akun pembayaran (Kas/Bank); KREDIT Piutang.
async function postJurnalPelunasanPiutang(conn, { akun, idtenant, idlokasi, idpelunasan, kodepelunasan, tgltrans, payments }) {
  assertAkun(akun, ['akunPiutang']);
  const bayar = (payments || [])
    .map(p => ({ idakun: p.idakun, amount: round2(p.amount) }))
    .filter(p => p.idakun && p.amount > 0);
  const total = round2(bayar.reduce((s, p) => s + p.amount, 0));
  await postJurnal(conn, {
    idtenant, idlokasi, idtrans: idpelunasan, kodetrans: kodepelunasan, jenis: 'pelunasanpiutang', tgltrans,
    lines: [
      ...bayar.map(p => ({ idakun: p.idakun, posisi: 'DEBET', amount: p.amount })),
      { idakun: akun.akunPiutang, posisi: 'KREDIT', amount: total },
    ],
  });
}

// Jurnal pelunasan hutang: DEBET Hutang; KREDIT akun pembayaran (Kas/Bank).
async function postJurnalPelunasanHutang(conn, { akun, idtenant, idlokasi, idpelunasan, kodepelunasan, tgltrans, payments }) {
  assertAkun(akun, ['akunHutang']);
  const bayar = (payments || [])
    .map(p => ({ idakun: p.idakun, amount: round2(p.amount) }))
    .filter(p => p.idakun && p.amount > 0);
  const total = round2(bayar.reduce((s, p) => s + p.amount, 0));
  await postJurnal(conn, {
    idtenant, idlokasi, idtrans: idpelunasan, kodetrans: kodepelunasan, jenis: 'pelunasanhutang', tgltrans,
    lines: [
      { idakun: akun.akunHutang, posisi: 'DEBET', amount: total },
      ...bayar.map(p => ({ idakun: p.idakun, posisi: 'KREDIT', amount: p.amount })),
    ],
  });
}

// Jurnal retur penjualan (kebalikan penjualan): DEBET Penjualan + PPN Keluaran; KREDIT Piutang.
async function postJurnalReturJual(conn, { akun, idtenant, idlokasi, idreturjual, kodereturjual, tgltrans, total, totalppn }) {
  const tot = round2(total);
  const ppn = round2(totalppn);
  const dpp = round2(tot - ppn);
  const required = ['akunPiutang', 'akunPenjualan'];
  if (ppn > 0) required.push('akunPpnKeluaran');
  assertAkun(akun, required);
  await postJurnal(conn, {
    idtenant, idlokasi, idtrans: idreturjual, kodetrans: kodereturjual, jenis: 'returjual', tgltrans,
    lines: [
      { idakun: akun.akunPenjualan,   posisi: 'DEBET',  amount: dpp },
      { idakun: akun.akunPpnKeluaran, posisi: 'DEBET',  amount: ppn },
      { idakun: akun.akunPiutang,     posisi: 'KREDIT', amount: tot },
    ],
  });
}

// Jurnal retur pembelian (kebalikan pembelian): DEBET Hutang; KREDIT Pembelian + PPN Masukan.
async function postJurnalReturBeli(conn, { akun, idtenant, idlokasi, idreturbeli, kodereturbeli, tgltrans, total, totalppn }) {
  const tot = round2(total);
  const ppn = round2(totalppn);
  const dpp = round2(tot - ppn);
  const required = ['akunHutang', 'akunPembelian'];
  if (ppn > 0) required.push('akunPpnMasukan');
  assertAkun(akun, required);
  await postJurnal(conn, {
    idtenant, idlokasi, idtrans: idreturbeli, kodetrans: kodereturbeli, jenis: 'returbeli', tgltrans,
    lines: [
      { idakun: akun.akunHutang,     posisi: 'DEBET',  amount: tot },
      { idakun: akun.akunPembelian,  posisi: 'KREDIT', amount: dpp },
      { idakun: akun.akunPpnMasukan, posisi: 'KREDIT', amount: ppn },
    ],
  });
}

module.exports = {
  AKUN_CONFIG,
  ensureJurnalSchema,
  getDefaultAkunJurnal,
  assertAkun,
  resolveAkunBayar,
  round2,
  postJurnal,
  hapusJurnal,
  postJurnalPenjualan,
  postJurnalPembelian,
  postJurnalPelunasanPiutang,
  postJurnalPelunasanHutang,
  postJurnalReturJual,
  postJurnalReturBeli,
};
