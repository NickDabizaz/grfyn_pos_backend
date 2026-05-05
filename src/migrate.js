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
    'kartustok', 'saldoawaldtl', 'saldoawal',
    'penyesuaianstokdtl', 'penyesuaianstok',
    'belidtl', 'beli', 'jualdtl', 'jual',
    'hargajual', 'hargabeli',
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
      jenis ENUM('BAHAN BAKU', 'BAHAN SETENGAH JADI', 'BAHAN JADI') DEFAULT 'BAHAN JADI',
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
      metode_bayar ENUM('TUNAI','NON TUNAI') DEFAULT 'TUNAI',
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

  // 13. kartustok
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

  // 14. akun
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

  // 15. kas
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

  // 16. kasdtl
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

  // 17. jurnal
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
  await connection.query(`CREATE INDEX idx_hargabeli_barang ON hargabeli(idbarang, tgltrans DESC)`);
  await connection.query(`CREATE INDEX idx_hargajual_barang ON hargajual(idbarang, tgltrans DESC)`);

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
