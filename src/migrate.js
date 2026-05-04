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

  // Create database
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME || 'grfyn_pos'}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await connection.query(`USE \`${process.env.DB_NAME || 'grfyn_pos'}\``);
  console.log(`Database ${process.env.DB_NAME} ready`);

  // Drop tables in reverse dependency order
  const tables = [
    'produksidtl', 'produksi',
    'hitunghppdtl', 'hitunghpp',
    'closingdtl', 'closing', 'kartustok', 'saldostokdtl', 'saldostok',
    'saldoawaldtl', 'saldoawal',
    'penyesuaianstokdtl', 'penyesuaianstok',
    'belidtl', 'beli', 'jualdtl', 'jual',
    'hargajual', 'hargabeli',
    'resepdtl', 'resep',
    'kasdtl', 'kas', 'jurnal',
    'barang', 'supplier', 'customer', 'akun', 'users'
  ];
  for (const t of tables) {
    await connection.query(`DROP TABLE IF EXISTS \`${t}\``);
  }
  console.log('Tables dropped');

  // 1. users
  await connection.query(`
    CREATE TABLE users (
      iduser INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(50) NOT NULL UNIQUE,
      email VARCHAR(100),
      pass VARCHAR(255) NOT NULL,
      namatoko VARCHAR(100),
      alamat TEXT,
      hp VARCHAR(20),
      logo VARCHAR(255),
      ppn DECIMAL(5,2) DEFAULT 11.00,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);

  // 2. customer
  await connection.query(`
    CREATE TABLE customer (
      idcustomer INT AUTO_INCREMENT PRIMARY KEY,
      kodecustomer VARCHAR(20) NOT NULL UNIQUE,
      namacustomer VARCHAR(100) NOT NULL,
      alamat TEXT,
      hp VARCHAR(20)
    ) ENGINE=InnoDB
  `);

  // 3. supplier
  await connection.query(`
    CREATE TABLE supplier (
      idsupplier INT AUTO_INCREMENT PRIMARY KEY,
      kodesupplier VARCHAR(20) NOT NULL UNIQUE,
      namasupplier VARCHAR(100) NOT NULL,
      alamat TEXT,
      hp VARCHAR(20)
    ) ENGINE=InnoDB
  `);

  // 4. barang
  await connection.query(`
    CREATE TABLE barang (
      idbarang INT AUTO_INCREMENT PRIMARY KEY,
      kodebarang VARCHAR(20) NOT NULL UNIQUE,
      namabarang VARCHAR(200) NOT NULL,
      satuanbesar VARCHAR(20),
      satuansedang VARCHAR(20),
      satuankecil VARCHAR(20),
      konversi1 INT DEFAULT 0,
      konversi2 INT DEFAULT 0,
      jenis ENUM('BAHAN BAKU', 'BAHAN JADI') DEFAULT 'BAHAN JADI',
      stokmin INT DEFAULT 0,
      status INT DEFAULT 1
    ) ENGINE=InnoDB
  `);

  // 5. hargabeli
  await connection.query(`
    CREATE TABLE hargabeli (
      idhargabeli INT AUTO_INCREMENT PRIMARY KEY,
      idbarang INT NOT NULL,
      hargabeli DECIMAL(15,2) NOT NULL,
      tgltrans DATE NOT NULL,
      FOREIGN KEY (idbarang) REFERENCES barang(idbarang) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);

  // 6. hargajual
  await connection.query(`
    CREATE TABLE hargajual (
      idhargajual INT AUTO_INCREMENT PRIMARY KEY,
      idbarang INT NOT NULL,
      hargajual DECIMAL(15,2) NOT NULL,
      tgltrans DATE NOT NULL,
      FOREIGN KEY (idbarang) REFERENCES barang(idbarang) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);

  // 7. jual
  await connection.query(`
    CREATE TABLE jual (
      idjual INT AUTO_INCREMENT PRIMARY KEY,
      kodejual VARCHAR(30) NOT NULL UNIQUE,
      tgltrans DATE NOT NULL,
      idcustomer INT,
      idkasir INT,
      grandtotal DECIMAL(15,2) DEFAULT 0,
      bayar DECIMAL(15,2) DEFAULT 0,
      kembali DECIMAL(15,2) DEFAULT 0,
      jenis ENUM('POS','JUAL') DEFAULT 'POS',
      status INT DEFAULT 1,
      FOREIGN KEY (idcustomer) REFERENCES customer(idcustomer),
      FOREIGN KEY (idkasir) REFERENCES users(iduser)
    ) ENGINE=InnoDB
  `);

  // 8. jualdtl
  await connection.query(`
    CREATE TABLE jualdtl (
      idjualdtl INT AUTO_INCREMENT PRIMARY KEY,
      idjual INT NOT NULL,
      kodejual VARCHAR(30),
      idbarang INT,
      jml INT NOT NULL,
      harga DECIMAL(15,2) NOT NULL,
      ppn DECIMAL(15,2) DEFAULT 0,
      diskon DECIMAL(5,2) DEFAULT 0,
      subtotal DECIMAL(15,2) NOT NULL,
      FOREIGN KEY (idjual) REFERENCES jual(idjual) ON DELETE CASCADE,
      FOREIGN KEY (idbarang) REFERENCES barang(idbarang)
    ) ENGINE=InnoDB
  `);

  // 9. beli
  await connection.query(`
    CREATE TABLE beli (
      idbeli INT AUTO_INCREMENT PRIMARY KEY,
      kodebeli VARCHAR(30) NOT NULL UNIQUE,
      tgltrans DATE NOT NULL,
      idsupplier INT,
      idkasir INT,
      grandtotal DECIMAL(15,2) DEFAULT 0,
      bayar DECIMAL(15,2) DEFAULT 0,
      status INT DEFAULT 1,
      FOREIGN KEY (idsupplier) REFERENCES supplier(idsupplier),
      FOREIGN KEY (idkasir) REFERENCES users(iduser)
    ) ENGINE=InnoDB
  `);

  // 10. belidtl
  await connection.query(`
    CREATE TABLE belidtl (
      idbelidtl INT AUTO_INCREMENT PRIMARY KEY,
      idbeli INT NOT NULL,
      kodebeli VARCHAR(30),
      idbarang INT,
      jml INT NOT NULL,
      harga DECIMAL(15,2) NOT NULL,
      ppn DECIMAL(15,2) DEFAULT 0,
      diskon DECIMAL(5,2) DEFAULT 0,
      subtotal DECIMAL(15,2) NOT NULL,
      FOREIGN KEY (idbeli) REFERENCES beli(idbeli) ON DELETE CASCADE,
      FOREIGN KEY (idbarang) REFERENCES barang(idbarang)
    ) ENGINE=InnoDB
  `);

  // 11. penyesuaianstok
  await connection.query(`
    CREATE TABLE penyesuaianstok (
      idpenyesuaianstok INT AUTO_INCREMENT PRIMARY KEY,
      kodepenyesuaianstok VARCHAR(30) NOT NULL UNIQUE,
      tgltrans DATE NOT NULL,
      idkasir INT,
      keterangan TEXT,
      status INT DEFAULT 1,
      FOREIGN KEY (idkasir) REFERENCES users(iduser)
    ) ENGINE=InnoDB
  `);

  // 12. penyesuaianstokdtl
  await connection.query(`
    CREATE TABLE penyesuaianstokdtl (
      idpenyesuaianstokdtl INT AUTO_INCREMENT PRIMARY KEY,
      idpenyesuaianstok INT NOT NULL,
      kodepenyesuaianstok VARCHAR(30),
      idbarang INT,
      jml INT NOT NULL,
      selisih INT NOT NULL,
      keterangan TEXT,
      FOREIGN KEY (idpenyesuaianstok) REFERENCES penyesuaianstok(idpenyesuaianstok) ON DELETE CASCADE,
      FOREIGN KEY (idbarang) REFERENCES barang(idbarang)
    ) ENGINE=InnoDB
  `);

  // 13. saldostok
  await connection.query(`
    CREATE TABLE saldostok (
      idsaldostok INT AUTO_INCREMENT PRIMARY KEY,
      kodesaldostok VARCHAR(30) NOT NULL UNIQUE,
      tgltrans DATE NOT NULL,
      keterangan VARCHAR(200),
      status INT DEFAULT 1
    ) ENGINE=InnoDB
  `);

  // 14. saldostokdtl
  await connection.query(`
    CREATE TABLE saldostokdtl (
      idsaldostokdtl INT AUTO_INCREMENT PRIMARY KEY,
      idsaldostok INT NOT NULL,
      kodesaldostok VARCHAR(30),
      idbarang INT,
      jml INT NOT NULL,
      FOREIGN KEY (idsaldostok) REFERENCES saldostok(idsaldostok) ON DELETE CASCADE,
      FOREIGN KEY (idbarang) REFERENCES barang(idbarang)
    ) ENGINE=InnoDB
  `);

  // 15. kartustok
  await connection.query(`
    CREATE TABLE kartustok (
      idkartustok INT AUTO_INCREMENT PRIMARY KEY,
      kodetrans VARCHAR(30) NOT NULL,
      idbarang INT,
      jml INT NOT NULL,
      jenis ENUM('M', 'K') NOT NULL,
      tgltrans DATE NOT NULL,
      keterangan TEXT,
      idref INT,
      jenisref VARCHAR(30),
      FOREIGN KEY (idbarang) REFERENCES barang(idbarang)
    ) ENGINE=InnoDB
  `);

  // 16. closing
  await connection.query(`
    CREATE TABLE closing (
      idclosing INT AUTO_INCREMENT PRIMARY KEY,
      kodeclosing VARCHAR(30) NOT NULL UNIQUE,
      tglclosing DATE NOT NULL,
      periode_start DATE NOT NULL,
      periode_end DATE NOT NULL,
      jenis ENUM('HARIAN', 'BULANAN') NOT NULL,
      status INT DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);

  // 16b. closing detail
  await connection.query(`
    CREATE TABLE closingdtl (
      idclosingdtl INT AUTO_INCREMENT PRIMARY KEY,
      idclosing INT NOT NULL,
      idbarang INT NOT NULL,
      jml INT NOT NULL,
      FOREIGN KEY (idclosing) REFERENCES closing(idclosing) ON DELETE CASCADE,
      FOREIGN KEY (idbarang) REFERENCES barang(idbarang)
    ) ENGINE=InnoDB
  `);

  // 17. hitunghpp
  await connection.query(`
    CREATE TABLE hitunghpp (
      idhitunghpp INT AUTO_INCREMENT PRIMARY KEY,
      kodehitunghpp VARCHAR(30) NOT NULL UNIQUE,
      tgltrans DATE NOT NULL,
      periode_bulan VARCHAR(7) NOT NULL,
      periode_dari DATE NOT NULL,
      periode_sampai DATE NOT NULL,
      keterangan TEXT,
      iduser INT,
      status INT DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (iduser) REFERENCES users(iduser)
    ) ENGINE=InnoDB
  `);

  // 18. hitunghppdtl
  await connection.query(`
    CREATE TABLE hitunghppdtl (
      idhitunghppdtl INT AUTO_INCREMENT PRIMARY KEY,
      idhitunghpp INT NOT NULL,
      kodehitunghpp VARCHAR(30),
      idbarang INT NOT NULL,
      saldo_awal_qty DECIMAL(15,2) DEFAULT 0,
      saldo_awal_hpp DECIMAL(15,2) DEFAULT 0,
      pembelian_qty DECIMAL(15,2) DEFAULT 0,
      pembelian_total DECIMAL(15,2) DEFAULT 0,
      produksi_qty DECIMAL(15,2) DEFAULT 0,
      produksi_total DECIMAL(15,2) DEFAULT 0,
      penyesuaian_qty DECIMAL(15,2) DEFAULT 0,
      penyesuaian_total DECIMAL(15,2) DEFAULT 0,
      penjualan_qty DECIMAL(15,2) DEFAULT 0,
      penjualan_hpp DECIMAL(15,2) DEFAULT 0,
      saldo_akhir_qty DECIMAL(15,2) DEFAULT 0,
      saldo_akhir_hpp DECIMAL(15,2) DEFAULT 0,
      hpp_per_unit DECIMAL(15,2) DEFAULT 0,
      FOREIGN KEY (idhitunghpp) REFERENCES hitunghpp(idhitunghpp) ON DELETE CASCADE,
      FOREIGN KEY (idbarang) REFERENCES barang(idbarang)
    ) ENGINE=InnoDB
  `);

  // 19. resep
  await connection.query(`
    CREATE TABLE resep (
      idresep INT AUTO_INCREMENT PRIMARY KEY,
      koderesep VARCHAR(30) NOT NULL UNIQUE,
      idbarang INT NOT NULL,
      hasiljml DECIMAL(15,2) DEFAULT 0,
      hasilsatuan VARCHAR(20),
      status INT DEFAULT 1,
      FOREIGN KEY (idbarang) REFERENCES barang(idbarang)
    ) ENGINE=InnoDB
  `);

  // 18. resepdtl
  await connection.query(`
    CREATE TABLE resepdtl (
      idresepdtl INT AUTO_INCREMENT PRIMARY KEY,
      idresep INT NOT NULL,
      koderesep VARCHAR(30),
      idbarang INT NOT NULL,
      jml DECIMAL(15,2) NOT NULL,
      satuan VARCHAR(20),
      harga DECIMAL(15,2) DEFAULT 0,
      subtotal DECIMAL(15,2) DEFAULT 0,
      FOREIGN KEY (idresep) REFERENCES resep(idresep) ON DELETE CASCADE,
      FOREIGN KEY (idbarang) REFERENCES barang(idbarang)
    ) ENGINE=InnoDB
  `);

  // 19. produksi
  await connection.query(`
    CREATE TABLE produksi (
      idproduksi INT AUTO_INCREMENT PRIMARY KEY,
      kodeproduksi VARCHAR(30) NOT NULL UNIQUE,
      idresep INT,
      idbarang INT NOT NULL,
      tgltrans DATE NOT NULL,
      qtyhasil DECIMAL(15,2) NOT NULL DEFAULT 0,
      satuanhasil VARCHAR(20),
      biayatk DECIMAL(15,2) DEFAULT 0,
      biayaoverhead DECIMAL(15,2) DEFAULT 0,
      totalhpp DECIMAL(15,2) DEFAULT 0,
      hppperunit DECIMAL(15,2) DEFAULT 0,
      keterangan TEXT,
      iduser INT,
      status INT DEFAULT 1,
      FOREIGN KEY (idresep) REFERENCES resep(idresep) ON DELETE SET NULL,
      FOREIGN KEY (idbarang) REFERENCES barang(idbarang),
      FOREIGN KEY (iduser) REFERENCES users(iduser)
    ) ENGINE=InnoDB
  `);

  // 20. produksidtl
  await connection.query(`
    CREATE TABLE produksidtl (
      idproduksidtl INT AUTO_INCREMENT PRIMARY KEY,
      idproduksi INT NOT NULL,
      kodeproduksi VARCHAR(30),
      idbarang INT NOT NULL,
      jml DECIMAL(15,2) NOT NULL DEFAULT 0,
      satuan VARCHAR(20),
      harga DECIMAL(15,2) DEFAULT 0,
      subtotal DECIMAL(15,2) DEFAULT 0,
      FOREIGN KEY (idproduksi) REFERENCES produksi(idproduksi) ON DELETE CASCADE,
      FOREIGN KEY (idbarang) REFERENCES barang(idbarang)
    ) ENGINE=InnoDB
  `);

  // 21. akun
  await connection.query(`
    CREATE TABLE akun (
      idakun INT AUTO_INCREMENT PRIMARY KEY,
      kodeakun VARCHAR(20) NOT NULL UNIQUE,
      namaakun VARCHAR(200) NOT NULL,
      posisi ENUM('DEBET','KREDIT') NOT NULL DEFAULT 'DEBET',
      iduser INT,
      status INT DEFAULT 1,
      FOREIGN KEY (iduser) REFERENCES users(iduser)
    ) ENGINE=InnoDB
  `);

  // 22. kas
  await connection.query(`
    CREATE TABLE kas (
      idkas INT AUTO_INCREMENT PRIMARY KEY,
      kodekas VARCHAR(30) NOT NULL UNIQUE,
      tgltrans DATE NOT NULL,
      iduser INT,
      status INT DEFAULT 1,
      FOREIGN KEY (iduser) REFERENCES users(iduser)
    ) ENGINE=InnoDB
  `);

  // 23. kasdtl
  await connection.query(`
    CREATE TABLE kasdtl (
      idkasdtl INT AUTO_INCREMENT PRIMARY KEY,
      idkas INT NOT NULL,
      kodekas VARCHAR(30),
      idakun INT NOT NULL,
      catatan VARCHAR(200),
      amount DECIMAL(15,2) NOT NULL,
      FOREIGN KEY (idkas) REFERENCES kas(idkas) ON DELETE CASCADE,
      FOREIGN KEY (idakun) REFERENCES akun(idakun)
    ) ENGINE=InnoDB
  `);

  // 22. jurnal
  await connection.query(`
    CREATE TABLE jurnal (
      idjurnal INT AUTO_INCREMENT PRIMARY KEY,
      idtrans INT NOT NULL,
      kodetrans VARCHAR(30) NOT NULL,
      jenis VARCHAR(20) NOT NULL,
      idakun INT NOT NULL,
      posisi ENUM('DEBET','KREDIT') NOT NULL,
      amount DECIMAL(15,2) NOT NULL,
      status INT DEFAULT 1,
      FOREIGN KEY (idakun) REFERENCES akun(idakun)
    ) ENGINE=InnoDB
  `);

  // Indexes
  await connection.query(`CREATE INDEX idx_kartustok_barang ON kartustok(idbarang, tgltrans)`);
  await connection.query(`CREATE INDEX idx_kartustok_tgl ON kartustok(tgltrans)`);
  await connection.query(`CREATE INDEX idx_jual_tgl ON jual(tgltrans)`);
  await connection.query(`CREATE INDEX idx_beli_tgl ON beli(tgltrans)`);
  await connection.query(`CREATE INDEX idx_saldostok_tgl ON saldostok(tgltrans)`);
  await connection.query(`CREATE INDEX idx_hargabeli_barang ON hargabeli(idbarang, tgltrans DESC)`);
  await connection.query(`CREATE INDEX idx_hargajual_barang ON hargajual(idbarang, tgltrans DESC)`);
  await connection.query(`CREATE INDEX idx_hitunghpp_bulan ON hitunghpp(periode_bulan)`);
  await connection.query(`CREATE INDEX idx_hitunghppdtl_header ON hitunghppdtl(idhitunghpp)`);
  await connection.query(`CREATE INDEX idx_hitunghppdtl_barang ON hitunghppdtl(idbarang)`);

  console.log('All tables created');

  // Seed data
  const bcrypt = require('bcryptjs');
  const hash = await bcrypt.hash('admin123', 10);

  await connection.query(`INSERT INTO users (username, email, pass, namatoko, alamat, hp) VALUES (?, ?, ?, ?, ?, ?)`,
    ['admin', 'admin@grfyn.com', hash, 'Grfyn POS', 'Jl. Contoh No. 123', '081234567890']);

  await connection.query(`INSERT INTO customer (kodecustomer, namacustomer, alamat, hp) VALUES (?, ?, ?, ?)`,
    ['CST-0001', 'CASH', 'Umum', '-']);

  await connection.query(`INSERT INTO supplier (kodesupplier, namasupplier, alamat, hp) VALUES (?, ?, ?, ?)`,
    ['SUP-0001', 'Supplier Umum', '-', '-']);

  await connection.query(`INSERT INTO akun (kodeakun, namaakun, posisi, iduser) VALUES (?, ?, ?, ?)`,
    ['AKN-0001', 'KAS', 'DEBET', 1]);
  await connection.query(`INSERT INTO akun (kodeakun, namaakun, posisi, iduser) VALUES (?, ?, ?, ?)`,
    ['AKN-0002', 'PENJUALAN', 'KREDIT', 1]);
  await connection.query(`INSERT INTO akun (kodeakun, namaakun, posisi, iduser) VALUES (?, ?, ?, ?)`,
    ['AKN-0003', 'HPP', 'DEBET', 1]);

  console.log('Seed data inserted');
  console.log('Migration completed successfully!');
  console.log('Default login: admin / admin123');

  await connection.end();
  process.exit(0);
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
