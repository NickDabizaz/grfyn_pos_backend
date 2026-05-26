require('dotenv').config();
const mysql = require('mysql2/promise');
const { setConfigValue } = require('./lib/confighelper');

const DEFAULT_COA = [
  ['1-1001', 'Kas Tunai', 'ASET', 'DEBET'],
  ['1-1002', 'Bank Operasional', 'ASET', 'DEBET'],
  ['1-1003', 'Piutang Usaha', 'ASET', 'DEBET'],
  ['1-1004', 'Persediaan Barang Dagang', 'ASET', 'DEBET'],
  ['1-1005', 'PPN Masukan', 'ASET', 'DEBET'],
  ['1-1006', 'Uang Muka Pembelian', 'ASET', 'DEBET'],
  ['1-1007', 'Piutang Karyawan', 'ASET', 'DEBET'],
  ['1-1008', 'Piutang Lain-lain', 'ASET', 'DEBET'],
  ['1-1009', 'Penyisihan Piutang Tak Tertagih', 'ASET', 'KREDIT'],
  ['1-1010', 'Kas Kecil', 'ASET', 'DEBET'],
  ['1-1011', 'Bank BCA', 'ASET', 'DEBET'],
  ['1-1012', 'Bank Mandiri', 'ASET', 'DEBET'],
  ['1-1013', 'Bank BRI', 'ASET', 'DEBET'],
  ['1-1014', 'QRIS / E-Wallet Clearing', 'ASET', 'DEBET'],
  ['1-1015', 'Giro / Cek Diterima', 'ASET', 'DEBET'],
  ['1-1020', 'Sewa Dibayar Dimuka', 'ASET', 'DEBET'],
  ['1-1021', 'Asuransi Dibayar Dimuka', 'ASET', 'DEBET'],
  ['1-1030', 'Peralatan Toko', 'ASET', 'DEBET'],
  ['1-1031', 'Akumulasi Penyusutan Peralatan', 'ASET', 'KREDIT'],
  ['1-1032', 'Kendaraan', 'ASET', 'DEBET'],
  ['1-1033', 'Akumulasi Penyusutan Kendaraan', 'ASET', 'KREDIT'],
  ['1-1040', 'Deposit / Uang Jaminan', 'ASET', 'DEBET'],

  ['2-1001', 'Hutang Usaha', 'LIABILITAS', 'KREDIT'],
  ['2-1002', 'Hutang Gaji', 'LIABILITAS', 'KREDIT'],
  ['2-1003', 'PPN Keluaran', 'LIABILITAS', 'KREDIT'],
  ['2-1004', 'PPN Kurang Bayar', 'LIABILITAS', 'KREDIT'],
  ['2-1005', 'Hutang PPh', 'LIABILITAS', 'KREDIT'],
  ['2-1006', 'Hutang Biaya', 'LIABILITAS', 'KREDIT'],
  ['2-1007', 'Uang Muka Penjualan', 'LIABILITAS', 'KREDIT'],
  ['2-1008', 'Hutang Bank Jangka Pendek', 'LIABILITAS', 'KREDIT'],
  ['2-2001', 'Hutang Bank Jangka Panjang', 'LIABILITAS', 'KREDIT'],

  ['3-1001', 'Modal Pemilik', 'EKUITAS', 'KREDIT'],
  ['3-1002', 'Laba Ditahan', 'EKUITAS', 'KREDIT'],
  ['3-1003', 'Prive / Dividen', 'EKUITAS', 'DEBET'],
  ['3-1004', 'Laba Tahun Berjalan', 'EKUITAS', 'KREDIT'],

  ['4-1001', 'Penjualan Barang Dagang', 'PENDAPATAN', 'KREDIT'],
  ['4-1002', 'Penjualan Jasa', 'PENDAPATAN', 'KREDIT'],
  ['4-1003', 'Diskon Penjualan', 'PENDAPATAN', 'DEBET'],
  ['4-1004', 'Retur Penjualan', 'PENDAPATAN', 'DEBET'],
  ['4-1005', 'Pendapatan Ongkir', 'PENDAPATAN', 'KREDIT'],
  ['4-1006', 'Pendapatan Lain-lain', 'PENDAPATAN', 'KREDIT'],
  ['4-1007', 'Selisih Pembulatan Penjualan', 'PENDAPATAN', 'KREDIT'],

  ['5-1001', 'Harga Pokok Penjualan', 'BEBAN', 'DEBET'],
  ['5-1002', 'Beban Operasional', 'BEBAN', 'DEBET'],
  ['5-1003', 'Beban Gaji', 'BEBAN', 'DEBET'],
  ['5-1004', 'Pembelian Barang Dagang', 'BEBAN', 'DEBET'],
  ['5-1005', 'Retur Pembelian', 'BEBAN', 'KREDIT'],
  ['5-1006', 'Diskon Pembelian', 'BEBAN', 'KREDIT'],
  ['5-1007', 'Ongkos Angkut Pembelian', 'BEBAN', 'DEBET'],
  ['5-1008', 'Selisih Stok', 'BEBAN', 'DEBET'],
  ['5-1009', 'Penyesuaian Persediaan', 'BEBAN', 'DEBET'],

  ['6-1001', 'Beban Sewa', 'BEBAN', 'DEBET'],
  ['6-1002', 'Beban Listrik dan Air', 'BEBAN', 'DEBET'],
  ['6-1003', 'Beban Internet', 'BEBAN', 'DEBET'],
  ['6-1004', 'Beban Telepon', 'BEBAN', 'DEBET'],
  ['6-1005', 'Beban ATK', 'BEBAN', 'DEBET'],
  ['6-1006', 'Beban Penyusutan', 'BEBAN', 'DEBET'],
  ['6-1007', 'Beban Perlengkapan', 'BEBAN', 'DEBET'],
  ['6-1008', 'Beban Promosi', 'BEBAN', 'DEBET'],
  ['6-1009', 'Beban Transportasi', 'BEBAN', 'DEBET'],
  ['6-1010', 'Beban Administrasi Bank', 'BEBAN', 'DEBET'],
  ['6-1011', 'Beban Pembulatan', 'BEBAN', 'DEBET'],
  ['6-1012', 'Beban Pajak', 'BEBAN', 'DEBET'],
  ['6-1013', 'Beban Perbaikan dan Pemeliharaan', 'BEBAN', 'DEBET'],
  ['6-1014', 'Beban Kebersihan', 'BEBAN', 'DEBET'],
  ['6-1015', 'Beban Keamanan', 'BEBAN', 'DEBET'],
  ['6-1016', 'Beban Lain-lain', 'BEBAN', 'DEBET'],
];

const DEFAULT_JURNAL_AKUN = {
  AKUN_PIUTANG     : '1-1003',
  AKUN_PENJUALAN   : '4-1001',
  AKUN_PPN_KELUARAN: '2-1003',
  AKUN_HUTANG      : '2-1001',
  AKUN_PEMBELIAN   : '5-1004',
  AKUN_PPN_MASUKAN : '1-1005',
  AKUN_KAS         : '1-1001',
  AKUN_BANK        : '1-1002',
};

async function migrate() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    port: parseInt(process.env.DB_PORT) || 3306
  });

  console.log('Connected to MySQL');

  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME || 'grfyn_pos'}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await connection.query(`USE \`${process.env.DB_NAME || 'grfyn_pos'}\``);
  console.log(`Database ${process.env.DB_NAME} ready`);

  // Drop tables in reverse dependency order (child first, parent last)
  const tables = [
    'webhook_log', 'webhook_config',
    'refresh_token',
    'audit_trail',
    'batch_lot',
    'lembur_karyawan', 'cuti_karyawan',
    'anggarandtl', 'anggaran',
    'penyusutan_aset', 'aset',
    'poin_transaksi', 'poin_customer', 'poin_setting',
    'hargajual_leveldtl', 'hargajual_level',
    'diskondtl', 'diskon',
    'subscription_payment',
    'menutemplatedtl', 'usermenu', 'userlokasi',
    'closingdtl', 'closing',
    'payrolldtl', 'payroll',
    'absensi', 'komponengaji', 'karyawan',
    'stockopnamedtl', 'stockopname',
    'bpbdtl', 'bpb',
    'purchaseorderdtl', 'purchaseorder',
    'bpkdtl', 'bpk',
    'salesorderdtl', 'salesorder',
    'transferstokdtl', 'transferstok',
    'setorantunai', 'modalawal', 'shift',
    'saldostokdtl', 'saldostok',
    'produksidtl', 'produksi',
    'resepdtl', 'resep',
    'hitunghppdtl', 'hitunghpp',
    'saldoawaldtl', 'saldoawal',
    'penyesuaianstokdtl', 'penyesuaianstok',
    'kartustok',
    'tukarbarangdtl_baru', 'tukarbarangdtl_kembali', 'tukarbarang',
    'pelunasanpiutangbayar', 'pelunasanpiutangdtl', 'pelunasanpiutang', 'kartupiutang',
    'pelunasanhutangbayar', 'pelunasanhutangdtl', 'pelunasanhutang', 'kartuhutang',
    'returjualdtl', 'returjual',
    'returbelidtl', 'returbeli',
    'belidtl', 'beli', 'jualdtl', 'jual',
    'hargajual', 'hargabeli',
    'kasdtl', 'kas', 'jurnal',
    'barang', 'supplier', 'customer',
    'akun',
    'menutemplate',
    'config',
    'user', 'lokasi', 'tenant',
    'subscription_plan',
    'menu', 'currency',
    'historyprogram'
  ];
  for (const t of tables) {
    await connection.query(`DROP TABLE IF EXISTS \`${t}\``);
  }
  console.log('Tables dropped');

  // ============================================================
  // GLOBAL TABLES (shared semua tenant)
  // ============================================================

  // historyprogram
  await connection.query(`
    CREATE TABLE historyprogram (
      idhistory   INT AUTO_INCREMENT PRIMARY KEY,
      idtenant    INT DEFAULT NULL,
      idlokasi    INT DEFAULT NULL,
      iduser      INT DEFAULT NULL,
      action      VARCHAR(50) NOT NULL,
      ref         VARCHAR(100) DEFAULT NULL,
      detail      TEXT DEFAULT NULL,
      ip          VARCHAR(50) DEFAULT NULL,
      useragent   VARCHAR(255) DEFAULT NULL,
      tglentry    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_history_tenant (idtenant),
      INDEX idx_history_action (action),
      INDEX idx_history_tgl (tglentry)
    ) ENGINE=InnoDB
  `);

  // currency
  await connection.query(`
    CREATE TABLE currency (
      idcurrency    INT AUTO_INCREMENT PRIMARY KEY,
      kodecurrency  VARCHAR(10) NOT NULL UNIQUE,
      namacurrency  VARCHAR(50) NOT NULL,
      simbol        VARCHAR(5) NOT NULL,
      kurs          DECIMAL(15,4) DEFAULT 1.0000,
      status        VARCHAR(20) DEFAULT 'AKTIF'
    ) ENGINE=InnoDB
  `);

  // menu
  await connection.query(`
    CREATE TABLE menu (
      idmenu    INT PRIMARY KEY,
      idparent  INT DEFAULT NULL,
      kodemenu  VARCHAR(50) NOT NULL UNIQUE,
      namamenu  VARCHAR(100) NOT NULL,
      urutan    INT DEFAULT 0,
      icon      VARCHAR(50) DEFAULT NULL,
      path      VARCHAR(100) DEFAULT NULL,
      FOREIGN KEY (idparent) REFERENCES menu(idmenu)
    ) ENGINE=InnoDB
  `);

  // ============================================================
  // TENANT TABLES
  // ============================================================

  // subscription plan
  await connection.query(`
    CREATE TABLE subscription_plan (
      idplan INT AUTO_INCREMENT PRIMARY KEY,
      kodeplan VARCHAR(20) NOT NULL UNIQUE,
      namaplan VARCHAR(50) NOT NULL,
      harga DECIMAL(15,2) NOT NULL DEFAULT 0,
      monthly_transaction_limit INT DEFAULT NULL,
      max_users INT DEFAULT NULL,
      has_backup TINYINT(1) NOT NULL DEFAULT 0,
      has_support TINYINT(1) NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL DEFAULT 'AKTIF',
      userentry INT NOT NULL DEFAULT 0,
      tglentry TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);

  // tenant
  await connection.query(`
    CREATE TABLE tenant (
      idtenant    INT AUTO_INCREMENT PRIMARY KEY,
      namatenant  VARCHAR(100) NOT NULL,
      alamat      TEXT DEFAULT NULL,
      hp          VARCHAR(20) DEFAULT NULL,
      email       VARCHAR(100) DEFAULT NULL,
      npwp        VARCHAR(30) DEFAULT NULL,
      ppn         DECIMAL(5,2) DEFAULT 0,
      idcurrency  INT DEFAULT 1,
      logo        VARCHAR(255) DEFAULT NULL,
      subscription_plan VARCHAR(20) NOT NULL DEFAULT 'FREE',
      subscription_status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
      subscription_started_at DATETIME DEFAULT NULL,
      subscription_expires_at DATETIME DEFAULT NULL,
      status      VARCHAR(20) DEFAULT 'AKTIF',
      userentry   INT NOT NULL DEFAULT 0,
      FOREIGN KEY (idcurrency) REFERENCES currency(idcurrency)
    ) ENGINE=InnoDB
  `);

  // subscription payment
  await connection.query(`
    CREATE TABLE subscription_payment (
      idpayment INT AUTO_INCREMENT PRIMARY KEY,
      idtenant INT NOT NULL,
      order_id VARCHAR(100) NOT NULL UNIQUE,
      plan_code VARCHAR(20) NOT NULL,
      amount DECIMAL(15,2) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
      midtrans_token VARCHAR(255) DEFAULT NULL,
      midtrans_redirect_url VARCHAR(500) DEFAULT NULL,
      midtrans_transaction_status VARCHAR(50) DEFAULT NULL,
      midtrans_payment_type VARCHAR(50) DEFAULT NULL,
      midtrans_fraud_status VARCHAR(50) DEFAULT NULL,
      paid_at DATETIME DEFAULT NULL,
      expired_at DATETIME DEFAULT NULL,
      raw_notification TEXT DEFAULT NULL,
      userentry INT NOT NULL DEFAULT 0,
      tglentry TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      INDEX idx_subscription_payment_tenant (idtenant),
      INDEX idx_subscription_payment_status (status)
    ) ENGINE=InnoDB
  `);

  // lokasi
  await connection.query(`
    CREATE TABLE lokasi (
      idlokasi    INT AUTO_INCREMENT PRIMARY KEY,
      idtenant    INT NOT NULL,
      kodelokasi  VARCHAR(20) NOT NULL,
      namalokasi  VARCHAR(100) NOT NULL,
      alamat      TEXT DEFAULT NULL,
      hp          VARCHAR(20) DEFAULT NULL,
      isdefault   TINYINT DEFAULT 0,
      status      VARCHAR(20) DEFAULT 'AKTIF',
      userentry   INT NOT NULL DEFAULT 0,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      UNIQUE KEY uq_lokasi_kode (idtenant, kodelokasi)
    ) ENGINE=InnoDB
  `);

  // user
  await connection.query(`
    CREATE TABLE user (
      iduser        INT AUTO_INCREMENT PRIMARY KEY,
      idtenant      INT NOT NULL,
      username      VARCHAR(50) NOT NULL,
      pass          VARCHAR(100) NOT NULL,
      namauser      VARCHAR(100) NOT NULL,
      email         VARCHAR(100) DEFAULT NULL,
      hp            VARCHAR(20) DEFAULT NULL,
      isowner       TINYINT DEFAULT 0,
      tokenversion  INT DEFAULT 1,
      status        VARCHAR(20) DEFAULT 'DRAFT',
      userentry     INT NOT NULL DEFAULT 0,
      tglentry      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      UNIQUE KEY uq_user_username (idtenant, username)
    ) ENGINE=InnoDB
  `);

  // menutemplate
  await connection.query(`
    CREATE TABLE menutemplate (
      idmenutemplate  INT AUTO_INCREMENT PRIMARY KEY,
      idtenant        INT NOT NULL,
      namatemplate    VARCHAR(100) NOT NULL,
      status          VARCHAR(20) DEFAULT 'APPROVED',
      userentry       INT NOT NULL DEFAULT 0,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant)
    ) ENGINE=InnoDB
  `);

  // menutemplatedtl
  await connection.query(`
    CREATE TABLE menutemplatedtl (
      idmenutemplatedtl  INT AUTO_INCREMENT PRIMARY KEY,
      idmenutemplate     INT NOT NULL,
      idmenu             INT NOT NULL,
      status             VARCHAR(20) DEFAULT 'AKTIF',
      FOREIGN KEY (idmenutemplate) REFERENCES menutemplate(idmenutemplate) ON DELETE CASCADE,
      FOREIGN KEY (idmenu) REFERENCES menu(idmenu)
    ) ENGINE=InnoDB
  `);

  // usermenu
  await connection.query(`
    CREATE TABLE usermenu (
      idusermenu      INT AUTO_INCREMENT PRIMARY KEY,
      iduser          INT NOT NULL,
      idmenu          INT NOT NULL,
      hakakses        TINYINT(1) NOT NULL DEFAULT 1,
      tambah          TINYINT(1) NOT NULL DEFAULT 0,
      ubah            TINYINT(1) NOT NULL DEFAULT 0,
      approve         TINYINT(1) NOT NULL DEFAULT 0,
      batalapprove    TINYINT(1) NOT NULL DEFAULT 0,
      bataltransaksi  TINYINT(1) NOT NULL DEFAULT 0,
      cetak           TINYINT(1) NOT NULL DEFAULT 0,
      status          VARCHAR(20) DEFAULT 'AKTIF',
      userentry       INT NOT NULL DEFAULT 0,
      FOREIGN KEY (iduser) REFERENCES user(iduser) ON DELETE CASCADE,
      FOREIGN KEY (idmenu) REFERENCES menu(idmenu),
      UNIQUE KEY uq_usermenu (iduser, idmenu)
    ) ENGINE=InnoDB
  `);

  // userlokasi
  await connection.query(`
    CREATE TABLE userlokasi (
      iduserlokasi  INT AUTO_INCREMENT PRIMARY KEY,
      iduser        INT NOT NULL,
      idlokasi      INT NOT NULL,
      status        VARCHAR(20) DEFAULT 'AKTIF',
      userentry     INT NOT NULL DEFAULT 0,
      FOREIGN KEY (iduser) REFERENCES user(iduser) ON DELETE CASCADE,
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      UNIQUE KEY uq_userlokasi (iduser, idlokasi)
    ) ENGINE=InnoDB
  `);

  // config
  await connection.query(`
    CREATE TABLE config (
      idtenant INT NOT NULL,
      modul    VARCHAR(50) NOT NULL,
      config   VARCHAR(50) NOT NULL,
      value    VARCHAR(100) DEFAULT NULL,
      status   INT DEFAULT 1,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      PRIMARY KEY (idtenant, modul, config),
      INDEX idx_config_tenant_modul (idtenant, modul)
    ) ENGINE=InnoDB
  `);

  // akun
  await connection.query(`
    CREATE TABLE akun (
      idakun    INT AUTO_INCREMENT PRIMARY KEY,
      idtenant  INT NOT NULL,
      kodeakun  VARCHAR(20) NOT NULL,
      namaakun  VARCHAR(100) NOT NULL,
      jenisak   VARCHAR(30) DEFAULT 'BEBAN',
      saldo     VARCHAR(10) DEFAULT 'DEBET',
      status    VARCHAR(20) DEFAULT 'AKTIF',
      userentry INT NOT NULL DEFAULT 0,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      UNIQUE KEY uq_akun_kode (idtenant, kodeakun)
    ) ENGINE=InnoDB
  `);

  // customer
  await connection.query(`
    CREATE TABLE customer (
      idcustomer       INT AUTO_INCREMENT PRIMARY KEY,
      idtenant         INT NOT NULL,
      kodecustomer     VARCHAR(20) NOT NULL,
      namacustomer     VARCHAR(100) NOT NULL,
      alamat           TEXT DEFAULT NULL,
      hp               VARCHAR(20) DEFAULT NULL,
      idhargajuallevel INT DEFAULT NULL,
      status           VARCHAR(20) DEFAULT 'AKTIF',
      userentry        INT NOT NULL DEFAULT 0,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      UNIQUE KEY uq_customer_kode (idtenant, kodecustomer)
    ) ENGINE=InnoDB
  `);

  // supplier
  await connection.query(`
    CREATE TABLE supplier (
      idsupplier    INT AUTO_INCREMENT PRIMARY KEY,
      idtenant      INT NOT NULL,
      kodesupplier  VARCHAR(20) NOT NULL,
      namasupplier  VARCHAR(100) NOT NULL,
      alamat        TEXT DEFAULT NULL,
      hp            VARCHAR(20) DEFAULT NULL,
      status        VARCHAR(20) DEFAULT 'AKTIF',
      userentry     INT NOT NULL DEFAULT 0,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      UNIQUE KEY uq_supplier_kode (idtenant, kodesupplier)
    ) ENGINE=InnoDB
  `);

  // barang
  await connection.query(`
    CREATE TABLE barang (
      idbarang     INT AUTO_INCREMENT PRIMARY KEY,
      idtenant     INT NOT NULL,
      kodebarang   VARCHAR(20) NOT NULL,
      namabarang   VARCHAR(100) NOT NULL,
      satuanbesar  VARCHAR(20) DEFAULT NULL,
      satuansedang VARCHAR(20) DEFAULT NULL,
      satuankecil  VARCHAR(20) DEFAULT NULL,
      konversi1    INT DEFAULT 0,
      konversi2    INT DEFAULT 0,
      jenis        VARCHAR(30) DEFAULT 'BARANG JADI',
      stokmin      DECIMAL(15,3) DEFAULT 0,
      foto         VARCHAR(255) DEFAULT NULL,
      has_batch    TINYINT(1) DEFAULT 0,
      idhargajuallevel INT DEFAULT NULL,
      status       VARCHAR(20) DEFAULT 'AKTIF',
      userentry    INT NOT NULL DEFAULT 0,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      UNIQUE KEY uq_barang_kode (idtenant, kodebarang),
      UNIQUE KEY uq_barang_nama (idtenant, namabarang),
      INDEX idx_barang_nama (namabarang)
    ) ENGINE=InnoDB
  `);

  // hargabeli
  await connection.query(`
    CREATE TABLE hargabeli (
      idhargabeli INT AUTO_INCREMENT PRIMARY KEY,
      idtenant    INT NOT NULL,
      idbarang    INT NOT NULL,
      hargabeli   DECIMAL(15,2) NOT NULL,
      tgltrans    DATE NOT NULL,
      idref       INT DEFAULT NULL,
      koderef     VARCHAR(30) DEFAULT NULL,
      jenisref    VARCHAR(30) DEFAULT NULL,
      status      VARCHAR(20) DEFAULT 'AKTIF',
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idbarang) REFERENCES barang(idbarang),
      INDEX idx_hargabeli_barang_tgl (idbarang, tgltrans)
    ) ENGINE=InnoDB
  `);

  // hargajual
  await connection.query(`
    CREATE TABLE hargajual (
      idhargajual INT AUTO_INCREMENT PRIMARY KEY,
      idtenant    INT NOT NULL,
      idbarang    INT NOT NULL,
      hargajual   DECIMAL(15,2) NOT NULL,
      tgltrans    DATE NOT NULL,
      idref       INT DEFAULT NULL,
      koderef     VARCHAR(30) DEFAULT NULL,
      jenisref    VARCHAR(30) DEFAULT NULL,
      status      VARCHAR(20) DEFAULT 'AKTIF',
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idbarang) REFERENCES barang(idbarang),
      INDEX idx_hargajual_barang_tgl (idbarang, tgltrans)
    ) ENGINE=InnoDB
  `);

  // jurnal
  await connection.query(`
    CREATE TABLE jurnal (
      idjurnal    INT AUTO_INCREMENT PRIMARY KEY,
      idtenant    INT NOT NULL,
      idlokasi    INT NOT NULL,
      idtrans     INT DEFAULT NULL,
      kodetrans   VARCHAR(30) DEFAULT NULL,
      jenis       VARCHAR(20) DEFAULT NULL,
      tgltrans    DATE DEFAULT NULL,
      idakun      INT NOT NULL,
      posisi      VARCHAR(10) NOT NULL,
      amount      DECIMAL(15,2) NOT NULL,
      status      VARCHAR(20) DEFAULT 'AKTIF',
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      FOREIGN KEY (idakun) REFERENCES akun(idakun),
      INDEX idx_jurnal_kodetrans (kodetrans),
      INDEX idx_jurnal_tenant_lokasi (idtenant, idlokasi),
      INDEX idx_jurnal_tgltrans (tgltrans)
    ) ENGINE=InnoDB
  `);

  // kas
  await connection.query(`
    CREATE TABLE kas (
      idkas       INT AUTO_INCREMENT PRIMARY KEY,
      idtenant    INT NOT NULL,
      idlokasi    INT NOT NULL,
      kodekas     VARCHAR(30) NOT NULL,
      tgltrans    DATE NOT NULL,
      iduser      INT NOT NULL,
      status      VARCHAR(20) DEFAULT 'DRAFT',
      userentry   INT NOT NULL DEFAULT 0,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      INDEX idx_kas_tgl (tgltrans),
      UNIQUE KEY uq_kas_kode (idtenant, idlokasi, kodekas)
    ) ENGINE=InnoDB
  `);

  // kasdtl
  await connection.query(`
    CREATE TABLE kasdtl (
      idkasdtl  INT AUTO_INCREMENT PRIMARY KEY,
      idkas     INT NOT NULL,
      idtenant  INT NOT NULL,
      idakun    INT NOT NULL,
      catatan   VARCHAR(255) DEFAULT NULL,
      amount    DECIMAL(15,2) NOT NULL,
      FOREIGN KEY (idkas) REFERENCES kas(idkas) ON DELETE CASCADE,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idakun) REFERENCES akun(idakun)
    ) ENGINE=InnoDB
  `);

  // jual
  await connection.query(`
    CREATE TABLE jual (
      idjual      INT AUTO_INCREMENT PRIMARY KEY,
      idtenant    INT NOT NULL,
      idlokasi    INT NOT NULL,
      kodejual    VARCHAR(30) NOT NULL,
      tgltrans    DATE NOT NULL,
      idcustomer  INT DEFAULT NULL,
      iduser      INT NOT NULL,
      grandtotal  DECIMAL(15,2) DEFAULT 0,
      bayar       DECIMAL(15,2) DEFAULT 0,
      jenistransaksi VARCHAR(30) NOT NULL DEFAULT 'JUAL',
      idbpk       INT DEFAULT NULL,
      kodebpk     VARCHAR(50) DEFAULT NULL,
      jalurpenjualan VARCHAR(20) NOT NULL DEFAULT 'LANGSUNG',
      is_lunaslangsung TINYINT(1) NOT NULL DEFAULT 0,
      status      VARCHAR(20) DEFAULT 'DRAFT',
      userentry   INT NOT NULL DEFAULT 0,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      FOREIGN KEY (idcustomer) REFERENCES customer(idcustomer),
      UNIQUE KEY uq_jual_kode (idtenant, idlokasi, kodejual),
      INDEX idx_jual_tgl (tgltrans),
      INDEX idx_jual_customer (idcustomer)
    ) ENGINE=InnoDB
  `);

  // jualdtl
  await connection.query(`
    CREATE TABLE jualdtl (
      idjualdtl INT AUTO_INCREMENT PRIMARY KEY,
      idjual    INT NOT NULL,
      idtenant  INT NOT NULL,
      idbarang  INT NOT NULL,
      satuan    VARCHAR(20) DEFAULT NULL,
      jml       DECIMAL(15,3) NOT NULL,
      harga     DECIMAL(15,2) NOT NULL,
      ppn       DECIMAL(15,2) DEFAULT 0,
      diskon    DECIMAL(5,2) DEFAULT 0,
      subtotal  DECIMAL(15,2) NOT NULL,
      FOREIGN KEY (idjual) REFERENCES jual(idjual) ON DELETE CASCADE,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idbarang) REFERENCES barang(idbarang),
      INDEX idx_jualdtl_barang (idbarang)
    ) ENGINE=InnoDB
  `);

  // beli
  await connection.query(`
    CREATE TABLE beli (
      idbeli      INT AUTO_INCREMENT PRIMARY KEY,
      idtenant    INT NOT NULL,
      idlokasi    INT NOT NULL,
      kodebeli    VARCHAR(30) NOT NULL,
      tgltrans    DATE NOT NULL,
      idsupplier  INT DEFAULT NULL,
      iduser      INT NOT NULL,
      grandtotal  DECIMAL(15,2) DEFAULT 0,
      bayar       DECIMAL(15,2) DEFAULT 0,
      jenistransaksi VARCHAR(30) NOT NULL DEFAULT 'BELI',
      idbpb       INT DEFAULT NULL,
      kodebpb     VARCHAR(50) DEFAULT NULL,
      jalurpembelian VARCHAR(20) NOT NULL DEFAULT 'LANGSUNG',
      is_lunaslangsung TINYINT(1) NOT NULL DEFAULT 0,
      status      VARCHAR(20) DEFAULT 'DRAFT',
      userentry   INT NOT NULL DEFAULT 0,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      FOREIGN KEY (idsupplier) REFERENCES supplier(idsupplier),
      UNIQUE KEY uq_beli_kode (idtenant, idlokasi, kodebeli),
      INDEX idx_beli_tgl (tgltrans),
      INDEX idx_beli_supplier (idsupplier)
    ) ENGINE=InnoDB
  `);

  // belidtl
  await connection.query(`
    CREATE TABLE belidtl (
      idbelidtl INT AUTO_INCREMENT PRIMARY KEY,
      idbeli    INT NOT NULL,
      idtenant  INT NOT NULL,
      idbarang  INT NOT NULL,
      satuan    VARCHAR(20) DEFAULT NULL,
      jml       DECIMAL(15,3) NOT NULL,
      harga     DECIMAL(15,2) NOT NULL,
      ppn       DECIMAL(15,2) DEFAULT 0,
      diskon    DECIMAL(5,2) DEFAULT 0,
      subtotal  DECIMAL(15,2) NOT NULL,
      FOREIGN KEY (idbeli) REFERENCES beli(idbeli) ON DELETE CASCADE,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idbarang) REFERENCES barang(idbarang),
      INDEX idx_belidtl_barang (idbarang)
    ) ENGINE=InnoDB
  `);

  // returbeli
  await connection.query(`
    CREATE TABLE IF NOT EXISTS returbeli (
      idreturbeli   INT AUTO_INCREMENT PRIMARY KEY,
      idtenant      INT NOT NULL,
      idlokasi      INT NOT NULL,
      kodereturbeli VARCHAR(30) NOT NULL,
      tgltrans      DATE NOT NULL,
      idsupplier    INT DEFAULT NULL,
      idbeli        INT DEFAULT NULL,
      kodebeli      VARCHAR(30) DEFAULT NULL,
      iduser        INT NOT NULL,
      total         DECIMAL(15,2) DEFAULT 0,
      catatan       TEXT DEFAULT NULL,
      status        VARCHAR(20) DEFAULT 'AKTIF',
      userentry     INT NOT NULL DEFAULT 0,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      FOREIGN KEY (idsupplier) REFERENCES supplier(idsupplier),
      UNIQUE KEY uq_returbeli_kode (idtenant, idlokasi, kodereturbeli),
      INDEX idx_returbeli_tgl (tgltrans)
    ) ENGINE=InnoDB
  `);

  // returbelidtl
  await connection.query(`
    CREATE TABLE IF NOT EXISTS returbelidtl (
      idreturbelidtl INT AUTO_INCREMENT PRIMARY KEY,
      idreturbeli    INT NOT NULL,
      idtenant       INT NOT NULL,
      idbarang       INT NOT NULL,
      satuan         VARCHAR(20) DEFAULT NULL,
      jml            DECIMAL(15,3) NOT NULL,
      harga          DECIMAL(15,2) DEFAULT 0,
      ppn            DECIMAL(15,2) DEFAULT 0,
      diskon         DECIMAL(5,2) DEFAULT 0,
      subtotal       DECIMAL(15,2) NOT NULL,
      FOREIGN KEY (idreturbeli) REFERENCES returbeli(idreturbeli) ON DELETE CASCADE,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idbarang) REFERENCES barang(idbarang)
    ) ENGINE=InnoDB
  `);

  // returjual
  await connection.query(`
    CREATE TABLE returjual (
      idreturjual   INT AUTO_INCREMENT PRIMARY KEY,
      idtenant      INT NOT NULL,
      idlokasi      INT NOT NULL,
      kodereturjual VARCHAR(30) NOT NULL,
      tgltrans      DATE NOT NULL,
      idcustomer    INT DEFAULT NULL,
      idjual        INT DEFAULT NULL,
      kodejual      VARCHAR(30) DEFAULT NULL,
      iduser        INT NOT NULL,
      total         DECIMAL(15,2) DEFAULT 0,
      catatan       TEXT DEFAULT NULL,
      status        VARCHAR(20) DEFAULT 'DRAFT',
      userentry     INT NOT NULL DEFAULT 0,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      FOREIGN KEY (idcustomer) REFERENCES customer(idcustomer),
      UNIQUE KEY uq_returjual_kode (idtenant, idlokasi, kodereturjual),
      INDEX idx_returjual_tgl (tgltrans)
    ) ENGINE=InnoDB
  `);

  // returjualdtl
  await connection.query(`
    CREATE TABLE returjualdtl (
      idreturjualdtl INT AUTO_INCREMENT PRIMARY KEY,
      idreturjual    INT NOT NULL,
      idtenant       INT NOT NULL,
      idbarang       INT NOT NULL,
      satuan         VARCHAR(20) DEFAULT NULL,
      jml            DECIMAL(15,3) NOT NULL,
      harga          DECIMAL(15,2) DEFAULT 0,
      ppn            DECIMAL(15,2) DEFAULT 0,
      diskon         DECIMAL(5,2) DEFAULT 0,
      subtotal       DECIMAL(15,2) NOT NULL,
      FOREIGN KEY (idreturjual) REFERENCES returjual(idreturjual) ON DELETE CASCADE,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idbarang) REFERENCES barang(idbarang)
    ) ENGINE=InnoDB
  `);

  // kartustok
  await connection.query(`
    CREATE TABLE kartustok (
      idkartustok INT AUTO_INCREMENT PRIMARY KEY,
      idtrans     INT DEFAULT NULL,
      kodetrans   VARCHAR(30) NOT NULL,
      jenistransaksi VARCHAR(50) DEFAULT NULL,
      idtenant    INT NOT NULL,
      idlokasi    INT NOT NULL,
      idbarang    INT NOT NULL,
      jml         DECIMAL(15,3) NOT NULL,
      jenis       VARCHAR(5) NOT NULL,
      tgltrans    DATE NOT NULL,
      keterangan  VARCHAR(200) DEFAULT NULL,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      FOREIGN KEY (idbarang) REFERENCES barang(idbarang),
      INDEX idx_kartustok_barang_tgl (idbarang, tgltrans),
      INDEX idx_kartustok_tenant_lokasi (idtenant, idlokasi),
      INDEX idx_kartustok_kodetrans (kodetrans),
      INDEX idx_kartustok_transaksi (idtrans, jenistransaksi)
    ) ENGINE=InnoDB
  `);

  // penyesuaianstok
  await connection.query(`
    CREATE TABLE penyesuaianstok (
      idpenyesuaianstok    INT AUTO_INCREMENT PRIMARY KEY,
      idtenant             INT NOT NULL,
      idlokasi             INT NOT NULL,
      kodepenyesuaianstok  VARCHAR(30) NOT NULL,
      tgltrans             DATE NOT NULL,
      iduser               INT NOT NULL,
      keterangan           VARCHAR(255) DEFAULT NULL,
      status               VARCHAR(20) DEFAULT 'AKTIF',
      userentry            INT NOT NULL DEFAULT 0,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      UNIQUE KEY uq_penyesuaian_kode (idtenant, idlokasi, kodepenyesuaianstok)
    ) ENGINE=InnoDB
  `);

  // penyesuaianstokdtl
  await connection.query(`
    CREATE TABLE penyesuaianstokdtl (
      idpenyesuaianstokdtl INT AUTO_INCREMENT PRIMARY KEY,
      idpenyesuaianstok    INT NOT NULL,
      idtenant             INT NOT NULL,
      idbarang             INT NOT NULL,
      jml                  DECIMAL(15,3) NOT NULL,
      selisih              DECIMAL(15,3) DEFAULT NULL,
      keterangan           VARCHAR(255) DEFAULT NULL,
      FOREIGN KEY (idpenyesuaianstok) REFERENCES penyesuaianstok(idpenyesuaianstok) ON DELETE CASCADE,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idbarang) REFERENCES barang(idbarang)
    ) ENGINE=InnoDB
  `);

  // saldostok
  await connection.query(`
    CREATE TABLE saldostok (
      idsaldostok   INT AUTO_INCREMENT PRIMARY KEY,
      idtenant      INT NOT NULL,
      idlokasi      INT NOT NULL,
      kodesaldostok VARCHAR(30) NOT NULL,
      tgltrans      DATE NOT NULL,
      iduser        INT NOT NULL,
      catatan       VARCHAR(255) DEFAULT NULL,
      status        VARCHAR(20) DEFAULT 'AKTIF',
      userentry     INT NOT NULL DEFAULT 0,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      UNIQUE KEY uq_saldostok_kode (idtenant, idlokasi, kodesaldostok),
      INDEX idx_saldostok_tgl (tgltrans)
    ) ENGINE=InnoDB
  `);

  // saldostokdtl
  await connection.query(`
    CREATE TABLE saldostokdtl (
      idsaldostokdtl INT AUTO_INCREMENT PRIMARY KEY,
      idsaldostok    INT NOT NULL,
      idtenant       INT NOT NULL,
      idbarang       INT NOT NULL,
      qty            DECIMAL(15,3) DEFAULT 0,
      FOREIGN KEY (idsaldostok) REFERENCES saldostok(idsaldostok) ON DELETE CASCADE,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idbarang) REFERENCES barang(idbarang)
    ) ENGINE=InnoDB
  `);

  // hitunghpp
  await connection.query(`
    CREATE TABLE hitunghpp (
      idhitunghpp     INT AUTO_INCREMENT PRIMARY KEY,
      idtenant        INT NOT NULL,
      idlokasi        INT NOT NULL,
      kodehitunghpp   VARCHAR(30) NOT NULL,
      periodbulan     VARCHAR(7) NOT NULL,
      tglawal         DATE NOT NULL,
      tglakhir        DATE NOT NULL,
      iduser          INT NOT NULL,
      catatan         TEXT DEFAULT NULL,
      totalpembelian  DECIMAL(15,2) DEFAULT 0,
      totalhppjual    DECIMAL(15,2) DEFAULT 0,
      totalsaldoakhir DECIMAL(15,2) DEFAULT 0,
      status          VARCHAR(20) DEFAULT 'AKTIF',
      userentry       INT NOT NULL DEFAULT 0,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      INDEX idx_hitunghpp_periode (periodbulan)
    ) ENGINE=InnoDB
  `);

  // hitunghppdtl
  await connection.query(`
    CREATE TABLE hitunghppdtl (
      iddetail         INT AUTO_INCREMENT PRIMARY KEY,
      idhitunghpp      INT NOT NULL,
      idtenant         INT NOT NULL,
      idbarang         INT NOT NULL,
      saldoawal_qty    DECIMAL(15,3) DEFAULT 0,
      saldoawal_nilai  DECIMAL(15,2) DEFAULT 0,
      pembelian_qty    DECIMAL(15,3) DEFAULT 0,
      pembelian_nilai  DECIMAL(15,2) DEFAULT 0,
      total_qty        DECIMAL(15,3) DEFAULT 0,
      total_nilai      DECIMAL(15,2) DEFAULT 0,
      hpp_per_unit     DECIMAL(15,6) DEFAULT 0,
      qty_jual         DECIMAL(15,3) DEFAULT 0,
      hpp_jual         DECIMAL(15,2) DEFAULT 0,
      qty_adjust       DECIMAL(15,3) DEFAULT 0,
      hpp_adjust       DECIMAL(15,2) DEFAULT 0,
      saldoakhir_qty   DECIMAL(15,3) DEFAULT 0,
      saldoakhir_nilai DECIMAL(15,2) DEFAULT 0,
      FOREIGN KEY (idhitunghpp) REFERENCES hitunghpp(idhitunghpp) ON DELETE CASCADE,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idbarang) REFERENCES barang(idbarang)
    ) ENGINE=InnoDB
  `);

  // kartupiutang
  await connection.query(`
    CREATE TABLE kartupiutang (
      idkartupiutang     INT AUTO_INCREMENT PRIMARY KEY,
      idtenant           INT NOT NULL,
      idlokasi           INT NOT NULL,
      idcustomer         INT DEFAULT NULL,
      kodetrans          VARCHAR(30) NOT NULL,
      jenis              VARCHAR(20) NOT NULL,
      kodetransreferensi VARCHAR(30) DEFAULT NULL,
      amount             DECIMAL(15,2) NOT NULL,
      terbayar           DECIMAL(15,2) DEFAULT 0,
      sisa               DECIMAL(15,2) NOT NULL,
      tgltrans           DATE NOT NULL,
      status             VARCHAR(20) DEFAULT 'OPEN',
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      FOREIGN KEY (idcustomer) REFERENCES customer(idcustomer),
      INDEX idx_kartupiutang_kodetrans (kodetrans),
      INDEX idx_kartupiutang_customer (idcustomer, status)
    ) ENGINE=InnoDB
  `);

  // pelunasanpiutang
  await connection.query(`
    CREATE TABLE pelunasanpiutang (
      idpelunasan    INT AUTO_INCREMENT PRIMARY KEY,
      idtenant       INT NOT NULL,
      idlokasi       INT NOT NULL,
      idcustomer     INT NOT NULL,
      kodepelunasan  VARCHAR(30) NOT NULL,
      tgltrans       DATE NOT NULL,
      total_amount   DECIMAL(15,2) NOT NULL,
      metodbayar     VARCHAR(20) DEFAULT 'TUNAI',
      catatan        TEXT,
      userentry      INT NOT NULL DEFAULT 0,
      tglentry       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      FOREIGN KEY (idcustomer) REFERENCES customer(idcustomer),
      UNIQUE KEY uq_pelunasan_kode (idtenant, idlokasi, kodepelunasan)
    ) ENGINE=InnoDB
  `);

  // pelunasanpiutangdtl
  await connection.query(`
    CREATE TABLE pelunasanpiutangdtl (
      idpelunasandtl INT AUTO_INCREMENT PRIMARY KEY,
      idpelunasan    INT NOT NULL,
      kodetrans      VARCHAR(30) NOT NULL,
      amount         DECIMAL(15,2) NOT NULL,
      FOREIGN KEY (idpelunasan) REFERENCES pelunasanpiutang(idpelunasan) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);

  // pelunasanpiutangbayar — rincian akun pembayaran (Detail Jurnal) untuk jurnal pelunasan piutang
  await connection.query(`
    CREATE TABLE pelunasanpiutangbayar (
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

  // kartuhutang
  await connection.query(`
    CREATE TABLE kartuhutang (
      idkartuhutang      INT AUTO_INCREMENT PRIMARY KEY,
      idtenant           INT NOT NULL,
      idlokasi           INT NOT NULL,
      idsupplier         INT DEFAULT NULL,
      kodetrans          VARCHAR(30) NOT NULL,
      jenis              VARCHAR(20) NOT NULL,
      kodetransreferensi VARCHAR(30) DEFAULT NULL,
      amount             DECIMAL(15,2) NOT NULL,
      terbayar           DECIMAL(15,2) DEFAULT 0,
      sisa               DECIMAL(15,2) NOT NULL,
      tgltrans           DATE NOT NULL,
      status             VARCHAR(20) DEFAULT 'OPEN',
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      FOREIGN KEY (idsupplier) REFERENCES supplier(idsupplier),
      INDEX idx_kartuhutang_kodetrans (kodetrans),
      INDEX idx_kartuhutang_supplier (idsupplier, status)
    ) ENGINE=InnoDB
  `);

  // pelunasanhutang
  await connection.query(`
    CREATE TABLE pelunasanhutang (
      idpelunasan    INT AUTO_INCREMENT PRIMARY KEY,
      idtenant       INT NOT NULL,
      idlokasi       INT NOT NULL,
      idsupplier     INT NOT NULL,
      kodepelunasan  VARCHAR(30) NOT NULL,
      tgltrans       DATE NOT NULL,
      total_amount   DECIMAL(15,2) NOT NULL,
      metodbayar     VARCHAR(20) DEFAULT 'TUNAI',
      catatan        TEXT,
      userentry      INT NOT NULL DEFAULT 0,
      tglentry       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      FOREIGN KEY (idsupplier) REFERENCES supplier(idsupplier),
      UNIQUE KEY uq_pelunasanhutang_kode (idtenant, idlokasi, kodepelunasan)
    ) ENGINE=InnoDB
  `);

  // pelunasanhutangdtl
  await connection.query(`
    CREATE TABLE pelunasanhutangdtl (
      idpelunasandtl INT AUTO_INCREMENT PRIMARY KEY,
      idpelunasan    INT NOT NULL,
      kodetrans      VARCHAR(30) NOT NULL,
      amount         DECIMAL(15,2) NOT NULL,
      FOREIGN KEY (idpelunasan) REFERENCES pelunasanhutang(idpelunasan) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);

  // pelunasanhutangbayar — rincian akun pembayaran (Detail Jurnal) untuk jurnal pelunasan hutang
  await connection.query(`
    CREATE TABLE pelunasanhutangbayar (
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

  // salesorder
  await connection.query(`
    CREATE TABLE salesorder (
      idso        INT AUTO_INCREMENT PRIMARY KEY,
      idtenant    INT NOT NULL,
      idlokasi    INT NOT NULL,
      kodeso      VARCHAR(30) NOT NULL,
      tgltrans    DATE NOT NULL,
      idcustomer  INT DEFAULT NULL,
      iduser      INT NOT NULL,
      grandtotal  DECIMAL(15,2) DEFAULT 0,
      catatan     TEXT DEFAULT NULL,
      status      VARCHAR(20) DEFAULT 'DRAFT',
      userentry   INT NOT NULL DEFAULT 0,
      tglentry    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      FOREIGN KEY (idcustomer) REFERENCES customer(idcustomer),
      UNIQUE KEY uq_so_kode (idtenant, idlokasi, kodeso),
      INDEX idx_so_tgl (tgltrans)
    ) ENGINE=InnoDB
  `);

  // salesorderdtl
  await connection.query(`
    CREATE TABLE salesorderdtl (
      idsodtl       INT AUTO_INCREMENT PRIMARY KEY,
      idso          INT NOT NULL,
      idtenant      INT NOT NULL,
      idbarang      INT NOT NULL,
      jml           DECIMAL(15,3) NOT NULL,
      jml_dikirim   DECIMAL(15,3) DEFAULT 0,
      satuan        VARCHAR(20) DEFAULT NULL,
      harga         DECIMAL(15,2) DEFAULT 0,
      subtotal      DECIMAL(15,2) DEFAULT 0,
      FOREIGN KEY (idso) REFERENCES salesorder(idso) ON DELETE CASCADE,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idbarang) REFERENCES barang(idbarang)
    ) ENGINE=InnoDB
  `);

  // bpk (Bukti Pengeluaran Barang - penjualan)
  await connection.query(`
    CREATE TABLE bpk (
      idbpk       INT AUTO_INCREMENT PRIMARY KEY,
      idtenant    INT NOT NULL,
      idlokasi    INT NOT NULL,
      kodebpk     VARCHAR(30) NOT NULL,
      tgltrans    DATE NOT NULL,
      idso        INT DEFAULT NULL,
      idcustomer  INT DEFAULT NULL,
      iduser      INT NOT NULL,
      grandtotal  DECIMAL(15,2) DEFAULT 0,
      catatan     TEXT DEFAULT NULL,
      status      VARCHAR(20) DEFAULT 'DRAFT',
      userentry   INT NOT NULL DEFAULT 0,
      tglentry    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      FOREIGN KEY (idso) REFERENCES salesorder(idso),
      FOREIGN KEY (idcustomer) REFERENCES customer(idcustomer),
      UNIQUE KEY uq_bpk_kode (idtenant, idlokasi, kodebpk),
      INDEX idx_bpk_tgl (tgltrans)
    ) ENGINE=InnoDB
  `);

  // bpkdtl
  await connection.query(`
    CREATE TABLE bpkdtl (
      idbpkdtl  INT AUTO_INCREMENT PRIMARY KEY,
      idbpk     INT NOT NULL,
      idtenant  INT NOT NULL,
      idbarang  INT NOT NULL,
      idsodtl   INT DEFAULT NULL,
      jml       DECIMAL(15,3) NOT NULL,
      satuan    VARCHAR(20) DEFAULT NULL,
      harga     DECIMAL(15,2) DEFAULT 0,
      subtotal  DECIMAL(15,2) DEFAULT 0,
      FOREIGN KEY (idbpk) REFERENCES bpk(idbpk) ON DELETE CASCADE,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idbarang) REFERENCES barang(idbarang)
    ) ENGINE=InnoDB
  `);

  // closing
  await connection.query(`
    CREATE TABLE closing (
      idclosing     INT AUTO_INCREMENT PRIMARY KEY,
      idtenant      INT NOT NULL,
      idlokasi      INT NOT NULL,
      kodeclosing   VARCHAR(30) NOT NULL,
      periodbulan   VARCHAR(7) NOT NULL,
      tglawal       DATE NOT NULL,
      tglakhir      DATE NOT NULL,
      iduser        INT NOT NULL,
      laba_rugi     DECIMAL(15,2) DEFAULT 0,
      catatan       TEXT DEFAULT NULL,
      status        VARCHAR(20) DEFAULT 'AKTIF',
      userentry     INT NOT NULL DEFAULT 0,
      tglentry      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      UNIQUE KEY uq_closing_kode (idtenant, idlokasi, kodeclosing),
      INDEX idx_closing_periode (idtenant, idlokasi, periodbulan)
    ) ENGINE=InnoDB
  `);

  // closingdtl
  await connection.query(`
    CREATE TABLE closingdtl (
      idclosingdtl  INT AUTO_INCREMENT PRIMARY KEY,
      idclosing     INT NOT NULL,
      idtenant      INT NOT NULL,
      idakun        INT NOT NULL,
      namaakun      VARCHAR(100) DEFAULT NULL,
      jenisak       VARCHAR(30) DEFAULT NULL,
      total_debet   DECIMAL(15,2) DEFAULT 0,
      total_kredit  DECIMAL(15,2) DEFAULT 0,
      saldo_normal  DECIMAL(15,2) DEFAULT 0,
      FOREIGN KEY (idclosing) REFERENCES closing(idclosing) ON DELETE CASCADE,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      INDEX idx_closingdtl_closing (idclosing)
    ) ENGINE=InnoDB
  `);

  // transferstok
  await connection.query(`
    CREATE TABLE transferstok (
      idtransferstok    INT AUTO_INCREMENT PRIMARY KEY,
      idtenant          INT NOT NULL,
      idlokasi          INT NOT NULL,
      kodetransferstok  VARCHAR(30) NOT NULL,
      tgltrans          DATE NOT NULL,
      idlokasitujuan    INT NOT NULL,
      iduser            INT NOT NULL,
      catatan           TEXT DEFAULT NULL,
      status            VARCHAR(20) DEFAULT 'DRAFT',
      userentry         INT NOT NULL DEFAULT 0,
      tglentry          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      FOREIGN KEY (idlokasitujuan) REFERENCES lokasi(idlokasi),
      UNIQUE KEY uq_transferstok_kode (idtenant, idlokasi, kodetransferstok),
      INDEX idx_transferstok_tgl (tgltrans)
    ) ENGINE=InnoDB
  `);

  // transferstokdtl
  await connection.query(`
    CREATE TABLE transferstokdtl (
      idtransferstokdtl INT AUTO_INCREMENT PRIMARY KEY,
      idtransferstok    INT NOT NULL,
      idtenant          INT NOT NULL,
      idbarang          INT NOT NULL,
      jml               DECIMAL(15,3) NOT NULL,
      satuan            VARCHAR(20) DEFAULT NULL,
      keterangan        VARCHAR(255) DEFAULT NULL,
      FOREIGN KEY (idtransferstok) REFERENCES transferstok(idtransferstok) ON DELETE CASCADE,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idbarang) REFERENCES barang(idbarang)
    ) ENGINE=InnoDB
  `);

  // shift
  await connection.query(`
    CREATE TABLE shift (
      idshift       INT AUTO_INCREMENT PRIMARY KEY,
      idtenant      INT NOT NULL,
      idlokasi      INT NOT NULL,
      kodeshift     VARCHAR(30) NOT NULL,
      tglshift      DATE NOT NULL,
      iduser        INT NOT NULL,
      modal_awal    DECIMAL(15,2) DEFAULT 0,
      kas_akhir     DECIMAL(15,2) DEFAULT 0,
      total_sales   DECIMAL(15,2) DEFAULT 0,
      selisih       DECIMAL(15,2) DEFAULT 0,
      catatan       TEXT DEFAULT NULL,
      status        VARCHAR(20) DEFAULT 'BUKA',
      tgl_buka      DATETIME DEFAULT NULL,
      tgl_tutup     DATETIME DEFAULT NULL,
      userentry     INT NOT NULL DEFAULT 0,
      tglentry      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      UNIQUE KEY uq_shift_kode (idtenant, idlokasi, kodeshift),
      INDEX idx_shift_tgl (tglshift)
    ) ENGINE=InnoDB
  `);

  // modalawal
  await connection.query(`
    CREATE TABLE modalawal (
      idmodalawal   INT AUTO_INCREMENT PRIMARY KEY,
      idtenant      INT NOT NULL,
      idlokasi      INT NOT NULL,
      tgltrans      DATE NOT NULL,
      amount        DECIMAL(15,2) DEFAULT 0,
      userentry     INT NOT NULL DEFAULT 0,
      tglentry      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      status        VARCHAR(20) DEFAULT 'AKTIF',
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      INDEX idx_modalawal_tgl (tgltrans)
    ) ENGINE=InnoDB
  `);

  // setorantunai
  await connection.query(`
    CREATE TABLE setorantunai (
      idsetorantunai INT AUTO_INCREMENT PRIMARY KEY,
      idtenant       INT NOT NULL,
      idlokasi       INT NOT NULL,
      tgltrans       DATE NOT NULL,
      amount         DECIMAL(15,2) DEFAULT 0,
      userentry      INT NOT NULL DEFAULT 0,
      tglentry       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      status         VARCHAR(20) DEFAULT 'AKTIF',
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      INDEX idx_setorantunai_tgl (tgltrans)
    ) ENGINE=InnoDB
  `);

  // purchaseorder
  await connection.query(`
    CREATE TABLE purchaseorder (
      idpo        INT AUTO_INCREMENT PRIMARY KEY,
      idtenant    INT NOT NULL,
      idlokasi    INT NOT NULL,
      kodepo      VARCHAR(30) NOT NULL,
      tgltrans    DATE NOT NULL,
      idsupplier  INT DEFAULT NULL,
      iduser      INT NOT NULL,
      grandtotal  DECIMAL(15,2) DEFAULT 0,
      catatan     TEXT DEFAULT NULL,
      status      VARCHAR(20) DEFAULT 'DRAFT',
      userentry   INT NOT NULL DEFAULT 0,
      tglentry    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      FOREIGN KEY (idsupplier) REFERENCES supplier(idsupplier),
      UNIQUE KEY uq_po_kode (idtenant, idlokasi, kodepo),
      INDEX idx_po_tgl (tgltrans)
    ) ENGINE=InnoDB
  `);

  // purchaseorderdtl
  await connection.query(`
    CREATE TABLE purchaseorderdtl (
      idpodtl       INT AUTO_INCREMENT PRIMARY KEY,
      idpo          INT NOT NULL,
      idtenant      INT NOT NULL,
      idbarang      INT NOT NULL,
      jml           DECIMAL(15,3) NOT NULL,
      jml_diterima  DECIMAL(15,3) DEFAULT 0,
      satuan        VARCHAR(20) DEFAULT NULL,
      harga         DECIMAL(15,2) DEFAULT 0,
      subtotal      DECIMAL(15,2) DEFAULT 0,
      FOREIGN KEY (idpo) REFERENCES purchaseorder(idpo) ON DELETE CASCADE,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idbarang) REFERENCES barang(idbarang)
    ) ENGINE=InnoDB
  `);

  // bpb
  await connection.query(`
    CREATE TABLE bpb (
      idbpb       INT AUTO_INCREMENT PRIMARY KEY,
      idtenant    INT NOT NULL,
      idlokasi    INT NOT NULL,
      kodebpb     VARCHAR(30) NOT NULL,
      tgltrans    DATE NOT NULL,
      idpo        INT DEFAULT NULL,
      idsupplier  INT DEFAULT NULL,
      iduser      INT NOT NULL,
      grandtotal  DECIMAL(15,2) DEFAULT 0,
      catatan     TEXT DEFAULT NULL,
      status      VARCHAR(20) DEFAULT 'DRAFT',
      userentry   INT NOT NULL DEFAULT 0,
      tglentry    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      FOREIGN KEY (idpo) REFERENCES purchaseorder(idpo),
      FOREIGN KEY (idsupplier) REFERENCES supplier(idsupplier),
      UNIQUE KEY uq_bpb_kode (idtenant, idlokasi, kodebpb),
      INDEX idx_bpb_tgl (tgltrans)
    ) ENGINE=InnoDB
  `);

  // bpbdtl
  await connection.query(`
    CREATE TABLE bpbdtl (
      idbpbdtl  INT AUTO_INCREMENT PRIMARY KEY,
      idbpb     INT NOT NULL,
      idtenant  INT NOT NULL,
      idbarang  INT NOT NULL,
      idpodtl   INT DEFAULT NULL,
      jml       DECIMAL(15,3) NOT NULL,
      satuan    VARCHAR(20) DEFAULT NULL,
      harga     DECIMAL(15,2) DEFAULT 0,
      subtotal  DECIMAL(15,2) DEFAULT 0,
      FOREIGN KEY (idbpb) REFERENCES bpb(idbpb) ON DELETE CASCADE,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idbarang) REFERENCES barang(idbarang)
    ) ENGINE=InnoDB
  `);

  // stockopname
  await connection.query(`
    CREATE TABLE stockopname (
      idstockopname     INT AUTO_INCREMENT PRIMARY KEY,
      idtenant          INT NOT NULL,
      idlokasi          INT NOT NULL,
      kodestockopname   VARCHAR(30) NOT NULL,
      tgltrans          DATE NOT NULL,
      iduser            INT NOT NULL,
      catatan           TEXT DEFAULT NULL,
      status            VARCHAR(20) DEFAULT 'DRAFT',
      userentry         INT NOT NULL DEFAULT 0,
      tglentry          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      UNIQUE KEY uq_stockopname_kode (idtenant, idlokasi, kodestockopname),
      INDEX idx_stockopname_tgl (tgltrans)
    ) ENGINE=InnoDB
  `);

  // stockopnamedtl
  await connection.query(`
    CREATE TABLE stockopnamedtl (
      idstockopnamedtl  INT AUTO_INCREMENT PRIMARY KEY,
      idstockopname     INT NOT NULL,
      idtenant          INT NOT NULL,
      idbarang          INT NOT NULL,
      stok_sistem       DECIMAL(15,3) DEFAULT 0,
      stok_fisik        DECIMAL(15,3) DEFAULT 0,
      selisih           DECIMAL(15,3) DEFAULT 0,
      FOREIGN KEY (idstockopname) REFERENCES stockopname(idstockopname) ON DELETE CASCADE,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idbarang) REFERENCES barang(idbarang)
    ) ENGINE=InnoDB
  `);

  // karyawan
  await connection.query(`
    CREATE TABLE karyawan (
      idkaryawan    INT AUTO_INCREMENT PRIMARY KEY,
      idtenant      INT NOT NULL,
      kodekaryawan  VARCHAR(20) NOT NULL,
      namakaryawan  VARCHAR(100) NOT NULL,
      jabatan       VARCHAR(50) DEFAULT NULL,
      departemen    VARCHAR(50) DEFAULT NULL,
      tgllahir      DATE DEFAULT NULL,
      tglmasuk      DATE DEFAULT NULL,
      gajipoko      DECIMAL(15,2) DEFAULT 0,
      norekening    VARCHAR(50) DEFAULT NULL,
      namabank      VARCHAR(50) DEFAULT NULL,
      hp            VARCHAR(20) DEFAULT NULL,
      email         VARCHAR(100) DEFAULT NULL,
      alamat        TEXT DEFAULT NULL,
      status        VARCHAR(20) DEFAULT 'AKTIF',
      userentry     INT NOT NULL DEFAULT 0,
      tglentry      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      UNIQUE KEY uq_karyawan_kode (idtenant, kodekaryawan)
    ) ENGINE=InnoDB
  `);

  // komponengaji
  await connection.query(`
    CREATE TABLE komponengaji (
      idkomponengaji  INT AUTO_INCREMENT PRIMARY KEY,
      idtenant        INT NOT NULL,
      idkaryawan      INT NOT NULL,
      namakomponan    VARCHAR(100) NOT NULL,
      jenis           VARCHAR(20) NOT NULL,
      amount          DECIMAL(15,2) DEFAULT 0,
      status          VARCHAR(20) DEFAULT 'AKTIF',
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idkaryawan) REFERENCES karyawan(idkaryawan) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);

  // absensi
  await connection.query(`
    CREATE TABLE absensi (
      idabsensi     INT AUTO_INCREMENT PRIMARY KEY,
      idtenant      INT NOT NULL,
      idlokasi      INT NOT NULL,
      idkaryawan    INT NOT NULL,
      tglabsensi    DATE NOT NULL,
      jampinmasuk   TIME DEFAULT NULL,
      jampinkeluar  TIME DEFAULT NULL,
      jenisabsensi  VARCHAR(30) DEFAULT 'HADIR',
      keterangan    VARCHAR(255) DEFAULT NULL,
      userentry     INT NOT NULL DEFAULT 0,
      tglentry      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      FOREIGN KEY (idkaryawan) REFERENCES karyawan(idkaryawan),
      UNIQUE KEY uq_absensi (idtenant, idkaryawan, tglabsensi)
    ) ENGINE=InnoDB
  `);

  // payroll
  await connection.query(`
    CREATE TABLE payroll (
      idpayroll       INT AUTO_INCREMENT PRIMARY KEY,
      idtenant        INT NOT NULL,
      idlokasi        INT NOT NULL,
      kodepayroll     VARCHAR(30) NOT NULL,
      periodbulan     VARCHAR(7) NOT NULL,
      tglawal         DATE NOT NULL,
      tglakhir        DATE NOT NULL,
      total_bruto     DECIMAL(15,2) DEFAULT 0,
      total_potongan  DECIMAL(15,2) DEFAULT 0,
      total_neto      DECIMAL(15,2) DEFAULT 0,
      idakun_beban    INT DEFAULT NULL,
      idakun_hutang   INT DEFAULT NULL,
      status          VARCHAR(20) DEFAULT 'DRAFT',
      iduser          INT NOT NULL,
      userentry       INT NOT NULL DEFAULT 0,
      tglentry        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      UNIQUE KEY uq_payroll_kode (idtenant, idlokasi, kodepayroll),
      INDEX idx_payroll_periode (idtenant, idlokasi, periodbulan)
    ) ENGINE=InnoDB
  `);

  // payrolldtl
  await connection.query(`
    CREATE TABLE payrolldtl (
      idpayrolldtl    INT AUTO_INCREMENT PRIMARY KEY,
      idpayroll       INT NOT NULL,
      idtenant        INT NOT NULL,
      idkaryawan      INT NOT NULL,
      gajipoko        DECIMAL(15,2) DEFAULT 0,
      total_tunjangan DECIMAL(15,2) DEFAULT 0,
      total_potongan  DECIMAL(15,2) DEFAULT 0,
      gaji_bersih     DECIMAL(15,2) DEFAULT 0,
      harikerja       INT DEFAULT 0,
      hari_hadir      INT DEFAULT 0,
      FOREIGN KEY (idpayroll) REFERENCES payroll(idpayroll) ON DELETE CASCADE,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idkaryawan) REFERENCES karyawan(idkaryawan)
    ) ENGINE=InnoDB
  `);

  // produksi
  await connection.query(`
    CREATE TABLE produksi (
      idproduksi    INT AUTO_INCREMENT PRIMARY KEY,
      idtenant      INT NOT NULL,
      kodeproduksi  VARCHAR(50) NOT NULL,
      idlokasi      INT NOT NULL,
      tgltrans      DATE NOT NULL,
      catatan       TEXT NULL,
      total_bahan   DECIMAL(15,2) DEFAULT 0,
      total_hasil   DECIMAL(15,2) DEFAULT 0,
      status        VARCHAR(20) DEFAULT 'AKTIF',
      userentry     INT,
      tglentry      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      FOREIGN KEY (userentry) REFERENCES user(iduser),
      UNIQUE KEY uk_kodeproduksi (idtenant, kodeproduksi)
    ) ENGINE=InnoDB
  `);

  // produksidtl
  await connection.query(`
    CREATE TABLE produksidtl (
      idproduksidtl INT AUTO_INCREMENT PRIMARY KEY,
      idproduksi    INT NOT NULL,
      idtenant      INT NOT NULL,
      idbarang      INT NOT NULL,
      jenisbarang   ENUM('BAHAN BAKU', 'BAHAN SETENGAH JADI', 'BARANG JADI') NOT NULL,
      jml           DECIMAL(15,2) NOT NULL,
      satuan        VARCHAR(20) NULL,
      harga_satuan  DECIMAL(15,2) DEFAULT 0,
      subtotal      DECIMAL(15,2) DEFAULT 0,
      FOREIGN KEY (idproduksi) REFERENCES produksi(idproduksi) ON DELETE CASCADE,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idbarang) REFERENCES barang(idbarang)
    ) ENGINE=InnoDB
  `);

  // ============================================================
  // NEW FEATURE TABLES
  // ============================================================

  // diskon
  await connection.query(`
    CREATE TABLE diskon (
      iddiskon INT AUTO_INCREMENT PRIMARY KEY,
      idtenant INT NOT NULL,
      kodediskon VARCHAR(20) NOT NULL,
      namadiskon VARCHAR(100) NOT NULL,
      jenis ENUM('PERSEN','NOMINAL','BELI_X_GRATIS_Y') NOT NULL DEFAULT 'PERSEN',
      nilai DECIMAL(15,2) NOT NULL DEFAULT 0,
      min_pembelian DECIMAL(15,2) DEFAULT 0,
      min_qty DECIMAL(15,3) DEFAULT 0,
      max_diskon DECIMAL(15,2) DEFAULT NULL,
      nilai_x INT DEFAULT NULL,
      nilai_y INT DEFAULT NULL,
      tglawal DATE NOT NULL,
      tglakhir DATE NOT NULL,
      berlaku_semua_barang TINYINT(1) DEFAULT 1,
      status VARCHAR(20) DEFAULT 'AKTIF',
      userentry INT DEFAULT 0,
      tglentry TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      UNIQUE KEY uq_diskon_kode (idtenant, kodediskon)
    ) ENGINE=InnoDB
  `);

  // diskondtl
  await connection.query(`
    CREATE TABLE diskondtl (
      iddiskondtl INT AUTO_INCREMENT PRIMARY KEY,
      iddiskon INT NOT NULL,
      idtenant INT NOT NULL,
      idbarang INT NOT NULL,
      FOREIGN KEY (iddiskon) REFERENCES diskon(iddiskon) ON DELETE CASCADE,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idbarang) REFERENCES barang(idbarang)
    ) ENGINE=InnoDB
  `);

  // hargajual_level
  await connection.query(`
    CREATE TABLE hargajual_level (
      idhargajuallevel INT AUTO_INCREMENT PRIMARY KEY,
      idtenant INT NOT NULL,
      namalevel VARCHAR(50) NOT NULL,
      deskripsi VARCHAR(100) DEFAULT NULL,
      urutan INT DEFAULT 0,
      status VARCHAR(20) DEFAULT 'AKTIF',
      userentry INT DEFAULT 0,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant)
    ) ENGINE=InnoDB
  `);

  // hargajual_leveldtl
  await connection.query(`
    CREATE TABLE hargajual_leveldtl (
      idhargajualleveldtl INT AUTO_INCREMENT PRIMARY KEY,
      idhargajuallevel INT NOT NULL,
      idtenant INT NOT NULL,
      idbarang INT NOT NULL,
      satuan VARCHAR(20) DEFAULT NULL,
      hargajual DECIMAL(15,2) NOT NULL DEFAULT 0,
      FOREIGN KEY (idhargajuallevel) REFERENCES hargajual_level(idhargajuallevel) ON DELETE CASCADE,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idbarang) REFERENCES barang(idbarang),
      UNIQUE KEY uq_hjl_barang (idhargajuallevel, idbarang)
    ) ENGINE=InnoDB
  `);

  // poin_setting
  await connection.query(`
    CREATE TABLE poin_setting (
      idtenant INT NOT NULL PRIMARY KEY,
      nominal_per_poin DECIMAL(15,2) NOT NULL DEFAULT 10000,
      nilai_tukar_poin DECIMAL(15,2) NOT NULL DEFAULT 1000,
      min_poin_tukar INT NOT NULL DEFAULT 10,
      max_poin_per_transaksi INT DEFAULT NULL,
      status VARCHAR(20) DEFAULT 'AKTIF',
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant)
    ) ENGINE=InnoDB
  `);

  // poin_customer
  await connection.query(`
    CREATE TABLE poin_customer (
      idpoincustomer INT AUTO_INCREMENT PRIMARY KEY,
      idtenant INT NOT NULL,
      idcustomer INT NOT NULL,
      total_poin INT NOT NULL DEFAULT 0,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idcustomer) REFERENCES customer(idcustomer) ON DELETE CASCADE,
      UNIQUE KEY uq_poin_customer (idtenant, idcustomer)
    ) ENGINE=InnoDB
  `);

  // poin_transaksi
  await connection.query(`
    CREATE TABLE poin_transaksi (
      idpointegon INT AUTO_INCREMENT PRIMARY KEY,
      idtenant INT NOT NULL,
      idcustomer INT NOT NULL,
      idref INT DEFAULT NULL,
      koderef VARCHAR(30) DEFAULT NULL,
      jenisref VARCHAR(30) DEFAULT NULL,
      poin INT NOT NULL DEFAULT 0,
      jenis ENUM('MASUK','KELUAR') NOT NULL,
      tgltrans DATE NOT NULL,
      keterangan VARCHAR(255) DEFAULT NULL,
      tglentry TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idcustomer) REFERENCES customer(idcustomer),
      INDEX idx_poin_customer (idtenant, idcustomer),
      INDEX idx_poin_tgl (tgltrans)
    ) ENGINE=InnoDB
  `);

  // audit_trail
  await connection.query(`
    CREATE TABLE audit_trail (
      idaudit INT AUTO_INCREMENT PRIMARY KEY,
      idtenant INT DEFAULT NULL,
      idlokasi INT DEFAULT NULL,
      iduser INT DEFAULT NULL,
      tabel VARCHAR(50) NOT NULL,
      idref INT DEFAULT NULL,
      aksi ENUM('CREATE','UPDATE','DELETE') NOT NULL,
      data_lama TEXT DEFAULT NULL,
      data_baru TEXT DEFAULT NULL,
      tglentry TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_audit_tabel (tabel, idref),
      INDEX idx_audit_tenant (idtenant),
      INDEX idx_audit_tgl (tglentry)
    ) ENGINE=InnoDB
  `);

  // aset
  await connection.query(`
    CREATE TABLE aset (
      idaset INT AUTO_INCREMENT PRIMARY KEY,
      idtenant INT NOT NULL,
      idlokasi INT NOT NULL,
      kodeaset VARCHAR(20) NOT NULL,
      namaaset VARCHAR(100) NOT NULL,
      kategori VARCHAR(50) DEFAULT 'PERALATAN',
      tglbeli DATE NOT NULL,
      nilai_beli DECIMAL(15,2) NOT NULL DEFAULT 0,
      umur_ekonomis INT NOT NULL DEFAULT 12,
      metode_penyusutan ENUM('GARIS_LURUS','SALDO_MENURUN') NOT NULL DEFAULT 'GARIS_LURUS',
      nilai_sisa DECIMAL(15,2) NOT NULL DEFAULT 0,
      akumulasi_penyusutan DECIMAL(15,2) NOT NULL DEFAULT 0,
      nilai_buku DECIMAL(15,2) NOT NULL DEFAULT 0,
      idakun_aset INT DEFAULT NULL,
      idakun_penyusutan INT DEFAULT NULL,
      idakun_akumulasi INT DEFAULT NULL,
      status VARCHAR(20) DEFAULT 'AKTIF',
      userentry INT DEFAULT 0,
      tglentry TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      UNIQUE KEY uq_aset_kode (idtenant, idlokasi, kodeaset)
    ) ENGINE=InnoDB
  `);

  // penyusutan_aset
  await connection.query(`
    CREATE TABLE penyusutan_aset (
      idpenyusutan INT AUTO_INCREMENT PRIMARY KEY,
      idaset INT NOT NULL,
      idtenant INT NOT NULL,
      idlokasi INT NOT NULL,
      periode VARCHAR(7) NOT NULL,
      nilai_penyusutan DECIMAL(15,2) NOT NULL DEFAULT 0,
      akumulasi DECIMAL(15,2) NOT NULL DEFAULT 0,
      nilai_buku DECIMAL(15,2) NOT NULL DEFAULT 0,
      tglentry TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idaset) REFERENCES aset(idaset) ON DELETE CASCADE,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      UNIQUE KEY uq_penyusutan_aset_periode (idaset, periode)
    ) ENGINE=InnoDB
  `);

  // anggaran
  await connection.query(`
    CREATE TABLE anggaran (
      idanggaran INT AUTO_INCREMENT PRIMARY KEY,
      idtenant INT NOT NULL,
      idlokasi INT NOT NULL,
      kodeanggaran VARCHAR(20) NOT NULL,
      namaanggaran VARCHAR(100) NOT NULL,
      periode VARCHAR(4) NOT NULL,
      tglawal DATE NOT NULL,
      tglakhir DATE NOT NULL,
      total_anggaran DECIMAL(15,2) DEFAULT 0,
      status VARCHAR(20) DEFAULT 'DRAFT',
      userentry INT DEFAULT 0,
      tglentry TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      UNIQUE KEY uq_anggaran (idtenant, idlokasi, kodeanggaran)
    ) ENGINE=InnoDB
  `);

  // anggarandtl
  await connection.query(`
    CREATE TABLE anggarandtl (
      idanggarandtl INT AUTO_INCREMENT PRIMARY KEY,
      idanggaran INT NOT NULL,
      idtenant INT NOT NULL,
      idakun INT NOT NULL,
      bulan INT NOT NULL,
      nilai_anggaran DECIMAL(15,2) NOT NULL DEFAULT 0,
      nilai_realisasi DECIMAL(15,2) NOT NULL DEFAULT 0,
      FOREIGN KEY (idanggaran) REFERENCES anggaran(idanggaran) ON DELETE CASCADE,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idakun) REFERENCES akun(idakun)
    ) ENGINE=InnoDB
  `);

  // cuti_karyawan
  await connection.query(`
    CREATE TABLE cuti_karyawan (
      idcuti INT AUTO_INCREMENT PRIMARY KEY,
      idtenant INT NOT NULL,
      idlokasi INT NOT NULL,
      idkaryawan INT NOT NULL,
      jeniscuti ENUM('TAHUNAN','SAKIT','IZIN','MELAHIRKAN','LAINNYA') NOT NULL DEFAULT 'TAHUNAN',
      tglawal DATE NOT NULL,
      tglakhir DATE NOT NULL,
      jumlah_hari INT NOT NULL DEFAULT 1,
      keterangan VARCHAR(255) DEFAULT NULL,
      status VARCHAR(20) DEFAULT 'DRAFT',
      userentry INT DEFAULT 0,
      tglentry TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      FOREIGN KEY (idkaryawan) REFERENCES karyawan(idkaryawan)
    ) ENGINE=InnoDB
  `);

  // lembur_karyawan
  await connection.query(`
    CREATE TABLE lembur_karyawan (
      idlembur INT AUTO_INCREMENT PRIMARY KEY,
      idtenant INT NOT NULL,
      idlokasi INT NOT NULL,
      idkaryawan INT NOT NULL,
      tgllembur DATE NOT NULL,
      jam_mulai TIME NOT NULL,
      jam_selesai TIME NOT NULL,
      total_jam DECIMAL(5,2) NOT NULL DEFAULT 0,
      tarif_per_jam DECIMAL(15,2) NOT NULL DEFAULT 0,
      total_bayar DECIMAL(15,2) NOT NULL DEFAULT 0,
      keterangan VARCHAR(255) DEFAULT NULL,
      status VARCHAR(20) DEFAULT 'DRAFT',
      userentry INT DEFAULT 0,
      tglentry TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      FOREIGN KEY (idkaryawan) REFERENCES karyawan(idkaryawan),
      UNIQUE KEY uq_lembur (idtenant, idkaryawan, tgllembur, jam_mulai)
    ) ENGINE=InnoDB
  `);

  // batch_lot
  await connection.query(`
    CREATE TABLE batch_lot (
      idbatch INT AUTO_INCREMENT PRIMARY KEY,
      idtenant INT NOT NULL,
      idbarang INT NOT NULL,
      idlokasi INT NOT NULL,
      nomorbatch VARCHAR(50) NOT NULL,
      tglproduksi DATE DEFAULT NULL,
      tglkadaluarsa DATE DEFAULT NULL,
      qty_masuk DECIMAL(15,3) DEFAULT 0,
      qty_keluar DECIMAL(15,3) DEFAULT 0,
      qty_sisa DECIMAL(15,3) DEFAULT 0,
      satuan VARCHAR(20) DEFAULT NULL,
      idref INT DEFAULT NULL,
      koderef VARCHAR(30) DEFAULT NULL,
      jenisref VARCHAR(30) DEFAULT NULL,
      status VARCHAR(20) DEFAULT 'AKTIF',
      tglentry TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idbarang) REFERENCES barang(idbarang),
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      UNIQUE KEY uq_batch (idtenant, idbarang, idlokasi, nomorbatch),
      INDEX idx_batch_kadaluarsa (tglkadaluarsa)
    ) ENGINE=InnoDB
  `);

  // refresh_token
  await connection.query(`
    CREATE TABLE refresh_token (
      idrefreshtoken INT AUTO_INCREMENT PRIMARY KEY,
      iduser INT NOT NULL,
      idtenant INT NOT NULL,
      token_hash VARCHAR(64) NOT NULL,
      expires_at DATETIME NOT NULL,
      used TINYINT(1) DEFAULT 0,
      tglentry TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_rt_token (token_hash),
      INDEX idx_rt_user (iduser),
      FOREIGN KEY (iduser) REFERENCES user(iduser) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);

  // webhook_config
  await connection.query(`
    CREATE TABLE webhook_config (
      idwebhook INT AUTO_INCREMENT PRIMARY KEY,
      idtenant INT NOT NULL,
      namawebhook VARCHAR(100) NOT NULL,
      url VARCHAR(500) NOT NULL,
      events TEXT NOT NULL,
      secret VARCHAR(100) DEFAULT NULL,
      status VARCHAR(20) DEFAULT 'AKTIF',
      userentry INT DEFAULT 0,
      tglentry TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant)
    ) ENGINE=InnoDB
  `);

  // webhook_log
  await connection.query(`
    CREATE TABLE webhook_log (
      idwebhooklog INT AUTO_INCREMENT PRIMARY KEY,
      idwebhook INT NOT NULL,
      idtenant INT NOT NULL,
      event VARCHAR(50) NOT NULL,
      payload TEXT DEFAULT NULL,
      status_code INT DEFAULT NULL,
      response TEXT DEFAULT NULL,
      error_message VARCHAR(500) DEFAULT NULL,
      tglentry TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idwebhook) REFERENCES webhook_config(idwebhook) ON DELETE CASCADE,
      INDEX idx_webhook_log_webhook (idwebhook),
      INDEX idx_webhook_log_tgl (tglentry)
    ) ENGINE=InnoDB
  `);

  console.log('All tables created');

  // ============================================================
  // SEED DATA
  // ============================================================

  // Seed currency
  await connection.query(
    `INSERT INTO currency (kodecurrency, namacurrency, simbol, kurs, status) VALUES (?, ?, ?, ?, ?)`,
    ['IDR', 'Rupiah', 'Rp', 1.0000, 'AKTIF']
  );

  // Seed subscription plans
  await connection.query(
    `INSERT INTO subscription_plan
      (kodeplan, namaplan, harga, monthly_transaction_limit, max_users, has_backup, has_support, status, userentry)
     VALUES
      ('FREE', 'Free', 0, 50, 1, 0, 0, 'AKTIF', 0),
      ('PRO', 'Pro', 99000, NULL, NULL, 1, 1, 'AKTIF', 0)`
  );

  // Seed menu — top-level
  const topMenus = [
    [1,  null, 'dashboard', 'Dashboard', 1, 'LayoutDashboard', '/'],
    [3,  null, 'master',    'Master',    2, 'Package',         null],
    [4,  null, 'pembelian', 'Pembelian', 3, 'ShoppingBag',     null],
    [5,  null, 'penjualan', 'Penjualan', 4, 'ReceiptText',     null],
    [6,  null, 'stok',      'Stok',      5, 'Warehouse',       null],
    [7,  null, 'keuangan',  'Keuangan',  6, 'Wallet',          null],
    [40, null, 'hr',        'HR',        7, 'Users',           null],
    [8,  null, 'laporan',   'Laporan',   8, 'FileBarChart',    null],
    [9,  null, 'setting',   'Setting',   9, 'Settings',        '/setting'],
  ];
  for (const m of topMenus) {
    await connection.query(
      'INSERT INTO menu (idmenu, idparent, kodemenu, namamenu, urutan, icon, path) VALUES (?, ?, ?, ?, ?, ?, ?)',
      m
    );
  }

  // Seed menu — children: Master
  const masterChildren = [
    [14, 3, 'master.user',     'User',     1, null, '/master/user'],
    [10, 3, 'master.barang',   'Barang',   2, null, '/master/barang'],
    [12, 3, 'master.customer', 'Customer', 3, null, '/master/customer'],
    [11, 3, 'master.supplier', 'Supplier', 4, null, '/master/supplier'],
    [15, 3, 'master.lokasi',   'Lokasi',   5, null, '/master/lokasi'],
    [13, 3, 'master.akun',     'Akun',     6, null, '/master/akun'],
  ];
  for (const m of masterChildren) {
    await connection.query(
      'INSERT INTO menu (idmenu, idparent, kodemenu, namamenu, urutan, icon, path) VALUES (?, ?, ?, ?, ?, ?, ?)',
      m
    );
  }

  // Seed menu — children: Pembelian
  const pembelianChildren = [
    [37, 4, 'pembelian.po',        'Purchase Order (PO)',           1, null, '/pembelian/po'],
    [38, 4, 'pembelian.bpb',       'Bukti Penerimaan Barang (BPB)', 2, null, '/pembelian/bpb'],
    [29, 4, 'pembelian.transaksi', 'Pembelian',                     3, null, '/pembelian'],
    [30, 4, 'pembelian.retur',     'Retur Pembelian',               4, null, '/pembelian/retur'],
  ];
  for (const m of pembelianChildren) {
    await connection.query(
      'INSERT INTO menu (idmenu, idparent, kodemenu, namamenu, urutan, icon, path) VALUES (?, ?, ?, ?, ?, ?, ?)',
      m
    );
  }

  // Seed menu — children: Penjualan
  const penjualanChildren = [
    [27, 5, 'penjualan.so',        'Sales Order (SO)',               1, null, '/penjualan/so'],
    [49, 5, 'penjualan.bpk',       'Bukti Pengeluaran Barang (BPK)', 2, null, '/penjualan/bpk'],
    [25, 5, 'penjualan.transaksi', 'Penjualan',                      3, null, '/penjualan'],
    [26, 5, 'penjualan.retur',     'Retur Penjualan',                4, null, '/penjualan/retur'],
  ];
  for (const m of penjualanChildren) {
    await connection.query(
      'INSERT INTO menu (idmenu, idparent, kodemenu, namamenu, urutan, icon, path) VALUES (?, ?, ?, ?, ?, ?, ?)',
      m
    );
  }

  // Seed menu — children: Stok
  const stokChildren = [
    [16, 6, 'stok.saldoawal',    'Saldo Stok',  1, null, '/stok/saldoawal'],
    [39, 6, 'stok.stockopname',  'Opname Stok', 2, null, '/stok/opname'],
    [35, 6, 'stok.transferstok', 'Transfer',    3, null, '/stok/transfer'],
    [24, 6, 'stok.hitunghpp',    'Hitung HPP',  4, null, '/stok/hitunghpp'],
  ];
  for (const m of stokChildren) {
    await connection.query(
      'INSERT INTO menu (idmenu, idparent, kodemenu, namamenu, urutan, icon, path) VALUES (?, ?, ?, ?, ?, ?, ?)',
      m
    );
  }

  // Seed menu — children: Keuangan
  const keuanganChildren = [
    [31, 7, 'keuangan.kas',              'Kas',              1, null, '/kas'],
    [33, 7, 'keuangan.pelunasanhutang',  'Pelunasan Hutang', 2, null, '/keuangan/pelunasanhutang'],
    [32, 7, 'keuangan.pelunasanpiutang', 'Pelunasan Piutang',3, null, '/keuangan/pelunasanpiutang'],
  ];
  for (const m of keuanganChildren) {
    await connection.query(
      'INSERT INTO menu (idmenu, idparent, kodemenu, namamenu, urutan, icon, path) VALUES (?, ?, ?, ?, ?, ?, ?)',
      m
    );
  }

  // Seed menu — children: HR
  const hrChildren = [
    [41, 40, 'sdm.karyawan', 'Karyawan', 1, null, '/sdm/karyawan'],
    [42, 40, 'sdm.absensi',  'Absensi',  2, null, '/sdm/absensi'],
    [43, 40, 'sdm.payroll',  'Gaji',     3, null, '/sdm/payroll'],
  ];
  for (const m of hrChildren) {
    await connection.query(
      'INSERT INTO menu (idmenu, idparent, kodemenu, namamenu, urutan, icon, path) VALUES (?, ?, ?, ?, ?, ?, ?)',
      m
    );
  }

  // Seed menu — Laporan: grup level-1 (parent: laporan idmenu=8)
  const laporanGrp = [
    [50, 8, 'laporan.pembelian', 'Pembelian', 1, null, null],
    [51, 8, 'laporan.penjualan', 'Penjualan', 2, null, null],
    [52, 8, 'laporan.stok',      'Stok',      3, null, null],
  ];
  for (const m of laporanGrp) {
    await connection.query(
      'INSERT INTO menu (idmenu, idparent, kodemenu, namamenu, urutan, icon, path) VALUES (?, ?, ?, ?, ?, ?, ?)',
      m
    );
  }

  // Seed menu — Laporan Pembelian leaves (parent: 50)
  const laporanPembelianLeaves = [
    [53, 50, 'laporan.pembelian.po',        'Purchase Order (PO)',           1, null, null],
    [54, 50, 'laporan.pembelian.bpb',       'Bukti Penerimaan Barang (BPB)', 2, null, null],
    [55, 50, 'laporan.pembelian.transaksi', 'Pembelian',                     3, null, null],
    [56, 50, 'laporan.pembelian.retur',     'Retur Pembelian',               4, null, null],
  ];
  for (const m of laporanPembelianLeaves) {
    await connection.query(
      'INSERT INTO menu (idmenu, idparent, kodemenu, namamenu, urutan, icon, path) VALUES (?, ?, ?, ?, ?, ?, ?)',
      m
    );
  }

  // Seed menu — Laporan Penjualan leaves (parent: 51)
  const laporanPenjualanLeaves = [
    [57, 51, 'laporan.penjualan.so',        'Sales Order (SO)',               1, null, null],
    [58, 51, 'laporan.penjualan.bpk',       'Bukti Pengeluaran Barang (BPK)', 2, null, null],
    [59, 51, 'laporan.penjualan.transaksi', 'Penjualan',                      3, null, null],
    [60, 51, 'laporan.penjualan.retur',     'Retur Penjualan',                4, null, null],
  ];
  for (const m of laporanPenjualanLeaves) {
    await connection.query(
      'INSERT INTO menu (idmenu, idparent, kodemenu, namamenu, urutan, icon, path) VALUES (?, ?, ?, ?, ?, ?, ?)',
      m
    );
  }

  // Seed menu — Laporan Stok leaves (parent: 52)
  const laporanStokLeaves = [
    [61, 52, 'laporan.stok.sekarang',  'Stok',       1, null, null],
    [62, 52, 'laporan.stok.kartustok', 'Kartu Stok', 2, null, null],
    [63, 52, 'laporan.stok.opname',    'Opname Stok', 3, null, null],
    [64, 52, 'laporan.stok.transfer',  'Transfer Stok', 4, null, null],
  ];
  for (const m of laporanStokLeaves) {
    await connection.query(
      'INSERT INTO menu (idmenu, idparent, kodemenu, namamenu, urutan, icon, path) VALUES (?, ?, ?, ?, ?, ?, ?)',
      m
    );
  }

  // Seed menu — Laporan Akuntansi: grup + leaves (parent: laporan idmenu=8)
  const laporanAkuntansi = [
    [65, 8,  'laporan.akuntansi',           'Akuntansi',        4, null, null],
    [66, 65, 'laporan.akuntansi.jurnal',    'Jurnal Transaksi', 1, null, null],
    [67, 65, 'laporan.akuntansi.bukubesar', 'Buku Besar',       2, null, null],
    [68, 65, 'laporan.akuntansi.neraca',    'Neraca',           3, null, null],
  ];
  for (const m of laporanAkuntansi) {
    await connection.query(
      'INSERT INTO menu (idmenu, idparent, kodemenu, namamenu, urutan, icon, path) VALUES (?, ?, ?, ?, ?, ?, ?)',
      m
    );
  }

  console.log('Seed data inserted');
  console.log('Migration completed successfully!');

  await connection.end();
  process.exit(0);
}

// seedDefaultCOA — dipanggil dari authController.register saat membuat tenant baru
// Menyediakan Chart of Account dasar agar jurnaling langsung berfungsi
async function seedDefaultCOA(conn, idtenant, iduser = 0) {
  for (const [kode, nama, jenis, saldo] of DEFAULT_COA) {
    await conn.query(
      'INSERT IGNORE INTO akun (idtenant, kodeakun, namaakun, jenisak, saldo, status, userentry) VALUES (?,?,?,?,?,?,?)',
      [idtenant, kode, nama, jenis, saldo, 'AKTIF', iduser || 0]
    );
  }
}

async function seedDefaultJurnalSettings(conn, idtenant, options = {}) {
  const overwrite = options.overwrite === true;

  for (const [configName, kodeakun] of Object.entries(DEFAULT_JURNAL_AKUN)) {
    const [[akun]] = await conn.query(
      'SELECT idakun FROM akun WHERE idtenant = ? AND kodeakun = ? AND status = ? LIMIT 1',
      [idtenant, kodeakun, 'AKTIF']
    );
    if (!akun) continue;

    let shouldWrite = overwrite;
    if (!shouldWrite) {
      const [[existing]] = await conn.query(
        `SELECT c.value, a.idakun AS valid_idakun
         FROM config c
         LEFT JOIN akun a
           ON a.idtenant = c.idtenant
          AND a.idakun = CAST(c.value AS UNSIGNED)
          AND a.status = 'AKTIF'
         WHERE c.idtenant = ? AND c.modul = 'JURNAL' AND c.config = ?
         LIMIT 1`,
        [idtenant, configName]
      );
      shouldWrite = !existing || !existing.value || !existing.valid_idakun;
    }

    if (shouldWrite) {
      await setConfigValue(conn, idtenant, 'JURNAL', configName, String(akun.idakun), 1);
    }
  }
}

async function seedDefaultCustomer(conn, idtenant, iduser = 0) {
  await conn.query(
    `INSERT IGNORE INTO customer (idtenant, kodecustomer, namacustomer, alamat, hp, status, userentry)
     VALUES (?, 'CASH', 'CASH', '', '', 'AKTIF', ?)`,
    [idtenant, iduser]
  );
}

module.exports = {
  DEFAULT_COA,
  DEFAULT_JURNAL_AKUN,
  seedDefaultCOA,
  seedDefaultJurnalSettings,
  seedDefaultCustomer,
};

if (require.main === module) {
  migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}
