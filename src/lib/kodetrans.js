async function generateKode(conn, prefix, idtenant, idlokasi, table, column) {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const dateStr = `${yy}${mm}${dd}`;

  const [[lokasi]] = await conn.query(
    'SELECT kodelokasi FROM lokasi WHERE idtenant = ? AND idlokasi = ?',
    [idtenant, idlokasi]
  );
  const kdlok = lokasi.kodelokasi;

  const kodepattern = `${prefix}.${kdlok}.${dateStr}.%`;

  await conn.query(`LOCK TABLES ${table} WRITE`);

  try {
    const [[{ maxKode }]] = await conn.query(
      `SELECT MAX(${column}) as maxKode FROM ${table}
       WHERE idtenant = ? AND idlokasi = ? AND ${column} LIKE ?`,
      [idtenant, idlokasi, kodepattern]
    );

    let num = 1;
    if (maxKode) {
      const parts = maxKode.split('.');
      num = parseInt(parts[parts.length - 1]) + 1;
    }

    const kode = `${prefix}.${kdlok}.${dateStr}.${String(num).padStart(3, '0')}`;

    return kode;
  } finally {
    await conn.query('UNLOCK TABLES');
  }
}

async function generateKodeJual(conn, idtenant, idlokasi) {
  return generateKode(conn, 'JL', idtenant, idlokasi, 'jual', 'kodejual');
}

async function generateKodeBeli(conn, idtenant, idlokasi) {
  return generateKode(conn, 'BL', idtenant, idlokasi, 'beli', 'kodebeli');
}

async function generateKodePenyesuaian(conn, idtenant, idlokasi) {
  return generateKode(conn, 'PS', idtenant, idlokasi, 'penyesuaianstok', 'kodepenyesuaianstok');
}

async function generateKodeKas(conn, idtenant, idlokasi) {
  return generateKode(conn, 'KS', idtenant, idlokasi, 'kas', 'kodekas');
}

async function generateKodeSaldoStok(conn, idtenant, idlokasi) {
  return generateKode(conn, 'SS', idtenant, idlokasi, 'saldostok', 'kodesaldostok');
}

async function generateKodeClosing(conn, idtenant, idlokasi) {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dateStr = `${yy}${mm}`;

  const [[lokasi]] = await conn.query(
    'SELECT kodelokasi FROM lokasi WHERE idtenant = ? AND idlokasi = ?',
    [idtenant, idlokasi]
  );
  const kdlok = lokasi.kodelokasi;

  const kodepattern = `CL.${kdlok}.${dateStr}.%`;

  await conn.query('LOCK TABLES closing WRITE');

  try {
    const [[{ maxKode }]] = await conn.query(
      `SELECT MAX(kodeclosing) as maxKode FROM closing
       WHERE idtenant = ? AND idlokasi = ? AND kodeclosing LIKE ?`,
      [idtenant, idlokasi, kodepattern]
    );

    let num = 1;
    if (maxKode) {
      const parts = maxKode.split('.');
      num = parseInt(parts[parts.length - 1]) + 1;
    }

    return `CL.${kdlok}.${dateStr}.${String(num).padStart(3, '0')}`;
  } finally {
    await conn.query('UNLOCK TABLES');
  }
}

async function generateKodeMaster(conn, prefix, idtenant, table, column, pad = 4) {
  const [[{ maxKode }]] = await conn.query(
    `SELECT MAX(${column}) as maxKode FROM ${table} WHERE idtenant = ?`,
    [idtenant]
  );

  let num = 1;
  if (maxKode) {
    const numStr = maxKode.replace(`${prefix}`, '');
    num = parseInt(numStr) + 1;
  }

  return `${prefix}${String(num).padStart(pad, '0')}`;
}

async function generateKodeHitungHPP(conn, idtenant, idlokasi, periodbulan) {
  const [yyyy, mm] = periodbulan.split('-');
  const dateStr = `${yyyy}${mm}`;

  const [[lokasi]] = await conn.query(
    'SELECT kodelokasi FROM lokasi WHERE idtenant = ? AND idlokasi = ?',
    [idtenant, idlokasi]
  );
  const kdlok = lokasi.kodelokasi;
  const pattern = `HPP.${kdlok}.${dateStr}.%`;

  await conn.query('LOCK TABLES hitunghpp WRITE');
  try {
    const [[{ maxKode }]] = await conn.query(
      `SELECT MAX(kodehitunghpp) as maxKode FROM hitunghpp
       WHERE idtenant = ? AND idlokasi = ? AND kodehitunghpp LIKE ?`,
      [idtenant, idlokasi, pattern]
    );
    let num = 1;
    if (maxKode) {
      const parts = maxKode.split('.');
      num = parseInt(parts[parts.length - 1]) + 1;
    }
    return `HPP.${kdlok}.${dateStr}.${String(num).padStart(3, '0')}`;
  } finally {
    await conn.query('UNLOCK TABLES');
  }
}

async function generateKodeReturJual(conn, idtenant, idlokasi) {
  return generateKode(conn, 'RJ', idtenant, idlokasi, 'returjual', 'kodereturjual');
}

async function generateKodeTukarBarang(conn, idtenant, idlokasi) {
  return generateKode(conn, 'TB', idtenant, idlokasi, 'tukarbarang', 'kodetukarbarang');
}

module.exports = {
  generateKode,
  generateKodeJual,
  generateKodeBeli,
  generateKodePenyesuaian,
  generateKodeKas,
  generateKodeSaldoStok,
  generateKodeClosing,
  generateKodeMaster,
  generateKodeHitungHPP,
  generateKodeReturJual,
  generateKodeTukarBarang,
};
