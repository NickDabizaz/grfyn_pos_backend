// Migrasi aditif & idempoten untuk fitur Jurnal Akuntansi.
// Aman dijalankan pada database yang SUDAH berisi data (tidak menghapus apa pun).
// Jalankan: npm run migrate:jurnal

require('dotenv').config();
const mysql = require('mysql2/promise');

// Akun COA tambahan yang dibutuhkan jurnal (PPN & Pembelian)
const NEW_COA = [
  ['1-1005', 'PPN Masukan',  'ASET',       'DEBET'],
  ['2-1003', 'PPN Keluaran', 'LIABILITAS', 'KREDIT'],
  ['5-1004', 'Pembelian',    'BEBAN',      'DEBET'],
];

// Menu Laporan > Akuntansi (idmenu, idparent, kodemenu, namamenu, urutan)
const NEW_MENUS = [
  [65, 8,  'laporan.akuntansi',           'Akuntansi',        4],
  [66, 65, 'laporan.akuntansi.jurnal',    'Jurnal Transaksi', 1],
  [67, 65, 'laporan.akuntansi.bukubesar', 'Buku Besar',       2],
  [68, 65, 'laporan.akuntansi.neraca',    'Neraca',           3],
];

// Setting akun default jurnal (config modul JURNAL) -> kode akun
const JURNAL_AKUN = {
  AKUN_PIUTANG     : '1-1003',
  AKUN_PENJUALAN   : '4-1001',
  AKUN_PPN_KELUARAN: '2-1003',
  AKUN_HUTANG      : '2-1001',
  AKUN_PEMBELIAN   : '5-1004',
  AKUN_PPN_MASUKAN : '1-1005',
  AKUN_KAS         : '1-1001',
  AKUN_BANK        : '1-1002',
};

async function migrateJurnal() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    port: parseInt(process.env.DB_PORT) || 3306,
  });
  await conn.query(`USE \`${process.env.DB_NAME || 'grfyn_pos'}\``);
  console.log('Connected. Menjalankan migrasi jurnal akuntansi...');

  // 1. Tabel rincian pembayaran pelunasan (Detail Jurnal)
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
  console.log('- Tabel pembayaran pelunasan siap');

  // 2. Kolom status pada tabel pelunasan (bila belum ada)
  for (const tbl of ['pelunasanpiutang', 'pelunasanhutang']) {
    const [cols] = await conn.query(`SHOW COLUMNS FROM ${tbl} LIKE 'status'`);
    if (!cols.length) {
      await conn.query(`ALTER TABLE ${tbl} ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'APPROVED' AFTER catatan`);
    }
  }
  console.log('- Kolom status pelunasan siap');

  // 3. Menu Laporan Akuntansi (tabel menu bersifat global)
  for (const [idmenu, idparent, kodemenu, namamenu, urutan] of NEW_MENUS) {
    await conn.query(
      'INSERT IGNORE INTO menu (idmenu, idparent, kodemenu, namamenu, urutan, icon, path) VALUES (?, ?, ?, ?, ?, NULL, NULL)',
      [idmenu, idparent, kodemenu, namamenu, urutan]
    );
  }
  console.log('- Menu Laporan Akuntansi siap');

  // 4. Per tenant: akun COA baru + setting akun default jurnal
  const [tenants] = await conn.query('SELECT idtenant FROM tenant');
  for (const { idtenant } of tenants) {
    for (const [kode, nama, jenis, saldo] of NEW_COA) {
      await conn.query(
        'INSERT IGNORE INTO akun (idtenant, kodeakun, namaakun, jenisak, saldo, status, userentry) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [idtenant, kode, nama, jenis, saldo, 'AKTIF', 0]
      );
    }
    for (const [configName, kodeakun] of Object.entries(JURNAL_AKUN)) {
      const [[akun]] = await conn.query(
        'SELECT idakun FROM akun WHERE idtenant = ? AND kodeakun = ? LIMIT 1',
        [idtenant, kodeakun]
      );
      if (akun) {
        // INSERT IGNORE: setting yang sudah ada tidak ditimpa
        await conn.query(
          "INSERT IGNORE INTO config (idtenant, modul, config, value, status) VALUES (?, 'JURNAL', ?, ?, 1)",
          [idtenant, configName, String(akun.idakun)]
        );
      }
    }
  }
  console.log(`- COA & setting jurnal di-seed untuk ${tenants.length} tenant`);

  // 5. Back-fill usermenu untuk semua user yang sudah ada
  const [users] = await conn.query('SELECT iduser FROM user');
  for (const { iduser } of users) {
    for (const m of NEW_MENUS) {
      await conn.query(
        `INSERT IGNORE INTO usermenu (iduser, idmenu, hakakses, tambah, ubah, approve, batalapprove, bataltransaksi, cetak, status, userentry)
         VALUES (?, ?, 1, 1, 1, 1, 1, 1, 1, 'AKTIF', ?)`,
        [iduser, m[0], iduser]
      );
    }
  }
  console.log(`- usermenu di-backfill untuk ${users.length} user`);

  await conn.end();
  console.log('Migrasi jurnal akuntansi selesai.');
  process.exit(0);
}

migrateJurnal().catch(err => {
  console.error('Migrasi jurnal gagal:', err);
  process.exit(1);
});
