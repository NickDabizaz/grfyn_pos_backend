const logger = require('./logger');

async function softDelete(conn, table, idField, idValue, idtenant) {
  const [[row]] = await conn.query(
    `SELECT \`${idField}\`, status FROM \`${table}\` WHERE \`${idField}\` = ? AND idtenant = ? LIMIT 1`,
    [idValue, idtenant]
  );
  if (!row) throw Object.assign(new Error('Data tidak ditemukan'), { code: 'NOT_FOUND' });
  if (row.status === 'DIHAPUS') throw Object.assign(new Error('Data sudah dihapus'), { code: 'ALREADY_DELETED' });

  await conn.query(
    `UPDATE \`${table}\` SET status = 'DIHAPUS' WHERE \`${idField}\` = ? AND idtenant = ?`,
    [idValue, idtenant]
  );
  return { deleted: true, id: idValue };
}

async function checkCanDelete(conn, tableChecks, idValue, idtenant) {
  const blockers = [];
  for (const { table, idField, label } of tableChecks) {
    const [[{ cnt }]] = await conn.query(
      `SELECT COUNT(*) as cnt FROM \`${table}\` WHERE \`${idField}\` = ? AND idtenant = ? AND (status IS NULL OR status != 'DIHAPUS')`,
      [idValue, idtenant]
    );
    if (cnt > 0) blockers.push(`${label} memiliki ${cnt} data terkait`);
  }
  return { canDelete: blockers.length === 0, blockers };
}

module.exports = { softDelete, checkCanDelete };
