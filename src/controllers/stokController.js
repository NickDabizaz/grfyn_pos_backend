const pool = require('../config/db');

// ============ KARTU STOK ============
exports.getKartuStok = async (req, res) => {
  try {
    const { idbarang, tglwal, tglakhir, jenis, search } = req.query;
    let sql = `SELECT ks.*, b.namabarang, b.satuankecil FROM kartustok ks LEFT JOIN barang b ON ks.idbarang = b.idbarang WHERE 1=1`;
    const params = [];
    if (idbarang) { sql += ' AND ks.idbarang = ?'; params.push(idbarang); }
    if (tglwal) { sql += ' AND ks.tgltrans >= ?'; params.push(tglwal); }
    if (tglakhir) { sql += ' AND ks.tgltrans <= ?'; params.push(tglakhir); }
    if (jenis) { sql += ' AND ks.jenis = ?'; params.push(jenis); }
    if (search) { sql += ' AND ks.kodetrans LIKE ?'; params.push(`%${search}%`); }
    sql += ' ORDER BY ks.tgltrans DESC, ks.idkartustok DESC LIMIT 500';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ============ PENYESUAIAN STOK ============
exports.getPenyesuaian = async (req, res) => {
  try {
    const { search } = req.query;
    let sql = `SELECT ps.*, u.username as kasir
      FROM penyesuaianstok ps LEFT JOIN users u ON ps.idkasir = u.iduser WHERE 1=1`;
    const params = [];
    if (search) { sql += ' AND ps.kodepenyesuaianstok LIKE ?'; params.push(`%${search}%`); }
    sql += ' ORDER BY ps.tgltrans DESC, ps.idpenyesuaianstok DESC';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getPenyesuaianDetail = async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT psd.*, b.namabarang, b.satuankecil
      FROM penyesuaianstokdtl psd LEFT JOIN barang b ON psd.idbarang = b.idbarang
      WHERE psd.idpenyesuaianstok = ?`, [req.params.id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.createPenyesuaian = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { idkasir, keterangan, items, tgltrans: tglInput } = req.body;

    if (!items || !items.length) return res.status(400).json({ message: 'Items tidak boleh kosong' });

    const tgltrans = tglInput || new Date().toISOString().slice(0, 10);
    const dateStr = tgltrans.replace(/-/g, '');
    const [[{ cnt }]] = await conn.query(`SELECT COUNT(*) as cnt FROM penyesuaianstok WHERE kodepenyesuaianstok LIKE ?`, [`PNS-${dateStr}-%`]);
    const num = String(cnt + 1).padStart(4, '0');
    const kode = `PNS-${dateStr}-${num}`;

    await conn.query(
      'INSERT INTO penyesuaianstok (kodepenyesuaianstok, tgltrans, idkasir, keterangan) VALUES (?, ?, ?, ?)',
      [kode, tgltrans, idkasir, keterangan || '']
    );
    const [[header]] = await conn.query('SELECT idpenyesuaianstok FROM penyesuaianstok WHERE kodepenyesuaianstok = ?', [kode]);

    for (const item of items) {
      // Get current stock from kartustok
      const [[masuk]] = await conn.query('SELECT COALESCE(SUM(jml), 0) as total FROM kartustok WHERE idbarang = ? AND jenis = ?', [item.idbarang, 'M']);
      const [[keluar]] = await conn.query('SELECT COALESCE(SUM(jml), 0) as total FROM kartustok WHERE idbarang = ? AND jenis = ?', [item.idbarang, 'K']);
      const stokProgram = masuk.total - keluar.total;
      const selisih = stokProgram - item.jml;

      await conn.query(
        'INSERT INTO penyesuaianstokdtl (idpenyesuaianstok, kodepenyesuaianstok, idbarang, jml, selisih, keterangan) VALUES (?, ?, ?, ?, ?, ?)',
        [header.idpenyesuaianstok, kode, item.idbarang, item.jml, selisih, item.keterangan || '']
      );

      // Kartu stok adjustment
      if (selisih !== 0) {
        const jenis = selisih > 0 ? 'K' : 'M';
        const jmlAbs = Math.abs(selisih);
        await conn.query(
          'INSERT INTO kartustok (kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idref, jenisref) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [kode, item.idbarang, jmlAbs, jenis, tgltrans, `Penyesuaian ${kode}`, header.idpenyesuaianstok, 'penyesuaianstok']
        );
      }
    }

    // Generate saldostok baru
    const saldoDateStr = tgltrans.replace(/-/g, '');
    const [[{ cnt: cntSaldo }]] = await conn.query(`SELECT COUNT(*) as cnt FROM saldostok WHERE kodesaldostok LIKE ?`, [`SD-${saldoDateStr}-%`]);
    const numSaldo = String(cntSaldo + 1).padStart(4, '0');
    const kodeSaldo = `SD-${saldoDateStr}-${numSaldo}`;

    await conn.query(
      'INSERT INTO saldostok (kodesaldostok, tgltrans, keterangan) VALUES (?, ?, ?)',
      [kodeSaldo, tgltrans, 'SALDO PENYESUAIAN STOK']
    );
    const [[saldoHeader]] = await conn.query('SELECT idsaldostok FROM saldostok WHERE kodesaldostok = ?', [kodeSaldo]);

    // Hitung saldo untuk semua barang yang ada di kartustok
    const [allBarang] = await conn.query('SELECT DISTINCT idbarang FROM kartustok');
    for (const b of allBarang) {
      const [[m]] = await conn.query('SELECT COALESCE(SUM(jml), 0) as total FROM kartustok WHERE idbarang = ? AND jenis = ?', [b.idbarang, 'M']);
      const [[k]] = await conn.query('SELECT COALESCE(SUM(jml), 0) as total FROM kartustok WHERE idbarang = ? AND jenis = ?', [b.idbarang, 'K']);
      const saldoAkhir = m.total - k.total;
      if (saldoAkhir > 0) {
        await conn.query(
          'INSERT INTO saldostokdtl (idsaldostok, kodesaldostok, idbarang, jml) VALUES (?, ?, ?, ?)',
          [saldoHeader.idsaldostok, kodeSaldo, b.idbarang, saldoAkhir]
        );
      }
    }

    await conn.commit();
    res.status(201).json({ message: 'Penyesuaian stok berhasil', kode });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// ============ SALDO STOK ============
exports.getSaldoStok = async (req, res) => {
  try {
    const { tgl } = req.query;
    const targetDate = tgl || new Date().toISOString().slice(0, 10);

    // Cek apakah ada saldostok
    const [[saldoExists]] = await pool.query('SELECT COUNT(*) as cnt FROM saldostok');

    if (saldoExists.cnt === 0) {
      // No saldostok yet, use kartustok only
      const [rows] = await pool.query(
        `SELECT b.idbarang, b.kodebarang, b.namabarang, b.satuankecil, b.stokmin,
          COALESCE(m.total, 0) - COALESCE(k.total, 0) as stok
        FROM barang b
        LEFT JOIN (SELECT idbarang, SUM(jml) as total FROM kartustok WHERE jenis='M' GROUP BY idbarang) m ON b.idbarang = m.idbarang
        LEFT JOIN (SELECT idbarang, SUM(jml) as total FROM kartustok WHERE jenis='K' GROUP BY idbarang) k ON b.idbarang = k.idbarang
        WHERE b.status = 1 ORDER BY b.namabarang`
      );
      return res.json(rows);
    }

    // Gunakan saldostok snapshot + kartustok setelahnya
    const sql = `SELECT b.idbarang, b.kodebarang, b.namabarang, b.satuankecil, b.stokmin,
      COALESCE(sd.jml, 0) + COALESCE(k.masuk, 0) - COALESCE(k.keluar, 0) as stok
    FROM barang b
    LEFT JOIN (
      SELECT ssd.idbarang, ssd.jml FROM saldostokdtl ssd
      JOIN saldostok ss ON ss.idsaldostok = ssd.idsaldostok
      WHERE ss.tgltrans = (SELECT MAX(tgltrans) FROM saldostok WHERE tgltrans <= ?)
    ) sd ON sd.idbarang = b.idbarang
    LEFT JOIN (
      SELECT idbarang,
        COALESCE(SUM(CASE WHEN jenis='M' THEN jml ELSE 0 END), 0) as masuk,
        COALESCE(SUM(CASE WHEN jenis='K' THEN jml ELSE 0 END), 0) as keluar
      FROM kartustok WHERE tgltrans > (SELECT COALESCE(MAX(tgltrans), '1970-01-01') FROM saldostok WHERE tgltrans <= ?)
      GROUP BY idbarang
    ) k ON k.idbarang = b.idbarang
    WHERE b.status = 1 ORDER BY b.namabarang`;
    const [rows] = await pool.query(sql, [targetDate, targetDate]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getSaldoStokList = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM saldostok ORDER BY tgltrans DESC, idsaldostok DESC LIMIT 50');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getSaldoStokDetail = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT ssd.*, b.namabarang, b.satuankecil, b.kodebarang
       FROM saldostokdtl ssd
       LEFT JOIN barang b ON ssd.idbarang = b.idbarang
       WHERE ssd.idsaldostok = ?`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ============ CLOSING ============
function getPeriodDates(jenis, rawValue) {
  // rawValue: 'YYYY-MM-DD' for harian, 'YYYY-MM' for bulanan
  if (jenis === 'HARIAN') {
    return { start: rawValue, end: rawValue };
  }
  // BULANAN
  const [y, m] = rawValue.split('-');
  const start = `${y}-${m}-01`;
  const end = new Date(parseInt(y), parseInt(m), 0).toISOString().slice(0, 10);
  return { start, end };
}

exports.createClosing = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { jenis, periode } = req.body; // jenis: 'HARIAN' | 'BULANAN', periode: 'YYYY-MM-DD' | 'YYYY-MM'

    if (!jenis || !periode) {
      return res.status(400).json({ message: 'Jenis dan periode wajib diisi' });
    }

    const { start, end } = getPeriodDates(jenis, periode);

    // 1. Cek apakah sudah ada closing untuk periode yang sama
    const [[existing]] = await conn.query(
      `SELECT COUNT(*) as cnt FROM closing 
       WHERE status = 1 AND jenis = ? AND periode_start = ? AND periode_end = ?`,
      [jenis, start, end]
    );
    if (existing.cnt > 0) {
      return res.status(400).json({ message: `Closing ${jenis} untuk periode ini sudah ada` });
    }

    // 2. Cek apakah ada transaksi jual di periode ini
    const [[transaksi]] = await conn.query(
      `SELECT COUNT(*) as cnt FROM jual WHERE status = 1 AND tgltrans >= ? AND tgltrans <= ?`,
      [start, end]
    );
    if (transaksi.cnt === 0) {
      return res.status(400).json({ message: 'Tidak ada transaksi penjualan di periode ini' });
    }

    // 3. Cek apakah ada closing lain yang mencakup periode ini (konflik)
    const [[conflict]] = await conn.query(
      `SELECT COUNT(*) as cnt FROM closing 
       WHERE status = 1 AND (
         (periode_start <= ? AND periode_end >= ?) OR
         (periode_start <= ? AND periode_end >= ?)
       )`,
      [end, start, end, start]
    );
    // Untuk harian: cek apakah ada closing bulanan yang mencakup tanggal ini
    // Untuk bulanan: cek apakah ada closing harian di dalam bulan ini
    if (jenis === 'HARIAN') {
      const [[conflictBulanan]] = await conn.query(
        `SELECT COUNT(*) as cnt FROM closing WHERE status = 1 AND jenis = 'BULANAN' AND periode_start <= ? AND periode_end >= ?`,
        [end, start]
      );
      if (conflictBulanan.cnt > 0) {
        return res.status(400).json({ message: 'Tanggal ini sudah masuk dalam closing bulanan' });
      }
    } else {
      const [[conflictHarian]] = await conn.query(
        `SELECT COUNT(*) as cnt FROM closing WHERE status = 1 AND jenis = 'HARIAN' AND periode_start >= ? AND periode_end <= ?`,
        [start, end]
      );
      if (conflictHarian.cnt > 0) {
        return res.status(400).json({ message: 'Ada closing harian di dalam bulan ini, batalkan terlebih dahulu' });
      }
    }

    // 4. Validasi: apakah ada transaksi sebelum periode ini yang belum diclosing?
    const [[unclosed]] = await conn.query(
      `SELECT DISTINCT j.tgltrans as tgl
       FROM jual j
       WHERE j.status = 1 AND j.tgltrans < ?
       AND NOT EXISTS (
         SELECT 1 FROM closing c
         WHERE c.status = 1 AND c.periode_start <= j.tgltrans AND c.periode_end >= j.tgltrans
       )
       LIMIT 1`,
      [start]
    );
    if (unclosed) {
      return res.status(400).json({ message: `Harap closing periode sebelumnya terlebih dahulu (ada transaksi tanggal ${unclosed.tgl} yang belum closing)` });
    }

    // 5. Generate kode closing
    const datePrefix = jenis === 'HARIAN' ? periode.replace(/-/g, '') : periode.replace(/-/g, '');
    const prefix = jenis === 'HARIAN' ? `CLS-H-${datePrefix}` : `CLS-B-${datePrefix}`;
    const [[{ cnt }]] = await conn.query(`SELECT COUNT(*) as cnt FROM closing WHERE kodeclosing LIKE ?`, [`${prefix}-%`]);
    const num = String(cnt + 1).padStart(4, '0');
    const kodeclosing = `${prefix}-${num}`;
    const tglclosing = new Date().toISOString().slice(0, 10);

    // 6. Insert closing
    await conn.query(
      'INSERT INTO closing (kodeclosing, tglclosing, periode_start, periode_end, jenis) VALUES (?, ?, ?, ?, ?)',
      [kodeclosing, tglclosing, start, end, jenis]
    );
    const [[header]] = await conn.query('SELECT idclosing FROM closing WHERE kodeclosing = ?', [kodeclosing]);

    // 7. Hitung total keluar per barang dari t_jual
    const [barangKeluar] = await conn.query(
      `SELECT jd.idbarang, SUM(jd.jml) as total
       FROM jual j
       JOIN jualdtl jd ON j.idjual = jd.idjual
       WHERE j.status = 1 AND j.tgltrans >= ? AND j.tgltrans <= ?
       GROUP BY jd.idbarang`,
      [start, end]
    );

    // 8. Insert closingdtl
    for (const row of barangKeluar) {
      await conn.query(
        'INSERT INTO closingdtl (idclosing, idbarang, jml) VALUES (?, ?, ?)',
        [header.idclosing, row.idbarang, row.total]
      );
    }

    // 9. Hapus kartustok per-transaksi (jenisref='jual') di periode ini
    await conn.query(
      `DELETE FROM kartustok WHERE jenisref = 'jual' AND tgltrans >= ? AND tgltrans <= ?`,
      [start, end]
    );

    // 10. Insert kartustok summary closing
    for (const row of barangKeluar) {
      await conn.query(
        `INSERT INTO kartustok (kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idref, jenisref)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [kodeclosing, row.idbarang, row.total, 'K', end, `Closing ${jenis} ${kodeclosing}`, header.idclosing, jenis === 'HARIAN' ? 'closing_harian' : 'closing_bulanan']
      );
    }

    await conn.commit();
    res.status(201).json({ message: `Closing ${jenis} berhasil`, kodeclosing });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.cancelClosing = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { id } = req.params;

    const [[closing]] = await conn.query('SELECT * FROM closing WHERE idclosing = ?', [id]);
    if (!closing) return res.status(404).json({ message: 'Closing tidak ditemukan' });
    if (closing.status === 0) return res.status(400).json({ message: 'Closing sudah dibatalkan' });

    const jenisref = closing.jenis === 'HARIAN' ? 'closing_harian' : 'closing_bulanan';

    // 1. Hapus kartustok summary closing
    await conn.query(
      `DELETE FROM kartustok WHERE jenisref = ? AND idref = ?`,
      [jenisref, id]
    );

    // 2. Re-generate kartustok dari t_jual per transaksi asli
    const [juals] = await conn.query(
      `SELECT j.idjual, j.kodejual, j.tgltrans FROM jual j
       WHERE j.status = 1 AND j.tgltrans >= ? AND j.tgltrans <= ?`,
      [closing.periode_start, closing.periode_end]
    );

    for (const j of juals) {
      const [details] = await conn.query(
        `SELECT idbarang, jml FROM jualdtl WHERE idjual = ?`,
        [j.idjual]
      );
      for (const d of details) {
        await conn.query(
          `INSERT INTO kartustok (kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idref, jenisref)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [j.kodejual, d.idbarang, d.jml, 'K', j.tgltrans, `Penjualan ${j.kodejual}`, j.idjual, 'jual']
        );
      }
    }

    // 3. Nonaktifkan closing
    await conn.query('UPDATE closing SET status = 0 WHERE idclosing = ?', [id]);

    // closingdtl dibiarkan untuk history

    await conn.commit();
    res.json({ message: `Closing ${closing.kodeclosing} berhasil dibatalkan` });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.getClosingDetail = async (req, res) => {
  try {
    const [header] = await pool.query('SELECT * FROM closing WHERE idclosing = ?', [req.params.id]);
    if (header.length === 0) return res.status(404).json({ message: 'Closing tidak ditemukan' });

    const [items] = await pool.query(
      `SELECT cd.*, b.kodebarang, b.namabarang, b.satuankecil
       FROM closingdtl cd
       LEFT JOIN barang b ON cd.idbarang = b.idbarang
       WHERE cd.idclosing = ?`,
      [req.params.id]
    );

    res.json({ ...header[0], items });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ============ SALDO AWAL STOK ============
exports.createSaldoAwal = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { idkasir, keterangan, items, tgltrans: tglInput } = req.body;

    if (!items || !items.length) return res.status(400).json({ message: 'Items tidak boleh kosong' });

    const tgltrans = tglInput || new Date().toISOString().slice(0, 10);
    const dateStr = tgltrans.replace(/-/g, '');
    const [[{ cnt }]] = await conn.query('SELECT COUNT(*) as cnt FROM saldostok WHERE kodesaldostok LIKE ?', [`SA-${dateStr}-%`]);
    const num = String(cnt + 1).padStart(4, '0');
    const kodeSaldo = `SA-${dateStr}-${num}`;

    await conn.query(
      'INSERT INTO saldostok (kodesaldostok, tgltrans, keterangan) VALUES (?, ?, ?)',
      [kodeSaldo, tgltrans, keterangan || 'SALDO AWAL STOK']
    );
    const [[header]] = await conn.query('SELECT idsaldostok FROM saldostok WHERE kodesaldostok = ?', [kodeSaldo]);

    for (const item of items) {
      await conn.query(
        'INSERT INTO saldostokdtl (idsaldostok, kodesaldostok, idbarang, jml) VALUES (?, ?, ?, ?)',
        [header.idsaldostok, kodeSaldo, item.idbarang, item.jml]
      );

      if (item.jml > 0) {
        await conn.query(
          'INSERT INTO kartustok (kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idref, jenisref) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [kodeSaldo, item.idbarang, item.jml, 'M', tgltrans, `Saldo Awal ${kodeSaldo}`, header.idsaldostok, 'saldostok']
        );
      }
    }

    await conn.commit();
    res.status(201).json({ message: 'Saldo awal stok berhasil', kode: kodeSaldo });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.getClosing = async (req, res) => {
  try {
    const { jenis } = req.query;
    let sql = 'SELECT * FROM closing WHERE 1=1';
    const params = [];
    if (jenis) { sql += ' AND jenis = ?'; params.push(jenis); }
    sql += ' ORDER BY periode_end DESC, idclosing DESC LIMIT 50';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ============ GET STOK PER BARANG ============
exports.getStok = async (req, res) => {
  try {
    const { idbarang } = req.params;
    const targetDate = req.query.tgl || new Date().toISOString().slice(0, 10);

    // Cari saldostok terbaru <= targetDate
    const [[latestSaldo]] = await pool.query(
      `SELECT ss.idsaldostok, ss.tgltrans FROM saldostok ss
       WHERE ss.tgltrans <= ? ORDER BY ss.tgltrans DESC LIMIT 1`,
      [targetDate]
    );

    let stok = 0;
    let fromDate = null;

    if (latestSaldo) {
      const [[snap]] = await pool.query(
        `SELECT COALESCE(jml, 0) as jml FROM saldostokdtl
         WHERE idsaldostok = ? AND idbarang = ?`,
        [latestSaldo.idsaldostok, idbarang]
      );
      stok = snap ? snap.jml : 0;
      fromDate = latestSaldo.tgltrans;
    }

    // Kartu stok: M (masuk) & K (keluar) setelah fromDate s/d targetDate
    const params = [idbarang];
    let dateCond = 'AND tgltrans <= ?';
    params.push(targetDate);
    if (fromDate) {
      dateCond += ' AND tgltrans > ?';
      params.push(fromDate);
    }

    const [[masuk]] = await pool.query(
      `SELECT COALESCE(SUM(jml), 0) as total FROM kartustok
       WHERE idbarang = ? AND jenis = 'M' ${dateCond}`,
      params
    );
    const [[keluar]] = await pool.query(
      `SELECT COALESCE(SUM(jml), 0) as total FROM kartustok
       WHERE idbarang = ? AND jenis = 'K' ${dateCond}`,
      params
    );

    stok += masuk.total - keluar.total;

    res.json({ idbarang: parseInt(idbarang), stok, tgl: targetDate });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
