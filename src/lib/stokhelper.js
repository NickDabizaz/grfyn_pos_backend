// Helper untuk menghitung stok barang per lokasi pada tanggal tertentu.
// Menggabungkan data dari saldostok (stok awal per periode) dan kartustok (mutasi harian).

const { pool, getTenantContext } = require("../config/db");

/**
 * Menghitung stok suatu barang di suatu lokasi sampai dengan tanggal yang ditentukan.
 * Logika: stok = saldo_stok_terakhir_sebelum_tgl + SUM(mutasi_kartustok_setelah_saldo_sampai_tgl)
 *
 * @param {number} idbarang - ID barang
 * @param {number} idlokasi - ID lokasi
 * @param {string} tgl   - Tanggal batas perhitungan (YYYY-MM-DD)
 * @returns {number} Jumlah stok, 0 jika tidak ditemukan
 */
async function getStok(idbarang, idlokasi, tgl) {
    const ctx = getTenantContext();
    const idtenant = ctx.idtenant;

    const sql = `
        SELECT idbarang, idlokasi, SUM(jml) AS totalstok
        FROM (
            -- Bagian 1: Ambil saldo stok terakhir sebelum atau pada tanggal tgl
            SELECT b.idbarang, a.idlokasi, b.qty AS jml
            FROM saldostok a
                JOIN saldostokdtl b ON a.idsaldostok = b.idsaldostok AND b.idtenant = ?
            WHERE a.idtenant = ?
              AND a.idlokasi = ?
              AND b.idbarang = ?
              AND a.tgltrans = (
                  SELECT MAX(a1.tgltrans)
                  FROM saldostok a1
                      JOIN saldostokdtl b1 ON b1.idsaldostok = a1.idsaldostok AND b1.idtenant = ?
                  WHERE a1.idtenant = ?
                    AND a1.idlokasi = ?
                    AND b1.idbarang = ?
                    AND a1.tgltrans <= ?
              )

            UNION ALL

            -- Bagian 2: Ambil semua mutasi kartustok setelah saldo terakhir sampai tgl
            SELECT d.idbarang, d.idlokasi, CASE WHEN d.jenis = 'M' THEN d.jml ELSE -d.jml END AS jml
            FROM kartustok d
            WHERE d.idtenant = ?
              AND d.idlokasi = ?
              AND d.idbarang = ?
              AND d.tgltrans > (
                  SELECT COALESCE(MAX(a1.tgltrans), '1900-01-01')
                  FROM saldostok a1
                      JOIN saldostokdtl b1 ON b1.idsaldostok = a1.idsaldostok AND b1.idtenant = ?
                  WHERE a1.idtenant = ?
                    AND a1.idlokasi = ?
                    AND b1.idbarang = ?
                    AND a1.tgltrans <= ?
              )
              AND d.tgltrans <= ?
        ) stok
        GROUP BY idbarang, idlokasi
    `;

    const params = [
        idtenant, idtenant, idlokasi, idbarang,           // Bagian 1 JOIN + WHERE
        idtenant, idtenant, idlokasi, idbarang, tgl,      // Subquery saldo bagian 1
        idtenant, idlokasi, idbarang,                     // WHERE kartustok bagian 2
        idtenant, idtenant, idlokasi, idbarang, tgl,      // Subquery saldo bagian 2
        tgl,                                              // AND tgltrans <= tgl
    ];

    const [rows] = await pool.query(sql, params);

    if (rows.length === 0) return 0;
    return rows[0].totalstok ?? 0;
}

module.exports = {
    getStok,
}