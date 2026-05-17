require('dotenv').config();
const mysql = require('mysql2/promise');

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
    'pelunasanpiutangdtl', 'pelunasanpiutang', 'kartupiutang',
    'pelunasanhutangdtl', 'pelunasanhutang', 'kartuhutang',
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
      status      VARCHAR(20) DEFAULT 'AKTIF',
      userentry   INT NOT NULL DEFAULT 0,
      FOREIGN KEY (idcurrency) REFERENCES currency(idcurrency)
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
      status        VARCHAR(20) DEFAULT 'AKTIF',
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
      status          VARCHAR(20) DEFAULT 'AKTIF',
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
      idcustomer    INT AUTO_INCREMENT PRIMARY KEY,
      idtenant      INT NOT NULL,
      kodecustomer  VARCHAR(20) NOT NULL,
      namacustomer  VARCHAR(100) NOT NULL,
      alamat        TEXT DEFAULT NULL,
      hp            VARCHAR(20) DEFAULT NULL,
      status        VARCHAR(20) DEFAULT 'AKTIF',
      userentry     INT NOT NULL DEFAULT 0,
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
      status      VARCHAR(20) DEFAULT 'AKTIF',
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

  console.log('All tables created');

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
  // SEED DATA
  // ============================================================

  // Seed currency
  await connection.query(
    `INSERT INTO currency (kodecurrency, namacurrency, simbol, kurs, status) VALUES (?, ?, ?, ?, ?)`,
    ['IDR', 'Rupiah', 'Rp', 1.0000, 'AKTIF']
  );

  // Seed menu — top-level
  const topMenus = [
    [1, null, 'dashboard',           'Dashboard',           1, 'LayoutDashboard', '/'],
    [2, null, 'pos',                 'POS',                 2, 'ShoppingCart',    '/pos'],
    [3, null, 'master',              'Master',              3, 'Package',         null],
    [4, null, 'pembelian',           'Pembelian',           4, 'ShoppingBag',     '/pembelian'],
    [5, null, 'penjualan',           'Penjualan',           5, 'ReceiptText',     '/penjualan'],
    [6, null, 'stok',                'Stok',                6, 'Warehouse',       null],
    [7, null, 'keuangan',            'Keuangan',            7, 'Wallet',          null],
    [8, null, 'laporan',             'Laporan',             8, 'FileBarChart',    null],
    [9, null, 'setting',             'Setting',             9, 'Settings',        '/setting'],
  ];
  for (const m of topMenus) {
    await connection.query(
      'INSERT INTO menu (idmenu, idparent, kodemenu, namamenu, urutan, icon, path) VALUES (?, ?, ?, ?, ?, ?, ?)',
      m
    );
  }

  // Seed menu — children: Master
  const masterChildren = [
    [10, 3, 'master.barang',     'Barang',          1, null, '/master/barang'],
    [11, 3, 'master.supplier',   'Supplier',        2, null, '/master/supplier'],
    [12, 3, 'master.customer',   'Customer',        3, null, '/master/customer'],
    [13, 3, 'master.akun',       'Akun',            4, null, '/master/akun'],
    [14, 3, 'master.user',       'User',            5, null, '/master/user'],
    [15, 3, 'master.lokasi',     'Lokasi',          6, null, '/master/lokasi'],
  ];
  for (const m of masterChildren) {
    await connection.query(
      'INSERT INTO menu (idmenu, idparent, kodemenu, namamenu, urutan, icon, path) VALUES (?, ?, ?, ?, ?, ?, ?)',
      m
    );
  }

  // Seed menu — children: Stok
  const stokChildren = [
    [16, 6, 'stok.saldoawal',    'Saldo Awal Stok',             1, null, '/stok/saldoawal'],
    [17, 6, 'stok.penyesuaian',  'Penyesuaian Stok',            2, null, '/stok/penyesuaian'],
    [18, 6, 'stok.kartustok',    'Kartu Stok',                  3, null, '/stok/kartustok'],
    [24, 6, 'stok.hitunghpp',    'Hitung HPP',                  4, null, '/stok/hitunghpp'],
    [34, 6, 'stok.produksi',     'Produksi',                     5, null, '/stok/produksi'],
  ];
  for (const m of stokChildren) {
    await connection.query(
      'INSERT INTO menu (idmenu, idparent, kodemenu, namamenu, urutan, icon, path) VALUES (?, ?, ?, ?, ?, ?, ?)',
      m
    );
  }

  // Seed menu — children: Penjualan
  const penjualanChildren = [
    [27, 5, 'penjualan.so',           'Sales Order (SO)',              1, null, '/penjualan/so'],
    [49, 5, 'penjualan.bpk',          'Bukti Pengeluaran Barang (BPK)', 2, null, '/penjualan/bpk'],
    [25, 5, 'penjualan.transaksi',    'Transaksi Jual',                3, null, '/penjualan'],
    [26, 5, 'penjualan.retur',        'Retur Penjualan',               4, null, '/penjualan/retur'],
  ];
  for (const m of penjualanChildren) {
    await connection.query(
      'INSERT INTO menu (idmenu, idparent, kodemenu, namamenu, urutan, icon, path) VALUES (?, ?, ?, ?, ?, ?, ?)',
      m
    );
  }

  // Seed menu — children: Laporan
  const laporanChildren = [
    [19, 8, 'laporan.penjualan',       'Penjualan',       1, null, '/laporan/penjualan'],
    [20, 8, 'laporan.pembelian',       'Pembelian',       2, null, '/laporan/pembelian'],
    [21, 8, 'laporan.barang',          'Barang',          3, null, '/laporan/master/barang'],
    [22, 8, 'laporan.stoksekarang',    'Stok Sekarang',   4, null, '/laporan/stok/sekarang'],
    [23, 8, 'laporan.kartustok',       'Kartu Stok',      5, null, '/laporan/stok/kartustok'],
    [28, 8, 'laporan.rekapsales',      'Rekap Sales',     6, null, '/laporan/rekap-sales'],
  ];
  for (const m of laporanChildren) {
    await connection.query(
      'INSERT INTO menu (idmenu, idparent, kodemenu, namamenu, urutan, icon, path) VALUES (?, ?, ?, ?, ?, ?, ?)',
      m
    );
  }

  // Seed menu — children: Keuangan
  const keuanganChildren = [
    [31, 7, 'keuangan.kas',                'Kas',                 1, null, '/kas'],
    [32, 7, 'keuangan.pelunasanpiutang',   'Pelunasan Piutang',   2, null, '/keuangan/pelunasanpiutang'],
    [33, 7, 'keuangan.pelunasanhutang',    'Pelunasan Hutang',    3, null, '/keuangan/pelunasanhutang'],
  ];
  for (const m of keuanganChildren) {
    await connection.query(
      'INSERT INTO menu (idmenu, idparent, kodemenu, namamenu, urutan, icon, path) VALUES (?, ?, ?, ?, ?, ?, ?)',
      m
    );
  }

  // Seed menu — children: Pembelian
  const pembelianChildren = [
    [37, 4, 'pembelian.po',            'Purchase Order (PO)',              1, null, '/pembelian/po'],
    [38, 4, 'pembelian.bpb',           'Bukti Penerimaan Barang (BPB)',    2, null, '/pembelian/bpb'],
    [29, 4, 'pembelian.transaksi',     'Pembelian',                        3, null, '/pembelian'],
    [30, 4, 'pembelian.retur',         'Retur Pembelian',                  4, null, '/pembelian/retur'],
  ];
  for (const m of pembelianChildren) {
    await connection.query(
      'INSERT INTO menu (idmenu, idparent, kodemenu, namamenu, urutan, icon, path) VALUES (?, ?, ?, ?, ?, ?, ?)',
      m
    );
  }

  // Seed menu — children: Transfer Stok + Stock Opname (parent: stok)
  const stokNewChildren = [
    [35, 6, 'stok.transferstok',       'Transfer Stok',     6, null, '/stok/transfer'],
    [39, 6, 'stok.stockopname',        'Stock Opname',      7, null, '/stok/opname'],
  ];
  for (const m of stokNewChildren) {
    await connection.query(
      'INSERT INTO menu (idmenu, idparent, kodemenu, namamenu, urutan, icon, path) VALUES (?, ?, ?, ?, ?, ?, ?)',
      m
    );
  }

  // Seed menu — SDM parent + children
  await connection.query(
    'INSERT INTO menu (idmenu, idparent, kodemenu, namamenu, urutan, icon, path) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [40, null, 'sdm', 'SDM', 10, 'Users', null]
  );
  const sdmChildren = [
    [41, 40, 'sdm.karyawan',   'Karyawan',   1, null, '/sdm/karyawan'],
    [42, 40, 'sdm.absensi',    'Absensi',    2, null, '/sdm/absensi'],
    [43, 40, 'sdm.payroll',    'Payroll',    3, null, '/sdm/payroll'],
  ];
  for (const m of sdmChildren) {
    await connection.query(
      'INSERT INTO menu (idmenu, idparent, kodemenu, namamenu, urutan, icon, path) VALUES (?, ?, ?, ?, ?, ?, ?)',
      m
    );
  }

  // Seed menu — Laporan Keuangan children (parent: laporan)
  const laporanKeuanganChildren = [
    [44, 8, 'laporan.neracasaldo',     'Neraca Saldo',     7, null, '/laporan/neraca-saldo'],
    [45, 8, 'laporan.labarugi',        'Laba Rugi',        8, null, '/laporan/laba-rugi'],
    [46, 8, 'laporan.neraca',          'Neraca',           9, null, '/laporan/neraca'],
    [47, 8, 'laporan.bukubesar',       'Buku Besar',       10, null, '/laporan/buku-besar'],
    [48, 8, 'laporan.closing',         'Closing Periode',  11, null, '/laporan/closing'],
  ];
  for (const m of laporanKeuanganChildren) {
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
async function seedDefaultCOA(conn, idtenant) {
  const defaultCOA = [
    ['1-1001', 'Kas Tunai',               'ASET',        'DEBET'],
    ['1-1002', 'Bank',                    'ASET',        'DEBET'],
    ['1-1003', 'Piutang Usaha',           'ASET',        'DEBET'],
    ['1-1004', 'Persediaan Barang',       'ASET',        'DEBET'],
    ['2-1001', 'Hutang Usaha',            'LIABILITAS',  'KREDIT'],
    ['2-1002', 'Hutang Gaji',             'LIABILITAS',  'KREDIT'],
    ['3-1001', 'Modal',                   'EKUITAS',     'KREDIT'],
    ['3-1002', 'Laba Ditahan',            'EKUITAS',     'KREDIT'],
    ['4-1001', 'Pendapatan Penjualan',    'PENDAPATAN',  'KREDIT'],
    ['5-1001', 'Harga Pokok Penjualan',   'BEBAN',       'DEBET'],
    ['5-1002', 'Beban Operasional',       'BEBAN',       'DEBET'],
    ['5-1003', 'Beban Gaji',              'BEBAN',       'DEBET'],
  ];
  for (const [kode, nama, jenis, saldo] of defaultCOA) {
    await conn.query(
      'INSERT IGNORE INTO akun (idtenant, kodeakun, namaakun, jenisak, saldo, status, userentry) VALUES (?,?,?,?,?,?,?)',
      [idtenant, kode, nama, jenis, saldo, 'AKTIF', 0]
    );
  }
}

async function seedDefaultCustomer(conn, idtenant, iduser = 0) {
  await conn.query(
    `INSERT IGNORE INTO customer (idtenant, kodecustomer, namacustomer, alamat, hp, status, userentry)
     VALUES (?, 'CASH', 'CASH', '', '', 'AKTIF', ?)`,
    [idtenant, iduser]
  );
}

module.exports = { seedDefaultCOA, seedDefaultCustomer };

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
