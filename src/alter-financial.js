require('dotenv').config();
const mysql = require('mysql2/promise');

async function alterFinancial() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    port: parseInt(process.env.DB_PORT) || 3306,
    database: process.env.DB_NAME || 'grfyn_pos',
  });

  console.log('Connected to database:', process.env.DB_NAME);

  // 1. ALTER akun: tambah kolom jenisak
  try {
    await connection.query(`ALTER TABLE akun ADD COLUMN jenisak VARCHAR(30) DEFAULT 'BEBAN'`);
    console.log('Added jenisak column to akun');
  } catch (err) {
    if (err.code === 'ER_DUP_FIELDNAME') {
      console.log('jenisak column already exists in akun — skipped');
    } else {
      throw err;
    }
  }

  // 2. ALTER jurnal: tambah kolom tgltrans
  try {
    await connection.query(`ALTER TABLE jurnal ADD COLUMN tgltrans DATE DEFAULT NULL`);
    console.log('Added tgltrans column to jurnal');
  } catch (err) {
    if (err.code === 'ER_DUP_FIELDNAME') {
      console.log('tgltrans column already exists in jurnal — skipped');
    } else {
      throw err;
    }
  }

  // 3. CREATE TABLE closing
  await connection.query(`
    CREATE TABLE IF NOT EXISTS closing (
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
      UNIQUE KEY uq_closing_kode (idtenant, idlokasi, kodeclosing),
      INDEX idx_closing_periode (idtenant, idlokasi, periodbulan)
    ) ENGINE=InnoDB
  `);
  console.log('closing table ready');

  // 4. CREATE TABLE closingdtl
  await connection.query(`
    CREATE TABLE IF NOT EXISTS closingdtl (
      idclosingdtl  INT AUTO_INCREMENT PRIMARY KEY,
      idclosing     INT NOT NULL,
      idtenant      INT NOT NULL,
      idakun        INT NOT NULL,
      namaakun      VARCHAR(100) DEFAULT NULL,
      jenisak       VARCHAR(30) DEFAULT NULL,
      total_debet   DECIMAL(15,2) DEFAULT 0,
      total_kredit  DECIMAL(15,2) DEFAULT 0,
      saldo_normal  DECIMAL(15,2) DEFAULT 0,
      INDEX idx_closingdtl_closing (idclosing)
    ) ENGINE=InnoDB
  `);
  console.log('closingdtl table ready');

  // 5. Backfill tgltrans di jurnal dari tabel transaksi
  console.log('Backfilling jurnal.tgltrans ...');

  await connection.query(`
    UPDATE jurnal j
    JOIN jual jl ON j.idtrans = jl.idjual AND j.idtenant = jl.idtenant
    SET j.tgltrans = jl.tgltrans
    WHERE j.jenis = 'jual' AND j.tgltrans IS NULL
  `);
  console.log('Backfilled jurnal tgltrans from jual');

  await connection.query(`
    UPDATE jurnal j
    JOIN beli b ON j.idtrans = b.idbeli AND j.idtenant = b.idtenant
    SET j.tgltrans = b.tgltrans
    WHERE j.jenis = 'beli' AND j.tgltrans IS NULL
  `);
  console.log('Backfilled jurnal tgltrans from beli');

  await connection.query(`
    UPDATE jurnal j
    JOIN kas k ON j.idtrans = k.idkas AND j.idtenant = k.idtenant
    SET j.tgltrans = k.tgltrans
    WHERE j.jenis = 'kas' AND j.tgltrans IS NULL
  `);
  console.log('Backfilled jurnal tgltrans from kas');

  await connection.query(`
    UPDATE jurnal j
    JOIN returjual rj ON j.idtrans = rj.idreturjual AND j.idtenant = rj.idtenant
    SET j.tgltrans = rj.tgltrans
    WHERE j.jenis = 'returjual' AND j.tgltrans IS NULL
  `);
  console.log('Backfilled jurnal tgltrans from returjual');

  await connection.query(`
    UPDATE jurnal j
    JOIN returbeli rb ON j.idtrans = rb.idreturbeli AND j.idtenant = rb.idtenant
    SET j.tgltrans = rb.tgltrans
    WHERE j.jenis = 'returbeli' AND j.tgltrans IS NULL
  `);
  console.log('Backfilled jurnal tgltrans from returbeli');

  await connection.query(`
    UPDATE jurnal j
    JOIN produksi p ON j.idtrans = p.idproduksi AND j.idtenant = p.idtenant
    SET j.tgltrans = p.tgltrans
    WHERE j.jenis = 'produksi' AND j.tgltrans IS NULL
  `);
  console.log('Backfilled jurnal tgltrans from produksi');

  console.log('alter-financial completed successfully!');
  await connection.end();
  process.exit(0);
}

alterFinancial().catch(err => {
  console.error('alter-financial failed:', err);
  process.exit(1);
});
