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
    'saldostokdtl', 'saldostok',
    'produksidtl', 'produksi',
    'resepdtl', 'resep',
    'hitunghppdtl', 'hitunghpp',
    'saldoawaldtl', 'saldoawal',
    'penyesuaianstokdtl', 'penyesuaianstok',
    'kartustok',
    'tukarbarangdtl_baru', 'tukarbarangdtl_kembali', 'tukarbarang',
    'returjualdtl', 'returjual',
    'belidtl', 'beli', 'jualdtl', 'jual',
    'hargajual', 'hargabeli',
    'kasdtl', 'kas', 'jurnal',
    'barang', 'supplier', 'customer',
    'akun',
    'menutemplate',
    'user', 'lokasi', 'tenant',
    'menu', 'currency',
    'users', 'historyprogram'
  ];
  for (const t of tables) {
    await connection.query(`DROP TABLE IF EXISTS \`${t}\``);
  }
  console.log('Tables dropped');

  // ============================================================
  // GLOBAL TABLES (shared semua tenant)
  // ============================================================

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
      idmenu        INT AUTO_INCREMENT PRIMARY KEY,
      idparent      INT DEFAULT NULL,
      kodemenu      VARCHAR(50) NOT NULL UNIQUE,
      namamenu      VARCHAR(100) NOT NULL,
      urutan        INT DEFAULT 0,
      icon          VARCHAR(50) DEFAULT NULL,
      path          VARCHAR(200) DEFAULT NULL,
      status        VARCHAR(20) DEFAULT 'AKTIF',
      FOREIGN KEY (idparent) REFERENCES menu(idmenu)
    ) ENGINE=InnoDB
  `);

  // ============================================================
  // TENANT TABLES
  // ============================================================

  // tenant
  await connection.query(`
    CREATE TABLE tenant (
      idtenant      INT AUTO_INCREMENT PRIMARY KEY,
      namatenant    VARCHAR(200) NOT NULL,
      alamat        VARCHAR(500),
      hp            VARCHAR(50),
      email         VARCHAR(200),
      npwp          VARCHAR(30),
      logo          VARCHAR(500),
      ppn           DECIMAL(5,2) DEFAULT 0,
      idcurrency    INT NOT NULL DEFAULT 1,
      status        VARCHAR(20) DEFAULT 'AKTIF',
      userentry     INT NOT NULL,
      tglentry      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idcurrency) REFERENCES currency(idcurrency)
    ) ENGINE=InnoDB
  `);

  // lokasi
  await connection.query(`
    CREATE TABLE lokasi (
      idlokasi      INT AUTO_INCREMENT PRIMARY KEY,
      idtenant      INT NOT NULL,
      kodelokasi    VARCHAR(10) NOT NULL,
      namalokasi    VARCHAR(200) NOT NULL,
      alamat        VARCHAR(500),
      hp            VARCHAR(50),
      isdefault     TINYINT(1) DEFAULT 0,
      status        VARCHAR(20) DEFAULT 'AKTIF',
      userentry     INT NOT NULL,
      tglentry      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      INDEX idx_lokasi_tenant (idtenant, idlokasi)
    ) ENGINE=InnoDB
  `);

  // user
  await connection.query(`
    CREATE TABLE user (
      iduser        INT AUTO_INCREMENT PRIMARY KEY,
      idtenant      INT NOT NULL,
      username      VARCHAR(100) NOT NULL,
      pass          VARCHAR(255) NOT NULL,
      namauser      VARCHAR(200) NOT NULL,
      email         VARCHAR(200),
      hp            VARCHAR(50),
      isowner       TINYINT(1) DEFAULT 0,
      tokenversion  INT DEFAULT 1,
      status        VARCHAR(20) DEFAULT 'AKTIF',
      userentry     INT NOT NULL,
      tglentry      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      INDEX idx_user_tenant (idtenant),
      INDEX idx_user_username (username)
    ) ENGINE=InnoDB
  `);

  // usermenu
  await connection.query(`
    CREATE TABLE usermenu (
      idusermenu    INT AUTO_INCREMENT PRIMARY KEY,
      iduser        INT NOT NULL,
      idmenu        INT NOT NULL,
      status        VARCHAR(20) DEFAULT 'AKTIF',
      userentry     INT NOT NULL,
      tglentry      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
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
      userentry     INT NOT NULL,
      tglentry      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (iduser) REFERENCES user(iduser) ON DELETE CASCADE,
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      UNIQUE KEY uq_userlokasi (iduser, idlokasi)
    ) ENGINE=InnoDB
  `);

  // menutemplate
  await connection.query(`
    CREATE TABLE menutemplate (
      idmenutemplate INT AUTO_INCREMENT PRIMARY KEY,
      idtenant       INT NOT NULL,
      namatemplate   VARCHAR(100) NOT NULL,
      status         VARCHAR(20) DEFAULT 'AKTIF',
      userentry      INT NOT NULL,
      tglentry       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant)
    ) ENGINE=InnoDB
  `);

  // menutemplatedtl
  await connection.query(`
    CREATE TABLE menutemplatedtl (
      idmenutemplatedtl INT AUTO_INCREMENT PRIMARY KEY,
      idmenutemplate   INT NOT NULL,
      idmenu           INT NOT NULL,
      status           VARCHAR(20) DEFAULT 'AKTIF',
      FOREIGN KEY (idmenutemplate) REFERENCES menutemplate(idmenutemplate) ON DELETE CASCADE,
      FOREIGN KEY (idmenu) REFERENCES menu(idmenu),
      UNIQUE KEY uq_menutemplatedtl (idmenutemplate, idmenu)
    ) ENGINE=InnoDB
  `);

  // ============================================================
  // MASTER DATA TABLES (tenant-level, no idlokasi)
  // ============================================================

  // barang
  await connection.query(`
    CREATE TABLE barang (
      idbarang      INT AUTO_INCREMENT PRIMARY KEY,
      idtenant      INT NOT NULL,
      kodebarang    VARCHAR(20) NOT NULL,
      namabarang    VARCHAR(200) NOT NULL,
      satuanbesar   VARCHAR(20) DEFAULT NULL,
      satuansedang  VARCHAR(20) DEFAULT NULL,
      satuankecil   VARCHAR(20) DEFAULT NULL,
      konversi1     INT DEFAULT 0,
      konversi2     INT DEFAULT 0,
      jenis         VARCHAR(30) DEFAULT 'BAHAN JADI',
      stokmin       INT DEFAULT 0,
      status        VARCHAR(20) DEFAULT 'AKTIF',
      userentry     INT NOT NULL,
      tglentry      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (userentry) REFERENCES user(iduser),
      INDEX idx_barang_tenant (idtenant),
      UNIQUE KEY uq_barang_kode (idtenant, kodebarang)
    ) ENGINE=InnoDB
  `);

  // customer
  await connection.query(`
    CREATE TABLE customer (
      idcustomer    INT AUTO_INCREMENT PRIMARY KEY,
      idtenant      INT NOT NULL,
      kodecustomer  VARCHAR(20) NOT NULL,
      namacustomer  VARCHAR(200) NOT NULL,
      alamat        VARCHAR(500),
      hp            VARCHAR(50),
      status        VARCHAR(20) DEFAULT 'AKTIF',
      userentry     INT NOT NULL,
      tglentry      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (userentry) REFERENCES user(iduser),
      INDEX idx_customer_tenant (idtenant),
      UNIQUE KEY uq_customer_kode (idtenant, kodecustomer)
    ) ENGINE=InnoDB
  `);

  // supplier
  await connection.query(`
    CREATE TABLE supplier (
      idsupplier    INT AUTO_INCREMENT PRIMARY KEY,
      idtenant      INT NOT NULL,
      kodesupplier  VARCHAR(20) NOT NULL,
      namasupplier  VARCHAR(200) NOT NULL,
      alamat        VARCHAR(500),
      hp            VARCHAR(50),
      status        VARCHAR(20) DEFAULT 'AKTIF',
      userentry     INT NOT NULL,
      tglentry      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (userentry) REFERENCES user(iduser),
      INDEX idx_supplier_tenant (idtenant),
      UNIQUE KEY uq_supplier_kode (idtenant, kodesupplier)
    ) ENGINE=InnoDB
  `);

  // akun
  await connection.query(`
    CREATE TABLE akun (
      idakun       INT AUTO_INCREMENT PRIMARY KEY,
      idtenant     INT NOT NULL,
      kodeakun     VARCHAR(20) NOT NULL,
      namaakun     VARCHAR(200) NOT NULL,
      saldo        VARCHAR(10) NOT NULL DEFAULT 'DEBET',
      status       VARCHAR(20) DEFAULT 'AKTIF',
      userentry    INT NOT NULL,
      tglentry     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (userentry) REFERENCES user(iduser),
      INDEX idx_akun_tenant (idtenant),
      UNIQUE KEY uq_akun_kode (idtenant, kodeakun)
    ) ENGINE=InnoDB
  `);

  // hargabeli
  await connection.query(`
    CREATE TABLE hargabeli (
      idhargabeli   INT AUTO_INCREMENT PRIMARY KEY,
      idtenant      INT NOT NULL,
      idbarang      INT NOT NULL,
      hargabeli     DECIMAL(15,2) NOT NULL,
      tgltrans      DATE NOT NULL,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idbarang) REFERENCES barang(idbarang),
      INDEX idx_hargabeli_barang (idbarang, tgltrans DESC),
      INDEX idx_hargabeli_tenant (idtenant)
    ) ENGINE=InnoDB
  `);

  // hargajual
  await connection.query(`
    CREATE TABLE hargajual (
      idhargajual   INT AUTO_INCREMENT PRIMARY KEY,
      idtenant      INT NOT NULL,
      idbarang      INT NOT NULL,
      hargajual     DECIMAL(15,2) NOT NULL,
      tgltrans      DATE NOT NULL,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idbarang) REFERENCES barang(idbarang),
      INDEX idx_hargajual_barang (idbarang, tgltrans DESC),
      INDEX idx_hargajual_tenant (idtenant)
    ) ENGINE=InnoDB
  `);

  // ============================================================
  // TRANSACTION TABLES (lokasi-level: idtenant + idlokasi)
  // ============================================================

  // jual
  await connection.query(`
    CREATE TABLE jual (
      idjual        INT AUTO_INCREMENT PRIMARY KEY,
      idtenant      INT NOT NULL,
      idlokasi      INT NOT NULL,
      kodejual      VARCHAR(30) NOT NULL,
      tgltrans      DATE NOT NULL,
      idcustomer    INT DEFAULT NULL,
      iduser        INT NOT NULL,
      grandtotal    DECIMAL(15,2) NOT NULL DEFAULT 0,
      bayar         DECIMAL(15,2) NOT NULL DEFAULT 0,
      kembali       DECIMAL(15,2) NOT NULL DEFAULT 0,
      jenis         VARCHAR(20) DEFAULT 'POS',
      metodbayar    VARCHAR(20) DEFAULT 'TUNAI',
      catatan       TEXT,
      status        VARCHAR(20) DEFAULT 'AKTIF',
      userentry     INT NOT NULL,
      tglentry      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      FOREIGN KEY (idcustomer) REFERENCES customer(idcustomer),
      FOREIGN KEY (iduser) REFERENCES user(iduser),
      FOREIGN KEY (userentry) REFERENCES user(iduser),
      INDEX idx_jual_tenant_lokasi (idtenant, idlokasi),
      INDEX idx_jual_tgl (tgltrans),
      UNIQUE KEY uq_jual_kode (idtenant, idlokasi, kodejual)
    ) ENGINE=InnoDB
  `);

  // jualdtl
  await connection.query(`
    CREATE TABLE jualdtl (
      idjualdtl     INT AUTO_INCREMENT PRIMARY KEY,
      idjual        INT NOT NULL,
      idtenant      INT NOT NULL,
      idbarang      INT DEFAULT NULL,
      jml           INT NOT NULL,
      harga         DECIMAL(15,2) NOT NULL,
      ppn           DECIMAL(15,2) DEFAULT 0,
      diskon        DECIMAL(5,2) DEFAULT 0,
      subtotal      DECIMAL(15,2) NOT NULL,
      FOREIGN KEY (idjual) REFERENCES jual(idjual) ON DELETE CASCADE,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idbarang) REFERENCES barang(idbarang),
      INDEX idx_jualdtl_jual (idjual)
    ) ENGINE=InnoDB
  `);

  // beli
  await connection.query(`
    CREATE TABLE beli (
      idbeli        INT AUTO_INCREMENT PRIMARY KEY,
      idtenant      INT NOT NULL,
      idlokasi      INT NOT NULL,
      kodebeli      VARCHAR(30) NOT NULL,
      tgltrans      DATE NOT NULL,
      idsupplier    INT DEFAULT NULL,
      iduser        INT NOT NULL,
      grandtotal    DECIMAL(15,2) NOT NULL DEFAULT 0,
      bayar         DECIMAL(15,2) NOT NULL DEFAULT 0,
      status        VARCHAR(20) DEFAULT 'AKTIF',
      userentry     INT NOT NULL,
      tglentry      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      FOREIGN KEY (idsupplier) REFERENCES supplier(idsupplier),
      FOREIGN KEY (iduser) REFERENCES user(iduser),
      FOREIGN KEY (userentry) REFERENCES user(iduser),
      INDEX idx_beli_tenant_lokasi (idtenant, idlokasi),
      INDEX idx_beli_tgl (tgltrans),
      UNIQUE KEY uq_beli_kode (idtenant, idlokasi, kodebeli)
    ) ENGINE=InnoDB
  `);

  // belidtl
  await connection.query(`
    CREATE TABLE belidtl (
      idbelidtl     INT AUTO_INCREMENT PRIMARY KEY,
      idbeli        INT NOT NULL,
      idtenant      INT NOT NULL,
      idbarang      INT DEFAULT NULL,
      jml           INT NOT NULL,
      harga         DECIMAL(15,2) NOT NULL,
      ppn           DECIMAL(15,2) DEFAULT 0,
      diskon        DECIMAL(5,2) DEFAULT 0,
      subtotal      DECIMAL(15,2) NOT NULL,
      satuan        VARCHAR(20) DEFAULT NULL,
      FOREIGN KEY (idbeli) REFERENCES beli(idbeli) ON DELETE CASCADE,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idbarang) REFERENCES barang(idbarang),
      INDEX idx_belidtl_beli (idbeli)
    ) ENGINE=InnoDB
  `);

  // penyesuaianstok
  await connection.query(`
    CREATE TABLE penyesuaianstok (
      idpenyesuaianstok  INT AUTO_INCREMENT PRIMARY KEY,
      idtenant           INT NOT NULL,
      idlokasi           INT NOT NULL,
      kodepenyesuaianstok VARCHAR(30) NOT NULL,
      tgltrans           DATE NOT NULL,
      iduser             INT NOT NULL,
      keterangan         TEXT,
      status             VARCHAR(20) DEFAULT 'AKTIF',
      userentry          INT NOT NULL,
      tglentry           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      FOREIGN KEY (iduser) REFERENCES user(iduser),
      FOREIGN KEY (userentry) REFERENCES user(iduser),
      INDEX idx_penyesuaianstok_tenant_lokasi (idtenant, idlokasi),
      INDEX idx_penyesuaianstok_tgl (tgltrans),
      UNIQUE KEY uq_penyesuaianstok_kode (idtenant, idlokasi, kodepenyesuaianstok)
    ) ENGINE=InnoDB
  `);

  // penyesuaianstokdtl
  await connection.query(`
    CREATE TABLE penyesuaianstokdtl (
      idpenyesuaianstokdtl  INT AUTO_INCREMENT PRIMARY KEY,
      idpenyesuaianstok     INT NOT NULL,
      idtenant              INT NOT NULL,
      idbarang              INT DEFAULT NULL,
      jml                   INT NOT NULL,
      selisih               INT NOT NULL,
      keterangan            TEXT,
      FOREIGN KEY (idpenyesuaianstok) REFERENCES penyesuaianstok(idpenyesuaianstok) ON DELETE CASCADE,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idbarang) REFERENCES barang(idbarang),
      INDEX idx_penyesuaianstokdtl_hdr (idpenyesuaianstok)
    ) ENGINE=InnoDB
  `);

  // kartustok
  await connection.query(`
    CREATE TABLE kartustok (
      idkartustok   INT AUTO_INCREMENT PRIMARY KEY,
      idtenant      INT NOT NULL,
      idlokasi      INT NOT NULL,
      kodetrans     VARCHAR(30) NOT NULL,
      idbarang      INT DEFAULT NULL,
      jml           INT NOT NULL,
      jenis         VARCHAR(1) NOT NULL,
      tgltrans      DATE NOT NULL,
      keterangan    TEXT,
      idref         INT,
      jenisref      VARCHAR(30),
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      FOREIGN KEY (idbarang) REFERENCES barang(idbarang),
      INDEX idx_kartustok_tenant_lokasi (idtenant, idlokasi),
      INDEX idx_kartustok_barang (idbarang, tgltrans),
      INDEX idx_kartustok_tgl (tgltrans)
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
      catatan       TEXT,
      status        VARCHAR(20) DEFAULT 'AKTIF',
      userentry     INT NOT NULL,
      tglentry      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      FOREIGN KEY (iduser) REFERENCES user(iduser),
      FOREIGN KEY (userentry) REFERENCES user(iduser),
      INDEX idx_saldostok_tenant_lokasi (idtenant, idlokasi),
      UNIQUE KEY uq_saldostok_kode (idtenant, idlokasi, kodesaldostok)
    ) ENGINE=InnoDB
  `);

  // saldostokdtl
  await connection.query(`
    CREATE TABLE saldostokdtl (
      idsaldostokdtl INT AUTO_INCREMENT PRIMARY KEY,
      idsaldostok    INT NOT NULL,
      idtenant       INT NOT NULL,
      idbarang       INT DEFAULT NULL,
      qty            INT NOT NULL,
      FOREIGN KEY (idsaldostok) REFERENCES saldostok(idsaldostok) ON DELETE CASCADE,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idbarang) REFERENCES barang(idbarang),
      INDEX idx_saldostokdtl_hdr (idsaldostok)
    ) ENGINE=InnoDB
  `);

  // kas
  await connection.query(`
    CREATE TABLE kas (
      idkas         INT AUTO_INCREMENT PRIMARY KEY,
      idtenant      INT NOT NULL,
      idlokasi      INT NOT NULL,
      kodekas       VARCHAR(30) NOT NULL,
      tgltrans      DATE NOT NULL,
      iduser        INT NOT NULL,
      catatan       TEXT,
      status        VARCHAR(20) DEFAULT 'AKTIF',
      userentry     INT NOT NULL,
      tglentry      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      FOREIGN KEY (iduser) REFERENCES user(iduser),
      FOREIGN KEY (userentry) REFERENCES user(iduser),
      INDEX idx_kas_tenant_lokasi (idtenant, idlokasi),
      INDEX idx_kas_tgl (tgltrans),
      UNIQUE KEY uq_kas_kode (idtenant, idlokasi, kodekas)
    ) ENGINE=InnoDB
  `);

  // kasdtl
  await connection.query(`
    CREATE TABLE kasdtl (
      idkasdtl      INT AUTO_INCREMENT PRIMARY KEY,
      idkas         INT NOT NULL,
      idtenant      INT NOT NULL,
      idakun        INT NOT NULL,
      catatan       VARCHAR(200),
      amount        DECIMAL(15,2) NOT NULL,
      FOREIGN KEY (idkas) REFERENCES kas(idkas) ON DELETE CASCADE,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idakun) REFERENCES akun(idakun),
      INDEX idx_kasdtl_kas (idkas)
    ) ENGINE=InnoDB
  `);

  // jurnal
  await connection.query(`
    CREATE TABLE jurnal (
      idjurnal      INT AUTO_INCREMENT PRIMARY KEY,
      idtenant      INT NOT NULL,
      idlokasi      INT NOT NULL,
      idtrans       INT NOT NULL,
      kodetrans     VARCHAR(30) NOT NULL,
      jenis         VARCHAR(20) NOT NULL,
      idakun        INT NOT NULL,
      posisi        VARCHAR(10) NOT NULL,
      amount        DECIMAL(15,2) NOT NULL,
      status        VARCHAR(20) DEFAULT 'AKTIF',
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      FOREIGN KEY (idakun) REFERENCES akun(idakun),
      INDEX idx_jurnal_tenant_lokasi (idtenant, idlokasi),
      INDEX idx_jurnal_kodetrans (kodetrans)
    ) ENGINE=InnoDB
  `);

  // closing
  await connection.query(`
    CREATE TABLE closing (
      idclosing     INT AUTO_INCREMENT PRIMARY KEY,
      idtenant      INT NOT NULL,
      idlokasi      INT NOT NULL,
      kodeclosing   VARCHAR(30) NOT NULL,
      tgltrans      DATE NOT NULL,
      periodbulan   VARCHAR(7) NOT NULL,
      iduser        INT NOT NULL,
      catatan       TEXT,
      status        VARCHAR(20) DEFAULT 'AKTIF',
      userentry     INT NOT NULL,
      tglentry      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      FOREIGN KEY (iduser) REFERENCES user(iduser),
      FOREIGN KEY (userentry) REFERENCES user(iduser),
      INDEX idx_closing_tenant_lokasi (idtenant, idlokasi, periodbulan),
      UNIQUE KEY uq_closing_kode (idtenant, idlokasi, kodeclosing)
    ) ENGINE=InnoDB
  `);

  // closingdtl
  await connection.query(`
    CREATE TABLE closingdtl (
      idclosingdtl  INT AUTO_INCREMENT PRIMARY KEY,
      idclosing     INT NOT NULL,
      idtenant      INT NOT NULL,
      idakun        INT NOT NULL,
      amountdb      DECIMAL(15,2) DEFAULT 0,
      amountcr      DECIMAL(15,2) DEFAULT 0,
      FOREIGN KEY (idclosing) REFERENCES closing(idclosing) ON DELETE CASCADE,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idakun) REFERENCES akun(idakun),
      INDEX idx_closingdtl_hdr (idclosing)
    ) ENGINE=InnoDB
  `);

  // historyprogram — developer portal audit log
  await connection.query(`
    CREATE TABLE historyprogram (
      idhistory     BIGINT AUTO_INCREMENT PRIMARY KEY,
      idtenant      INT DEFAULT NULL,
      idlokasi      INT DEFAULT NULL,
      iduser        INT DEFAULT NULL,
      action        VARCHAR(100) NOT NULL,
      ref           VARCHAR(50) DEFAULT NULL,
      detail        JSON DEFAULT NULL,
      ip            VARCHAR(45) DEFAULT NULL,
      useragent     VARCHAR(255) DEFAULT NULL,
      tglentry      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_history_tenant (idtenant),
      INDEX idx_history_action (action),
      INDEX idx_history_tgl (tglentry)
    ) ENGINE=InnoDB
  `);

  // hitunghpp — HPP calculation header
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
      totalpembelian  DECIMAL(15,2) DEFAULT 0,
      totalhppjual    DECIMAL(15,2) DEFAULT 0,
      totalsaldoakhir DECIMAL(15,2) DEFAULT 0,
      catatan         TEXT,
      status          VARCHAR(20) DEFAULT 'AKTIF',
      userentry       INT NOT NULL,
      tglentry        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      FOREIGN KEY (iduser) REFERENCES user(iduser),
      FOREIGN KEY (userentry) REFERENCES user(iduser),
      INDEX idx_hitunghpp_tenant_lokasi (idtenant, idlokasi, periodbulan),
      UNIQUE KEY uq_hitunghpp_period (idtenant, idlokasi, periodbulan, status)
    ) ENGINE=InnoDB
  `);

  // hitunghppdtl — HPP calculation detail per barang
  await connection.query(`
    CREATE TABLE hitunghppdtl (
      idhitunghppdtl  INT AUTO_INCREMENT PRIMARY KEY,
      idhitunghpp     INT NOT NULL,
      idtenant        INT NOT NULL,
      idbarang        INT NOT NULL,
      saldoawal_qty       DECIMAL(15,2) DEFAULT 0,
      saldoawal_nilai     DECIMAL(15,2) DEFAULT 0,
      pembelian_qty       DECIMAL(15,2) DEFAULT 0,
      pembelian_nilai     DECIMAL(15,2) DEFAULT 0,
      total_qty           DECIMAL(15,2) DEFAULT 0,
      total_nilai         DECIMAL(15,2) DEFAULT 0,
      hpp_per_unit        DECIMAL(15,4) DEFAULT 0,
      qty_jual            DECIMAL(15,2) DEFAULT 0,
      hpp_jual            DECIMAL(15,2) DEFAULT 0,
      qty_adjust          DECIMAL(15,2) DEFAULT 0,
      hpp_adjust          DECIMAL(15,2) DEFAULT 0,
      saldoakhir_qty      DECIMAL(15,2) DEFAULT 0,
      saldoakhir_nilai    DECIMAL(15,2) DEFAULT 0,
      FOREIGN KEY (idhitunghpp) REFERENCES hitunghpp(idhitunghpp) ON DELETE CASCADE,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idbarang) REFERENCES barang(idbarang),
      INDEX idx_hitunghppdtl_hdr (idhitunghpp),
      INDEX idx_hitunghppdtl_barang (idbarang)
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
      catatan       TEXT,
      status        VARCHAR(20) DEFAULT 'AKTIF',
      userentry     INT NOT NULL,
      tglentry      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      FOREIGN KEY (idcustomer) REFERENCES customer(idcustomer),
      FOREIGN KEY (iduser) REFERENCES user(iduser),
      FOREIGN KEY (userentry) REFERENCES user(iduser),
      INDEX idx_returjual_tenant_lokasi (idtenant, idlokasi),
      INDEX idx_returjual_tgl (tgltrans),
      UNIQUE KEY uq_returjual_kode (idtenant, idlokasi, kodereturjual)
    ) ENGINE=InnoDB
  `);

  // returjualdtl
  await connection.query(`
    CREATE TABLE returjualdtl (
      idreturjualdtl INT AUTO_INCREMENT PRIMARY KEY,
      idreturjual    INT NOT NULL,
      idtenant       INT NOT NULL,
      idbarang       INT NOT NULL,
      jml            INT NOT NULL,
      harga          DECIMAL(15,2) NOT NULL DEFAULT 0,
      subtotal       DECIMAL(15,2) NOT NULL DEFAULT 0,
      tindaklanjut   VARCHAR(20) NOT NULL DEFAULT 'MASUK_STOK',
      idbarang2nd    INT DEFAULT NULL,
      FOREIGN KEY (idreturjual) REFERENCES returjual(idreturjual) ON DELETE CASCADE,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idbarang) REFERENCES barang(idbarang),
      FOREIGN KEY (idbarang2nd) REFERENCES barang(idbarang),
      INDEX idx_returjualdtl_hdr (idreturjual)
    ) ENGINE=InnoDB
  `);

  // tukarbarang
  await connection.query(`
    CREATE TABLE tukarbarang (
      idtukarbarang   INT AUTO_INCREMENT PRIMARY KEY,
      idtenant        INT NOT NULL,
      idlokasi        INT NOT NULL,
      kodetukarbarang VARCHAR(30) NOT NULL,
      tgltrans        DATE NOT NULL,
      idcustomer      INT DEFAULT NULL,
      iduser          INT NOT NULL,
      catatan         TEXT,
      status          VARCHAR(20) DEFAULT 'AKTIF',
      userentry       INT NOT NULL,
      tglentry        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idlokasi) REFERENCES lokasi(idlokasi),
      FOREIGN KEY (idcustomer) REFERENCES customer(idcustomer),
      FOREIGN KEY (iduser) REFERENCES user(iduser),
      FOREIGN KEY (userentry) REFERENCES user(iduser),
      INDEX idx_tukarbarang_tenant_lokasi (idtenant, idlokasi),
      INDEX idx_tukarbarang_tgl (tgltrans),
      UNIQUE KEY uq_tukarbarang_kode (idtenant, idlokasi, kodetukarbarang)
    ) ENGINE=InnoDB
  `);

  // tukarbarangdtl_kembali — items returned from customer
  await connection.query(`
    CREATE TABLE tukarbarangdtl_kembali (
      idtukarbarangdtl_kembali INT AUTO_INCREMENT PRIMARY KEY,
      idtukarbarang  INT NOT NULL,
      idtenant       INT NOT NULL,
      idbarang       INT NOT NULL,
      jml            INT NOT NULL,
      harga          DECIMAL(15,2) NOT NULL DEFAULT 0,
      subtotal       DECIMAL(15,2) NOT NULL DEFAULT 0,
      tindaklanjut   VARCHAR(20) NOT NULL DEFAULT 'MASUK_STOK',
      idbarang2nd    INT DEFAULT NULL,
      FOREIGN KEY (idtukarbarang) REFERENCES tukarbarang(idtukarbarang) ON DELETE CASCADE,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idbarang) REFERENCES barang(idbarang),
      FOREIGN KEY (idbarang2nd) REFERENCES barang(idbarang),
      INDEX idx_tukarbarangdtl_kembali_hdr (idtukarbarang)
    ) ENGINE=InnoDB
  `);

  // tukarbarangdtl_baru — replacement items to customer
  await connection.query(`
    CREATE TABLE tukarbarangdtl_baru (
      idtukarbarangdtl_baru INT AUTO_INCREMENT PRIMARY KEY,
      idtukarbarang  INT NOT NULL,
      idtenant       INT NOT NULL,
      idbarang       INT NOT NULL,
      jml            INT NOT NULL,
      harga          DECIMAL(15,2) NOT NULL DEFAULT 0,
      subtotal       DECIMAL(15,2) NOT NULL DEFAULT 0,
      FOREIGN KEY (idtukarbarang) REFERENCES tukarbarang(idtukarbarang) ON DELETE CASCADE,
      FOREIGN KEY (idtenant) REFERENCES tenant(idtenant),
      FOREIGN KEY (idbarang) REFERENCES barang(idbarang),
      INDEX idx_tukarbarangdtl_baru_hdr (idtukarbarang)
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

  // Seed menu — top-level
  const topMenus = [
    [1, null, 'dashboard',           'Dashboard',           1, 'LayoutDashboard', '/'],
    [2, null, 'pos',                 'POS',                 2, 'ShoppingCart',    '/pos'],
    [3, null, 'master',              'Master',              3, 'Package',         null],
    [4, null, 'pembelian',           'Pembelian',           4, 'ShoppingBag',     '/pembelian'],
    [5, null, 'penjualan',           'Penjualan',           5, 'ReceiptText',     '/penjualan'],
    [6, null, 'stok',                'Stok',                6, 'Warehouse',       null],
    [7, null, 'kas',                 'Kas',                 7, 'Coins',           '/kas'],
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
    [14, 3, 'master.user',       'User',     5, null, '/master/user'],
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
  ];
  for (const m of stokChildren) {
    await connection.query(
      'INSERT INTO menu (idmenu, idparent, kodemenu, namamenu, urutan, icon, path) VALUES (?, ?, ?, ?, ?, ?, ?)',
      m
    );
  }

  // Seed menu — children: Penjualan
  const penjualanChildren = [
    [25, 5, 'penjualan.transaksi',    'Transaksi Jual',   1, null, '/penjualan'],
    [26, 5, 'penjualan.retur',        'Retur Penjualan',  2, null, '/penjualan/retur'],
    [27, 5, 'penjualan.tukarbarang',  'Tukar Barang',     3, null, '/penjualan/tukarbarang'],
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

  console.log('Seed data inserted');
  console.log('Migration completed successfully!');

  await connection.end();
  process.exit(0);
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
