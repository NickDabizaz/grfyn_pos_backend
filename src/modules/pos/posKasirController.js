const { pool, tenantQuery, getConnection, getTenantContext } = require('../../config/db');
const { generateKodeJual, generateKodePelunasanPiutang } = require('../../lib/kodetrans');
const { getConfigValue, setConfigValue } = require('../../lib/confighelper');
const jurnalhelper = require('../../lib/jurnalhelper');
const logger = require('../../lib/logger');

// GET /api/pos/modalawal/today
exports.getModalAwalToday = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const today = new Date().toISOString().slice(0, 10);
    const [[row]] = await pool.query(
      'SELECT * FROM modalawal WHERE idtenant = ? AND idlokasi = ? AND tgltrans = ?',
      [ctx.idtenant, ctx.idlokasi, today]
    );
    res.json(row || null);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// POST /api/pos/modalawal
exports.setModalAwal = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { amount } = req.body;
    const today = new Date().toISOString().slice(0, 10);

    const [[row]] = await pool.query(
      'SELECT idmodalawal FROM modalawal WHERE idtenant = ? AND idlokasi = ? AND tgltrans = ?',
      [ctx.idtenant, ctx.idlokasi, today]
    );

    if (row) {
      await pool.query(
        'UPDATE modalawal SET amount = ?, userentry = ? WHERE idmodalawal = ?',
        [amount, ctx.iduser, row.idmodalawal]
      );
    } else {
      await pool.query(
        'INSERT INTO modalawal (idtenant, idlokasi, tgltrans, amount, userentry, status) VALUES (?, ?, ?, ?, ?, ?)',
        [ctx.idtenant, ctx.idlokasi, today, amount, ctx.iduser, 'AKTIF']
      );
    }
    res.json({ message: 'Modal awal berhasil disimpan' });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

function toKecilJml(jml, satuan, barang) {
  const k1 = Math.max(parseInt(barang.konversi1) || 1, 1);
  const k2 = Math.max(parseInt(barang.konversi2) || 1, 1);
  if (satuan && barang.satuanbesar  && satuan === barang.satuanbesar)  return jml * k1 * k2;
  if (satuan && barang.satuansedang && satuan === barang.satuansedang) return jml * k2;
  return jml;
}

async function ensureCashCustomer(conn, { idtenant, iduser }) {
  const [[existing]] = await conn.query(
    "SELECT idcustomer FROM customer WHERE idtenant = ? AND kodecustomer = 'CASH' LIMIT 1",
    [idtenant]
  );
  if (existing) return existing.idcustomer;

  const [result] = await conn.query(
    `INSERT INTO customer (idtenant, kodecustomer, namacustomer, alamat, hp, status, userentry)
     VALUES (?, 'CASH', 'CASH', '', '', 'AKTIF', ?)`,
    [idtenant, iduser || 0]
  );
  return result.insertId;
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

// POST /api/pos/transaksi
exports.createTransaksi = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await jurnalhelper.ensureJurnalSchema(conn);
    const akun = await jurnalhelper.getDefaultAkunJurnal(conn, ctx.idtenant);
    await conn.beginTransaction();

    const { items, metodbayar } = req.body;
    if (!items || !items.length) {
      await conn.rollback();
      return res.status(400).json({ message: 'Items tidak boleh kosong' });
    }

    const tgltrans = new Date().toISOString().slice(0, 10);

    // Check if already closed today
    const [[setoran]] = await conn.query(
      'SELECT idsetorantunai FROM setorantunai WHERE idtenant = ? AND idlokasi = ? AND tgltrans = ?',
      [ctx.idtenant, ctx.idlokasi, tgltrans]
    );
    if (setoran) {
      await conn.rollback();
      return res.status(400).json({ message: 'Sudah dilakukan closing untuk hari ini, transaksi tidak bisa ditambah' });
    }

    const kodejual = await generateKodeJual(conn, ctx.idtenant, ctx.idlokasi);
    const jenistransaksi = 'POS';
    const statusJual = 'APPROVED';

    const [[tenant]]  = await conn.query('SELECT ppn FROM tenant WHERE idtenant = ?', [ctx.idtenant]);
    const ppnPercent  = tenant ? parseFloat(tenant.ppn) : 11;
    const hargaIncludePpn = String(await getConfigValue(conn, ctx.idtenant, 'POS', 'HARGA_INCLUDE_PPN') || 'YA').toUpperCase() === 'YA';
    const ppnRate = ppnPercent > 0 ? ppnPercent / 100 : 0;
    const idcustomer = await ensureCashCustomer(conn, { idtenant: ctx.idtenant, iduser: ctx.iduser });
    let grandTotal  = 0;
    let totalPpn    = 0;

    const [headerResult] = await conn.query(
      `INSERT INTO jual (idtenant, idlokasi, kodejual, tgltrans, idcustomer, iduser, grandtotal, bayar, jenistransaksi, is_lunaslangsung, status, userentry)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, 1, ?, ?)`,
      [ctx.idtenant, ctx.idlokasi, kodejual, tgltrans, idcustomer, ctx.iduser, jenistransaksi, statusJual, ctx.iduser]
    );
    const idjual = headerResult.insertId;

    for (const item of items) {
      const hargaInput = parseFloat(item.harga) || 0;
      const jml     = parseFloat(item.jml) || 1;
      const diskon  = parseFloat(item.diskon) || 0;

      const hargaDasar = hargaIncludePpn && ppnRate > 0
        ? roundMoney(hargaInput / (1 + ppnRate))
        : roundMoney(hargaInput);
      const dppSebelumDiskon = hargaDasar * jml;
      const disknRp = roundMoney((dppSebelumDiskon * diskon) / 100);
      const dppSetelahDiskon = Math.max(dppSebelumDiskon - disknRp, 0);
      const ppnRp = roundMoney(dppSetelahDiskon * ppnRate);
      const subTtl = roundMoney(dppSetelahDiskon + ppnRp);

      grandTotal += subTtl;
      totalPpn   += ppnRp;

      await conn.query(
        'INSERT INTO jualdtl (idjual, idtenant, idbarang, jml, harga, ppn, diskon, subtotal, satuan) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [idjual, ctx.idtenant, item.idbarang, jml, hargaDasar, ppnRp, diskon, subTtl, item.satuan || null]
      );

      const [[barangInfo]] = await conn.query('SELECT satuanbesar, satuansedang, satuankecil, konversi1, konversi2 FROM barang WHERE idbarang = ? AND idtenant = ?', [item.idbarang, ctx.idtenant]);
      const jmlStokKecil   = barangInfo ? toKecilJml(jml, item.satuan, barangInfo) : jml;

      await conn.query(
        'INSERT INTO kartustok (idtenant, idlokasi, kodetrans, idbarang, jml, jenis, tgltrans, keterangan, idtrans, jenistransaksi) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [ctx.idtenant, ctx.idlokasi, kodejual, item.idbarang, jmlStokKecil, 'K', tgltrans, `POS ${kodejual}`, idjual, 'POS']
      );
    }

    grandTotal = roundMoney(grandTotal);
    await conn.query('UPDATE jual SET grandtotal = ?, bayar = ? WHERE idjual = ?', [grandTotal, grandTotal, idjual]);

    // Piutang and Pelunasan
    await conn.query(
      'INSERT INTO kartupiutang (idtenant, idlokasi, idcustomer, kodetrans, jenis, amount, terbayar, sisa, tgltrans, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [ctx.idtenant, ctx.idlokasi, idcustomer, kodejual, 'JUAL', grandTotal, grandTotal, 0, tgltrans, 'LUNAS']
    );

    // Jurnal penjualan POS: DEBET Piutang; KREDIT Penjualan + PPN Keluaran
    await jurnalhelper.postJurnalPenjualan(conn, {
      akun, idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, idjual, kodejual, jenis: 'pos',
      tgltrans, grandtotal: grandTotal, totalppn: totalPpn,
    });

    if (grandTotal > 0) {
      const kodepelunasan = await generateKodePelunasanPiutang(conn, ctx.idtenant, ctx.idlokasi);
      const [pelResult] = await conn.query(
        'INSERT INTO pelunasanpiutang (idtenant, idlokasi, idcustomer, kodepelunasan, tgltrans, total_amount, metodbayar, catatan, userentry) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [ctx.idtenant, ctx.idlokasi, idcustomer, kodepelunasan, tgltrans, grandTotal, metodbayar || 'TUNAI', `Pelunasan POS ${kodejual}`, ctx.iduser]
      );
      await conn.query('INSERT INTO pelunasanpiutangdtl (idpelunasan, kodetrans, amount) VALUES (?, ?, ?)', [pelResult.insertId, kodejual, grandTotal]);

      // Jurnal pelunasan piutang POS (akun pembayaran dari setting default)
      const idakunBayar = jurnalhelper.resolveAkunBayar(akun, metodbayar);
      await conn.query('INSERT INTO pelunasanpiutangbayar (idpelunasan, idtenant, idakun, amount) VALUES (?, ?, ?, ?)', [pelResult.insertId, ctx.idtenant, idakunBayar, grandTotal]);
      await jurnalhelper.postJurnalPelunasanPiutang(conn, {
        akun, idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, idpelunasan: pelResult.insertId,
        kodepelunasan, tgltrans, payments: [{ idakun: idakunBayar, amount: grandTotal }],
      });
    }

    await conn.commit();
    await logger.history('POS_CREATE', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: kodejual, detail: { grandtotal: grandTotal }, req });
    res.status(201).json({ message: 'Transaksi berhasil', kodejual, idjual, grandtotal: grandTotal });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// GET /api/pos/transaksi/history
exports.getHistory = async (req, res) => {
  let conn;
  try {
    conn = await getConnection();
    const ctx = getTenantContext();
    const { tgltrans } = req.query;
    const dateQuery = tgltrans || new Date().toISOString().slice(0, 10);

    const rows = await tenantQuery(
      `SELECT j.*,
        DATE_FORMAT(j.tgltrans, '%Y-%m-%d') AS tgltrans,
        COALESCE(pp.metodbayar, 'TUNAI') as metodbayar
       FROM jual j
       LEFT JOIN pelunasanpiutangdtl ppd ON ppd.kodetrans = j.kodejual
       LEFT JOIN pelunasanpiutang pp ON pp.idpelunasan = ppd.idpelunasan
       WHERE j.idtenant = ? AND j.idlokasi = ? AND j.jenistransaksi = 'POS' AND j.tgltrans = ?
       ORDER BY j.idjual DESC`,
      [ctx.idtenant, ctx.idlokasi, dateQuery]
    );

    res.json(rows);
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    if (conn) conn.release();
  }
};

// POST /api/pos/transaksi/:id/cancel
exports.cancelTransaksi = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();
    const { id } = req.params;

    const [[jual]] = await conn.query('SELECT * FROM jual WHERE idjual = ? AND idtenant = ? AND idlokasi = ? AND jenistransaksi = "POS"', [id, ctx.idtenant, ctx.idlokasi]);
    if (!jual) {
      await conn.rollback();
      return res.status(404).json({ message: 'Transaksi tidak ditemukan' });
    }
    if (jual.status === 'CANCELLED') {
      await conn.rollback();
      return res.status(400).json({ message: 'Transaksi sudah dibatalkan' });
    }

    const [[setoran]] = await conn.query(
      'SELECT idsetorantunai FROM setorantunai WHERE idtenant = ? AND idlokasi = ? AND tgltrans = ?',
      [ctx.idtenant, ctx.idlokasi, jual.tgltrans]
    );
    if (setoran) {
      await conn.rollback();
      return res.status(400).json({ message: 'Sudah dilakukan closing, transaksi tidak bisa dibatalkan' });
    }

    // Hapus jurnal penjualan POS + jurnal pelunasannya
    const [pels] = await conn.query(
      `SELECT pp.kodepelunasan
       FROM pelunasanpiutang pp
       JOIN pelunasanpiutangdtl ppdtl ON pp.idpelunasan = ppdtl.idpelunasan
       WHERE ppdtl.kodetrans = ? AND pp.idtenant = ?`,
      [jual.kodejual, ctx.idtenant]
    );
    await jurnalhelper.hapusJurnal(conn, ctx.idtenant, [jual.kodejual, ...pels.map(p => p.kodepelunasan)]);

    // Delete pelunasan
    await conn.query(
      `DELETE pp, ppdtl
       FROM pelunasanpiutang pp
       JOIN pelunasanpiutangdtl ppdtl ON pp.idpelunasan = ppdtl.idpelunasan
       WHERE ppdtl.kodetrans = ? AND pp.idtenant = ?`,
      [jual.kodejual, ctx.idtenant]
    );

    // Delete piutang
    await conn.query('DELETE FROM kartupiutang WHERE kodetrans = ? AND idtenant = ?', [jual.kodejual, ctx.idtenant]);

    // Delete kartustok
    await conn.query("DELETE FROM kartustok WHERE idtrans = ? AND jenistransaksi = 'POS' AND idtenant = ?", [jual.idjual, ctx.idtenant]);

    // Cancel jual
    await conn.query("UPDATE jual SET status = 'CANCELLED' WHERE idjual = ? AND idtenant = ?", [id, ctx.idtenant]);

    await conn.commit();
    await logger.history('POS_CANCEL', { idtenant: ctx.idtenant, idlokasi: ctx.idlokasi, iduser: ctx.iduser, ref: jual.kodejual, req });
    res.json({ message: 'Transaksi berhasil dibatalkan' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// GET /api/pos/closing/summary
exports.getClosingSummary = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tgltrans } = req.query;
    const dateQuery = tgltrans || new Date().toISOString().slice(0, 10);

    const [[modal]] = await pool.query(
      'SELECT amount FROM modalawal WHERE idtenant = ? AND idlokasi = ? AND tgltrans = ?',
      [ctx.idtenant, ctx.idlokasi, dateQuery]
    );
    const modalAwal = modal ? parseFloat(modal.amount) : 0;

    const [[setoran]] = await pool.query(
      'SELECT amount FROM setorantunai WHERE idtenant = ? AND idlokasi = ? AND tgltrans = ?',
      [ctx.idtenant, ctx.idlokasi, dateQuery]
    );
    const setoranTunai = setoran ? parseFloat(setoran.amount) : null;
    const isClosed = setoran ? true : false;

    const summaryQuery = await pool.query(
      `SELECT
          COALESCE(SUM(j.grandtotal), 0) as total,
          COALESCE(SUM(CASE WHEN pp.metodbayar = 'TUNAI' THEN j.grandtotal ELSE 0 END), 0) as tunai,
          COALESCE(SUM(CASE WHEN pp.metodbayar != 'TUNAI' THEN j.grandtotal ELSE 0 END), 0) as non_tunai
       FROM jual j
       LEFT JOIN pelunasanpiutangdtl ppd ON ppd.kodetrans = j.kodejual
       LEFT JOIN pelunasanpiutang pp ON pp.idpelunasan = ppd.idpelunasan
       WHERE j.idtenant = ? AND j.idlokasi = ? AND j.jenistransaksi = 'POS' AND j.tgltrans = ? AND j.status = 'APPROVED'`,
      [ctx.idtenant, ctx.idlokasi, dateQuery]
    );

    const summary = summaryQuery[0][0];

    res.json({
      modal_awal: modalAwal,
      transaksi_tunai: parseFloat(summary.tunai),
      transaksi_non_tunai: parseFloat(summary.non_tunai),
      transaksi_total: parseFloat(summary.total),
      setoran_tunai: setoranTunai !== null ? setoranTunai : 0,
      selisih: setoranTunai !== null ? (setoranTunai - modalAwal - parseFloat(summary.tunai)) : 0,
      is_closed: isClosed
    });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// POST /api/pos/closing
exports.closingHarian = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await conn.beginTransaction();

    const { tgltrans, setoran_tunai } = req.body;
    const dateQuery = tgltrans || new Date().toISOString().slice(0, 10);

    const [[existing]] = await conn.query(
      'SELECT idsetorantunai FROM setorantunai WHERE idtenant = ? AND idlokasi = ? AND tgltrans = ?',
      [ctx.idtenant, ctx.idlokasi, dateQuery]
    );

    if (existing) {
      await conn.rollback();
      return res.status(400).json({ message: 'Closing sudah dilakukan untuk hari ini' });
    }

    await conn.query(
      'INSERT INTO setorantunai (idtenant, idlokasi, tgltrans, amount, userentry, status) VALUES (?, ?, ?, ?, ?, ?)',
      [ctx.idtenant, ctx.idlokasi, dateQuery, setoran_tunai, ctx.iduser, 'AKTIF']
    );

    await conn.commit();
    res.json({ message: 'Closing harian berhasil disimpan' });
  } catch (err) {
    await conn.rollback();
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

// POST /api/pos/closing/batal
exports.batalClosing = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { tgltrans } = req.body;
    const dateQuery = tgltrans || new Date().toISOString().slice(0, 10);

    await pool.query(
      'DELETE FROM setorantunai WHERE idtenant = ? AND idlokasi = ? AND tgltrans = ?',
      [ctx.idtenant, ctx.idlokasi, dateQuery]
    );

    res.json({ message: 'Batal closing berhasil' });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// GET /api/pos/setting
exports.getSetting = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const nonTunai = await getConfigValue(pool, ctx.idtenant, 'POS', 'NON_TUNAI');
    const hargaIncludePpn = await getConfigValue(pool, ctx.idtenant, 'POS', 'HARGA_INCLUDE_PPN');
    const [[tenant]] = await pool.query('SELECT ppn FROM tenant WHERE idtenant = ?', [ctx.idtenant]);
    res.json({
      non_tunai: nonTunai ? JSON.parse(nonTunai) : [],
      harga_include_ppn: String(hargaIncludePpn || 'YA').toUpperCase() === 'YA',
      ppn_percent: parseFloat(tenant?.ppn || 0),
    });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};

// POST /api/pos/setting
exports.saveSetting = async (req, res) => {
  try {
    const ctx = getTenantContext();
    const { non_tunai, harga_include_ppn } = req.body;
    if (non_tunai) {
      await setConfigValue(pool, ctx.idtenant, 'POS', 'NON_TUNAI', JSON.stringify(non_tunai), ctx.iduser);
    }
    if (harga_include_ppn !== undefined) {
      await setConfigValue(pool, ctx.idtenant, 'POS', 'HARGA_INCLUDE_PPN', harga_include_ppn ? 'YA' : 'TIDAK', ctx.iduser);
    }
    res.json({ message: 'Setting berhasil disimpan' });
  } catch (err) {
    logger.error(err, { req });
    res.status(500).json({ message: err.message });
  }
};
