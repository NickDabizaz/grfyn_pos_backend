async function getStok(idbarang, idlokasi, tgl) {
    const sql = `
        SELECT idbarang, idlokasi, SUM(jml) AS totalstok
        FROM (
            SELECT b.idbarang, a.idlokasi, b.jml
            FROM saldostok a
                JOIN saldostokdtl b ON a.idsaldostok = b.idsaldostok
            WHERE a.idlokasi = ?
              AND b.idbarang = ?
              AND a.tgltrans = (
                  SELECT MAX(a1.tgltrans)
                  FROM saldostok a1
                      JOIN saldostokdtl b1 ON b1.idsaldostok = a1.idsaldostok
                  WHERE a1.idlokasi = ?
                    AND b1.idbarang = ?
                    AND a1.tgltrans <= ?
              )

            UNION ALL

            SELECT d.idbarang, d.idlokasi, d.jml
            FROM kartustok d
            WHERE d.idlokasi = ?
              AND d.idbarang = ?
              AND d.tgltrans > (
                  SELECT COALESCE(MAX(a1.tgltrans), '1900-01-01')
                  FROM saldostok a1
                      JOIN saldostokdtl b1 ON b1.idsaldostok = a1.idsaldostok
                  WHERE a1.idlokasi = ?
                    AND b1.idbarang = ?
                    AND a1.tgltrans <= ?
              )
              AND d.tgltrans <= ?
        ) stok
        GROUP BY idbarang, idlokasi
    `;

    const params = [
        idlokasi, idbarang,          // WHERE saldostok
        idlokasi, idbarang, tgl,     // subquery saldo
        idlokasi, idbarang,          // WHERE kartustok
        idlokasi, idbarang, tgl,     // subquery kartu
        tgl                          // AND tgltrans <= tgl
    ];

    const [rows] = await db.query(sql, params);

    if (rows.length === 0) return 0;
    return rows[0].totalstok ?? 0;
}